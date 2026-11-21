// components/dish-sheet/index.js — 底部详情抽屉（方案 A 视觉冻结：上滑/渐暗/回弹保持）
// 结构：遮罩 / 独立 scroll-view 内容 / 固定操作层。关闭=遮罩点击+拖拽条下拉。
// 手势隔离：抽屉打开时页面置 card-stack interactionLocked，背景卡栈 WXS 与原生手势全短路；
// 抽屉自身所有触摸节点 catch，杜绝穿透。
Component({
  options: { pureDataPattern: /^_/ },

  properties: {
    item: { type: Object, value: null },
    show: { type: Boolean, value: false }
  },

  data: {
    visible: false,
    entered: false,
    sheetMaxH: 600,
    scrollTop: 0,
    dragDy: 0        // 拖拽条下拉位移（跟手）
  },

  observers: {
    'show': function (show) {
      if (show) {
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        // 最大高度 = 可用高度 78%（POC 同值），底部安全区由操作层 padding 让位
        this.setData({ visible: true, sheetMaxH: Math.round(win.windowHeight * 0.78), scrollTop: 0, dragDy: 0 });
        setTimeout(() => this.setData({ entered: true }), 20);
      } else if (this.data.visible) {
        this.setData({ entered: false, dragDy: 0 });
        this._timer = setTimeout(() => this.setData({ visible: false }), 320);
      }
    }
  },

  methods: {
    noop() { /* 拦截触摸/点击，防穿透背景 */ },
    close() { this.triggerEvent('close'); },
    onLike() { this.triggerEvent('like'); },
    onWant() { this.triggerEvent('want'); },
    onScroll(e) { this._scrollTop = e.detail.scrollTop; },
    onPreviewImage() {
      const it = this.data.item;
      const url = it && (it.coverImageUrl || it.coverFileID);
      if (url) wx.previewImage({ urls: [url] });
    },

    /* ---- 拖拽条下拉关闭（手势归属：touchstart 即锁定只驱动抽屉） ---- */
    onGripStart(e) {
      const t = e.touches[0];
      this._grip = { y0: t.clientY, dy: 0 };
    },
    onGripMove(e) {
      if (!this._grip) return;
      const t = e.touches[0];
      const dy = Math.max(0, t.clientY - this._grip.y0);
      this._grip.dy = dy;
      this.setData({ dragDy: dy });   // 跟手下移
    },
    onGripEnd() {
      if (!this._grip) return;
      const dy = this._grip.dy;
      this._grip = null;
      if (dy > 110) {                  // 阈值：完整退出动画
        this.setData({ dragDy: 0 });
        this.triggerEvent('close');
      } else {                         // 不足：回弹
        this.setData({ dragDy: 0 });
      }
    }
  },

  detached() {
    if (this._timer) clearTimeout(this._timer);
  }
});
