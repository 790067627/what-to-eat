// components/card-stack/index.js — 菜品灵感卡栈（方案 A · Swiper Cards 交互模型的原生实现）
// 手势层在 gestures.wxs（touchmove 直接 setStyle，不走 setData，保证跟手 60fps）；
// JS 层只负责：提交换卡（出场动画 + advance 事件）、回弹兜底、误触判定、锁定。
// 运动参数与方案 A POC 一致：阈值 96px / 速度 0.55 / 出场 400ms rotate 13° / 落位 spring(.22,1.28,.36,1)
Component({
  options: { pureDataPattern: /^_/ },

  properties: {
    items: { type: Array, value: [] },        // 卡片数据（从 activeIndex 起的可见队列，页面切片传入）
    activeIndex: { type: Number, value: 0 },  // 仅用于 key 稳定性
    loading: { type: Boolean, value: false },
    // 交互锁：抽屉打开时页面置 true，WXS 手势与原生手势全部短路（经 change: 同步到 WXS 模块态）
    interactionLocked: { type: Boolean, value: false }
  },

  data: {
    renderList: [],   // [{key, depth, exiting, exitDir, data}]
    locked: false
  },

  observers: {
    'items': function (items) {
      this._rebuild(items);
    }
  },

  lifetimes: {
    attached() {
      this._moved = 0;
      this._rebuild(this.data.items);
    }
  },

  methods: {
    _rebuild(items) {
      const list = (items || []).slice(0, 4).map((d, i) => ({
        key: `${d.type || 'own'}:${d.id}:${this.data.activeIndex + i}`,
        depth: i,
        exiting: false,
        exitDir: '',
        data: d
      }));
      this.setData({ renderList: list, locked: false });
    },

    /** WXS 层同步拖拽位移（仅越过阈值时调用一次，用于 tap 误触判定） */
    dragMoved(e) {
      this._moved = (e && e.moved) || 0;
    },

    /** WXS 判定提交换卡：dir=-1 左滑（下一张）/ 1 右滑（上一张，由页面决定是否支持） */
    commitSwipe(e) {
      if (this.data.locked || !this.data.renderList.length) return;
      const dir = (e && e.dir) || -1;
      this.setData({ locked: true });
      // 出场动画：class 切换触发 CSS transition（400ms，倾斜滑出）；
      // 补位卡同帧进入 promote 态：归位+去 veil+显示内容（对齐 Swiper commit 切换时机）
      const patch = { 'renderList[0].exiting': true, 'renderList[0].exitDir': dir < 0 ? 'left' : 'right' };
      if (this.data.renderList[1]) patch['renderList[1].promote'] = true;
      this.setData(patch);
      this._exitTimer = setTimeout(() => {
        this.triggerEvent('advance', { dir });
        // 页面更新 items 后 observers 重建；此处兜底解锁
        this.setData({ locked: false });
      }, 420);
    },

    /** 卡片点按（双通道：卡片 bindtap + WXS touchEnd callMethod，幂等）：
     *  非主卡点击忽略；拖拽 >10px 抑制；出场动画中忽略 */
    /** 卡片点按：由 WXS touchend 判定后 callMethod 触发（catchtouchend 会吞框架 tap 合成，
     *  故不依赖 bindtap）。拖拽 >10px 或出场动画中抑制。 */
    onCardTap() {
      if (this.data.interactionLocked) return;
      if (this._moved > 10) { this._moved = 0; return; }
      if (this.data.locked) return;
      const front = this.data.renderList[0];
      if (front) this.triggerEvent('cardtap', { item: front.data });
    },

    /** 长按 = 不感兴趣（负反馈 + 换下一张）；交互锁期间忽略 */
    onCardLongPress() {
      if (this.data.interactionLocked) return;
      const front = this.data.renderList[0];
      if (front) this.triggerEvent('notinterest', { item: front.data });
    },

    /** 编程式换卡（底部「换一道」按钮走这里，与手势同一动画通道） */
    advanceByButton() {
      this.commitSwipe({ dir: -1 });
    }
  },

  detached() {
    if (this._exitTimer) clearTimeout(this._exitTimer);
  }
});
