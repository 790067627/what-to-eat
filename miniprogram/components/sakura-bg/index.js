// components/sakura-bg/index.js - 樱花背景组件
// 背景图存云存储（代码不存图）。免费环境存储不可设公开读，且临时链接会过期，
// 故由云函数（管理员身份）下载图片返回 base64，组件写入手机本地用户目录持久缓存，
// 之后直接读本地文件，永不过期；仅在本地缺失/损坏时才回源一次。
const api = require('../../services/db');
const fs = wx.getFileSystemManager();

const LOCAL_PATH = `${wx.env.USER_DATA_PATH}/sakura-bg.jpg`;
const FLAG_KEY = 'sakura_bg_saved'; // 本地已保存标记

Component({
  data: { url: '' },

  lifetimes: {
    attached() {
      this.load();
    }
  },

  methods: {
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

    /** 本地文件损坏/读取失败：清标记重取一次，仍失败则纯色底 */
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
      // 静默降级纯色底，不打扰用户
      console.warn('背景图不可用，使用纯色底');
    }
  }
});
