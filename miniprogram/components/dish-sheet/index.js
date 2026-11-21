// components/dish-sheet/index.js — 底部详情抽屉（方案 A 视觉冻结：动画曲线不变）
// 关闭通道：①遮罩点击 ②顶部 56px 拖拽热区下拉（WXS 实时跟手 + JS 松手决策）
// 拖动中实时位移由 WXS setStyle 驱动（零延迟）；松手后 JS 重写 style 属性接管补间，
// 起点值 = 松手时位移，衔接连续无跳变。防重复关闭：_closing 守卫。
const OPEN_CURVE = 'cubic-bezier(.32,1.25,.42,1)';    // POC 原入场曲线（保持）
const CLOSE_CURVE = 'cubic-bezier(.4,0,1,1)';         // 退出：加速滑出
const SPRING_CURVE = 'cubic-bezier(.22,1.28,.36,1)';  // 回弹：过冲弹簧

Component({
  options: { pureDataPattern: /^_/ },

  properties: {
    item: { type: Object, value: null },
    show: { type: Boolean, value: false }
  },

  data: {
    visible: false,
    sheetMaxH: 600,
    scrollTop: 0,
    dragStyle: '',    // ds-drag 内联 transform+transition（JS 补间态）
    maskStyle: ''     // ds-mask 内联 opacity+transition
  },

  observers: {
    'show': function (show) {
      if (show) this._open();
      else if (this.data.visible) this._animateClose();
    }
  },

  lifetimes: {
    created() { this._closing = false; }
  },

  methods: {
    noop() { /* 拦截触摸/点击，防穿透背景 */ },

    _open() {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      // 竞态守卫：关闭动画进行中重新打开 → 取消旧卸载定时器，防止把新开的抽屉误卸载
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this._closing = false;
      this.setData({
        visible: true,
        sheetMaxH: Math.round(win.windowHeight * 0.78),
        scrollTop: 0,
        // 初始在屏外（无过渡），下一帧补间到 0 → 原入场动画
        dragStyle: 'transform: translateY(102%)',
        maskStyle: 'opacity: 0'
      });
      setTimeout(() => {
        if (!this.data.visible || this._closing) return;
        this.setData({
          dragStyle: `transform: translateY(0); transition: transform 420ms ${OPEN_CURVE}`,
          maskStyle: 'opacity: 1; transition: opacity 300ms linear'
        });
      }, 20);
    },

    /** 关闭动画（遮罩点击 / 拖拽关闭 / show=false 共用）：沿原轨迹滑出 + 遮罩同步渐隐 */
    _animateClose(fromDy) {
      if (this._closing) return;          // 快速连点守卫：只执行一次
      this._closing = true;
      const start = fromDy || 0;
      this.setData({
        // 从当前位移继续滑出屏底（fromDy=0 时即原轨迹反向）
        dragStyle: `transform: translateY(calc(102% + ${start}px)); transition: transform 300ms ${CLOSE_CURVE}`,
        maskStyle: 'opacity: 0; transition: opacity 300ms linear'
      });
      this._timer = setTimeout(() => {
        this.setData({ visible: false, dragStyle: '', maskStyle: '' });
        this._closing = false;
        this.triggerEvent('closed');
      }, 320);
    },

    /** 遮罩点击：立即触发关闭动画（抽屉内部 catchtap="noop" 不会冒泡到这里） */
    onMaskTap() {
      this._animateClose(0);
      this.triggerEvent('close');   // 页面同步 sheetShow=false + 延时解锁背景
    },

    /* ---- 顶部拖拽热区（WXS 实时跟手，这里只做松手决策） ---- */

    onGripDragStart() {
      this._closing = false;        // 拖动开始解除关闭锁（拖动中允许后续关闭）
    },

    /** WXS 松手判定关闭后的状态收尾：视觉补间已在 WXS 同帧启动，这里只管状态与卸载。
     *  _closing 先置位，阻断 show=false 触发的 _animateClose 重复动画。 */
    onDragClose() {
      if (this._closing) return;
      this._closing = true;
      this.triggerEvent('close');   // 页面置 sheetShow=false（observer 的 _animateClose 被守卫跳过）
      this._timer = setTimeout(() => {
        this.setData({ visible: false, dragStyle: '', maskStyle: '' });
        this._closing = false;
        this.triggerEvent('closed');
      }, 320);
    },

    /** 保留：JS 侧松手决策兜底（WXS 不可用环境） */
    onGripRelease(e) {
      const { dy = 0, vy = 0 } = e || {};
      const shouldClose = dy > 70 || (vy > 0.5 && dy > 20);
      if (shouldClose) {
        this._animateClose(dy);
        this.triggerEvent('close');
      } else {
        this.setData({
          dragStyle: `transform: translateY(0); transition: transform 350ms ${SPRING_CURVE}`,
          maskStyle: 'opacity: 1; transition: opacity 250ms linear'
        });
      }
    },

    onScroll(e) { this._scrollTop = e.detail.scrollTop; },

    onLike() { this.triggerEvent('like'); },
    onWant() { this.triggerEvent('want'); },
    onPreviewImage() {
      const it = this.data.item;
      const url = it && (it.coverImageUrl || it.coverFileID);
      if (url) wx.previewImage({ urls: [url] });
    },

    /** 兼容旧调用：close 语义 = 遮罩点击关闭 */
    close() { this.onMaskTap(); }
  },

  detached() {
    if (this._timer) clearTimeout(this._timer);
  }
});
