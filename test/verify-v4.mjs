import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const st = () => mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const sh = p.selectComponent('#sheet');
  const tb = p.getTabBar && p.getTabBar();
  return { sheet: p.data.sheetShow, lock: p.data.stackLocked, tb: tb ? tb.data.hidden : null, vis: sh ? sh.data.visible : null };
});
await mini.reLaunch('/pages/index/index');
await sleep(4500);
// 开
await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.onCardTap({ detail: { item: p.data.feedQueue[p.data.cursorIdx] } }); });
await sleep(700);
console.log('open:', JSON.stringify(await st()));
// 遮罩点击关闭
await mini.evaluate(() => { getCurrentPages().slice(-1)[0].selectComponent('#sheet').onMaskTap(); });
await sleep(600);
console.log('mask close:', JSON.stringify(await st()));
// 拖拽关闭（onDragClose 新路径）
await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.onCardTap({ detail: { item: p.data.feedQueue[p.data.cursorIdx] } }); });
await sleep(600);
await mini.evaluate(() => { getCurrentPages().slice(-1)[0].selectComponent('#sheet').onDragClose(); });
await sleep(600);
console.log('drag close:', JSON.stringify(await st()));
// 快速开关 x4
for (let i = 0; i < 4; i++) {
  await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.onCardTap({ detail: { item: p.data.feedQueue[p.data.cursorIdx] } }); });
  await sleep(150);
  await mini.evaluate(() => { getCurrentPages().slice(-1)[0].selectComponent('#sheet').onMaskTap(); });
  await sleep(400);
}
console.log('rapid:', JSON.stringify(await st()));
const f = await st();
console.log(!f.sheet && !f.lock && f.tb === false && f.vis === false ? 'VERIFY PASS' : 'VERIFY FAIL');
await mini.disconnect();
