/* WXS 手势逻辑单测：mock owner/element，验证 tap 判定与滑动提交分流 */
const fs = require('fs');
const src = fs.readFileSync('../miniprogram/components/card-stack/gestures.wxs', 'utf8');
const module_ = { exports: {} };
new Function('module', 'Math', src)(module_, Math);
const g = module_.exports;

function mkOwner(calls) {
  return {
    callMethod: (name, arg) => calls.push([name, arg]),
    selectComponent: () => ({ setStyle: () => {} })
  };
}
const touch = (x, y, t) => ({ touches: [{ clientX: x, clientY: y }], timeStamp: t });

let pass = 0, fail = 0;
const t = (name, fn) => { g._reset(); try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, e.message); } };

t('轻点(位移0, 120ms) → callMethod onCardTap', () => {
  const calls = [];
  const o = mkOwner(calls);
  g.touchStart(touch(200, 400, 0), o);
  g.touchEnd(touch(200, 400, 120), o);
  const names = calls.map(c => c[0]);
  if (!names.includes('onCardTap')) throw new Error('未触发 onCardTap: ' + JSON.stringify(names));
  if (names.includes('commitSwipe')) throw new Error('轻点不应提交换卡');
});

t('长位移轻按(8px, 300ms) → 仍算 tap', () => {
  const calls = [];
  const o = mkOwner(calls);
  g.touchStart(touch(200, 400, 0), o);
  g.touchMove(touch(208, 400, 150), o);
  g.touchEnd(touch(208, 400, 300), o);
  if (!calls.some(c => c[0] === 'onCardTap')) throw new Error('应触发 tap');
});

t('横滑 150px 慢速 → commitSwipe(dir=-1) 且不触发 tap', () => {
  const calls = [];
  const o = mkOwner(calls);
  g.touchStart(touch(300, 400, 0), o);
  for (let i = 1; i <= 8; i++) g.touchMove(touch(300 - i * 20, 400, i * 40), o);
  g.touchEnd(touch(140, 400, 400), o);
  const commit = calls.find(c => c[0] === 'commitSwipe');
  if (!commit) throw new Error('未提交换卡');
  if (commit[1].dir !== -1) throw new Error('方向应为 -1，实际 ' + commit[1].dir);
  if (calls.some(c => c[0] === 'onCardTap')) throw new Error('滑动不应触发 tap');
});

t('快速甩出(60px, 高速) → commitSwipe（速度判定）', () => {
  const calls = [];
  const o = mkOwner(calls);
  g.touchStart(touch(300, 400, 0), o);
  g.touchMove(touch(270, 400, 30), o);
  g.touchEnd(touch(240, 400, 60), o);   // v ≈ 30px/30ms = 1.0 > 0.55
  if (!calls.some(c => c[0] === 'commitSwipe')) throw new Error('甩出应提交');
});

t('小位移松手(40px) → 不换卡不 tap（回弹）', () => {
  const calls = [];
  const o = mkOwner(calls);
  g.touchStart(touch(300, 400, 0), o);
  g.touchMove(touch(280, 400, 100), o);
  g.touchEnd(touch(260, 400, 250), o);
  if (calls.some(c => c[0] === 'commitSwipe')) throw new Error('小位移不应换卡');
  if (calls.some(c => c[0] === 'onCardTap')) throw new Error('40px 位移不应算 tap');
});

t('纵向滑动(方向锁) → 不接管不触发 tap', () => {
  const calls = [];
  const o = mkOwner(calls);
  g.touchStart(touch(200, 300, 0), o);
  g.touchMove(touch(202, 380, 100), o);   // 纵向 80px > 横向 2px
  g.touchEnd(touch(202, 420, 200), o);
  if (calls.some(c => c[0] === 'commitSwipe')) throw new Error('纵滑不应换卡');
  if (calls.some(c => c[0] === 'onCardTap')) throw new Error('纵滑不应 tap');
});

t('长按(500ms 位移0) → 不触发 tap（longpress 通道）', () => {
  const calls = [];
  const o = mkOwner(calls);
  g.touchStart(touch(200, 400, 0), o);
  g.touchEnd(touch(200, 400, 500), o);
  if (calls.some(c => c[0] === 'onCardTap')) throw new Error('500ms 不应算 tap');
});

/* ===== 提交协议状态机 ===== */

const swipe = (o, x0, t0) => {
  g.touchStart(touch(x0, 400, t0), o);
  for (let i = 1; i <= 6; i++) g.touchMove(touch(x0 - i * 25, 400, t0 + i * 30), o);
  g.touchEnd(touch(x0 - 150, 400, t0 + 200), o);
};

t('commit 后未释放：第二次 touchStart 不进入 dragging（settling 锁）', () => {
  const calls = [];
  const o = mkOwner(calls);
  swipe(o, 300, 0);
  if (!calls.some(c => c[0] === 'commitSwipe')) throw new Error('首次应提交');
  calls.length = 0;
  swipe(o, 300, 1000);           // settling 期再次滑动
  if (calls.some(c => c[0] === 'commitSwipe')) throw new Error('settling 期不应再提交');
  const peek = g._peek();
  if (peek.phase !== 'settling') throw new Error('phase 应保持 settling，实际 ' + peek.phase);
});

t('releaseToken 释放后：第二次 touchStart 正常提交（连续滑动核心用例）', () => {
  const calls = [];
  const o = mkOwner(calls);
  swipe(o, 300, 0);
  g.syncRelease(1, 0, o);          // JS _release() → releaseToken 递增回调
  if (g._peek().phase !== 'idle') throw new Error('释放后应回 idle');
  calls.length = 0;
  swipe(o, 300, 1000);
  if (!calls.some(c => c[0] === 'commitSwipe')) throw new Error('第二次滑动应提交');
});

t('连续 3 次滑动（每次间隔释放）全部提交成功', () => {
  const calls = [];
  const o = mkOwner(calls);
  let n = 0;
  for (let i = 0; i < 3; i++) {
    swipe(o, 300, i * 1000);
    g.syncRelease(++n, n - 1, o);
  }
  const commits = calls.filter(c => c[0] === 'commitSwipe').length;
  if (commits !== 3) throw new Error('应提交 3 次，实际 ' + commits);
});

t('未释放时 syncRelease 才恢复；dragging 中 clearAll 不清样式（竞态守卫）', () => {
  const cleared = [];
  const o = {
    callMethod: () => {},
    selectComponent: () => ({ setStyle: () => {} }),
    selectAll: () => [{ setStyle: st => cleared.push(st) }]
  };
  g.touchStart(touch(300, 400, 0), o);
  g.touchMove(touch(250, 400, 50), o);   // 进入 dragging
  g.clearAll(1, 0, o);                    // 拖拽中收到 clearToken
  if (cleared.length) throw new Error('dragging 期 clearAll 不得清样式');
  g.touchEnd(touch(250, 400, 300), o);    // 小位移回弹
  g.clearAll(2, 1, o);                    // idle 期清理生效
  if (!cleared.length) throw new Error('idle 期 clearAll 应清样式');
});

t('uiLocked 期间 touchStart 短路', () => {
  const calls = [];
  const o = mkOwner(calls);
  g.syncUiLock(true);
  swipe(o, 300, 0);
  if (calls.length) throw new Error('锁定期不应有任何 callMethod');
  g.syncUiLock(false);
  swipe(o, 300, 1000);
  if (!calls.some(c => c[0] === 'commitSwipe')) throw new Error('解锁后应恢复');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
