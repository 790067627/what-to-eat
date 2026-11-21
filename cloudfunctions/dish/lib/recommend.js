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

  /** 菜品口味向量：AI 提取的持久化特征（flavorProfiles 集合）优先，标签关键词规则回退。
   *  调用方应传入预取的 aiMap（getFeed 内批量取），避免逐卡查库。 */
  function flavorVectorOfDish(dish, aiMap) {
    const key = `${dish.type || 'own'}:${dish.id || dish._id}`;
    const ai = aiMap && aiMap[key];
    if (ai && ai.flavors) {
      const v = {};
      for (const k of Object.keys(FLAVOR_TAGS)) v[k] = clamp01(Number(ai.flavors[k]));
      return v;
    }
    const v = { spicy: 0, light: 0, carb: 0, sweet: 0, rich: 0 };
    const text = `${(dish.tags || []).join('')} ${dish.name} ${dish.categoryName || ''}`;
    for (const [dim, kws] of Object.entries(FLAVOR_TAGS)) {
      for (const kw of kws) if (text.includes(kw)) v[dim] += 0.5;
    }
    for (const k in v) v[k] = Math.min(1, v[k]);
    return v;
  }
  const clamp01 = v => (isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

  /** 批量预取 AI 口味特征（一次 where in，命中缓存集合 flavor_profiles） */
  async function fetchAiFlavors(keys) {
    const map = {};
    if (!keys.length) return map;
    try {
      const res = await db.collection('flavor_profiles')
        .where({ key: _.in(keys.slice(0, 50)) }).limit(50).get();
      (res.data || []).forEach(r => { map[r.key] = r; });
    } catch (e) { /* 集合未建 = 全回退规则 */ }
    return map;
  }

  const envStr = k => String(process.env[k] || '').replace(/^"|"$/g, '').trim();
  const hashKey = k => require('crypto').createHash('md5').update(k).digest('hex');

  /** 模型配置：与 airec 同源（控制台环境变量 AI_MODELS，JSON 数组 [{url,apiKey,name}]），主备顺序即切换顺序 */
  function getModels() {
    const raw = String(process.env.AI_MODELS || '');
    if (!raw) return [];
    // 工具链可能把值存成 JSON 字符串字面量（外层引号+内层转义引号），逐层 parse 直到数组
    let cur = raw;
    for (let i = 0; i < 3; i++) {
      try { cur = JSON.parse(cur); } catch (e) { break; }
      if (Array.isArray(cur)) break;
      if (typeof cur !== 'string') break;
    }
    return Array.isArray(cur) ? cur.filter(m => m && m.url && m.apiKey && m.name) : [];
  }

  /** 主备切换调用：逐模型尝试，解析 JSON，全失败返回 null。
   *  budget: { models, attempts } 控制成本——发布期提取用紧预算(1模型1次)，理由生成用宽预算 */
  async function callModelJson(models, prompt, timeoutMs, budget) {
    const b = budget || {};
    const mList = models.slice(0, b.models || models.length);
    const tries = b.attempts || 2;
    for (const m of mList) {
      for (let attempt = 0; attempt < tries; attempt++) {
        try {
          const resp = await httpsPostJson(m.url, {
            model: m.name, temperature: 0.3,
            enable_thinking: false,   // 复用 airec 经验：qwen3.x 默认开思考链，首字延迟极高，结构化任务必须关
            messages: [{ role: 'user', content: prompt + (attempt ? '\n只输出 JSON 对象本身。' : '') }]
          }, { Authorization: `Bearer ${m.apiKey}` }, timeoutMs);
          if (resp.status !== 200) { console.log('[ai] model=%s status=%s', m.name, resp.status); continue; }
          const text = String((((resp.body || {}).choices || [{}])[0].message || {}).content || '');
          const t = text.replace(/```json/gi, '').replace(/```/g, '').trim();
          const a = t.indexOf('{'), b = t.lastIndexOf('}');
          if (a < 0 || b <= a) continue;
          return JSON.parse(t.slice(a, b + 1));
        } catch (e) { console.log('[ai] model=%s 异常=%s', m.name, e.message || e); }
      }
    }
    return null;
  }

  /** AI 菜品口味特征提取（发布/入库时调用，或定时补齐）：
   *  输入菜名+标签+简介，输出 5 维口味向量 + 一句话口味描述；失败返回 null（保留规则值）。
   *  复用 airec 的 AI_MODELS 供应商配置与主备切换经验（httpsPostJson + 逐模型重试）。 */
  async function extractFlavors(dishKey, dish) {
    const models = getModels();
    console.log('[ai-extract] key=%s models=%d', dishKey, models.length);
    if (!models.length) return null;
    const prompt = [
      '你是菜品口味分析器。给定菜品信息，输出其口味特征向量（JSON，0~1 浮点）：',
      '{ "spicy": 辣度, "light": 清淡度, "carb": 主食碳水感, "sweet": 甜度, "rich": 浓郁下饭度, "note": "12字内口味描述" }',
      `菜品：${dish.name}；标签：${(dish.tags || []).join('、') || '无'}；简介：${(dish.description || '').slice(0, 60) || '无'}`,
      '只输出 JSON。'
    ].join('\n');
    const parsed = await callModelJson(models, prompt, 9000, { models: 1, attempts: 1 });
    console.log('[ai-extract] parsed=%s', parsed ? 'ok' : 'null');
    if (!parsed) return null;
    const flavors = {};
    for (const k of Object.keys(FLAVOR_TAGS)) flavors[k] = clamp01(Number(parsed[k]));
    const note = String(parsed.note || '').slice(0, 24);
    try {
      await db.collection('flavor_profiles').add({
        data: { _id: hashKey(dishKey), key: dishKey, flavors, note, src: 'ai', model: models[0].name, updatedAt: db.serverDate() }
      });
    } catch (e) {
      console.log('[ai-extract] add 冲突，走更新:', e.message || e);
      try {
        await db.collection('flavor_profiles').doc(hashKey(dishKey))
          .update({ data: { flavors, note, updatedAt: db.serverDate() } });
      } catch (e2) { /* 忽略 */ }
    }
    return { flavors, note };
  }

  /** 用户画像动态更新：把互动行为折算为口味增量写回 profiles.tastePrefs（隐式反馈）。
   *  规则：like/save/eat = 该菜口味向量 ×w 正向累加；not_interest = 负向；
   *  与显式设置合并（显式优先维度取 max 权重），衰减旧值（×0.9）防止画像僵化。
   *  触发时机：logBehavior 的 like/save/not_interest/eat（由 index.js 调用）。 */
  async function updateProfileFromBehavior(openid, type, refType, refId) {
    const W = { like: 0.15, save: 0.2, eat: 0.25, not_interest: -0.2, rate: 0.1 };
    const w = W[type];
    if (!w) return;
    const key = `${refType}:${refId}`;
    const aiMap = await fetchAiFlavors([key]);
    let fv = aiMap[key] && aiMap[key].flavors;
    if (!fv) {
      // 无 AI 特征时按菜名/标签规则向量（公开菜查 public_dishes，私有查 dishes）
      let dish = null;
      try {
        const col = refType === 'public' ? 'public_dishes' : 'dishes';
        const r = await db.collection(col).where(refType === 'public' ? { _id: refId } : { _id: refId, openid }).limit(1).get();
        dish = r.data && r.data[0];
      } catch (e) { /* ignore */ }
      if (!dish) return;
      fv = flavorVectorOfDish(Object.assign({ type: refType, id: refId }, dish), null);
    }
    let p = null;
    try {
      const r = await db.collection('profiles').where({ openid }).limit(1).get();
      p = r.data && r.data[0];
    } catch (e) { /* ignore */ }
    const cur = (p && p.tastePrefs) || { spicy: 0.5, light: 0.5, carb: 0.5, sweet: 0.5, rich: 0.5 };
    const next = {};
    for (const k of Object.keys(FLAVOR_TAGS)) {
      const decayed = (cur[k] == null ? 0.5 : cur[k]) * 0.9 + 0.05;   // 向中位衰减
      next[k] = clamp01(decayed + (fv[k] - 0.5) * w);
    }
    const col = db.collection('profiles');
    try { await db.createCollection('profiles'); } catch (e) { /* 已存在 */ }
    if (p) {
      await col.where({ openid }).update({ data: { tastePrefs: next, tasteUpdatedAt: db.serverDate() } });
    } else {
      await col.add({ data: { openid, tastePrefs: next, tasteUpdatedAt: db.serverDate(), createdAt: db.serverDate() } });
    }
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
    // 预取 AI 口味特征（一次批量查询，滑动链路零额外 DB 往返/零模型调用）

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
    const aiMap = await fetchAiFlavors(
      ownDishes.map(d => 'own:' + d._id).concat(publicPool.map(p => 'public:' + p._id))
    );
    ownDishes.forEach(d => {
      if (seenSet.has('own:' + d._id)) return;
      if (violatesAvoid(d, profile.avoid)) return;
      const fv = flavorVectorOfDish(d, aiMap);
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
      const fv = flavorVectorOfDish(p, aiMap);
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
        const dom = dominant(flavorVectorOfDish(c.dish, aiMap));
        const sameDom = last3.filter(x => dominant(flavorVectorOfDish(x.dish, aiMap)) === dom).length;
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
      buildReasons(openid, picked, profile, aiMap)
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
    // 展示精简：来源由徽章/副行独立展示、特征由标签展示，理由只解释「为什么适合你」
    return parts[0] + '。';
  }

  /** AI 理由缓存：public_ai_reasons 集合，键 = hash(菜名+标签+画像摘要)。
   *  getFeed 默认只读缓存；生成由 batchReasons 触发（每页最多 3 次调用，串行，失败回退模板）。
   *  大模型不进实时链路：缓存未命中先返回模板理由，后台异步补。 */
  async function buildReasons(openid, picked, profile, aiMap) {
    // 解释层零模型调用（任务书：大模型不参与每次滑动实时请求）：
    // 用户侧句子来自模板（真实画像信号），菜品侧理解来自发布期 AI 提取的 note（flavor_profiles 缓存）。
    return picked.map(c => {
      const base = templateReason(c, profile);
      const key = `${c.type}:${c.id}`;
      const note = aiMap && aiMap[key] && aiMap[key].note;
      return note ? `${base}AI 口味解读：${note}` : base;
    });
  }

  /** AI 推荐理由：复用 AI_MODELS 配置，6s 超时，失败返回 null（调用方回退模板） */
  async function genAiReason(dish, profile) {
    const models = getModels();
    if (!models.length) return null;
    const top = Object.entries(profile.taste).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join('/');
    const prompt = [
      `为点菜小程序写一句推荐语（40字内，口语化，禁止编造用户行为、禁止出现百分比数字）。`,
      `菜品：${dish.name}，标签：${(dish.tags || []).join('、') || '无'}，来源：${dish.authorNickname || '匿名'}的公开分享。`,
      `用户口味画像（0~1）：${JSON.stringify(profile.taste)}，主导维度：${top}。`,
      `只输出推荐语本身。`
    ].join('\n');
    const parsed = await callModelJson(models, prompt + '\n以 JSON 输出：{"reason": "..."}', 3000, { attempts: 1 });
    if (parsed && parsed.reason) return String(parsed.reason).slice(0, 60);
    return null;
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

  /** 离线补跑：对指定公开菜重新提取 AI 口味特征（控制台/脚本调用，不在实时链路） */
  async function regenDishAi({ event }) {
    const { publicDishId } = event;
    if (!publicDishId) return fail('缺少公开菜品 ID');
    const res = await db.collection('public_dishes').where({ _id: publicDishId }).limit(1).get();
    if (!res.data.length) return fail('记录不存在');
    const d = res.data[0];
    const out = await extractFlavors('public:' + d._id, d);
    return ok({ extracted: !!out, flavors: out && out.flavors, note: out && out.note });
  }

  return {
    getFeed, buildProfile, saveTastePrefs, getTastePrefs, templateReason, tasteScore, bandOf,
    extractFlavors, updateProfileFromBehavior, fetchAiFlavors, flavorVectorOfDish,
    regenDishAi, genAiReason
  };
};
