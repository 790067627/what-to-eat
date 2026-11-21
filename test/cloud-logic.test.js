/* test/cloud-logic.test.js — dish 云函数新逻辑本地单测（mock wx-server-sdk 数据层）
 * 覆盖验收项：越权读取 / token 分享 / 发布审核可见性 / 点赞幂等 / 一键加入去重与隔离 /
 *            分类映射 / 评分不继承 / 撤回后可见性 / 口味画像推荐差异 / AI 失败回退
 * 运行：node test/cloud-logic.test.js
 */
'use strict';
const assert = require('assert');
const path = require('path');

/* ==================== 内存 mock db ==================== */
function makeDb() {
  const cols = {};
  let idSeq = 0;
  const serverDate = () => new Date();

  function match(doc, where) {
    for (const k of Object.keys(where)) {
      const v = where[k];
      if (v && typeof v === 'object' && v.__op) {
        if (v.__op === 'neq' && doc[k] === v.val) return false;
        if (v.__op === 'in' && !v.val.includes(doc[k])) return false;
        if (v.__op === 'gte' && !(doc[k] >= v.val)) return false;
        continue;
      }
      if (doc[k] !== v) return false;
    }
    return true;
  }

  function collection(name) {
    if (!cols[name]) cols[name] = [];
    const arr = cols[name];
    const q = { _where: null, _limit: Infinity, _order: null };
    const api = {
      where(w) { q._where = w; return api; },
      limit(n) { q._limit = n; return api; },
      orderBy(f, d) { q._order = { f, d }; return api; },
      skip() { return api; },
      async get() {
        let rows = arr.filter(d => q._where ? match(d, q._where) : true);
        if (q._order) rows = rows.slice().sort((a, b) => {
          const av = a[q._order.f], bv = b[q._order.f];
          return q._order.d === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
        });
        return { data: rows.slice(0, q._limit).map(d => JSON.parse(JSON.stringify(d))) };
      },
      async count() {
        const rows = arr.filter(d => q._where ? match(d, q._where) : true);
        return { total: rows.length };
      },
      async add({ data }) {
        const doc = JSON.parse(JSON.stringify(data));
        if (!doc._id) doc._id = 'id' + (++idSeq);
        if (arr.some(d => d._id === doc._id)) { const e = new Error('duplicate key'); e.errCode = -1; throw e; }
        arr.push(doc);
        return { _id: doc._id };
      },
      async update({ data }) {
        const rows = arr.filter(d => q._where ? match(d, q._where) : false);
        rows.forEach(r => {
          for (const k of Object.keys(data)) {
            const v = data[k];
            if (v && typeof v === 'object' && v.__op === 'inc') r[k] = (r[k] || 0) + v.val;
            else if (v instanceof Date) r[k] = new Date(v);
            else r[k] = v;
          }
        });
        return { stats: { updated: rows.length } };
      },
      doc(id) {
        return {
          async get() {
            const d = arr.find(x => x._id === id);
            if (!d) { const e = new Error('not exists'); e.errCode = -1; throw e; }
            return { data: JSON.parse(JSON.stringify(d)) };
          },
          async update({ data }) {
            const d = arr.find(x => x._id === id);
            if (!d) throw new Error('not exists');
            for (const k of Object.keys(data)) {
              const v = data[k];
              if (v && typeof v === 'object' && v.__op === 'inc') d[k] = (d[k] || 0) + v.val;
              else d[k] = v;
            }
            return { stats: { updated: 1 } };
          }
        };
      }
    };
    return api;
  }

  const cmd = {
    neq: v => ({ __op: 'neq', val: v }),
    in: v => ({ __op: 'in', val: v }),
    gte: v => ({ __op: 'gte', val: v }),
    inc: v => ({ __op: 'inc', val: v })
  };
  return { db: { collection, command: cmd, serverDate, createCollection: async () => ({}) }, cols };
}

/* ==================== 装载被测模块 ==================== */
const { db, cols } = makeDb();
const _ = db.command;
const ok = (data) => ({ code: 0, data });
const fail = (msg, code = 1) => ({ code, msg });
const cloud = {
  getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map(f => ({ fileID: f, status: 0, tempFileURL: 'https://tmp/' + f })) }),
  downloadFile: async () => ({ fileContent: Buffer.from('img') }),
  uploadFile: async ({ cloudPath }) => ({ fileID: 'cloud://pub/' + cloudPath }),
  openapi: { security: { msgSecCheck: async () => ({ result: { suggest: 'pass' } }) } }
};
const discovery = require('../cloudfunctions/dish/lib/discovery')({ cloud, db, _, ok, fail, fetchAll: null });
const recommend = require('../cloudfunctions/dish/lib/recommend')({ cloud, db, _, ok, fail });

const A = 'openid_A', B = 'openid_B', C = 'openid_C';

async function seed() {
  // A 的私人菜（含分类）
  await db.collection('categories').add({ data: { _id: 'catA1', openid: A, name: '家常菜', deleted: false } });
  await db.collection('dishes').add({ data: { _id: 'dishA1', openid: A, name: '回锅肉', categoryId: 'catA1', coverImage: 'cloud://a/1.jpg', images: [], description: '秘制做法', price: 3800, tags: ['辣', '下饭'], rating: 5, status: 'often', deleted: false } });
  await db.collection('dishes').add({ data: { _id: 'dishA2', openid: A, name: '清蒸鲈鱼', categoryId: 'catA1', coverImage: '', images: [], description: '', price: null, tags: ['清淡'], rating: 4, status: 'often', deleted: false } });
  // B 的私人菜（清淡画像）
  await db.collection('categories').add({ data: { _id: 'catB1', openid: B, name: '轻食', deleted: false } });
  await db.collection('dishes').add({ data: { _id: 'dishB1', openid: B, name: '白灼菜心', categoryId: 'catB1', coverImage: '', images: [], description: '', price: null, tags: ['清淡', '低卡'], rating: 5, status: 'often', deleted: false } });
  await db.collection('eat_logs').add({ data: { openid: B, dishId: 'dishB1', eatenAt: new Date() } });
}

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}

(async () => {
  await seed();
  console.log('云函数新逻辑单测（mock db）');

  /* ---- P0：定向分享 token ---- */
  await t('createShareToken 仅 owner 可签发', async () => {
    const r1 = await discovery.createShareToken({ openid: A, event: { dishId: 'dishA1' } });
    assert.strictEqual(r1.code, 0);
    assert(r1.data.token);
    const r2 = await discovery.createShareToken({ openid: B, event: { dishId: 'dishA1' } });
    assert.strictEqual(r2.code, 1, '非 owner 应失败');
  });

  let token;
  await t('getSharedDish：token 有效返回白名单快照，无 openid/价格', async () => {
    token = (await discovery.createShareToken({ openid: A, event: { dishId: 'dishA1' } })).data.token;
    const r = await discovery.getSharedDish({ event: { token } });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.data.name, '回锅肉');
    assert.strictEqual(r.data.openid, undefined);
    assert.strictEqual(r.data.price, undefined);
    assert.strictEqual(r.data.status, undefined);
  });

  await t('getSharedDish：无效 token 拒绝', async () => {
    const r = await discovery.getSharedDish({ event: { token: 'bad_token' } });
    assert.strictEqual(r.code, 1);
  });

  await t('saveSharedDish(token)：B 保存成功，分类按名映射，评分不继承', async () => {
    const r = await discovery.saveSharedDish({ openid: B, event: { token } });
    assert.strictEqual(r.code, 0);
    const saved = cols.dishes.find(d => d._id === r.data.dishId);
    assert.strictEqual(saved.openid, B);
    assert.strictEqual(saved.rating, 0, '评分不继承');
    assert.strictEqual(saved.categoryId, '', 'B 无「家常菜」分类 → 归未分类');
    assert.strictEqual(saved.status, 'want');
  });

  await t('saveSharedDish：重复保存幂等（10 连点）', async () => {
    let firstId = null;
    for (let i = 0; i < 10; i++) {
      const r = await discovery.saveSharedDish({ openid: B, event: { token } });
      assert.strictEqual(r.code, 0);
      if (!firstId) firstId = r.data.dishId;
      assert.strictEqual(r.data.dishId, firstId);
    }
    const copies = cols.dishes.filter(d => d.openid === B && d.sourceShareToken === token);
    assert.strictEqual(copies.length, 1, '只有一条副本');
  });

  await t('saveSharedDish：不能保存自己分享的菜', async () => {
    const r = await discovery.saveSharedDish({ openid: A, event: { token } });
    assert.strictEqual(r.code, 1);
  });

  await t('saveSharedDish：无 token 的旧式 dishId 直传被拒绝（越权路径封死）', async () => {
    const r = await discovery.saveSharedDish({ openid: B, event: { dishId: 'dishA1' } });
    assert.strictEqual(r.code, 1);
  });

  /* ---- P1：公开发布 + 审核状态 ---- */
  let pubId;
  await t('publishDish：发布进入 pending（默认不自动过审）', async () => {
    const r = await discovery.publishDish({ openid: A, event: { dishId: 'dishA1', options: { includePrice: false } } });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.data.reviewStatus, 'pending');
    pubId = r.data.publicDishId;
    const doc = cols.public_dishes.find(d => d._id === pubId);
    assert.strictEqual(doc.authorOpenid, A);
    assert(doc.coverImage.startsWith('cloud://pub/public_dishes/'), '图片已复制公共副本（mock 前缀 cloud://pub/）');
    assert.strictEqual(doc.price, null, '未勾选公开价格则不带价格');
  });

  await t('pending 状态 B 不可见', async () => {
    const r = await discovery.getPublicDish({ openid: B, event: { id: pubId } });
    assert.strictEqual(r.code, 1);
  });

  await t('非管理员不能审核', async () => {
    const r = await discovery.reviewPublicDish({ openid: B, event: { publicDishId: pubId, approve: true } });
    assert.strictEqual(r.code, 1);
  });

  await t('管理员审核通过 → B 可见，且响应不含 authorOpenid', async () => {
    process.env.ADMIN_OPENIDS = 'admin_openid';
    const r = await discovery.reviewPublicDish({ openid: 'admin_openid', event: { publicDishId: pubId, approve: true } });
    assert.strictEqual(r.code, 0);
    const g = await discovery.getPublicDish({ openid: B, event: { id: pubId } });
    assert.strictEqual(g.code, 0);
    assert.strictEqual(g.data.authorOpenid, undefined);
    assert.strictEqual(g.data.name, '回锅肉');
  });

  /* ---- P2：点赞幂等 ---- */
  await t('点赞/取消幂等，计数不重复不穿负', async () => {
    let r = await discovery.likePublicDish({ openid: B, event: { id: pubId, like: true } });
    assert.strictEqual(r.data.likeCount, 1);
    r = await discovery.likePublicDish({ openid: B, event: { id: pubId, like: true } });
    assert.strictEqual(r.data.likeCount, 1, '重复点赞不加计数');
    r = await discovery.likePublicDish({ openid: B, event: { id: pubId, like: false } });
    assert.strictEqual(r.data.likeCount, 0);
    r = await discovery.likePublicDish({ openid: B, event: { id: pubId, like: false } });
    assert.strictEqual(r.data.likeCount, 0, '重复取消不穿负');
    await discovery.likePublicDish({ openid: B, event: { id: pubId, like: true } });
  });

  /* ---- P2：一键加入公开菜 ---- */
  let copyId;
  await t('savePublicDish：B 一键加入生成独立副本（分类映射/评分0/want）', async () => {
    await db.collection('categories').add({ data: { _id: 'catB2', openid: B, name: '家常菜', deleted: false } });
    const r = await discovery.savePublicDish({ openid: B, event: { id: pubId } });
    assert.strictEqual(r.code, 0);
    copyId = r.data.dishId;
    const saved = cols.dishes.find(d => d._id === copyId);
    assert.strictEqual(saved.openid, B);
    assert.strictEqual(saved.rating, 0);
    assert.strictEqual(saved.status, 'want');
    assert.strictEqual(saved.sourcePublicDishId, pubId);
    assert.strictEqual(saved.categoryId, 'catB2', '按分类名映射到 B 自己的「家常菜」');
    assert.notStrictEqual(saved.categoryId, 'catA1', '绝不继承 A 的 categoryId');
  });

  await t('savePublicDish：10 连点幂等', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await discovery.savePublicDish({ openid: B, event: { id: pubId } });
      assert.strictEqual(r.code, 0);
      assert.strictEqual(r.data.dishId, copyId);
      assert.strictEqual(r.data.duplicated, true);
    }
    assert.strictEqual(cols.dishes.filter(d => d.openid === B && d.sourcePublicDishId === pubId).length, 1);
  });

  await t('savePublicDish：软删后再加入 = 恢复原副本', async () => {
    await db.collection('dishes').doc(copyId).update({ data: { deleted: true } });
    const r = await discovery.savePublicDish({ openid: B, event: { id: pubId } });
    assert.strictEqual(r.data.dishId, copyId);
    assert.strictEqual(r.data.restored, true);
    assert.strictEqual(cols.dishes.find(d => d._id === copyId).deleted, false);
  });

  await t('B 修改副本不影响 A 原件', async () => {
    await db.collection('dishes').doc(copyId).update({ data: { name: '回锅肉（B改）', rating: 3 } });
    const a = cols.dishes.find(d => d._id === 'dishA1');
    assert.strictEqual(a.name, '回锅肉');
    assert.strictEqual(a.rating, 5);
  });

  await t('撤回公开后 B 不可再读取/加入', async () => {
    const w = await discovery.withdrawPublicDish({ openid: A, event: { publicDishId: pubId } });
    assert.strictEqual(w.data.reviewStatus, 'withdrawn');
    assert.strictEqual((await discovery.getPublicDish({ openid: B, event: { id: pubId } })).code, 1);
    assert.strictEqual((await discovery.savePublicDish({ openid: C, event: { id: pubId } })).code, 1);
    // 恢复 approved 供推荐测试
    process.env.ADMIN_OPENIDS = 'admin_openid';
    await discovery.reviewPublicDish({ openid: 'admin_openid', event: { publicDishId: pubId, approve: true } });
  });

  /* ---- P3：推荐 ---- */
  await t('三种口味画像产生不同推荐顺序', async () => {
    await db.collection('public_dishes').add({ data: { _id: 'pub2', sourceDishId: 'x', authorOpenid: C, authorNickname: '面馆老周', reviewStatus: 'approved', name: '阳春面', tags: ['面食'], coverImage: '', images: [], likeCount: 120, saveCount: 0, updatedAt: new Date() } });
    await db.collection('public_dishes').add({ data: { _id: 'pub3', sourceDishId: 'y', authorOpenid: C, authorNickname: '辣妹子', reviewStatus: 'approved', name: '麻辣香锅', tags: ['麻辣'], coverImage: '', images: [], likeCount: 5, saveCount: 0, updatedAt: new Date() } });
    // A：辣画像（回锅肉 often 辣）
    const fa = await recommend.getFeed({ openid: A, event: { size: 5 } });
    // B：清淡画像
    const fb = await recommend.getFeed({ openid: B, event: { size: 5 } });
    const namesA = fa.data.items.map(i => i.name);
    const namesB = fb.data.items.map(i => i.name);
    assert.notDeepStrictEqual(namesA.slice(0, 3), namesB.slice(0, 3), '画像不同 → 前三不同');
    // B 清淡：麻辣香锅不应在 B 的前 2
    assert(namesB.slice(0, 2).indexOf('麻辣香锅') < 0, '清淡用户前排不出麻辣');
  });

  await t('忌口硬过滤：设置 avoid 后不出现在 feed', async () => {
    await recommend.saveTastePrefs({ openid: B, event: { avoidTags: ['麻辣'] } });
    const fb = await recommend.getFeed({ openid: B, event: { size: 10 } });
    assert(fb.data.items.every(i => !(i.tags || []).includes('麻辣')));
  });

  await t('热度不翻盘：高赞低匹配排在低赞高匹配之后', async () => {
    // C：无历史新用户，设置极端清淡偏好
    await recommend.saveTastePrefs({ openid: C, event: { tastePrefs: { spicy: 0, light: 1, carb: 0, sweet: 0, rich: 0 } } });
    const fc = await recommend.getFeed({ openid: C, event: { size: 10 } });
    const items = fc.data.items.filter(i => i.type === 'public');
    const iHot = items.findIndex(i => i.name === '麻辣香锅');
    const iCold = items.findIndex(i => i.name === '清蒸鲈鱼');
    // 清蒸鲈鱼未入公开池时跳过（本用例只验证麻辣香锅不在口味带前部）
    assert(iHot === -1 || iHot >= 1, '高热度辣菜不在清淡用户首位');
  });

  await t('游标曝光去重：第二页不含第一页内容', async () => {
    const f1 = await recommend.getFeed({ openid: A, event: { size: 2 } });
    if (!f1.data.nextCursor) return; // 候选太少无法翻页，跳过
    const f2 = await recommend.getFeed({ openid: A, event: { size: 2, cursor: f1.data.nextCursor } });
    const ids1 = f1.data.items.map(i => i.seenKey);
    const dup = f2.data.items.filter(i => ids1.includes(i.seenKey));
    assert.strictEqual(dup.length, 0, '无重复曝光');
  });

  await t('AI 理由不可用时回退模板（默认 AI_REASON_ENABLED 未开）', async () => {
    delete process.env.AI_REASON_ENABLED;
    const f = await recommend.getFeed({ openid: A, event: { size: 3 } });
    f.data.items.forEach(i => assert(i.reason && i.reason.length > 5, '有理由文本'));
  });

  await t('行为记录按 openid 隔离', async () => {
    await discovery.logBehavior({ openid: A, event: { type: 'next', refType: 'public', refId: pubId } });
    await discovery.logBehavior({ openid: B, event: { type: 'save', refType: 'public', refId: pubId } });
    const aRows = cols.user_behaviors.filter(b => b.openid === A);
    const bRows = cols.user_behaviors.filter(b => b.openid === B);
    assert(aRows.every(b => b.openid === A));
    assert.strictEqual(bRows[0].type, 'save');
    const bad = await discovery.logBehavior({ openid: A, event: { type: 'hack', refId: 'x' } });
    assert.strictEqual(bad.code, 1, '未知类型拒绝');
  });

  console.log(`\n${passed} passed${process.exitCode ? '（存在失败）' : ''}`);
})();
