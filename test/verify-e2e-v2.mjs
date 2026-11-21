/* 端到端验证：提交协议/连续滑动/队尾结束态/抽屉锁/保存移除（automator 模拟器） */
import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
mini.on('console', m => { if (m.type === 'error') console.log('CONSOLE-ERR:', JSON.stringify(m.args).slice(0, 160)); });

const snap = () => mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const c = p.selectComponent('#cardStack');
  return {
    cursor: p.data.cursorIdx, end: p.data.feedEnd, qlen: p.data.feedQueue.length,
    hasMore: p.data.hasMore, locked: c.data.locked, rt: c.data.releaseToken, ct: c.data.clearToken,
    win: c._win.map(w => w.key.slice(0, 10) + '@' + w.depth).join(','),
    cCursor: c._cursor, exiting: c.data.renderList.filter(r => r.exiting).length
  };
});
const adv = () => mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#cardStack').advanceByButton());
let fails = 0;
const chk = (name, cond, extra = '') => { console.log(cond ? '✓' : '✗', name, extra); if (!cond) fails++; };

await mini.reLaunch('/pages/index/index');
await sleep(5000);
const s0 = await snap();
chk('初始：窗口4张 locked=false', s0.win.split(',').length === 4 && !s0.locked, JSON.stringify(s0.win));

// 1) 连续滑动 6 次（模拟真机连滑节奏：每次等 settling 收尾）
for (let i = 0; i < 6; i++) {
  await adv();
  await sleep(120);
  const mid = await snap();
  if (!mid.locked) { chk(`第${i + 1}滑 settling 上锁`, false, JSON.stringify(mid)); break; }
  await sleep(600);
}
const s1 = await snap();
chk('连滑6次：游标=6 无死锁 无出场残留', s1.cCursor === 6 && !s1.locked && s1.exiting === 0, `cursor=${s1.cCursor} rt=${s1.rt}`);
chk('releaseToken 随提交递增(≥6)', s1.rt >= 6, 'rt=' + s1.rt);

// 2) settling 期快速三连击（动画期间重复触摸）
await adv(); await sleep(50);
const midLock = await snap();
chk('三连击前 settling 锁生效', midLock.locked === true);
await adv(); await sleep(50); await adv();
await sleep(700);
const s2 = await snap();
chk('动画期三连击只走一张', s2.cCursor === 7 && !s2.locked, 'cursor=' + s2.cCursor + ' locked=' + s2.locked);

// 3) 滑到队尾 → depleted → 结束态
let guard = 0;
while (guard++ < 12) {
  const st = await snap();
  if (st.end) break;
  if (st.cCursor + 1 >= st.qlen && !st.hasMore) { await adv(); await sleep(600); break; }
  await adv(); await sleep(560);
}
const s3 = await snap();
chk('队尾触发结束态 feedEnd=true', s3.end === true, JSON.stringify(s3));
chk('结束态窗口未清空(仍可操作)', s3.win.split(',').filter(Boolean).length >= 1, s3.win);

// 4) 重新推荐 → 全链重置
await mini.evaluate(() => getCurrentPages().slice(-1)[0].onReshuffle());
await sleep(4000);
const s4 = await snap();
chk('重新推荐：游标0 结束态清除 窗口4张', s4.cCursor === 0 && !s4.end && s4.win.split(',').length === 4, JSON.stringify(s4));
chk('重置后组件重建(骨架屏)状态归零且 unlocked', s4.rt <= 2 && !s4.locked, 'rt=' + s4.rt);

// 5) 抽屉开→锁→关→再滑
await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.onCardTap({ detail: { item: p.data.feedQueue[p.data.cursorIdx] } }); });
await sleep(700);
const s5a = await mini.evaluate(() => ({ lock: getCurrentPages().slice(-1)[0].data.stackLocked, sheet: getCurrentPages().slice(-1)[0].data.sheetShow }));
chk('抽屉开→卡栈锁', s5a.lock && s5a.sheet, JSON.stringify(s5a));
await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#sheet').onMaskTap());
await sleep(800);
const c5 = await snap(); const before5 = c5.cCursor;
await adv(); await sleep(700);
const s5b = await snap();
chk('关抽屉后滑动恢复', s5b.cCursor === before5 + 1, `${before5}→${s5b.cCursor}`);

// 6) 保存移除后游标一致性（模拟 onWant 的 splice 路径）
const s6pre = await snap();
await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const q = p.data.feedQueue.slice();
  q.splice(p.data.cursorIdx, 1);
  p.setData({ feedQueue: q });
  p.syncVisible();
});
await sleep(600);
const s6 = await snap();
chk('保存移除：页面/组件游标一致', s6.cursor === s6.cCursor, `page=${s6.cursor} comp=${s6.cCursor} qlen=${s6.qlen}`);
await adv(); await sleep(700);
const s6b = await snap();
chk('移除后仍可继续滑动', s6b.cCursor === s6.cCursor + 1, `${s6.cCursor}→${s6b.cCursor}`);

console.log(fails === 0 ? 'E2E ALL PASS' : `E2E ${fails} FAIL`);
await mini.disconnect();
process.exit(fails ? 1 : 0);
