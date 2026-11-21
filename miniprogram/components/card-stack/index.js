// components/card-stack/index.js — 方案 A 卡栈（Swiper 渲染模型 + 提交协议状态机）
// 提交协议（与 gestures.wxs 配对）：
//  - WXS commit 后进入 settling，唯一恢复通道 = JS 递增 releaseToken（单调递增 → change: 必达）
//  - commitSwipe 的任何出口（接受/拒绝/耗尽/异常）都必须 _release()，杜绝 settling 死锁
//  - 拒绝路径同时 clearToken++ → WXS 清除出场内联样式，卡片 class 过渡弹回原位
// 队列边界：
//  - 队尾最后一张不允许再提交（无下一张可补位）→ 拒绝 + depleted 事件（页面显示结束态）
//  - 组件 reset（resetToken 变化）时清定时器、重建窗口、递增 releaseToken 恢复手势
Component({
  options: { pureDataPattern: /^_/ },

  properties: {
    queue: { type: Array, value: [] },        // 全量已加载队列（组件自管窗口游标）
    loading: { type: Boolean, value: false },
    resetToken: { type: Number, value: 0 },   // 页面重置 feed 时自增，组件回游标 0 重建
    // 交互锁：抽屉打开时页面置 true，手势全部短路（经 change: 同步到 WXS 模块态）
    interactionLocked: { type: Boolean, value: false },
    // 诊断日志开关（开发环境置 true：JS console + WXS console 全链路）
    debug: { type: Boolean, value: false }
  },

  data: {
    renderList: [],   // [出场卡?] + 窗口≤4张；仅布局态 {key, depth, exiting, exitDir}
    cardsMap: {},     // key → 卡片内容（含预计算 ratingText/_sig）；队列更新时增量补齐
    clearToken: 0,    // 递增触发 WXS clearAll 清内联样式（含 dragging 竞态守卫）
    releaseToken: 0,  // 递增触发 WXS syncRelease：settling→idle 的唯一恢复通道
    locked: false     // settling 锁（JS 侧防重入）
  },

  observers: {
    'queue, resetToken': function (queue, resetToken) {
      const q = queue || [];
      const isReset = resetToken !== this._lastReset;
      if (isReset) { this._lastReset = resetToken; this._cursor = 0; }
      const cursor = this._cursor || 0;
      this._syncMap(q);                       // 内容 map 增量补齐（先于窗口比对）
      const win = this._winKeys(q, cursor);
      const cur = (this.data.renderList || []).filter(r => !r.exiting).map(r => r.key);
      // 窗口成员未变（如队列尾部追加）→ 不动节点；变了才重建（重置/保存移除）
      if (win.join(',') !== cur.join(',')) this._rebuild(q, cursor, isReset);
    }
  },

  lifetimes: {
    attached() {
      // 注意：properties observer 先于 attached 触发并可能已 _rebuild，这里只兜底不重置
      if (this._cursor === undefined) this._cursor = 0;
      if (this._moved === undefined) this._moved = 0;
      if (!this._win) this._win = [];
    }
  },

  methods: {
    _log(...a) { if (this.data.debug) console.log('[cardstack-js]', ...a); },

    _key(d) { return `${d.type || 'own'}:${d.id}`; },
    _winKeys(q, cursor) { return q.slice(cursor, cursor + 4).map(d => this._key(d)); },

    /** 统一释放：settling 锁归位 + releaseToken 递增（WXS syncRelease 恢复 idle）。
     *  所有提交出口（成功/拒绝/耗尽）都必须经过这里。 */
    _release(extra) {
      const patch = Object.assign(
        { locked: false, releaseToken: this.data.releaseToken + 1 },
        extra || {}
      );
      this._log('_release → releaseToken', patch.releaseToken, 'cursor', this._cursor);
      this.setData(patch);
    },

    /** cardsMap 增量补齐：新 key 写入；已有 key 仅当展示签名变化时刷新（点赞/想吃回写） */
    _syncMap(q) {
      const map = this.data.cardsMap;
      const patch = {};
      const sig = d => `${d.liked ? 1 : 0}|${d.likeCount || 0}|${d.savedDishId || ''}|${d.reason || ''}|${d.rating || 0}|${d.name}`;
      for (const d of q) {
        const k = this._key(d);
        const entry = Object.assign({}, d, { ratingText: (Number(d.rating) || 0).toFixed(1), _sig: sig(d) });
        if (!map[k] || map[k]._sig !== sig(d)) {
          patch[`cardsMap.${k}`] = entry;
        }
        // 未变化：不重发（图片节点零扰动）
      }
      if (Object.keys(patch).length) this.setData(patch);
    },

    /** 重建窗口（重置/保存移除）。清定时器：settling 中动画作废，
     *  新窗口以 class 静态呈现（clearToken++ 清掉一切内联残留；reset 时 releaseToken++ 解锁手势） */
    _rebuild(q, cursor, isReset) {
      if (this._exitTimer) { clearTimeout(this._exitTimer); this._exitTimer = null; }
      if (this._clearTimer) { clearTimeout(this._clearTimer); this._clearTimer = null; }
      this._cursor = cursor;
      this._win = q.slice(cursor, cursor + 4).map((d, i) => ({
        key: this._key(d), depth: i, exiting: false, exitDir: ''
      }));
      const patch = {
        renderList: this._win.slice(),
        locked: false,
        clearToken: this.data.clearToken + 1
      };
      if (isReset) patch.releaseToken = this.data.releaseToken + 1;
      this.setData(patch);
    },

    /** WXS 拖拽位移回传（tap 误触判定） */
    dragMoved(e) {
      this._moved = (e && e.moved) || 0;
    },

    /** 提交换卡（手势与「换一道」/长按共用同一生命周期）。
     *  任何出口都 _release()：接受→450ms 收尾释放；拒绝→立即释放+清内联弹回。 */
    commitSwipe(e) {
      const dir = (e && e.dir) || -1;
      const q = this.data.queue || [];
      this._log('commitSwipe dir=', dir, 'locked=', this.data.locked, 'cursor=', this._cursor, 'win=', this._win && this._win.length, 'queue=', q.length);

      // ---- 拒绝路径 ----
      // settling 中（locked）：绝不动 locked（首次提交的收尾 timer 负责统一释放，
      // 提前置 false 会让第三次提交穿透 → 游标双跳）；只递增双 token 释放 WXS 并弹回卡片
      if (this.data.locked) {
        this._log('commitSwipe REJECT(locked) → release+clear token 递增');
        this.setData({
          releaseToken: this.data.releaseToken + 1,
          clearToken: this.data.clearToken + 1
        });
        return;
      }
      const reject = (reason) => {
        this._release({ clearToken: this.data.clearToken + 1 });
        if (reason === 'depleted') this.triggerEvent('depleted', { atEnd: true });
      };
      if (!this._win || !this._win.length) { this._log('commitSwipe REJECT(empty)'); return reject('empty'); }
      // 队尾边界：提交后无下一张可补位 → 拒绝并上报耗尽（页面显示结束态）
      if (this._cursor + 1 >= q.length) { this._log('commitSwipe REJECT(depleted) cursor=', this._cursor, 'queue=', q.length); return reject('depleted'); }

      const exiting = this._win[0];
      exiting.exiting = true;
      exiting.exitDir = dir < 0 ? 'left' : 'right';
      exiting.depth = -1;                       // 出场卡置顶飞离（POC prev 保持清晰）

      // 窗口前移：depth 1→0、2→1、3→2（class 过渡 = 补位动画），队尾补新卡
      this._win = this._win.slice(1).map((d, i) => { d.depth = i; d.exiting = false; return d; });
      const next = q[this._cursor + 4];
      if (next) {
        this._win.push({ key: this._key(next), depth: 3, exiting: false, exitDir: '' });
      }

      // ---- 接受路径：对齐 class/窗口数据（与 WXS 内联终值一致，零跳变） ----
      this.setData({ renderList: [exiting].concat(this._win), locked: true });

      // 450ms（>420ms 动画）后：移除出场卡 + 统一释放 + 通知页面推进游标。
      // 游标自愈：settling 期间页面可能 splice 队列（保存移除），盲加会错位——
      // 以队首 key 在当前队列中的实际索引重算（找不到才回退 +1）
      this._exitTimer = setTimeout(() => {
        this._exitTimer = null;
        const qq = this.data.queue || [];
        const frontKey = this._win[0] ? this._win[0].key : '';
        const idx = qq.findIndex(d => this._key(d) === frontKey);
        this._cursor = idx >= 0 ? idx : this._cursor + 1;
        this._release({
          renderList: this._win.slice(),
          clearToken: this.data.clearToken + 1
        });
        this.triggerEvent('advance', { cursor: this._cursor });
      }, 450);
    },

    /** 回弹路径：WXS 已同帧启动回弹补间，460ms 后清内联交还 class（dragging 守卫防竞态） */
    scheduleClear() {
      if (this._clearTimer) clearTimeout(this._clearTimer);
      this._clearTimer = setTimeout(() => {
        this._clearTimer = null;
        this.setData({ clearToken: this.data.clearToken + 1 });
      }, 460);
    },

    /** 编程式换卡（「换一道」/长按不感兴趣共用；无内联残留，纯 class 动画通道） */
    advanceByButton() {
      this.commitSwipe({ dir: -1 });
    },

    /** 卡片点按（WXS touchend 判定后 callMethod） */
    onCardTap() {
      if (this.data.interactionLocked) return;
      if (this._moved > 10) { this._moved = 0; return; }
      if (this.data.locked) return;
      const front = this._win[0];
      if (front) this.triggerEvent('cardtap', { item: this.data.cardsMap[front.key] });
    },

    /** 长按 = 不感兴趣 */
    onCardLongPress() {
      if (this.data.interactionLocked) return;
      const front = this._win[0];
      if (front) this.triggerEvent('notinterest', { item: this.data.cardsMap[front.key] });
    }
  },

  detached() {
    if (this._exitTimer) clearTimeout(this._exitTimer);
    if (this._clearTimer) clearTimeout(this._clearTimer);
  }
});
