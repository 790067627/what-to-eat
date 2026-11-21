// cloudfunctions/dish/lib/discovery.js — 公开菜品 / 定向分享 / 点赞 / 一键加入 / 行为记录
// 设计原则：
//  - 私人菜品（dishes）永远只有 owner 可读；对外只有两条通道：
//    ① 公开发布 public_dishes（独立快照 + 审核状态，图片复制副本）
//    ② 好友定向分享 dish_shares（服务端签发 token，快照白名单字段，有效期）
//  - 公开快照不回写 dishes，两态隔离（撤回公开不影响私人菜）
//  - 所有计数服务端维护，客户端传入数量一律忽略
const crypto = require('crypto');

const SHARE_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000; // 定向分享凭证 7 天有效
// 定向分享允许携带的字段白名单（不含 openid / 价格 / 私人状态）
const SHARE_FIELDS = ['name', 'coverImage', 'images', 'description', 'tags', 'categoryName'];

module.exports = function createDiscovery({ cloud, db, _, ok, fail, fetchAll }) {

  async function ensureDiscoveryCollections() {
    for (const name of ['public_dishes', 'dish_shares', 'public_dish_likes', 'user_behaviors']) {
      try { await db.createCollection(name); } catch (e) { /* 已存在 */ }
    }
  }

  function adminOpenids() {
    return String(process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  /** 用户公开身份：匿名 / 昵称（profiles.publicMode）。返回快照用 {nickname, avatarFileID} */
  async function resolvePublicIdentity(openid, forceAnonymous) {
    let p = null;
    try {
      const res = await db.collection('profiles').where({ openid }).limit(1).get();
      p = res.data && res.data[0];
    } catch (e) { /* 集合未建 */ }
    const anonymous = forceAnonymous || !p || p.publicMode === 'anonymous';
    return {
      nickname: anonymous ? '匿名厨友' : (p.publicNickname || p.nickname || '匿名厨友'),
      avatarFileID: anonymous ? '' : (p.avatarFileID || '')
    };
  }

  /** 文本内容安全检查。openapi 行为以官方文档为准；失败时返回 unavailable（走人工审核兜底，不放行） */
  async function checkText(openid, text) {
    if (!text || !text.trim()) return { pass: true };
    try {
      // msgSecCheck v2：需要 openid + scene（2=评论/发布场景）。若环境不支持会抛错 → unavailable
      const res = await cloud.openapi.security.msgSecCheck({
        version: 2,
        openid,
        scene: 2,
        content: text.slice(0, 2500)
      });
      // v2 返回 result.suggest: 'pass' | 'review' | 'risky'
      const suggest = res && res.result && res.result.suggest;
      if (suggest === 'pass') return { pass: true };
      if (suggest === 'risky') return { pass: false };
      return { pass: false, review: true }; // review → 转人工
    } catch (e) {
      console.warn('[discovery] msgSecCheck 调用失败，转人工审核:', e.message || e);
      return { pass: false, review: true, unavailable: true };
    }
  }

  /** 复制私人云存储图片到公共目录（发布快照的图片生命周期与原件解耦） */
  async function copyToPublic(fileID, publicDishKey, tag) {
    if (!fileID || String(fileID).indexOf('cloud://') !== 0) return '';
    try {
      const dl = await cloud.downloadFile({ fileID });
      if (!dl.fileContent) return '';
      const extMatch = String(fileID).match(/\.(jpe?g|png|webp|gif)(\?|$)/i);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      const cloudPath = `public_dishes/${publicDishKey}/${tag}_${Date.now()}.${ext}`;
      const up = await cloud.uploadFile({ cloudPath, fileContent: dl.fileContent });
      return up.fileID || '';
    } catch (e) {
      console.warn('[discovery] 图片复制失败:', e.message || e);
      return '';
    }
  }

  /* ==================== 公开发布 ==================== */

  /** 发布到我的公开快照。options: { includePrice, includeDescription, anonymous }
   *  同一私人菜重复发布 = 更新快照并重新送审（pending）。 */
  async function publishDish({ openid, event }) {
    await ensureDiscoveryCollections();
    const { dishId, options = {} } = event;
    if (!dishId) return fail('缺少菜品 ID');

    const res = await db.collection('dishes').where({ _id: dishId, openid, deleted: false }).get();
    if (!res.data.length) return fail('菜品不存在或无权操作');
    const dish = res.data[0];

    // 公开内容文本安检（菜名 + 简介 + 标签）
    const textParts = [dish.name, options.includeDescription === false ? '' : (dish.description || ''), (dish.tags || []).join(' ')];
    const chk = await checkText(openid, textParts.filter(Boolean).join('\n'));
    if (!chk.pass && !chk.review) return fail('内容未通过安全检查，请修改后再发布');

    // 分类名快照（不暴露私人 categoryId）
    let categoryName = '';
    if (dish.categoryId) {
      const cat = await db.collection('categories').where({ _id: dish.categoryId, openid }).get();
      if (cat.data.length) categoryName = cat.data[0].name || '';
    }

    const identity = await resolvePublicIdentity(openid, !!options.anonymous);

    // 图片复制副本（封面必复制；附图最多 3 张控制成本）
    const pubKey = crypto.createHash('md5').update(`${openid}_${dishId}`).digest('hex').slice(0, 16);
    const coverPublic = await copyToPublic(dish.coverImage, pubKey, 'cover');
    const imagesPublic = [];
    for (const img of (dish.images || []).slice(0, 3)) {
      const fid = await copyToPublic(img, pubKey, 'img');
      if (fid) imagesPublic.push(fid);
    }

    const snapshot = {
      sourceDishId: dishId,
      authorOpenid: openid,                 // 仅服务端使用，接口响应剔除
      authorNickname: identity.nickname,
      authorAvatar: identity.avatarFileID,
      anonymous: !!options.anonymous || identity.nickname === '匿名厨友',
      name: dish.name,
      coverImage: coverPublic || dish.coverImage || '',
      images: imagesPublic,
      description: options.includeDescription === false ? '' : (dish.description || ''),
      includePrice: !!options.includePrice,
      price: options.includePrice ? (dish.price == null ? null : dish.price) : null,
      tags: Array.isArray(dish.tags) ? dish.tags.slice(0, 10) : [],
      categoryName,
      likeCount: 0,
      saveCount: 0,
      updatedAt: db.serverDate()
    };

    // 审核状态：文本安检 review/不可用 → pending 人工；明确 pass → 仍进 pending（首发不自动过审，
    // 配置 AUTO_APPROVE=pass_security 且安检明确通过时直接 approved，便于联调，生产默认不开）
    let reviewStatus = 'pending';
    if (chk.pass && process.env.AUTO_APPROVE === 'pass_security') reviewStatus = 'approved';
    snapshot.reviewStatus = reviewStatus;
    snapshot.secCheck = chk.unavailable ? 'unavailable' : (chk.review ? 'review' : 'pass');

    // 同一私人菜只保留一条公开记录（重复发布 = 更新并重新送审）
    const exist = await db.collection('public_dishes').where({ sourceDishId: dishId, authorOpenid: openid }).limit(1).get();
    if (exist.data.length) {
      const old = exist.data[0];
      snapshot.likeCount = old.likeCount || 0;   // 互动数据保留
      snapshot.saveCount = old.saveCount || 0;
      snapshot.publishedAt = old.publishedAt || null;
      await db.collection('public_dishes').doc(old._id).update({ data: snapshot });
      return ok({ publicDishId: old._id, reviewStatus });
    }
    snapshot.publishedAt = null;
    snapshot.withdrawnAt = null;
    snapshot.createdAt = db.serverDate();
    const add = await db.collection('public_dishes').add({ data: snapshot });
    return ok({ publicDishId: add._id, reviewStatus });
  }

  /** 撤回公开：approved/pending → withdrawn，立即退出推荐池；已保存的副本不受影响 */
  async function withdrawPublicDish({ openid, event }) {
    const { publicDishId, dishId } = event;
    const where = { authorOpenid: openid };
    if (publicDishId) where._id = publicDishId;
    else if (dishId) where.sourceDishId = dishId;
    else return fail('缺少参数');
    const res = await db.collection('public_dishes').where(where).limit(1).get();
    if (!res.data.length) return fail('公开记录不存在');
    const doc = res.data[0];
    if (doc.reviewStatus === 'withdrawn') return ok({ publicDishId: doc._id, reviewStatus: 'withdrawn' });
    await db.collection('public_dishes').doc(doc._id).update({
      data: { reviewStatus: 'withdrawn', withdrawnAt: db.serverDate(), updatedAt: db.serverDate() }
    });
    return ok({ publicDishId: doc._id, reviewStatus: 'withdrawn' });
  }

  /** 我的发布列表（含各审核状态） */
  async function listMyPublications({ openid }) {
    await ensureDiscoveryCollections();
    let list = [];
    try {
      const res = await db.collection('public_dishes').where({ authorOpenid: openid })
        .orderBy('updatedAt', 'desc').limit(50).get();
      list = res.data;
    } catch (e) { /* 集合未建 */ }
    // 剔除服务端字段
    return ok(list.map(d => stripAuthor(d)));
  }

  function stripAuthor(d) {
    const { authorOpenid, secCheck, ...rest } = d;
    return rest;
  }

  /** 管理员审核（ADMIN_OPENIDS 环境变量）。action: reviewPublicDish { publicDishId, approve } */
  async function reviewPublicDish({ openid, event }) {
    if (!adminOpenids().includes(openid)) return fail('无审核权限');
    const { publicDishId, approve } = event;
    if (!publicDishId) return fail('缺少公开菜品 ID');
    const res = await db.collection('public_dishes').where({ _id: publicDishId }).get();
    if (!res.data.length) return fail('记录不存在');
    const status = approve ? 'approved' : 'rejected';
    const data = { reviewStatus: status, updatedAt: db.serverDate() };
    if (approve && !res.data[0].publishedAt) data.publishedAt = db.serverDate();
    await db.collection('public_dishes').doc(publicDishId).update({ data });
    return ok({ publicDishId, reviewStatus: status });
  }

  /** 读取公开菜品详情：仅 approved；作者本人可读自己的任意状态（管理需要） */
  async function getPublicDish({ openid, event }) {
    const { id } = event;
    if (!id) return fail('缺少公开菜品 ID');
    const res = await db.collection('public_dishes').where({ _id: id }).get();
    if (!res.data.length) return fail('公开菜品不存在');
    const doc = res.data[0];
    const isAuthor = doc.authorOpenid === openid;
    if (doc.reviewStatus !== 'approved' && !isAuthor) return fail('该公开菜品不可访问');
    const out = stripAuthor(doc);
    out.isAuthor = isAuthor;
    // 我的互动状态
    out.liked = await hasLiked(openid, id);
    const saved = await findSavedCopy(openid, id);
    out.savedDishId = saved ? saved._id : '';
    // 封面临时 URL
    await attachPublicUrls([out]);
    return ok(out);
  }

  async function attachPublicUrls(list) {
    const fileIDs = [];
    list.forEach(d => {
      if (d.coverImage) fileIDs.push(d.coverImage);
      (d.images || []).forEach(f => fileIDs.push(f));
      if (d.authorAvatar) fileIDs.push(d.authorAvatar);
    });
    if (!fileIDs.length) return;
    try {
      const urlRes = await cloud.getTempFileURL({ fileList: fileIDs });
      const map = {};
      urlRes.fileList.forEach(f => { if (f.status === 0) map[f.fileID] = f.tempFileURL; });
      list.forEach(d => {
        if (d.coverImage && map[d.coverImage]) d.coverImageUrl = map[d.coverImage];
        if (d.authorAvatar && map[d.authorAvatar]) d.authorAvatarUrl = map[d.authorAvatar];
        if (d.images && d.images.length) d.imagesUrl = d.images.map(f => map[f] || f);
      });
    } catch (e) { console.warn('[discovery] 临时URL失败:', e.message); }
  }

  /* ==================== 点赞（公共菜品） ==================== */

  async function hasLiked(openid, publicDishId) {
    try {
      const res = await db.collection('public_dish_likes').doc(likeDocId(openid, publicDishId)).get();
      return !!(res.data && !res.data.deleted);
    } catch (e) { return false; }
  }
  const likeDocId = (openid, pid) => `${openid}_${pid}`;

  /** 点赞/取消。确定性 _id 保证同一用户对同一公开菜只有一条关系；并发重复 add 会失败 → 幂等。
   *  计数用 _.inc 原子增减，不信任客户端数值；失败回滚（inc 失败时删除关系文档）。 */
  async function likePublicDish({ openid, event }) {
    await ensureDiscoveryCollections();
    const { id, like } = event;
    if (!id) return fail('缺少公开菜品 ID');
    const pub = await db.collection('public_dishes').where({ _id: id, reviewStatus: 'approved' }).get();
    if (!pub.data.length) return fail('公开菜品不存在或已下架');

    const docId = likeDocId(openid, id);
    const col = db.collection('public_dish_likes');
    let existed = null;
    try { existed = (await col.doc(docId).get()).data; } catch (e) { existed = null; }

    if (like) {
      if (existed && !existed.deleted) {
        return ok({ liked: true, likeCount: pub.data[0].likeCount || 0 }); // 幂等
      }
      if (existed && existed.deleted) {
        // 复活旧记录
        await col.doc(docId).update({ data: { deleted: false, createdAt: db.serverDate() } });
      } else {
        try {
          await col.add({ data: { _id: docId, openid, publicDishId: id, deleted: false, createdAt: db.serverDate() } });
        } catch (e) {
          // 并发下已被创建 → 视为成功幂等
          return ok({ liked: true, likeCount: (pub.data[0].likeCount || 0) });
        }
      }
      try {
        await db.collection('public_dishes').doc(id).update({ data: { likeCount: _.inc(1) } });
      } catch (e) {
        await col.doc(docId).update({ data: { deleted: true } }); // 回滚
        return fail('操作失败，请重试');
      }
      const now = await db.collection('public_dishes').doc(id).get();
      return ok({ liked: true, likeCount: (now.data && now.data.likeCount) || 0 });
    } else {
      if (!existed || existed.deleted) {
        return ok({ liked: false, likeCount: pub.data[0].likeCount || 0 }); // 幂等
      }
      await col.doc(docId).update({ data: { deleted: true } });
      try {
        await db.collection('public_dishes').doc(id).update({ data: { likeCount: _.inc(-1) } });
      } catch (e) {
        await col.doc(docId).update({ data: { deleted: false } }); // 回滚
        return fail('操作失败，请重试');
      }
      const now = await db.collection('public_dishes').doc(id).get();
      return ok({ liked: false, likeCount: Math.max(0, (now.data && now.data.likeCount) || 0) });
    }
  }

  /* ==================== 一键加入我的菜单（公共菜品） ==================== */

  async function findSavedCopy(openid, publicDishId) {
    try {
      const res = await db.collection('dishes').doc(copyDocId(openid, publicDishId)).get();
      return res.data || null;
    } catch (e) { return null; }
  }
  // 业务键 = openid + sourcePublicDishId，用确定性文档 ID 实现（并发 add 冲突即幂等）
  const copyDocId = (openid, pid) => `cp_${openid}_${pid}`;

  /** 分类映射：按公开快照的 categoryName 找当前用户同名未删分类；无则归未分类('') */
  async function mapCategory(openid, categoryName) {
    if (!categoryName) return '';
    try {
      const res = await db.collection('categories')
        .where({ openid, name: categoryName, deleted: false }).limit(1).get();
      return res.data.length ? res.data[0]._id : '';
    } catch (e) { return ''; }
  }

  /** 一键加入：读 approved 快照 → 幂等创建私人副本（独立 _id / 分类映射 / 评分不继承 / want / 私有）
   *  软删除副本再次加入 = 恢复原副本。图片引用发布时的公共副本 fileID（与原作者私人库解耦）。 */
  async function savePublicDish({ openid, event }) {
    await ensureDiscoveryCollections();
    const { id } = event;
    if (!id) return fail('缺少公开菜品 ID');

    const pub = await db.collection('public_dishes').where({ _id: id, reviewStatus: 'approved' }).get();
    if (!pub.data.length) return fail('该公开菜品已下架或不可保存');
    const p = pub.data[0];

    const docId = copyDocId(openid, id);
    const col = db.collection('dishes');

    // 已存在（含软删）→ 恢复或幂等返回
    let existed = null;
    try { existed = (await col.doc(docId).get()).data; } catch (e) { existed = null; }
    if (existed) {
      if (existed.deleted) {
        await col.doc(docId).update({ data: { deleted: false, status: 'want', updatedAt: db.serverDate() } });
      }
      return ok({ dishId: docId, duplicated: true, restored: !!existed.deleted });
    }

    const categoryId = await mapCategory(openid, p.categoryName);
    try {
      await col.add({
        data: {
          _id: docId,
          openid,
          name: p.name,
          categoryId,                              // 绝不继承原作者 categoryId
          coverImage: p.coverImage || '',          // 公共副本 fileID
          images: Array.isArray(p.images) ? p.images.slice(0, 9) : [],
          description: p.description || '',
          price: p.includePrice ? (p.price == null ? null : p.price) : null,
          tags: Array.isArray(p.tags) ? p.tags.slice(0, 10) : [],
          rating: 0,                               // 不继承作者评分
          status: 'want',
          deleted: false,
          sourcePublicDishId: id,                  // 来源关系
          sourceAuthor: { nickname: p.authorNickname, avatar: p.authorAvatar || '' },
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
    } catch (e) {
      // 并发冲突：另一请求已创建 → 幂等返回
      const again = await findSavedCopy(openid, id);
      if (again) return ok({ dishId: again._id, duplicated: true });
      return fail('保存失败，请重试');
    }
    try {
      await db.collection('public_dishes').doc(id).update({ data: { saveCount: _.inc(1) } });
    } catch (e) { /* 计数失败不影响主流程 */ }
    return ok({ dishId: docId, duplicated: false });
  }

  /* ==================== 好友定向分享（token 凭证） ==================== */

  /** 签发分享凭证：仅 owner 可为自己的菜签发；快照白名单字段，7 天有效 */
  async function createShareToken({ openid, event }) {
    await ensureDiscoveryCollections();
    const { dishId } = event;
    if (!dishId) return fail('缺少菜品 ID');
    const res = await db.collection('dishes').where({ _id: dishId, openid, deleted: false }).get();
    if (!res.data.length) return fail('菜品不存在或无权分享');
    const dish = res.data[0];

    let categoryName = '';
    if (dish.categoryId) {
      const cat = await db.collection('categories').where({ _id: dish.categoryId, openid }).get();
      if (cat.data.length) categoryName = cat.data[0].name || '';
    }

    const snapshot = {};
    SHARE_FIELDS.forEach(k => {
      if (k === 'categoryName') snapshot.categoryName = categoryName;
      else snapshot[k] = dish[k];
    });

    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('dish_shares').add({
      data: {
        token,
        openid,                    // 签发者（服务端内部）
        dishId,
        snapshot,
        expiresAt: new Date(Date.now() + SHARE_TOKEN_TTL_MS),
        createdAt: db.serverDate()
      }
    });
    return ok({ token, expiresAt: Date.now() + SHARE_TOKEN_TTL_MS });
  }

  async function readShare(token) {
    const res = await db.collection('dish_shares').where({ token }).limit(1).get();
    if (!res.data.length) return null;
    const doc = res.data[0];
    if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) return null;
    return doc;
  }

  /** 通过凭证读分享快照（不等于公开发布；响应不含签发者 openid / 原菜品 ID） */
  async function getSharedDish({ event }) {
    const { token } = event;
    if (!token) return fail('缺少分享凭证');
    const doc = await readShare(token);
    if (!doc) return fail('分享链接已过期或无效');
    const out = Object.assign({}, doc.snapshot);
    // 图片临时 URL（快照 fileID 属签发者，接收方需临时链接访问）
    const fileIDs = [];
    if (out.coverImage) fileIDs.push(out.coverImage);
    (out.images || []).forEach(f => fileIDs.push(f));
    if (fileIDs.length) {
      try {
        const urlRes = await cloud.getTempFileURL({ fileList: fileIDs });
        const map = {};
        urlRes.fileList.forEach(f => { if (f.status === 0) map[f.fileID] = f.tempFileURL; });
        if (out.coverImage && map[out.coverImage]) out.coverImageUrl = map[out.coverImage];
        if (out.images && out.images.length) out.imagesUrl = out.images.map(f => map[f] || f);
      } catch (e) { /* 降级 fileID */ }
    }
    return ok(out);
  }

  /** 重写版 saveSharedDish：仅接受定向分享 token（旧「dishId 跨用户直读」已废除）。
   *  幂等键 = openid + token 对应 dishId（确定性 _id），分类按名映射，评分不继承。 */
  async function saveSharedDish({ openid, event }) {
    const { token } = event;
    if (!token) return fail('缺少分享凭证');
    const doc = await readShare(token);
    if (!doc) return fail('分享链接已过期或无效');
    if (doc.openid === openid) return fail('不能保存自己分享的菜品');

    const snap = doc.snapshot || {};
    const docId = `cs_${openid}_${crypto.createHash('md5').update(token).digest('hex').slice(0, 16)}`;
    const col = db.collection('dishes');
    let existed = null;
    try { existed = (await col.doc(docId).get()).data; } catch (e) { existed = null; }
    if (existed) {
      if (existed.deleted) {
        await col.doc(docId).update({ data: { deleted: false, updatedAt: db.serverDate() } });
      }
      return ok({ dishId: docId, duplicated: true });
    }
    const categoryId = await mapCategory(openid, snap.categoryName || '');
    try {
      await col.add({
        data: {
          _id: docId,
          openid,
          name: String(snap.name || '').slice(0, 30),
          categoryId,
          coverImage: snap.coverImage || '',
          images: Array.isArray(snap.images) ? snap.images.slice(0, 9) : [],
          description: snap.description || '',
          price: null,                              // 定向分享不携带价格
          tags: Array.isArray(snap.tags) ? snap.tags.slice(0, 10) : [],
          rating: 0,
          status: 'want',
          deleted: false,
          sourceShareToken: token,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
    } catch (e) {
      return ok({ dishId: docId, duplicated: true }); // 并发幂等
    }
    return ok({ dishId: docId, duplicated: false });
  }

  /* ==================== 行为记录（按 openid 隔离） ==================== */

  const BEHAVIOR_TYPES = ['expose', 'like', 'unlike', 'save', 'next', 'not_interest', 'eat', 'rate'];

  async function logBehavior({ openid, event }) {
    await ensureDiscoveryCollections();
    const { type, refType, refId } = event;
    if (!BEHAVIOR_TYPES.includes(type)) return fail('未知行为类型');
    // 高频曝光类只保留最近 500 条：直接写，读取端限流（POC 阶段不做 TTL，索引建议见 README）
    await db.collection('user_behaviors').add({
      data: {
        openid,
        type,
        refType: refType === 'public' ? 'public' : 'own',
        refId: String(refId || '').slice(0, 64),
        createdAt: db.serverDate()
      }
    });
    return ok(true);
  }

  return {
    ensureDiscoveryCollections,
    publishDish, withdrawPublicDish, listMyPublications, reviewPublicDish, getPublicDish,
    likePublicDish, savePublicDish,
    createShareToken, getSharedDish, saveSharedDish,
    logBehavior, adminOpenids, stripAuthor, attachPublicUrls, hasLiked, findSavedCopy
  };
};
