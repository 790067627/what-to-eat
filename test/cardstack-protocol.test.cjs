/* card-stack 组件提交协议单测：mock Component 运行时，验证 JS 侧状态机
 * 覆盖：连续提交+释放、settling 防重入、队尾拒绝+depleted、重置恢复、保存移除重建 */
const fs = require('fs');
const src = fs.readFileSync('../miniprogram/components/card-stack/index.js', 'utf8');

// mock Component 运行时
function createComp(props) {
  let def;
  const Component = d => { def = d; };
  new Function('Component', src)(Component);
  const inst = {
    data: JSON.parse(JSON.stringify(def.data)),
    _cursor: 0, _win: [], _moved: 0, _lastReset: props.resetToken || 0,
    _timers: [], _events: [],
    setData(patch) {
      for (const k in patch) {
        if (k.includes('.')) {
          const [a, b] = k.split('.');
          this.data[a] = this.data[a] || {};
          this.data[a][b] = patch[k];
        } else this.data[k] = patch[k];
      }
    },
    triggerEvent(name, detail) { this._events.push([name, detail]); },
    selectComponent() { return null; },
    setTimeout: null
  };
  // setTimeout 用可手动触发的假时钟
  let clockId = 0;
  const clock = {};
  inst.setTimeout = null;
  const realSetTimeout = (fn, ms) => { const id = ++clockId; clock[id] = fn; return id; };
  const runTimers = () => { const ids = Object.keys(clock); ids.forEach(id => { const fn = clock[id]; delete clock[id]; fn(); }); };
  // 注入方法（绑定 this，替换 setTimeout/clearTimeout）
  for (const k in def.methods) {
    inst[k] = def.methods[k].bind(inst);
  }
  Object.defineProperty(inst, '_clock', { value: { run: runTimers, set: realSetTimeout } });
  // 用假时钟替换全局 setTimeout（组件代码通过闭包引用全局）
  return { inst, def, runTimers, clock };
}

// 组件源码里的 setTimeout 是全局的，用 stub 拦截
const origSetTimeout = global.setTimeout;
const origClearTimeout = global.clearTimeout;
let fakeClock, fakeId;
global.setTimeout = (fn, ms) => { const id = ++fakeId; fakeClock[id] = fn; return id; };
global.clearTimeout = (id) => { delete fakeClock[id]; };
function resetClock() { fakeClock = {}; fakeId = 0; }
function runClock() { const ids = Object.keys(fakeClock); ids.forEach(id => { const fn = fakeClock[id]; delete fakeClock[id]; fn(); }); }

let pass = 0, fail = 0;
const t = (name, fn) => { resetClock(); try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, e.message); } };

const mkQueue = n => Array.from({ length: n }, (_, i) => ({
  type: 'own', id: 'd' + i, name: '菜' + i, rating: 4, tags: [], reason: 'r' + i
}));

function setup(n, resetToken = 1) {
  const { inst, def } = createComp({ resetToken });
  inst.data.queue = mkQueue(n);
  inst.data.resetToken = resetToken;
  // 模拟 properties observer 首次触发
  def.observers['queue, resetToken'].call(inst, inst.data.queue, resetToken);
  return { inst, def, observer: def.observers['queue, resetToken'].bind(inst) };
}

t('初始窗口 4 张，内容进 cardsMap', () => {
  const { inst } = setup(6);
  if (inst._win.length !== 4) throw new Error('窗口应 4 张: ' + inst._win.length);
  if (Object.keys(inst.data.cardsMap).length !== 6) throw new Error('map 应 6 条');
  if (inst.data.renderList.length !== 4) throw new Error('renderList 应 4');
});

t('提交→settling 锁→450ms 后释放：releaseToken/clearToken 各 +1，advance 事件带游标', () => {
  const { inst } = setup(6);
  const rt0 = inst.data.releaseToken, ct0 = inst.data.clearToken;
  inst.commitSwipe({ dir: -1 });
  if (!inst.data.locked) throw new Error('提交后应 locked');
  runClock();
  if (inst.data.locked) throw new Error('收尾后应解锁');
  if (inst.data.releaseToken !== rt0 + 1) throw new Error('releaseToken 未递增');
  if (inst.data.clearToken !== ct0 + 1) throw new Error('clearToken 未递增');
  const adv = inst._events.find(e => e[0] === 'advance');
  if (!adv || adv[1].cursor !== 1) throw new Error('advance 游标错误: ' + JSON.stringify(inst._events));
  if (inst.data.renderList.some(r => r.exiting)) throw new Error('收尾后不应残留出场卡');
});

t('连续 20 次提交（每次收尾释放）：游标 0→20，无死锁', () => {
  const { inst } = setup(30);
  for (let i = 0; i < 20; i++) {
    if (inst.data.locked) throw new Error(`第 ${i + 1} 次提交前仍 locked（死锁）`);
    inst.commitSwipe({ dir: -1 });
    if (!inst.data.locked) throw new Error(`第 ${i + 1} 次提交未上锁`);
    runClock();
  }
  if (inst._cursor !== 20) throw new Error('游标应 20: ' + inst._cursor);
  if (inst._win.length !== 4) throw new Error('窗口应保持 4 张');
  if (inst._win[0].key !== 'own:d20') throw new Error('队首应是 d20: ' + inst._win[0].key);
});

t('settling 期重复提交被拒：WXS 释放但 locked 保持（收尾 timer 才解锁）+ 不双跳', () => {
  const { inst } = setup(6);
  inst.commitSwipe({ dir: -1 });
  const rt = inst.data.releaseToken;
  inst.commitSwipe({ dir: -1 });   // settling 期再提交（按钮路径）
  if (inst.data.releaseToken !== rt + 1) throw new Error('拒绝必须递增 releaseToken（释放 WXS）');
  if (!inst.data.locked) throw new Error('locked 必须保持 true（否则第三次提交穿透）');
  inst.commitSwipe({ dir: -1 });   // 第三次也被拒
  runClock();                       // 第一次提交的收尾
  if (inst._cursor !== 1) throw new Error('只应推进 1: ' + inst._cursor);
  if (inst.data.locked) throw new Error('收尾后应解锁');
});

t('队尾最后一张拒绝提交：depleted 事件 + 窗口保留', () => {
  const { inst } = setup(4);          // 4 张全在窗口
  inst.commitSwipe({ dir: -1 }); runClock();   // → cursor 1，窗口 [d1,d2,d3]
  inst.commitSwipe({ dir: -1 }); runClock();   // → cursor 2，窗口 [d2,d3]
  inst.commitSwipe({ dir: -1 }); runClock();   // → cursor 3，窗口 [d3] 最后一张
  const before = inst.data.renderList.length;
  inst._events.length = 0;
  inst.commitSwipe({ dir: -1 });      // 再滑 → 拒绝
  const dep = inst._events.find(e => e[0] === 'depleted');
  if (!dep) throw new Error('应发 depleted');
  if (inst._cursor !== 3) throw new Error('游标不应推进');
  if (inst.data.renderList.length !== before) throw new Error('窗口不应变化');
  if (inst.data.locked) throw new Error('拒绝后不得锁死');
});

t('重置（resetToken 变化）：游标归零 + releaseToken 递增 + 锁清空', () => {
  const { inst, observer } = setup(6);
  inst.commitSwipe({ dir: -1 });      // settling 中
  const rt = inst.data.releaseToken;
  observer(mkQueue(8), 2);            // 页面重置 feed
  if (inst._cursor !== 0) throw new Error('游标应归零');
  if (inst.data.releaseToken !== rt + 1) throw new Error('重置必须递增 releaseToken');
  if (inst.data.locked) throw new Error('重置必须解锁');
  if (inst._win.length !== 4) throw new Error('窗口应重建 4 张');
});

t('保存移除（queue splice，同 resetToken）：窗口重建无出场残留、不双跳游标', () => {
  const { inst, observer } = setup(6);
  const q = inst.data.queue;
  q.splice(1, 1);                     // 移除第二张（模拟保存当前卡后页面 splice）
  observer(q, 1);                     // 非重置
  if (inst.data.renderList.some(r => r.exiting)) throw new Error('不应有出场残留');
  if (inst._win.length !== 4) throw new Error('窗口应重建满 4: ' + inst._win.length);
  if (inst._win[1].key !== 'own:d2') throw new Error('d1 应被移除: ' + inst._win.map(w => w.key));
});

t('settling 中页面 splice 队列：收尾游标自愈（按队首 key 重算，不错位）', () => {
  const { inst, observer } = setup(6);
  inst.commitSwipe({ dir: -1 });      // settling：出场 d0，窗口 [d1..d4]，_exitTimer 挂着
  inst.data.queue.splice(0, 1);       // 页面保存移除 d0（出场卡）
  observer(inst.data.queue, 1);       // 窗口成员一致 → 不重建，定时器保留
  runClock();                          // 收尾：游标应按 d1 在新队列的索引重算 = 0
  if (inst._cursor !== 0) throw new Error('游标应自愈为 0: ' + inst._cursor);
  if (inst.data.locked) throw new Error('不应锁死');
  const adv = inst._events.filter(e => e[0] === 'advance').pop();
  if (!adv || adv[1].cursor !== 0) throw new Error('advance 游标应 0: ' + JSON.stringify(adv));
  if (inst._win[0].key !== 'own:d1') throw new Error('队首应 d1');
});

t('仅 1 张卡：直接拒绝提交（depleted），页面可操作', () => {
  const { inst } = setup(1);
  if (inst._win.length !== 1) throw new Error('窗口应 1 张');
  inst.commitSwipe({ dir: -1 });
  if (!inst._events.some(e => e[0] === 'depleted')) throw new Error('应发 depleted');
  if (inst.data.locked) throw new Error('不得锁死');
});

t('空队列：拒绝提交不崩溃', () => {
  const { inst } = setup(0);
  inst.commitSwipe({ dir: -1 });
  if (inst.data.locked) throw new Error('不得锁死');
});

t('advanceByButton 与手势同通道：同样上锁/释放/事件', () => {
  const { inst } = setup(6);
  inst.advanceByButton();
  if (!inst.data.locked) throw new Error('按钮换卡应上锁');
  runClock();
  if (!inst._events.some(e => e[0] === 'advance')) throw new Error('应发 advance');
});

global.setTimeout = origSetTimeout;
global.clearTimeout = origClearTimeout;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
