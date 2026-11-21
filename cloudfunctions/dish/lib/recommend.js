// cloudfunctions/dish/lib/recommend.js — 个性化推荐（规则引擎 + AI 理由缓存）
// 管道：候选召回 → 硬规则过滤 → 口味排序 → 多样性重排 → AI 解释（缓存，失败回退模板）
// 信号来源全部为现有数据：dishes.tags/rating/status、eat_logs、profiles（忌口/口味偏好）、公开池 likeCount
// 原则：口味匹配是第一排序键（band 硬约束），热度只作同带内辅助；大模型不参与实时滑动请求。
const crypto = require('crypto');

module.exports = function createRecommend({ cloud, db, _, ok, fail }) {

  /* ---------- 口味画像 ---------- */

  const FLAVOR_TAGS = {
    spicy: ['辣', '麻辣', '香辣', '酸辣', '川味', '重口'],
    light: ['清淡', '低卡', '轻食', '养生', '蒸', '白灼', '清爽'],
    carb: ['面食', '主食', '粉', '饭', '碳水'],
    sweet: ['甜', '甜品', '糖醋', '饮品'],
    rich: ['浓郁', '下饭', '红烧', '炖', '油焖', '家常']
  };

  function flavorVectorOfDish(dish) {
    const v = { spicy: 0, light: 0, carb: 0, sweet: 0, rich: 0 };
    const text = `${(dish.tags || []).join('')} ${dish.name} ${dish.categoryName || ''}`;
    for (const [dim, kws] of Object.entries(FLAVOR_TAGS)) {
      for (const kw of kws) if (text.includes(kw)) v[dim] += 0.5;
    }
    for (const k in v) v[k] = Math.min(1, v[k]);
    return v;
  }

  /** 从现有数据归纳口味画像：正反馈(often/高评分/吃过) vs 负反馈(never/跳过)，忌口来自 profiles */
  async function buildProfile(openid) {
    let profile = null;
    try {
      const res = await db.collection('profiles').where({ openid }).limit(1).get();
      profile = res.data && res.data[0];
    } catch (e) { /* 集合未建 */ }

    const [dishes, logs] = await Promise.all([
      safeList('dishes', { openid, deleted: false }),
      safeList('eat_logs', { openid })
    ]);
    const eatCount = {};
    logs.forEach(l => { eatCount[l.dishId] = (eatCount[l.dishId] || 0) + 1; });

    const taste = { spicy: 0, light: 0, carb: 0, sweet: 0, rich: 0 };
    let posWeight = 0, negWeight = 0;
    const neverNames = [];
    dishes.forEach(d => {
      const fv = flavorVectorOfDish(d);
      // 正反馈：often / rating>=4 / 吃过多次；负反馈：never。
      // 注意：新增菜默认 want，不算强正信号（任务书明确）。
      const eaten = eatCount[d._id] || 0;
      let w = 0;
      if (d.status === 'often') w += 2;
      if (d.status === 'never') { w = -2; neverNames.push(d.name); }
      if ((d.rating || 0) >= 4) w += 1.5;
      if (eaten >= 2) w += Math.min(2, eaten * 0.5);
      if (d.status === 'want' && w === 0) w = 0.3; // 弱信号
      for (const k in taste) taste[k] += fv[k] * w;
      if (w > 0) posWeight += w; else if (w < 0) negWeight -= w;
    });
    const total = posWeight + negWeight;
    const tasteNorm = {};
    for (const k in taste) {
      tasteNorm[k] = total > 0 ? (0.5 + taste[k] / (2 * total)) : 0.5;
      tasteNorm[k] = Math.max(0, Math.min(1, tasteNorm[k]));
    }
    // 用户显式口味设置（profiles.tastePrefs）覆盖归纳值；忌口（avoidTags）优先级最高
    const userPrefs = (profile && profile.tastePrefs) || null;
    const finalTaste = userPrefs ? Object.assign({}, tasteNorm, userPrefs) : tasteNorm;
    return {
      taste: finalTaste,
      avoid: (profile && Array.isArray(profile.avoidTags) ? profile.avoidTags : []),
      neverNames,
      hasHistory: dishes.length > 0,
      coldStart: !userPrefs && posWeight + negWeight < 2   // 新用户冷启动标记
    };
  }

  async function safeList(collection, where, limit = 200) {
    try {
      const res = await db.collection(collection).where(where).limit(limit).get();
      return res.data || [];
    } catch (e) { return []; }
  }

  /* ---------- 召回 + 排序 ---------- */

  function tasteScore(taste, fv) {
    let dot = 0, na = 0, nb = 0;
    for (const k of Object.keys(taste)) {
      const a = taste[k] || 0, b = fv[k] || 0;
      dot += a * b; na += a * a; nb += b * b;
    }
    if (!na || !nb) return 0.5;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  const bandOf = t => (t >= 0.62 ? 2 : t >= 0.48 ? 1 : 0);

  function violatesAvoid(item, avoid) {
    if (!avoid.length) return false;
    const text = `${(item.tags || []).join('')} ${item.name}`;
    return avoid.some(a => a && text.includes(a));
  }

  /**
   * 首页推荐 feed。参数：
   *  cursor: base64(JSON{seenIds:[...]})，短期曝光去重（客户端传回上次返回的游标）
   *  size:   每页条数（默认 6，上限 20）
   * 返回：{ items:[{type:'own'|'public', id, name, coverImageUrl, author, likeCount, liked,
   *                savedDishId, reason, tags}], nextCursor, hasMore, debug:{profile} }
   */
  async function getFeed({ openid, event }) {
    const size = Math.min(20, Math.max(3, Number(event.size) || 6));
    let seenIds = [];
    if (event.cursor) {
      try { seenIds = JSON.parse(Buffer.from(event.cursor, 'base64').toString('utf8')).seen || []; } catch (e) { /* 忽略非法游标 */ }
    }
    const seenSet = new Set(seenIds.slice(-100)); // 只保留最近 100 个曝光去重

    const profile = await buildProfile(openid);

    // ---- 候选召回 ----
    // 1) 自己的菜（非 never、非近期吃过——降权而非剔除）
    const ownDishes = await safeList('dishes', { openid, deleted: false, status: _.neq('never') });
    // 2) 公开池（approved；带分页与索引：status+updatedAt 排序，limit 拉取候选）
    let publicPool = [];
    try {
      const res = await db.collection('public_dishes')
        .where({ reviewStatus: 'approved' })
        .orderBy('updatedAt', 'desc')
        .limit(100).get();
      publicPool = res.data || [];
    } catch (e) { /* 集合未建 */ }
    // 3) 近期吃过（降权依据）
    const recentSince = new Date(Date.now() - 7 * 86400000);
    let recentLogs = [];
    try {
      const res = await db.collection('eat_logs').where({ openid, eatenAt: _.gte(recentSince) }).limit(100).get();
      recentLogs = res.data || [];
    } catch (e) { /* ignore */ }
    const recentCount = {};
    recentLogs.forEach(l => { recentCount[l.dishId] = (recentCount[l.dishId] || 0) + 1; });

    // ---- 硬过滤：忌口 + 曝光去重 ----
    const candidates = [];
    ownDishes.forEach(d => {
      if (seenSet.has('own:' + d._id)) return;
      if (violatesAvoid(d, profile.avoid)) return;
      const fv = flavorVectorOfDish(d);
      const taste = tasteScore(profile.taste, fv);
      const rep = recentCount[d._id] || 0;
      const recencyPenalty = rep >= 2 ? -0.25 : rep === 1 ? -0.1 : 0;
      candidates.push({
        type: 'own', id: d._id, dish: d, taste, band: bandOf(taste),
        heat: 0, extra: recencyPenalty,
        coldBoost: 0
      });
    });
    publicPool.forEach(p => {
      if (seenSet.has('public:' + p._id)) return;
      if (violatesAvoid(p, profile.avoid)) return;
      const fv = flavorVectorOfDish(p);
      const taste = tasteScore(profile.taste, fv);
      const heat = Math.min(1, (p.likeCount || 0) / 200);
      candidates.push({
        type: 'public', id: p._id, dish: p, taste, band: bandOf(taste),
        heat, extra: 0,
        coldBoost: profile.coldStart ? heat * 0.15 : Math.random() * 0.02 // 冷启动补热门 + 少量探索
      });
    });

    if (!candidates.length) {
      return ok({ items: [], nextCursor: '', hasMore: false, profile: { coldStart: profile.coldStart } });
    }

    // ---- 排序：口味带硬约束优先，带内综合分（热度只作辅助） ----
    candidates.forEach(c => {
      c.total = c.taste * 0.6 + c.heat * 0.1 + c.extra + c.coldBoost;
    });
    candidates.sort((a, b) => (b.band - a.band) || (b.total - a.total));

    // ---- 多样性重排：相邻 3 张内不重复来源类型超过 2 张、不重复主口味维度 ----
    const picked = [];
    const rest = candidates.slice();
    const dominant = fv => Object.keys(fv).reduce((a, b) => (fv[a] || 0) >= (fv[b] || 0) ? a : b);
    while (picked.length < size && rest.length) {
      let idx = rest.findIndex(c => {
        const last3 = picked.slice(-2);
        const sameType = last3.filter(x => x.type === c.type).length;
        if (sameType >= 2) return false;
        const dom = dominant(flavorVectorOfDish(c.dish));
        const sameDom = last3.filter(x => dominant(flavorVectorOfDish(x.dish)) === dom).length;
        return sameDom < 2;
      });
      if (idx < 0) idx = 0; // 全被多样性约束挡住时按分取
      picked.push(rest.splice(idx, 1)[0]);
    }

    // ---- 组装响应（含互动状态批量查询） ----
    const publicIds = picked.filter(p => p.type === 'public').map(p => p.id);
    const [likeMap, savedMap, reasons] = await Promise.all([
      batchLiked(openid, publicIds),
      batchSaved(openid, publicIds),
      buildReasons(openid, picked, profile)
    ]);

    // 封面临时 URL
    const fileIDs = [];
    picked.forEach(p => {
      const cov = p.dish.coverImage;
      if (cov) fileIDs.push(cov);
      if (p.type === 'public' && p.dish.authorAvatar) fileIDs.push(p.dish.authorAvatar);
    });
    const urlMap = {};
    if (fileIDs.length) {
      try {
        const urlRes = await cloud.getTempFileURL({ fileList: fileIDs });
        urlRes.fileList.forEach(f => { if (f.status === 0) urlMap[f.fileID] = f.tempFileURL; });
      } catch (e) { /* 降级 fileID */ }
    }

    const items = picked.map((p, i) => {
      const d = p.dish;
      const item = {
        type: p.type,
        id: p.id,
        name: d.name,
        coverImageUrl: urlMap[d.coverImage] || d.coverImage || '',
        coverFileID: d.coverImage || '',
        tags: (d.tags || []).slice(0, 3),
        reason: reasons[i],
        matchTag: matchTagText(d, profile),
        seenKey: `${p.type}:${p.id}`
      };
      if (p.type === 'public') {
        item.author = { nickname: d.authorNickname || '匿名厨友', avatarUrl: urlMap[d.authorAvatar] || '' };
        item.anonymous = !!d.anonymous;
        item.likeCount = d.likeCount || 0;
        item.liked = !!likeMap[p.id];
        item.savedDishId = savedMap[p.id] || '';
        item.categoryName = d.categoryName || '';
      } else {
        item.author = null;
        item.rating = d.rating || 0;
        item.status = d.status;
        item.savedDishId = d._id;   // 自己的菜直接就是私人 ID
        item.liked = false;          // 私有菜不显示社区点赞（不伪造）
        item.likeCount = 0;
      }
      return item;
    });

    // 游标：合并已见 ID（上限 100）
    const newSeen = seenIds.concat(items.map(i => i.seenKey)).slice(-100);
    const nextCursor = Buffer.from(JSON.stringify({ seen: newSeen })).toString('base64');
    const hasMore = rest.length > 0 || seenIds.length > 0; // 环形队列：去重池用尽后允许重置

    return ok({
      items,
      nextCursor: hasMore ? nextCursor : '',
      hasMore,
      profile: { coldStart: profile.coldStart, hasHistory: profile.hasHistory }
    });
  }

  async function batchLiked(openid, publicIds) {
    const map = {};
    if (!publicIds.length) return map;
    try {
      const res = await db.collection('public_dish_likes').where({
        openid, publicDishId: _.in(publicIds), deleted: false
      }).limit(100).get();
      (res.data || []).forEach(r => { map[r.publicDishId] = true; });
    } catch (e) { /* 集合未建 */ }
    return map;
  }

  async function batchSaved(openid, publicIds) {
    const map = {};
    if (!publicIds.length) return map;
    try {
      const res = await db.collection('dishes').where({
        openid, sourcePublicDishId: _.in(publicIds), deleted: false
      }).limit(100).get();
      (res.data || []).forEach(r => { map[r.sourcePublicDishId] = r._id; });
    } catch (e) { /* ignore */ }
    return map;
  }

  function matchTagText(dish, profile) {
    const fv = flavorVectorOfDish(dish);
    const t = profile.taste;
    if (t.spicy > 0.6 && fv.spicy > 0.4) return '符合你的香辣偏好';
    if (t.light > 0.6 && fv.light > 0.4) return '符合你的清淡偏好';
    if (t.carb > 0.6 && fv.carb > 0.4) return '符合你的面食偏好';
    if (t.sweet > 0.5 && fv.sweet > 0.4) return '符合你的嗜甜偏好';
    if (t.rich > 0.6 && fv.rich > 0.4) return '符合你的下饭偏好';
    if (profile.coldStart) return '新灵感 · 试试口味偏好设置';
    return '值得一试的新灵感';
  }

  /* ---------- 推荐理由：模板先行 + AI 批量生成（缓存，失败回退） ---------- */

  function templateReason(c, profile) {
    const d = c.dish;
    const fv = flavorVectorOfDish(d);
    const parts = [];
    const t = profile.taste;
    if (t.spicy > 0.6 && fv.spicy > 0.4) parts.push('你最近偏爱香辣口，这道辣度正好');
    else if (t.light > 0.6 && fv.light > 0.4) parts.push('你在走清淡路线，这道负担很小');
    else if (t.carb > 0.6 && fv.carb > 0.4) parts.push('你是面食胃，这道碳水满足感刚好');
    else if (t.sweet > 0.5 && fv.sweet > 0.4) parts.push('记得你爱甜，这道甜得清爽');
    else parts.push('和你最近的口味记录对得上');
    if (c.type === 'public') {
      parts.push(`来自${d.authorNickname || '匿名厨友'}的公开分享`);
      if ((d.likeCount || 0) >= 50) parts.push('社区反响不错');
    } else {
      parts.push('你自己的菜单');
    }
    return parts.slice(0, 2).join('；') + '。';
  }

  /** AI 理由缓存：public_ai_reasons 集合，键 = hash(菜名+标签+画像摘要)。
   *  getFeed 默认只读缓存；生成由 batchReasons 触发（每页最多 3 次调用，串行，失败回退模板）。
   *  大模型不进实时链路：缓存未命中先返回模板理由，后台异步补。 */
  async function buildReasons(openid, picked, profile) {
    const out = picked.map(c => templateReason(c, profile));
    // 异步补 AI 缓存（不阻塞响应）：仅公开菜、每次最多 3 条
    const targets = picked
      .map((c, i) => ({ c, i }))
      .filter(x => x.c.type === 'public')
      .slice(0, 3);
    if (!targets.length || process.env.AI_REASON_ENABLED !== 'true') return out;

    const tasteKey = Object.keys(profile.taste).map(k => `${k}:${profile.taste[k].toFixed(1)}`).join(',');
    for (const { c, i } of targets) {
      const key = crypto.createHash('md5').update(`${c.dish.name}|${(c.dish.tags || []).join(',')}|${tasteKey}`).digest('hex');
      try {
        const cached = await db.collection('ai_reason_cache').doc(key).get();
        if (cached.data && cached.data.text) { out[i] = cached.data.text; continue; }
      } catch (e) { /* 未命中 */ }
      const text = await genAiReason(c.dish, profile);
      if (text) {
        out[i] = text;
        try {
          await db.collection('ai_reason_cache').add({ data: { _id: key, text, createdAt: db.serverDate() } });
        } catch (e) { /* 并发重复忽略 */ }
      }
    }
    return out;
  }

  /** 复用 airec 的模型配置经验（AI_MODELS 环境变量），纯文本小请求，5s 超时，失败返回 null */
  async function genAiReason(dish, profile) {
    if (!process.env.AI_MODELS) return null;
    let models = [];
    try { models = JSON.parse(process.env.AI_MODELS).filter(m => m && m.url && m.apiKey); } catch (e) { return null; }
    if (!models.length) return null;
    const top = Object.entries(profile.taste).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join('/');
    const prompt = [
      `为点菜小程序写一句推荐语（40字内，口语化，禁止编造用户行为、禁止出现百分比数字）。`,
      `菜品：${dish.name}，标签：${(dish.tags || []).join('、') || '无'}，来源：${dish.authorNickname || '匿名'}的公开分享。`,
      `用户口味画像（0~1）：${JSON.stringify(profile.taste)}，主导维度：${top}。`,
      `只输出推荐语本身。`
    ].join('\n');
    const m = models[0];
    try {
      const resp = await httpsPostJson(m.url, {
        model: m.name, temperature: 0.7,
        messages: [{ role: 'user', content: prompt }]
      }, { Authorization: `Bearer ${m.apiKey}` }, 5000);
      if (resp.status !== 200) return null;
      const text = String(((resp.body || '').choices || [{}])[0].message?.content || '').trim().slice(0, 60);
      return text || null;
    } catch (e) { return null; }
  }

  function httpsPostJson(url, bodyObj, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const payload = JSON.stringify(bodyObj);
      const req = require('https').request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, headers)
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body = raw; try { body = JSON.parse(raw); } catch (e) { /* keep raw */ }
          resolve({ status: res.statusCode, body });
        });
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('TIMEOUT')));
      req.on('error', reject);
      req.write(payload); req.end();
    });
  }

  /** 口味偏好设置（冷启动 + 忌口），写 profiles */
  async function saveTastePrefs({ openid, event }) {
    const { tastePrefs, avoidTags } = event;
    const col = db.collection('profiles');
    try { await db.createCollection('profiles'); } catch (e) { /* 已存在 */ }
    const data = { updatedAt: db.serverDate() };
    if (tastePrefs && typeof tastePrefs === 'object') {
      const clean = {};
      ['spicy', 'light', 'carb', 'sweet', 'rich'].forEach(k => {
        const v = Number(tastePrefs[k]);
        if (isFinite(v)) clean[k] = Math.max(0, Math.min(1, v));
      });
      data.tastePrefs = clean;
    }
    if (Array.isArray(avoidTags)) {
      data.avoidTags = avoidTags.map(t => String(t).slice(0, 10)).filter(Boolean).slice(0, 10);
    }
    const exist = await col.where({ openid }).limit(1).get();
    if (exist.data && exist.data.length) {
      await col.where({ openid }).update({ data });
    } else {
      await col.add({ data: Object.assign({ openid, createdAt: db.serverDate() }, data) });
    }
    return ok(true);
  }

  async function getTastePrefs({ openid }) {
    try {
      const res = await db.collection('profiles').where({ openid }).limit(1).get();
      const p = res.data && res.data[0];
      return ok({ tastePrefs: (p && p.tastePrefs) || null, avoidTags: (p && p.avoidTags) || [] });
    } catch (e) { return ok({ tastePrefs: null, avoidTags: [] }); }
  }

  return { getFeed, buildProfile, saveTastePrefs, getTastePrefs, templateReason, tasteScore, bandOf };
};
