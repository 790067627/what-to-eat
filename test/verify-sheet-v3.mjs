import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getSheet = () => mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const sh = p.selectComponent('#sheet');
  const tb = p.getTabBar && p.getTabBar();
  return {
    sheetShow: p.data.sheetShow, stackLocked: p.data.stackLocked, tbHidden: tb ? tb.data.hidden : null,
    compVisible: sh ? sh.data.visible : null,
    compClosing: sh ? !!sh._closing : null,
    dragStyle: sh ? (sh.data.dragStyle || '').slice(0, 60) : null,
    maskStyle: sh ? (sh.data.maskStyle || '').slice(0, 40) : null
  };
});

await mini.reLaunch('/pages/index/index');
await sleep(4500);

// 1) 打开
await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  p.onCardTap({ detail: { item: p.data.feedQueue[p.data.cursorIdx] } });
});
await sleep(800);
console.log('1 open:', JSON.stringify(await getSheet()));

// 2) 遮罩点击关闭：连续点 3 次（防重复验证）
await mini.evaluate(() => {
  const sh = getCurrentPages().slice(-1)[0].selectComponent('#sheet');
  sh.onMaskTap(); sh.onMaskTap(); sh.onMaskTap();
});
await sleep(500);
const mid = await getSheet();
console.log('2 closing(动画中):', JSON.stringify(mid));
await sleep(600);
const closed = await getSheet();
console.log('2 closed:', JSON.stringify(closed));

// 3) 拖拽不足回弹
await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  p.onCardTap({ detail: { item: p.data.feedQueue[p.data.cursorIdx] } });
});
await sleep(700);
await mini.evaluate(() => {
  const sh = getCurrentPages().slice(-1)[0].selectComponent('#sheet');
  sh.onGripDragStart();
  sh.onGripRelease({ dy: 40, vy: 0.1 });   // 不足阈值 → 回弹
});
await sleep(500);
const bounce = await getSheet();
console.log('3 bounce(应仍打开):', JSON.stringify(bounce));

// 4) 拖拽过阈值关闭
await mini.evaluate(() => {
  const sh = getCurrentPages().slice(-1)[0].selectComponent('#sheet');
  sh.onGripDragStart();
  sh.onGripRelease({ dy: 120, vy: 0.2 });  // >70px → 关闭
});
await sleep(600);
const dragClosed = await getSheet();
console.log('4 drag-close:', JSON.stringify(dragClosed));

// 5) 快速下甩（短距离高速）
await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  p.onCardTap({ detail: { item: p.data.feedQueue[p.data.cursorIdx] } });
});
await sleep(600);
await mini.evaluate(() => {
  const sh = getCurrentPages().slice(-1)[0].selectComponent('#sheet');
  sh.onGripDragStart();
  sh.onGripRelease({ dy: 25, vy: 0.9 });   // vy>0.5 且 dy>20 → 关闭
});
await sleep(600);
console.log('5 flick-close:', JSON.stringify(await getSheet()));

// 6) 快速开关 5 轮状态不乱
for (let i = 0; i < 5; i++) {
  await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.onCardTap({ detail: { item: p.data.feedQueue[p.data.cursorIdx] } }); });
  await sleep(180);
  await mini.evaluate(() => { const sh = getCurrentPages().slice(-1)[0].selectComponent('#sheet'); sh.onMaskTap(); });
  await sleep(400);
}
await sleep(400);
const final = await getSheet();
console.log('6 rapid x5:', JSON.stringify(final));
const ok = closed.compVisible === false && closed.tbHidden === false && closed.stackLocked === false
  && bounce.sheetShow === true && dragClosed.compVisible === false
  && !final.sheetShow && !final.stackLocked && final.tbHidden === false;
console.log(ok ? 'VERIFY PASS' : 'VERIFY FAIL');
await mini.disconnect();
