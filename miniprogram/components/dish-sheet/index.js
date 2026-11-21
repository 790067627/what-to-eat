// components/dish-sheet/index.js — 底部详情抽屉（方案 A 视觉冻结项）
// 打开：遮罩淡入 + 抽屉上滑（cubic-bezier(.32,1.25,.42,1) 过冲回弹）；关闭：回落 + 遮罩淡出。
// 数据由页面传入（公开菜 / 私有菜通用结构），点赞/想吃动作事件上抛，页面统一走服务端。
Component({
  options: { pureDataPattern: /^_/ },

  properties: {
    item: { type: Object, value: null },   // { name, coverImageUrl, author, reason, tags, likeCount, liked, saved, type, rating, status }
    show: { type: Boolean, value: false }
  },

  data: {
    visible: false,   // 控制渲染
    entered: false    // 控制入场动画 class
  },

  observers: {
    'show': function (show) {
      if (show) {
        this.setData({ visible: true });
        // 双帧触发过渡（先渲染再位移，否则无动画）
        setTimeout(() => this.setData({ entered: true }), 20);
      } else if (this.data.visible) {
        this.setData({ entered: false });
        this._timer = setTimeout(() => this.setData({ visible: false }), 320);
      }
    }
  },

  methods: {
    close() {
      this.triggerEvent('close');
    },
    noop() { /* 阻断抽屉内点击冒泡到遮罩 */ },
    onLike() {
      this.triggerEvent('like');
    },
    onWant() {
      this.triggerEvent('want');
    },
    onPreviewImage() {
      const it = this.data.item;
      const url = it && (it.coverImageUrl || it.coverFileID);
      if (url) wx.previewImage({ urls: [url] });
    }
  },

  detached() {
    if (this._timer) clearTimeout(this._timer);
  }
});
