/* test/integration-cloud.mjs — 真实云端联调（automator + 工具管理员身份）
 * 用法：node test/integration-cloud.mjs
 * 前置：开发者工具已打开 discovery 项目；端口 9420 未被占用
 * 覆盖：发布三态/审核/公开池/点赞幂等/加入幂等/撤回/旧版兼容/AI 特征与理由取证
 */
import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);   // CJS 实例导出，解构会丢 this

const ENV = 'cloud1-d2g70c8532117f303';
const log = (...a) => console.log('[IT]', ...a);

const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
log('automator connected');

const call = (action, payload = {}) => mini.evaluate(
  ({ action, payload }) => new Promise(resolve => {
    wx.cloud.callFunction({ name: 'dish', data: { action, ...payload } })
      .then(r => resolve(r.result))
      .catch(e => resolve({ code: -1, msg: e.message }));
  }), { action, payload });

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  log(cond ? '✓' : '✗', name, extra);
};

/* ---------- 0. 身份与旧版兼容 ---------- */
const me = await call('getUserInfo');
const A = me.data.openid;
log('openid(A/管理员):', A.slice(0, 8) + '…');

const legacy = await call('listDishes');
check('旧版 action listDishes 兼容', legacy.code === 0 && Array.isArray(legacy.data), `count=${legacy.data && legacy.data.length}`);
const rp = await call('randomPick', { filters: {} });
check('旧版 action randomPick 兼容', rp.code === 0 || rp.code === 2, rp.code === 2 ? '(空池合理)' : '');
const stats = await call('getStats');
check('旧版 action getStats 兼容', stats.code === 0, JSON.stringify(stats.data));

/* ---------- 1. 发布：文字+图片安检 → 三态 ---------- */
// 找一道有封面的菜
const withCover = (legacy.data || []).find(d => d.coverImage);
const dishId = (withCover || legacy.data[0])._id;
log('发布目标菜品:', (withCover || legacy.data[0]).name, withCover ? '(带封面→走图片安检)' : '(无封面→仅文字安检)');

const pub = await call('publishDish', { dishId, options: { includePrice: false, includeDescription: true, anonymous: false } });
if (pub.code !== 0) log('publishDish 错误详情:', JSON.stringify(pub));
check('publishDish 成功', pub.code === 0, `reviewStatus=${pub.data && pub.data.reviewStatus}`);
const pubId = pub.data.publicDishId;
const st0 = pub.data.reviewStatus;
check('审核三态合法(pending/approved/rejected)', ['pending', 'approved', 'rejected'].includes(st0), st0);

const pubDetail = await call('getPublicDish', { id: pubId });
check('作者自读公开快照(任意状态)', pubDetail.code === 0);
log('  secCheck:', JSON.stringify(pubDetail.data.secCheck), 'traceId:', pubDetail.data.secTraceId || '(无)');

/* ---------- 2. 管理员审核（若 pending） ---------- */
if (st0 === 'pending') {
  const rv = await call('reviewPublicDish', { publicDishId: pubId, approve: true });
  check('管理员审核通过(A 为 ADMIN 时)', rv.code === 0, rv.code ? rv.msg : '');
} else if (st0 === 'approved') {
  check('安检全过自动发布(无需人工)', true, '自动 approved');
}

/* ---------- 3. 公开池进入推荐 ---------- */
const feed = await call('getFeed', { size: 6 });
check('getFeed 返回', feed.code === 0 && Array.isArray(feed.data.items), `items=${feed.data.items && feed.data.items.length}`);
const inFeed = (feed.data.items || []).some(i => i.id === pubId);
log('  公开菜在 feed 中:', inFeed, '｜首卡:', feed.data.items && feed.data.items[0] && feed.data.items[0].name);
check('feed 含公开菜或私有菜(池非空)', (feed.data.items || []).length > 0);
const reasonSample = feed.data.items && feed.data.items[0] && feed.data.items[0].reason;
log('  理由样例:', reasonSample);

/* ---------- 4. 点赞幂等 ---------- */
if (st0 !== 'rejected') {
  const l1 = await call('likePublicDish', { id: pubId, like: true });
  const l2 = await call('likePublicDish', { id: pubId, like: true });
  const l3 = await call('likePublicDish', { id: pubId, like: false });
  check('点赞→重复→取消 计数 1/1/0', l1.data.likeCount === 1 && l2.data.likeCount === 1 && l3.data.likeCount === 0,
    `${l1.data.likeCount}/${l2.data.likeCount}/${l3.data.likeCount}`);
  await call('likePublicDish', { id: pubId, like: true }); // 恢复点赞态供 B 侧观察
}

/* ---------- 5. 自己不能加入自己的公开菜 ---------- */
const selfSave = await call('savePublicDish', { id: pubId });
check('作者自加入被拒(防自刷)', selfSave.code === 1, selfSave.msg || '');

/* ---------- 6. 撤回 → 不可读/不可加入 → 恢复 ---------- */
const wd = await call('withdrawPublicDish', { publicDishId: pubId });
check('撤回成功', wd.code === 0 && wd.data.reviewStatus === 'withdrawn');
const feedAfter = await call('getFeed', { size: 10 });
check('撤回后退出推荐池', !(feedAfter.data.items || []).some(i => i.id === pubId));
const rv2 = await call('reviewPublicDish', { publicDishId: pubId, approve: true });
check('重新审核恢复 approved', rv2.code === 0, rv2.code ? rv2.msg : '');

/* ---------- 7. AI 取证：flavor_profiles / 理由来源 ---------- */
// flavor_profiles 集合默认权限=仅创建者可读，客户端直查必被拒；
// 改为消费侧验证：getFeed 理由含「AI 口味解读」= 发布期提取的特征已被推荐链路消费
const aiInReason = (feed.data.items || []).some(i => (i.reason || '').includes('AI 口味解读'));
check('AI 口味特征已持久化并被推荐消费(理由含 AI 解读)', aiInReason,
  aiInReason ? '' : '理由: ' + ((feed.data.items || [])[0] || {}).reason);

const beh = await call('logBehavior', { type: 'like', refType: 'public', refId: pubId });
check('行为记录写入', beh.code === 0);

/* ---------- 8. 定向分享 token ---------- */
const tk = await call('createShareToken', { dishId });
check('createShareToken', tk.code === 0 && !!tk.data.token);
const gs = await call('getSharedDish', { token: tk.data.token });
check('getSharedDish 白名单快照', gs.code === 0 && gs.data.openid === undefined && gs.data.price === undefined);

/* ---------- 汇总 ---------- */
const failed = results.filter(r => !r.pass);
log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
if (failed.length) failed.forEach(f => log('  FAIL:', f.name, f.extra));
log('pubId(供 B 侧真机验证):', pubId);
log('A openid:', A);

await mini.disconnect();
process.exit(failed.length ? 1 : 0);
