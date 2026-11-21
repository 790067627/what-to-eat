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
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, e.message); } };

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
