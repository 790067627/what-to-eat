// components/sakura-bg/index.js - 首页 Hello Kitty 装饰图组件
// 装饰图存云存储（代码不存图）。免费环境存储不可设公开读，且临时链接会过期，
// 故由云函数（管理员身份）下载图片返回 base64，组件写入手机本地用户目录持久缓存，
// 之后直接读本地文件，永不过期；仅在本地缺失/损坏时才回源一次。
// 加载失败时静默降级：不渲染装饰图，页面正常显示（#FFF7FA 底色）。
const api = require('../../services/db');
const fs = wx.getFileSystemManager();

const LOCAL_PATH = `${wx.env.USER_DATA_PATH}/kitty-deco.webp`;
const FLAG_KEY = 'kitty_deco_saved'; // 本地已保存标记
const OLD_LOCAL_PATH = `${wx.env.USER_DATA_PATH}/sakura-bg.jpg`; // 旧整图背景缓存（清理用）
const OLD_FLAG_KEY = 'sakura_bg_saved';

Component({
  data: { url: '', paused: false, bouncing: false },

  lifetimes: {
    attached() {
      this.cleanupOld();
      this.load();
    },
    detached() {
      clearTimeout(this._bounceTimer);
    }
  },

  /** 页面显隐联动：切走暂停动画，回来恢复（省资源也符合系统动效习惯）。
   *  注：小程序暂无「系统减少动态效果」设置项 API，能力缺失时默认常开 */
  pageLifetimes: {
    show() { this.setData({ paused: false }); },
    hide() { this.setData({ paused: true }); }
  },

  methods: {
    /** 页面级 tap 命中检测：坐标落在 Kitty 矩形内则触发一次弹跳（组件自身 pointer-events:none 不可点） */
    tryTapBounce(clientX, clientY) {
      if (this.data.bouncing || this.data.paused || !this.data.url) return;
      this.createSelectorQuery().select('.kitty-wrap').boundingClientRect(rect => {
        if (!rect) return;
        if (clientX >= rect.left && clientX <= rect.right &&
            clientY >= rect.top && clientY <= rect.bottom) {
          this.setData({ bouncing: true });
          // 动画 400ms，稍放宽后摘除 class 以便可重复触发
          clearTimeout(this._bounceTimer);
          this._bounceTimer = setTimeout(() => this.setData({ bouncing: false }), 450);
        }
      }).exec();
    },

    /** 清理旧版整张背景图的本地缓存，释放用户目录空间 */
    cleanupOld() {
      try {
        wx.removeStorageSync(OLD_FLAG_KEY);
        fs.unlink({ filePath: OLD_LOCAL_PATH, fail: () => {} });
      } catch (e) { /* 忽略 */ }
    },

    load() {
      // 1) 本地已有缓存：直接用，零网络
      try {
        if (wx.getStorageSync(FLAG_KEY)) {
          fs.accessSync(LOCAL_PATH);
          this.setData({ url: LOCAL_PATH });
          return;
        }
      } catch (e) { /* 本地无缓存或文件损坏，回源 */ }

      // 2) 回源：云函数下载 base64 → 写本地 → 展示
      api.getBgUrl().then(res => {
        if (!res.base64) throw new Error('empty base64');
        fs.writeFile({
          filePath: LOCAL_PATH,
          data: res.base64,
          encoding: 'base64',
          success: () => {
            try { wx.setStorageSync(FLAG_KEY, 1); } catch (e) { /* 忽略 */ }
            this.setData({ url: LOCAL_PATH });
          },
          fail: () => this.fallback()
        });
      }).catch(() => this.fallback());
    },

    /** 本地文件损坏/读取失败：清标记重取一次，仍失败则不渲染 */
    onBgError() {
      try {
        wx.removeStorageSync(FLAG_KEY);
        fs.unlink({ filePath: LOCAL_PATH, fail: () => {} });
      } catch (e) { /* 忽略 */ }
      if (!this._retrying) {
        this._retrying = true;
        this.load();
      }
    },

    fallback() {
      // 静默降级：不显示装饰图，页面照常使用
      console.warn('装饰图不可用，首页保持纯色背景');
    }
  }
});
