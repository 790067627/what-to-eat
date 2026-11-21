// components/card-stack/index.js — 方案 A 卡栈（Swiper 同款渲染模型 + 显式动画状态机）
// 丝滑原则：
//  1) 节点恒定：key = type:id（不含游标），换卡只改 class/数据，不销毁重建（图片不重载）
//  2) 布局/数据分离：renderList 只存布局状态 {key,depth,exiting,exitDir}（~80B/卡），
//     卡片内容经 cardsMap[key] 引用——换卡 setData payload 降一个量级，仅队列更新时补 map
//  3) 时序统一 420ms（POC Swiper speed:420）：出场/补位 420ms，450ms 后清理出场卡并
//     递增 clearToken 触发 WXS 清空全部内联样式，class 完全接管（根治内联残留）
//  4) 状态机 idle→dragging→settling→idle：settling 期 data.locked=true 经 change: 镜像到
//     WXS（animLocked），动画期触摸不重新拖拽、不打断补间
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
    renderList: [],   // [出场卡?] + 窗口≤4张；仅布局态 {key, depth, exiting, exitDir}
    cardsMap: {},     // key → 卡片内容（含预计算 ratingText）；队列更新时增量补齐
    clearToken: 0,    // 递增触发 WXS clearAll 清内联样式
    locked: false     // settling 锁（镜像到 WXS animLocked）
  },

  observers: {
    'queue, resetToken': function (queue, resetToken) {
      const q = queue || [];
      if (resetToken !== this._lastReset) { this._lastReset = resetToken; this._cursor = 0; }
      const cursor = this._cursor || 0;
      this._syncMap(q);                       // 内容 map 增量补齐（先于窗口比对）
      const win = this._winKeys(q, cursor);
      const cur = (this.data.renderList || []).filter(r => !r.exiting).map(r => r.key);
      // 窗口成员未变（如队列尾部追加）→ 不动节点；变了才重建（重置/回环/保存移除）
      if (win.join(',') !== cur.join(',')) this._rebuild(q, cursor);
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
    _key(d) { return `${d.type || 'own'}:${d.id}`; },
    _winKeys(q, cursor) { return q.slice(cursor, cursor + 4).map(d => this._key(d)); },

    /** cardsMap 增量补齐：新 key 写入；已有 key 仅当展示签名变化时刷新（点赞/想吃回写） */
    _syncMap(q) {
      const map = this.data.cardsMap;
      const patch = {};
      const sig = d => `${d.liked ? 1 : 0}|${d.likeCount || 0}|${d.savedDishId || ''}|${d.reason || ''}|${d.rating || 0}|${d.name}`;
      for (const d of q) {
        const k = this._key(d);
        const entry = Object.assign({}, d, { ratingText: (Number(d.rating) || 0).toFixed(1) });
        if (!map[k]) {
          patch[`cardsMap.${k}`] = entry;
        } else if (map[k]._sig !== sig(d)) {
          entry._sig = sig(d);
          patch[`cardsMap.${k}`] = entry;
        } else {
          continue;   // 未变化：不重发（图片节点零扰动）
        }
        entry._sig = sig(d);
      }
      if (Object.keys(patch).length) this.setData(patch);
    },

    _rebuild(q, cursor) {
      this._cursor = cursor;
      this._win = q.slice(cursor, cursor + 4).map((d, i) => ({
        key: this._key(d), depth: i, exiting: false, exitDir: ''
      }));
      this.setData({ renderList: this._win.slice(), locked: false });
    },

    /** WXS 拖拽位移回传（tap 误触判定） */
    dragMoved(e) {
      this._moved = (e && e.moved) || 0;
    },

    /** WXS 提交换卡（手势路径：视图层已同帧启动终值动画，这里对齐 class 与窗口数据，值一致零跳变） */
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
        this._win.push({ key: this._key(next), depth: 3, exiting: false, exitDir: '' });
      }

      // locked=true 经 change:anim-locked 镜像到 WXS → settling 期触摸短路
      this.setData({ renderList: [exiting].concat(this._win), locked: true });

      // 450ms（>420ms 动画）后：移除出场卡 + 解锁 + clearToken 清内联样式
      this._exitTimer = setTimeout(() => {
        this._cursor += 1;
        this.setData({
          renderList: this._win.slice(),
          locked: false,
          clearToken: this.data.clearToken + 1
        });
        this.triggerEvent('advance', { cursor: this._cursor });
      }, 450);
    },

    /** 回弹路径：WXS 已同帧启动回弹补间，450ms 后清内联样式交还 class */
    scheduleClear() {
      if (this._clearTimer) clearTimeout(this._clearTimer);
      this._clearTimer = setTimeout(() => {
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
