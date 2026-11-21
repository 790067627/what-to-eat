// components/card-stack/index.js — 方案 A 卡栈（Swiper 同款渲染模型）
// 丝滑三原则（对照 POC/Swiper 源码）：
//  1) 节点恒定：key = type:id（不含游标），换卡只改 class/数据，不销毁重建（图片不重载、过渡不重置）
//  2) 视觉差异全部 CSS class 驱动 + transition（depth 切换 = 补位动画），不用 wx:if 切节点
//  3) 提交换卡 = 单次 setData（出场标记 + 窗口前移 + 新卡入栈），无多跳往返
Component({
  options: { pureDataPattern: /^_/ },

  properties: {
    queue: { type: Array, value: [] },        // 全量已加载队列（组件自管窗口游标）
    loading: { type: Boolean, value: false },
    resetToken: { type: Number, value: 0 },   // 页面重置 feed 时自增，组件回游标 0 重建
    // 交互锁：抽屉打开时页面置 true，手势全部短路（经 change: 同步到 WXS 模块态）
    interactionLocked: { type: Boolean, value: false }
  },

  data: {
    renderList: [],   // [出场卡?] + 窗口4张；{key, depth, exiting, exitDir, data}
    locked: false
  },

  observers: {
    'queue, resetToken': function (queue, resetToken) {
      const q = queue || [];
      if (resetToken !== this._lastReset) { this._lastReset = resetToken; this._cursor = 0; }
      const cursor = this._cursor || 0;
      const win = this._winKeys(q, cursor);
      const cur = (this.data.renderList || []).filter(r => !r.exiting).map(r => r.key);
      // 窗口成员未变（如队列尾部追加）→ 不动节点；变了才重建（重置/回环）
      if (win.join(',') !== cur.join(',')) this._rebuild(q, cursor);
    }
  },

  lifetimes: {
    attached() {
      // 注意：properties observer 在 attached 之前已可能触发并 _rebuild（填充 _win/_cursor），
      // 这里只能兜底初始化，绝不能重置，否则会清空已构建的窗口导致 commitSwipe 失效
      if (this._cursor === undefined) this._cursor = 0;
      if (this._moved === undefined) this._moved = 0;
      if (!this._win) this._win = [];
    }
  },

  methods: {
    _key(d) { return `${d.type || 'own'}:${d.id}`; },
    _winKeys(q, cursor) { return q.slice(cursor, cursor + 4).map(d => this._key(d)); },

    _rebuild(q, cursor) {
      this._cursor = cursor;
      this._win = q.slice(cursor, cursor + 4).map((d, i) => ({
        key: this._key(d), depth: i, exiting: false, exitDir: '', data: d
      }));
      this.setData({ renderList: this._win.slice(), locked: false });
    },

    /** WXS 拖拽位移回传（tap 误触判定） */
    dragMoved(e) {
      this._moved = (e && e.moved) || 0;
    },

    /** WXS 提交换卡：单次 setData 完成「出场 + 窗口前移 + 新卡入栈」 */
    commitSwipe(e) {
      if (this.data.locked || !this._win || !this._win.length) return;
      const dir = (e && e.dir) || -1;
      const q = this.data.queue || [];

      const exiting = this._win[0];
      exiting.exiting = true;
      exiting.exitDir = dir < 0 ? 'left' : 'right';
      exiting.depth = -1;                       // 出场卡置顶飞离（POC prev 保持清晰）

      // 窗口前移：depth 1→0、2→1、3→2（class 过渡 = 补位动画），队尾补新卡
      this._win = this._win.slice(1).map((d, i) => { d.depth = i; d.exiting = false; return d; });
      const next = q[this._cursor + 4];
      if (next) {
        this._win.push({ key: this._key(next), depth: 3, exiting: false, exitDir: '', data: next });
      }

      this.setData({ renderList: [exiting].concat(this._win), locked: true });

      this._exitTimer = setTimeout(() => {
        this._cursor += 1;
        this.setData({ renderList: this._win.slice(), locked: false });
        this.triggerEvent('advance', { cursor: this._cursor });
      }, 420);
    },

    /** 编程式换卡（底部「换一道」按钮，与手势同通道） */
    advanceByButton() {
      this.commitSwipe({ dir: -1 });
    },

    /** 卡片点按（WXS touchend 判定后 callMethod） */
    onCardTap() {
      if (this.data.interactionLocked) return;
      if (this._moved > 10) { this._moved = 0; return; }
      if (this.data.locked) return;
      const front = this._win[0];
      if (front) this.triggerEvent('cardtap', { item: front.data });
    },

    /** 长按 = 不感兴趣 */
    onCardLongPress() {
      if (this.data.interactionLocked) return;
      const front = this._win[0];
      if (front) this.triggerEvent('notinterest', { item: front.data });
    }
  },

  detached() {
    if (this._exitTimer) clearTimeout(this._exitTimer);
  }
});
