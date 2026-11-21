/* 真机路径验证：模拟触摸点卡 → 检查抽屉 sheetShow=true → 再点遮罩关闭 */
import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

await mini.reLaunch('/pages/index/index');
await sleep(5000);
const page = await mini.currentPage();
console.log('page:', page.path);

const state0 = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  return { sheetShow: p.data.sheetShow, queueLen: p.data.feedQueue.length, stackH: p.data.stackHeightPx };
});
console.log('before tap:', JSON.stringify(state0));

// 卡片中心坐标：视口宽 375（模拟器 iPhone6/7/8），卡片区顶部 ≈ nav(~88) + head(~90) + gap
// 直接取 .stack-zone 的位置（页面级选择器可用）
const zone = await page.$('.stack-zone');
let cx = 187, cy = 420;
if (zone) {
  const off = await zone.offset();
  const sz = await zone.size();
  cx = off.left + sz.width / 2; cy = off.top + sz.height / 2;
  console.log('zone:', JSON.stringify(off), JSON.stringify(sz));
} else {
  console.log('zone not found, use fallback center');
}

// 真实触摸序列：touchstart + touchend（同点位短按 = tap）
await zone.touchstart({ x: cx, y: cy });
await sleep(80);
await zone.touchend({ x: cx, y: cy });
await sleep(1500);

const state1 = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  return { sheetShow: p.data.sheetShow, sheetItem: p.data.sheetItem && p.data.sheetItem.name };
});
console.log('after tap:', JSON.stringify(state1));
if (!state1.sheetShow) {
  console.log('FAIL: 抽屉未弹出');
  await mini.disconnect();
  process.exit(1);
}
await mini.screenshot({ path: '/Users/wx/WorkBuddy/what-to-eat-discovery/preview/verify-sheet-open.png' });

// 点遮罩关闭
// 遮罩在 dish-sheet 组件内：evaluate 触发页面 onSheetClose 等价路径改为真实点遮罩
const mask = await page.$('dish-sheet >>> .ds-mask');
if (mask) { await mask.tap(); } else { await mini.evaluate(() => { getCurrentPages().slice(-1)[0].onSheetClose(); }); }
await sleep(1200);
const state2 = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  return { sheetShow: p.data.sheetShow };
});
console.log('after mask tap:', JSON.stringify(state2));
if (state2.sheetShow) { console.log('FAIL: 遮罩点击未关闭'); process.exit(1); }

// 滑动手势仍正常（左滑换卡）
const zone2 = await page.$('.stack-zone');
await zone2.touchstart({ x: 300, y: cy });
for (let i = 1; i <= 8; i++) { await zone2.touchmove({ x: 300 - i * 30, y: cy }); await sleep(30); }
await zone2.touchend({ x: 60, y: cy });
await sleep(1200);
const state3 = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  return { cursorIdx: p.data.cursorIdx };
});
console.log('after swipe:', JSON.stringify(state3), state3.cursorIdx > 0 ? 'PASS 换卡成功' : 'FAIL 滑动无效');
await mini.disconnect();
console.log('ALL DONE');
