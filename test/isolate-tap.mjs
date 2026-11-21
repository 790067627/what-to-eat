import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await mini.reLaunch('/pages/index/index');
await sleep(4000);

// A) 直接调页面 onCardTap —— 验证抽屉数据流本身
const r1 = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const cur = p.data.feedQueue[p.data.cursorIdx];
  p.onCardTap({ detail: { item: cur } });
  return { called: !!cur, sheetShow: p.data.sheetShow };
});
console.log('A) 直接调 onCardTap:', JSON.stringify(r1));
await sleep(600);
const r1b = await mini.evaluate(() => ({ show: getCurrentPages().slice(-1)[0].data.sheetShow }));
console.log('A2) 600ms 后 sheetShow:', JSON.stringify(r1b));
await mini.evaluate(() => getCurrentPages().slice(-1)[0].onSheetClose());
await sleep(600);

// B) 组件层：模拟 WXS callMethod('onCardTap') 路径
const r2 = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const st = p.selectComponent('#cardStack');
  if (!st) return { err: 'no cardStack' };
  st._moved = 0;
  st.onCardTap();   // WXS tap 命中后调的就是这个
  return { ok: true };
});
console.log('B) 组件 onCardTap:', JSON.stringify(r2));
await sleep(600);
const r2b = await mini.evaluate(() => ({ show: getCurrentPages().slice(-1)[0].data.sheetShow }));
console.log('B2) sheetShow:', JSON.stringify(r2b));
await mini.disconnect();
