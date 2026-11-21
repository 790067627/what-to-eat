import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
mini.on('exception', e => console.log('EXC:', (e.message||'').slice(0,200)));
mini.on('console', m => { if (m.type==='error') console.log('ERR:', JSON.stringify(m.args).slice(0,300)); });
await mini.reLaunch('/pages/index/index');
await sleep(5000);
const st = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const c = p.selectComponent('#cardStack');
  return {
    feedQueue: p.data.feedQueue.length,
    cursorIdx: p.data.cursorIdx,
    compFound: !!c,
    renderList: c ? c.data.renderList.length : -1,
    win: c && c._win ? c._win.length : -1,
    cursor: c ? c._cursor : null,
    locked: c ? c.data.locked : null,
    firstDepth: c && c.data.renderList[0] ? c.data.renderList[0].depth : null,
    firstKey: c && c.data.renderList[0] ? c.data.renderList[0].key : null
  };
});
console.log('state:', JSON.stringify(st, null, 1));
// 编程式换卡是否工作
await mini.evaluate(() => {
  const c = getCurrentPages().slice(-1)[0].selectComponent('#cardStack');
  c.advanceByButton();
});
await sleep(900);
const st2 = await mini.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const c = p.selectComponent('#cardStack');
  return { cursorIdx: p.data.cursorIdx, win: c._win ? c._win.length : -1, firstKey: c.data.renderList[0] && c.data.renderList[0].key, locked: c.data.locked };
});
console.log('after advance:', JSON.stringify(st2));
await mini.disconnect();
