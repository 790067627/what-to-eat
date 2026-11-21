import automator from 'miniprogram-automator';
import fs from 'node:fs';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = '/Users/wx/WorkBuddy/what-to-eat-discovery/preview/frames';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
const shot = async () => { try { await mini.screenshot({ path: `${OUT}/f${String(n++).padStart(3, '0')}.png` }); } catch (e) {} };
const callPage = (m, arg) => mini.evaluate(({ m, arg }) => {
  const p = getCurrentPages().slice(-1)[0];
  if (p && typeof p[m] === 'function') p[m](arg);
  return !!p;
}, { m, arg });

await mini.reLaunch('/pages/index/index');
await sleep(5000);
console.log('page ok:', await callPage('buildGreeting'));
await shot();
// 换一道（与手势同动画通道：组件 commitSwipe）
await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const st = p.selectComponent('#cardStack');
  if (st) st.advanceByButton();
});
for (let i = 0; i < 12; i++) { await sleep(55); await shot(); }
await sleep(800); await shot();
// 开抽屉
await callPage('onCardTap', { detail: { item: null } });  // null 会被拦，改用真实卡
await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const cur = p.data.feedQueue[p.data.cursorIdx];
  if (cur) p.onCardTap({ detail: { item: cur } });
});
for (let i = 0; i < 12; i++) { await sleep(55); await shot(); }
await sleep(800); await shot();
// 关抽屉
await callPage('onSheetClose');
for (let i = 0; i < 12; i++) { await sleep(55); await shot(); }
await shot();
console.log('frames:', n);
await mini.disconnect();
