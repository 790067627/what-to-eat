import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await mini.reLaunch('/pages/index/index');
await sleep(5000);
const page = await mini.currentPage();

// 1) tap 主卡 → 抽屉
const stack = await page.$('#cardStack');
await stack.tap();
await sleep(1200);
const s1 = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  return { sheetShow: p.data.sheetShow, item: p.data.sheetItem && p.data.sheetItem.name };
});
console.log('1) 点卡→抽屉:', JSON.stringify(s1));
if (s1.sheetShow) await mini.screenshot({ path: '../preview/verify-sheet-open.png' });

// 2) 关抽屉
await mini.evaluate(() => getCurrentPages().slice(-1)[0].onSheetClose());
await sleep(800);
const s2 = await mini.evaluate(() => ({ sheetShow: getCurrentPages().slice(-1)[0].data.sheetShow }));
console.log('2) 关闭:', JSON.stringify(s2));

// 3) 换一道按钮仍工作
const btns = await page.$$('.insp-btn');
const idx0 = await mini.evaluate(() => getCurrentPages().slice(-1)[0].data.cursorIdx);
await btns[1].tap();
await sleep(1300);
const idx1 = await mini.evaluate(() => getCurrentPages().slice(-1)[0].data.cursorIdx);
console.log('3) 换一道:', idx0, '->', idx1);

// 4) 滑动不误触抽屉（touchmove 后 tap 应被抑制——用 touchstart/move/end 模拟）
const zone = await page.$('.stack-zone');
const off = await zone.offset(); const sz = await zone.size();
const cy = off.top + sz.height / 2;
await zone.touchstart({ x: off.left + sz.width * 0.8, y: cy });
for (let i = 1; i <= 6; i++) { await zone.touchmove({ x: off.left + sz.width * 0.8 - i * 30, y: cy }); await sleep(40); }
await zone.touchend({ x: off.left + sz.width * 0.8 - 180, y: cy });
await sleep(1300);
const s4 = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  return { cursorIdx: p.data.cursorIdx, sheetShow: p.data.sheetShow };
});
console.log('4) 滑动后:', JSON.stringify(s4), s4.cursorIdx > idx1 ? '换卡OK' : '换卡?', s4.sheetShow ? 'FAIL误触抽屉' : '无误触OK');
await mini.disconnect();
const pass = s1.sheetShow && !s2.sheetShow && idx1 > idx0;
console.log(pass ? 'VERIFY PASS' : 'VERIFY FAIL');
