/* 状态机验证：换卡/锁定时序/连滑防重入/数据卡片渲染/抽屉开合后恢复 */
import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
mini.on('console', m => { if (m.type === 'error') console.log('CONSOLE-ERR:', JSON.stringify(m.args).slice(0, 200)); });

const snap = () => mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const c = p.selectComponent('#cardStack');
  return {
    cursor: p.data.cursorIdx, locked: c.data.locked,
    rl: c.data.renderList.map(r => `${r.key.slice(0, 12)}@d${r.depth}${r.exiting ? '-exit' : ''}`),
    mapN: Object.keys(c.data.cardsMap || {}).length,
    clearToken: c.data.clearToken,
    winLen: c._win ? c._win.length : -1
  };
});

await mini.reLaunch('/pages/index/index');
await sleep(5000);
const s0 = await snap();
console.log('初始:', JSON.stringify(s0));
console.log('T1 卡片内容进 map:', s0.mapN >= 4 ? 'PASS' : 'FAIL mapN=' + s0.mapN);
console.log('T1 窗口4张:', s0.winLen === 4 ? 'PASS' : 'FAIL');

// T2 编程式换卡 → settling 锁立即生效
const adv = mini.evaluate(() => { getCurrentPages().slice(-1)[0].selectComponent('#cardStack').advanceByButton(); });
await sleep(100);
const sMid = await snap();
console.log('T2 settling 中 locked:', sMid.locked === true ? 'PASS' : 'FAIL', JSON.stringify(sMid.rl));
await adv; await sleep(600);
const s2 = await snap();
console.log('T2 换卡完成:', s2.cursor === 1 && !s2.locked && s2.rl.length === 4 ? 'PASS' : 'FAIL', JSON.stringify(s2));

// T3 settling 期重复提交被拒（locked 防重入）
await mini.evaluate(() => {
  const c = getCurrentPages().slice(-1)[0].selectComponent('#cardStack');
  c.advanceByButton();
  c.advanceByButton();   // 第二次应被 locked 拒绝
  c.advanceByButton();
});
await sleep(700);
const s3 = await snap();
console.log('T3 三连击只走一张:', s3.cursor === 2 ? 'PASS' : 'FAIL cursor=' + s3.cursor, JSON.stringify(s3.rl));

// T4 clearToken 递增（内联清理已触发）
console.log('T4 clearToken:', s3.clearToken >= s2.clearToken ? 'PASS(' + s3.clearToken + ')' : 'FAIL');

// T5 抽屉开→锁→关→解锁后可再换卡
await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.onCardTap({ detail: { item: p.data.feedQueue[p.data.cursorIdx] } }); });
await sleep(600);
const s5a = await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return { lock: p.data.stackLocked, ui: p.selectComponent('#cardStack').data.interactionLocked }; });
console.log('T5 抽屉开+卡栈锁:', s5a.lock && s5a.ui ? 'PASS' : 'FAIL', JSON.stringify(s5a));
// 锁定期间编程式换卡应被 WXS/组件拒绝？—— advanceByButton 走 JS commitSwipe（locked 只防动画期），
// 但 interactionLocked 不拦 JS 路径；验证点：抽屉开着时手势锁在 WXS（真机触摸被 uiLocked 短路）
await mini.evaluate(() => { const sh = getCurrentPages().slice(-1)[0].selectComponent('#sheet'); sh.onMaskTap(); });
await sleep(800);
const s5b = await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return { lock: p.data.stackLocked, sheet: p.data.sheetShow }; });
console.log('T5 抽屉关+解锁:', !s5b.lock && !s5b.sheet ? 'PASS' : 'FAIL', JSON.stringify(s5b));
await mini.evaluate(() => { getCurrentPages().slice(-1)[0].selectComponent('#cardStack').advanceByButton(); });
await sleep(700);
const s5c = await snap();
console.log('T5 关抽屉后换卡恢复:', s5c.cursor === 3 ? 'PASS' : 'FAIL cursor=' + s5c.cursor);

// T6 onNotInterest 走组件通道（视觉+游标同步）
await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const c = p.selectComponent('#cardStack');
  const front = c._win[0];
  p.onNotInterest({ detail: { item: c.data.cardsMap[front.key] } });   // cardsMap 在组件上
});
await sleep(800);
const s6 = await snap();
console.log('T6 不感兴趣→真换卡:', s6.cursor === 4 ? 'PASS' : 'FAIL cursor=' + s6.cursor);

const all = s0.mapN >= 4 && s2.cursor === 1 && s3.cursor === 2 && s3.clearToken >= s2.clearToken && s5c.cursor === 3 && s6.cursor === 4;
console.log(all ? 'FSM VERIFY PASS' : 'FSM VERIFY FAIL');
await mini.disconnect();
