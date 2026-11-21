// cloudfunctions/dish/index.js - 单入口云函数（命令路由模式）
// 所有数据按 openid 隔离，权限收敛在服务端，前端不直连数据库
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const MAX_LIMIT = 100; // 云函数端单次查询上限

const ok = (data) => ({ code: 0, data });
const fail = (msg, code = 1) => ({ code, msg });

// 发现域（公开菜品/定向分享/点赞/一键加入/行为）与推荐引擎
const discovery = require('./lib/discovery')({ cloud, db, _, ok, fail, fetchAll: null });
const recommend = require('./lib/recommend')({ cloud, db, _, ok, fail });

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('无法识别用户身份');

  const { action } = event;
  const ctx = { openid: OPENID, event };

  try {
    switch (action) {
      // ---- 分类 ----
      case 'listCategories': return await listCategories(ctx);
      case 'addCategory': return await addCategory(ctx);
      case 'updateCategory': return await updateCategory(ctx);
      case 'deleteCategory': return await deleteCategory(ctx);

      // ---- 菜品 ----
      case 'listDishes': return await listDishes(ctx);
      case 'getDish': return await getDish(ctx);
      case 'addDish': return await addDish(ctx);
      case 'updateDish': return await updateDish(ctx);
      case 'deleteDish': return await deleteDish(ctx);

      // ---- 随机推荐 ----
      case 'randomPick': return await randomPick(ctx);

      // ---- 吃过记录 ----
      case 'logEat': return await logEat(ctx);
      case 'listEatLogs': return await listEatLogs(ctx);

      // ---- 统计 / 初始化 / 导出 ----
      case 'getStats': return await getStats(ctx);
      case 'initDemo': return await initDemo(ctx);
      case 'exportData': return await exportData(ctx);
      case 'getBgUrl': return await getBgUrl(ctx);
      case 'listEatLogsByMonth': return await listEatLogsByMonth(ctx);
      case 'importData': return await importData(ctx);
      
      // ---- 用户信息 / 分享（saveSharedDish 已收紧为 token 凭证模式，见 lib/discovery） ----
      case 'getUserInfo': return await getUserInfo(ctx);
      case 'getProfile': return await getProfile(ctx);
      case 'saveProfile': return await saveProfile(ctx);
      case 'saveSharedDish': return await discovery.saveSharedDish(ctx);
      case 'createShareToken': return await discovery.createShareToken(ctx);
      case 'getSharedDish': return await discovery.getSharedDish(ctx);

      // ---- 公开发布（灵感广场） ----
      case 'publishDish': return await discovery.publishDish(ctx);
      case 'withdrawPublicDish': return await discovery.withdrawPublicDish(ctx);
      case 'listMyPublications': return await discovery.listMyPublications(ctx);
      case 'reviewPublicDish': return await discovery.reviewPublicDish(ctx);
      case 'getPublicDish': return await discovery.getPublicDish(ctx);

      // ---- 社区互动 ----
      case 'likePublicDish': return await discovery.likePublicDish(ctx);
      case 'savePublicDish': return await discovery.savePublicDish(ctx);
      case 'logBehavior': return await discovery.logBehavior(ctx);

      // ---- 个性化推荐 ----
      case 'getFeed': return await recommend.getFeed(ctx);
      case 'saveTastePrefs': return await recommend.saveTastePrefs(ctx);
      case 'getTastePrefs': return await recommend.getTastePrefs(ctx);

      default: return fail(`未知操作: ${action}`);
    }
  } catch (err) {
    console.error(`[dish] action=${action} error:`, err);
    return fail(err.message || '服务端异常');
  }
};

// ==================== 工具 ====================

/** 拉取某集合当前用户的全部数据（自动分批，上限 1000 条防失控） */
async function fetchAll(collection, where, orderBy) {
  const col = db.collection(collection);
  let total = 0;
  try {
    const c = await col.where(where).count();
    total = c.total;
  } catch (e) {
    return []; // 集合尚未创建，默认返回空
  }
  const capped = Math.min(total, 1000);
  const batchCount = Math.ceil(capped / MAX_LIMIT);
  const tasks = [];
  for (let i = 0; i < batchCount; i++) {
    let q = col.where(where);
    if (orderBy) q = q.orderBy(orderBy.field, orderBy.dir);
    tasks.push(q.skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
  }
  const results = await Promise.all(tasks);
  return results.reduce((acc, r) => acc.concat(r.data), []);
}

/** 服务端输入校验：菜品数据 */
function validateDish(data) {
  if (!data || typeof data.name !== 'string' || !data.name.trim()) {
    throw new Error('菜品名称不能为空');
  }
  if (data.name.trim().length > 30) throw new Error('菜品名称最长 30 字');
  if (data.description && data.description.length > 2000) throw new Error('介绍最长 2000 字');
  if (data.price !== undefined && data.price !== null && data.price !== '') {
    const p = Number(data.price);
    if (isNaN(p) || p < 0 || p > 100000000) throw new Error('价格不合法');
  }
  if (data.tags && !Array.isArray(data.tags)) throw new Error('标签格式不合法');
}

/** 确保 3 个集合存在：首次初始化自动创建，已存在则忽略 */
async function ensureCollections() {
  for (const name of ['categories', 'dishes', 'eat_logs']) {
    try {
      await db.createCollection(name);
    } catch (e) {
      // 集合已存在，忽略
    }
  }
}

// ==================== 分类 ====================

async function listCategories({ openid }) {
  const list = await fetchAll('categories', { openid, deleted: false }, { field: 'sortOrder', dir: 'asc' });
  return ok(list);
}

async function addCategory({ openid, event }) {
  const name = (event.data && event.data.name || '').trim();
  if (!name) return fail('分类名不能为空');
  if (name.length > 10) return fail('分类名最长 10 字');

  // 重名检查
  const dup = await db.collection('categories')
    .where({ openid, name, deleted: false }).count();
  if (dup.total > 0) return fail('已有同名分类');

  const res = await db.collection('categories').add({
    data: {
      openid,
      name,
      icon: (event.data && event.data.icon) || '',
      sortOrder: Date.now(), // 新增排最后
      deleted: false,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  });
  return ok({ _id: res._id });
}

async function updateCategory({ openid, event }) {
  const { id, data } = event;
  if (!id) return fail('缺少分类 ID');
  const update = {};
  if (data.name !== undefined) {
    const name = (data.name || '').trim();
    if (!name || name.length > 10) return fail('分类名 1-10 字');
    update.name = name;
  }
  if (data.icon !== undefined) update.icon = data.icon;
  if (data.sortOrder !== undefined) update.sortOrder = data.sortOrder;
  update.updatedAt = db.serverDate();

  // 只能改自己的：where 带 openid 条件
  await db.collection('categories').where({ _id: id, openid }).update({ data: update });
  return ok(true);
}

async function deleteCategory({ openid, event }) {
  const { id } = event;
  if (!id) return fail('缺少分类 ID');

  // 分类下还有菜品时禁止删除（软删除）
  const used = await db.collection('dishes')
    .where({ openid, categoryId: id, deleted: false }).count();
  if (used.total > 0) return fail(`该分类下还有 ${used.total} 道菜，先移走或删除它们`);

  await db.collection('categories').where({ _id: id, openid })
    .update({ data: { deleted: true, updatedAt: db.serverDate() } });
  return ok(true);
}

// ==================== 菜品 ====================

async function listDishes({ openid, event }) {
  const { query = {} } = event;
  const where = { openid, deleted: false };
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.status) where.status = query.status;
  let list;
  if (query.keyword) {
    const kw = String(query.keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexp = db.RegExp({ regexp: kw, options: 'i' });
    list = await fetchAllWithCommand('dishes', _.and([
      where,
      _.or([{ name: regexp }, { tags: regexp }, { description: regexp }])
    ]), { field: 'updatedAt', dir: 'desc' });
  } else {
    list = await fetchAll('dishes', where, { field: 'updatedAt', dir: 'desc' });
  }
  // 批量获取封面图临时URL（跨用户访问需要）
  await attachCoverTempUrls(list);
  return ok(list);
}

/** 批量给菜品列表附加 coverImageUrl（临时URL） */
async function attachCoverTempUrls(list) {
  const fileIDs = list.filter(d => d.coverImage).map(d => d.coverImage);
  if (!fileIDs.length) return;
  try {
    const urlRes = await cloud.getTempFileURL({ fileList: fileIDs });
    const urlMap = {};
    urlRes.fileList.forEach(f => { if (f.status === 0) urlMap[f.fileID] = f.tempFileURL; });
    list.forEach(d => {
      if (d.coverImage && urlMap[d.coverImage]) d.coverImageUrl = urlMap[d.coverImage];
    });
  } catch (e) {
    console.warn('批量获取封面临时URL失败:', e);
  }
}

/** fetchAll 的 command 条件版 */
async function fetchAllWithCommand(collection, whereCommand, orderBy) {
  const col = db.collection(collection);
  let total = 0;
  try {
    const c = await col.where(whereCommand).count();
    total = c.total;
  } catch (e) {
    return []; // 集合尚未创建，默认返回空
  }
  const capped = Math.min(total, 1000);
  const batchCount = Math.ceil(capped / MAX_LIMIT);
  const tasks = [];
  for (let i = 0; i < batchCount; i++) {
    let q = col.where(whereCommand);
    if (orderBy) q = q.orderBy(orderBy.field, orderBy.dir);
    tasks.push(q.skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
  }
  const results = await Promise.all(tasks);
  return results.reduce((acc, r) => acc.concat(r.data), []);
}

async function getDish({ openid, event }) {
  const { id } = event;
  if (!id) return fail('缺少菜品 ID');
  // 安全收紧（P0）：私人菜品仅 owner 可读。跨用户访问一律走公开快照（getPublicDish）
  // 或定向分享凭证（getSharedDish），禁止按 ID 直读他人 dishes。
  const res = await db.collection('dishes').where({ _id: id, openid, deleted: false }).get();
  if (!res.data.length) return fail('菜品不存在');

  const dish = res.data[0];
  // 附带最近一次吃的时间
  const logs = await db.collection('eat_logs')
    .where({ openid, dishId: id })
    .orderBy('eatenAt', 'desc').limit(1).get();
  dish.lastEatenAt = logs.data.length ? logs.data[0].eatenAt : null;

  // 图片 fileID 转临时 URL（自己的文件，保持前端展示兼容）
  const fileIDs = [];
  if (dish.coverImage) fileIDs.push(dish.coverImage);
  if (dish.images && dish.images.length) fileIDs.push(...dish.images);

  if (fileIDs.length > 0) {
    try {
      const urlRes = await cloud.getTempFileURL({ fileList: fileIDs });
      const urlMap = {};
      urlRes.fileList.forEach(f => {
        if (f.status === 0) urlMap[f.fileID] = f.tempFileURL;
      });
      if (dish.coverImage && urlMap[dish.coverImage]) {
        dish.coverImageUrl = urlMap[dish.coverImage];
      }
      if (dish.images && dish.images.length) {
        dish.imagesUrl = dish.images.map(fid => urlMap[fid] || fid);
      }
    } catch (e) {
      console.warn('获取临时 URL 失败:', e);
    }
  }

  return ok(dish);
}

async function addDish({ openid, event }) {
  const data = event.data || {};
  try {
    validateDish(data);
  } catch (e) {
    return fail(e.message);
  }
  const res = await db.collection('dishes').add({
    data: {
      openid,
      name: data.name.trim(),
      categoryId: data.categoryId || '',
      coverImage: data.coverImage || '',       // 云存储 fileID
      images: Array.isArray(data.images) ? data.images.slice(0, 9) : [],
      description: data.description || '',
      price: data.price === '' || data.price === null || data.price === undefined
        ? null : Math.round(Number(data.price)), // 单位：分
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 10) : [],
      rating: Math.min(5, Math.max(0, Number(data.rating) || 0)),
      status: ['want', 'often', 'never'].includes(data.status) ? data.status : 'want',
      deleted: false,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  });
  return ok({ _id: res._id });
}

async function updateDish({ openid, event }) {
  const { id, data = {} } = event;
  if (!id) return fail('缺少菜品 ID');

  const update = {};
  if (data.name !== undefined) {
    const name = (data.name || '').trim();
    if (!name || name.length > 30) return fail('菜品名 1-30 字');
    update.name = name;
  }
  ['categoryId', 'coverImage', 'description'].forEach(k => {
    if (data[k] !== undefined) update[k] = data[k];
  });
  if (data.images !== undefined) update.images = Array.isArray(data.images) ? data.images.slice(0, 9) : [];
  if (data.tags !== undefined) update.tags = Array.isArray(data.tags) ? data.tags.slice(0, 10) : [];
  if (data.price !== undefined) {
    update.price = data.price === '' || data.price === null ? null : Math.round(Number(data.price));
  }
  if (data.rating !== undefined) update.rating = Math.min(5, Math.max(0, Number(data.rating) || 0));
  if (data.status !== undefined && ['want', 'often', 'never'].includes(data.status)) {
    update.status = data.status;
  }
  update.updatedAt = db.serverDate();

  await db.collection('dishes').where({ _id: id, openid }).update({ data: update });
  return ok(true);
}

async function deleteDish({ openid, event }) {
  const { id } = event;
  if (!id) return fail('缺少菜品 ID');
  await db.collection('dishes').where({ _id: id, openid })
    .update({ data: { deleted: true, updatedAt: db.serverDate() } });
  return ok(true);
}

// ==================== 随机推荐 ====================

async function randomPick({ openid, event }) {
  const { filters = {} } = event;
  const where = { openid, deleted: false };

  // "不想再吃"永远不进随机池
  where.status = _.neq('never');
  if (filters.onlyStatus === 'want') where.status = 'want';
  if (filters.categoryId) where.categoryId = filters.categoryId;

  let pool = await fetchAll('dishes', where);

  // 排除最近 N 天吃过的
  const days = Number(filters.excludeRecentDays) || 0;
  if (days > 0 && pool.length) {
    const since = Date.now() - days * 86400000;
    const recentLogs = await fetchAll('eat_logs', { openid, eatenAt: _.gte(new Date(since)) });
    const recentIds = new Set(recentLogs.map(l => l.dishId));
    pool = pool.filter(d => !recentIds.has(d._id));
  }

  if (!pool.length) return fail('没有符合条件的菜品，放宽筛选试试', 2);

  // 评分加权抽样：weight = 1 + clamp(rating, 0, 5)，累加轮盘法；
  // 未开启（老前端不传）时保持均匀随机，向后兼容
  let picked;
  if (filters.weightByRating) {
    const weights = pool.map(d => 1 + Math.min(5, Math.max(0, Number(d.rating) || 0)));
    const totalW = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalW;
    picked = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r < 0) { picked = pool[i]; break; }
    }
  } else {
    picked = pool[Math.floor(Math.random() * pool.length)];
  }

  // 附带分类名和上次吃的时间
  let categoryName = '';
  if (picked.categoryId) {
    const cat = await db.collection('categories')
      .where({ _id: picked.categoryId, openid }).get();
    categoryName = cat.data.length ? cat.data[0].name : '';
  }
  const lastLog = await db.collection('eat_logs')
    .where({ openid, dishId: picked._id })
    .orderBy('eatenAt', 'desc').limit(1).get();

  return ok({
    dish: picked,
    categoryName,
    poolSize: pool.length,
    lastEatenAt: lastLog.data.length ? lastLog.data[0].eatenAt : null
  });
}

// ==================== 吃过记录 ====================

async function logEat({ openid, event }) {
  const { dishId, note = '' } = event;
  if (!dishId) return fail('缺少菜品 ID');

  const dishRes = await db.collection('dishes')
    .where({ _id: dishId, openid, deleted: false }).get();
  if (!dishRes.data.length) return fail('菜品不存在');
  const dish = dishRes.data[0];

  await db.collection('eat_logs').add({
    data: {
      openid,
      dishId,
      dishName: dish.name,
      coverImage: dish.coverImage || '',
      note: String(note).slice(0, 200),
      eatenAt: db.serverDate(),
      createdAt: db.serverDate()
    }
  });

  // 记一笔后自动把"想吃"升级为"常吃"
  if (dish.status === 'want') {
    await db.collection('dishes').where({ _id: dishId, openid })
      .update({ data: { status: 'often', updatedAt: db.serverDate() } });
  }
  return ok(true);
}

async function listEatLogs({ openid, event }) {
  const page = Math.max(1, Number(event.page) || 1);
  const size = Math.min(50, Math.max(1, Number(event.size) || 20));
  const where = { openid };
  const { total } = await db.collection('eat_logs').where(where).count();
  const res = await db.collection('eat_logs').where(where)
    .orderBy('eatenAt', 'desc')
    .skip((page - 1) * size).limit(size).get();
  return ok({ total, list: res.data, page, size });
}

// ==================== 统计 / 初始化 / 导出 ====================

async function safeCount(colName, where) {
  try {
    const r = await db.collection(colName).where(where).count();
    return r.total;
  } catch (e) {
    return 0; // 集合尚未创建，按 0 计
  }
}

async function getStats({ openid }) {
  const [dishCount, categoryCount, eatCount] = await Promise.all([
    safeCount('dishes', { openid, deleted: false }),
    safeCount('categories', { openid, deleted: false }),
    safeCount('eat_logs', { openid })
  ]);
  return ok({ dishCount, categoryCount, eatCount });
}

/** 一键初始化：默认分类 + 示例菜品（仅当菜品库为空时执行） */
async function initDemo({ openid }) {
  await ensureCollections();
  const existing = await db.collection('dishes').where({ openid, deleted: false }).count();
  if (existing.total > 0) return fail('菜品库已有数据，无需初始化');

  const defaults = [
    { name: '家常菜', icon: '\uf182' },
    { name: '面食粉类', icon: '\uf2df' },
    { name: '轻食沙拉', icon: '\uf90c' },
    { name: '火锅烧烤', icon: '\uf7f6' },
    { name: '甜品饮品', icon: '\uf6ed' }
  ];
  const catIds = {};
  for (let i = 0; i < defaults.length; i++) {
    const res = await db.collection('categories').add({
      data: {
        openid,
        name: defaults[i].name,
        icon: defaults[i].icon,
        sortOrder: i,
        deleted: false,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
    catIds[defaults[i].name] = res._id;
  }

  const demoDishes = [
    { name: '番茄牛腩煲', cat: '家常菜', desc: '浓郁番茄汤底，牛腩炖到软烂。番茄要多炒出沙。', price: 4800, rating: 5, status: 'want', tags: ['家常', '炖菜'] },
    { name: '葱油拌面', cat: '面食粉类', desc: '小葱熬到焦黄，酱油糖调汁，十分钟搞定。', price: 1800, rating: 4, status: 'often', tags: ['快手', '面食'] },
    { name: '鸡胸肉沙拉', cat: '轻食沙拉', desc: '鸡胸肉煎前用盐和黑胡椒腌 15 分钟，油醋汁。', price: 3200, rating: 4, status: 'want', tags: ['低卡', '健身'] },
    { name: '麻辣香锅', cat: '火锅烧烤', desc: '荤素一锅出，豆瓣酱+火锅底料炒香。', price: 6800, rating: 5, status: 'often', tags: ['辣', '聚餐'] },
    { name: '杨枝甘露', cat: '甜品饮品', desc: '芒果+西柚+西米+椰浆，冷藏后更好喝。', price: 2200, rating: 4, status: 'want', tags: ['甜品', '夏日'] },
    { name: '冰糖雪梨', cat: '甜品饮品', desc: '雪梨去核加冰糖慢炖，润肺止咳，秋冬必备。', price: 1800, rating: 5, status: 'want', tags: ['甜品', '养生'] }
  ];
  for (const d of demoDishes) {
    await db.collection('dishes').add({
      data: {
        openid,
        name: d.name,
        categoryId: catIds[d.cat] || '',
        coverImage: '',
        images: [],
        description: d.desc,
        price: d.price,
        tags: d.tags,
        rating: d.rating,
        status: d.status,
        deleted: false,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
  }
  return ok({ categories: defaults.length, dishes: demoDishes.length });
}

/** 云端图片资源表：云函数以管理员身份下载并返回 base64
 *  （免费环境不可设公开读；临时链接有有效期会过期，base64 + 端侧本地缓存可彻底避免过期问题） */
const CLOUD_ASSETS = {
  kitty: 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/kitty-deco.webp',
  header: 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/header-kitchen.jpg',
  // 蜂蜜小熊主题：导航 banner + 7 层角色部件（nav-bears 组件按需加载，非该主题不下载）
  // v2：重绘干净版（原素材自带贯穿黑线，2160x600 白→浅奶油黄渐变+5颗黄星）；
  //     换 key 使端侧旧本地缓存自然失效（LOCAL_PATH 按 key 分文件），无需清理代码
  'header-honey': 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/header-honey.jpg',
  'header-honey-v2': 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/header-honey-v2.jpg',
  'bears/brown_01_body': 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/bears/brown_01_body.png',
  'bears/brown_02_head_hat': 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/bears/brown_02_head_hat.png',
  'bears/brown_03_arm_panhandle': 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/bears/brown_03_arm_panhandle.png',
  'bears/brown_04_pan_splash': 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/bears/brown_04_pan_splash.png',
  'bears/white_01_body': 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/bears/white_01_body.png',
  'bears/white_02_head': 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/bears/white_02_head.png',
  'bears/white_03_spoon_arm': 'cloud://cloud1-d2g70c8532117f303.636c-cloud1-d2g70c8532117f303-1534361802/assets/bears/white_03_spoon_arm.png'
};
async function getBgUrl(ctx) {
  const key = (ctx && ctx.event && ctx.event.key) || 'kitty';
  const fileID = CLOUD_ASSETS[key];
  if (!fileID) return fail('未知图片资源');
  const res = await cloud.downloadFile({ fileID });
  if (!res.fileContent) throw new Error('下载图片失败');
  return ok({ base64: res.fileContent.toString('base64') });
}

/** 按月查询吃历 + 分类占比（云函数为 UTC，月边界必须带 +08:00 偏移） */
async function listEatLogsByMonth({ openid, event }) {
  const ym = String(event.yearMonth || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return fail('月份格式不合法');
  const [y, m] = ym.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const start = Date.parse(`${ym}-01T00:00:00+08:00`);
  const end = Date.parse(`${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00+08:00`);

  const logs = await fetchAll('eat_logs', {
    openid,
    eatenAt: _.gte(new Date(start)).and(_.lt(new Date(end)))
  }, { field: 'eatenAt', dir: 'asc' });

  // 分类占比：dishId -> categoryId 映射（含已删菜，吃历不该丢历史）
  const [dishes, categories] = await Promise.all([
    fetchAll('dishes', { openid }),
    fetchAll('categories', { openid })
  ]);
  const dishCat = {};
  dishes.forEach(d => { dishCat[d._id] = d.categoryId || ''; });
  const catInfo = {};
  categories.forEach(c => { catInfo[c._id] = c; });
  const countByCat = {};
  logs.forEach(l => {
    const cid = dishCat[l.dishId] || '__none__';
    countByCat[cid] = (countByCat[cid] || 0) + 1;
  });
  const categoryStats = Object.keys(countByCat).map(cid => ({
    categoryId: cid,
    name: cid === '__none__' ? '未分类/已删除' : (catInfo[cid] ? catInfo[cid].name : '未知分类'),
    icon: catInfo[cid] && catInfo[cid].icon ? catInfo[cid].icon : '',
    count: countByCat[cid]
  })).sort((a, b) => b.count - a.count);

  return ok({ logs, categoryStats, total: logs.length });
}

/** 导出全部数据（JSON），前端可复制或保存 */
async function exportData({ openid }) {
  const [categories, dishes, logs] = await Promise.all([
    fetchAll('categories', { openid, deleted: false }),
    fetchAll('dishes', { openid, deleted: false }),
    fetchAll('eat_logs', { openid }, { field: 'eatenAt', dir: 'desc' })
  ]);
  return ok({ version: 1, appName: 'Yuki小厨房', exportedAt: new Date().toISOString(), categories, dishes, eatLogs: logs });
}

// ==================== 数据导入（幂等合并） ====================

/** 导入导出数据：只增不覆盖。
 *  去重键：分类按 name；菜品/吃历按 _sourceId（原 _id）优先，回退业务键。
 *  openid 一律重写为当前用户；逐字段清洗；单次 <=1000 条；每 10 条并发一批。 */
async function importData({ openid, event }) {
  const payload = event.data;
  if (!payload || typeof payload !== 'object') return fail('数据格式不合法');
  const cats = Array.isArray(payload.categories) ? payload.categories : [];
  const dishes = Array.isArray(payload.dishes) ? payload.dishes : [];
  const logs = Array.isArray(payload.eatLogs) ? payload.eatLogs : [];
  if (cats.length + dishes.length + logs.length > 1000) return fail('单次导入不能超过 1000 条');

  await ensureCollections();

  // 拉当前用户已有数据做去重集合（个人量级 <=1000，一次查完）
  const [existCats, existDishes, existLogs] = await Promise.all([
    fetchAll('categories', { openid, deleted: false }),
    fetchAll('dishes', { openid, deleted: false }),
    fetchAll('eat_logs', { openid })
  ]);
  const dishSrcSet = new Set(existDishes.map(d => d._sourceId).filter(Boolean));
  const dishBizSet = new Set(existDishes.map(d => `${d.name}|${d.categoryId}`));
  const logSrcSet = new Set(existLogs.map(l => l._sourceId).filter(Boolean));

  const stat = { categories: 0, dishes: 0, eatLogs: 0, skipped: 0 };
  const catIdMap = {}; // 导出文件旧分类 _id -> 当前库分类 _id

  // 1) 分类：按 name 去重
  for (const c of cats) {
    const name = String(c.name || '').trim().slice(0, 10);
    if (!name) { stat.skipped++; continue; }
    const hit = existCats.find(x => x.name === name);
    if (hit) { catIdMap[c._id] = hit._id; stat.skipped++; continue; }
    const res = await db.collection('categories').add({ data: {
      openid, name,
      icon: typeof c.icon === 'string' ? c.icon : '',
      sortOrder: Number(c.sortOrder) || Date.now(),
      deleted: false,
      _sourceId: c._id || '',
      createdAt: db.serverDate(), updatedAt: db.serverDate()
    } });
    catIdMap[c._id] = res._id;
    existCats.push({ _id: res._id, name });
    stat.categories++;
  }

  // 2) 菜品：_sourceId 优先，回退 name|categoryId
  const toAddDishes = [];
  const dishIdMap = {}; // 旧 dishId -> 新 dishId
  for (const d of dishes) {
    const name = String(d.name || '').trim().slice(0, 30);
    const catId = catIdMap[d.categoryId] || '';
    if (!name) { stat.skipped++; continue; }
    if ((d._id && dishSrcSet.has(d._id)) || dishBizSet.has(`${name}|${catId}`)) {
      const hit = existDishes.find(x =>
        (d._id && x._sourceId === d._id) || (x.name === name && x.categoryId === catId));
      if (hit) dishIdMap[d._id] = hit._id;
      stat.skipped++;
      continue;
    }
    toAddDishes.push({ raw: d, name, catId });
  }
  for (let i = 0; i < toAddDishes.length; i += 10) {
    const batch = toAddDishes.slice(i, i + 10);
    const results = await Promise.all(batch.map(({ raw, name, catId }) =>
      db.collection('dishes').add({ data: {
        openid, name, categoryId: catId,
        coverImage: typeof raw.coverImage === 'string' ? raw.coverImage : '',
        images: Array.isArray(raw.images) ? raw.images.slice(0, 9) : [],
        description: String(raw.description || '').slice(0, 2000),
        price: raw.price === null || raw.price === undefined || raw.price === ''
          ? null : (Math.round(Number(raw.price)) || null),
        tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 10) : [],
        rating: Math.min(5, Math.max(0, Number(raw.rating) || 0)),
        status: ['want', 'often', 'never'].includes(raw.status) ? raw.status : 'want',
        deleted: false,
        _sourceId: raw._id || '',
        // 公开来源关系（合法恢复）：仅白名单两字段；审核状态/计数等服务端字段绝不随导入伪造
        sourcePublicDishId: typeof raw.sourcePublicDishId === 'string' ? raw.sourcePublicDishId.slice(0, 64) : '',
        sourceAuthor: (raw.sourceAuthor && typeof raw.sourceAuthor === 'object')
          ? { nickname: String(raw.sourceAuthor.nickname || '').slice(0, 32), avatar: '' }
          : undefined,
        createdAt: db.serverDate(), updatedAt: db.serverDate()
      } })));
    results.forEach((r, j) => { dishIdMap[batch[j].raw._id] = r._id; });
    stat.dishes += results.length;
  }

  // 3) 吃历：_sourceId 去重，dishId 重映射；映射不到菜品的记录跳过
  const toAddLogs = [];
  for (const l of logs) {
    const dishId = dishIdMap[l.dishId];
    if (!dishId || (l._id && logSrcSet.has(l._id))) { stat.skipped++; continue; }
    toAddLogs.push({ raw: l, dishId });
  }
  for (let i = 0; i < toAddLogs.length; i += 10) {
    const batch = toAddLogs.slice(i, i + 10);
    await Promise.all(batch.map(({ raw, dishId }) =>
      db.collection('eat_logs').add({ data: {
        openid, dishId,
        dishName: String(raw.dishName || '').slice(0, 30),
        coverImage: typeof raw.coverImage === 'string' ? raw.coverImage : '',
        note: String(raw.note || '').slice(0, 200),
        eatenAt: raw.eatenAt ? new Date(raw.eatenAt) : db.serverDate(),
        _sourceId: raw._id || '',
        createdAt: db.serverDate()
      } })));
    stat.eatLogs += batch.length;
  }

  return ok(stat);
}

// ==================== 用户信息与分享 ====================

/** 获取当前用户信息（前端用来判断是否是自己的菜） */
async function getUserInfo({ openid }) {
  return ok({ openid });
}

/** 读取用户资料（头像 fileID / 昵称）。首次进入无记录时返回空资料，前端用默认头像 */
async function getProfile({ openid }) {
  try {
    const res = await db.collection('profiles').where({ openid }).limit(1).get();
    const p = res.data && res.data[0];
    return ok({
      avatarFileID: (p && p.avatarFileID) || '',
      nickname: (p && p.nickname) || ''
    });
  } catch (e) {
    // profiles 集合尚未创建：视为无资料
    return ok({ avatarFileID: '', nickname: '' });
  }
}

/** 保存用户资料（按 openid upsert）。头像上传由前端完成，这里只存 fileID/昵称。
 *  avatarFileID 传空串表示不改动头像字段（仅更新昵称场景）。 */
async function saveProfile({ openid, event }) {
  const col = db.collection('profiles');
  const { avatarFileID, nickname } = event;

  const data = { updatedAt: db.serverDate() };
  if (typeof avatarFileID === 'string' && avatarFileID) data.avatarFileID = avatarFileID;
  if (typeof nickname === 'string') data.nickname = nickname.slice(0, 32);

  // 首次写入确保集合存在
  try { await db.createCollection('profiles'); } catch (e) { /* 已存在，忽略 */ }

  const exist = await col.where({ openid }).limit(1).get();
  if (exist.data && exist.data.length) {
    await col.where({ openid }).update({ data });
    return ok({ updated: true });
  }
  await col.add({ data: { openid, avatarFileID: data.avatarFileID || '', nickname: data.nickname || '', createdAt: db.serverDate(), updatedAt: data.updatedAt } });
  return ok({ created: true });
}
// 旧版 saveSharedDish（按 dishId 跨用户直读 + name/categoryId 去重）已删除：
// 存在越权读取、复制他人 categoryId、并发重复三个问题。
// 新版实现见 lib/discovery.js：仅接受服务端签发的定向分享 token（createShareToken 签发），
// 幂等键 = openid + token（确定性 _id），分类按名映射，评分不继承。
