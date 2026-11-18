// components/immersive-nav/index.js - 四 Tab 页共用沉浸式插画导航栏
// 头图存云存储（代码不存图），复用 base64 + 本地持久缓存机制（与 kitty 装饰图同一套）
const api = require('../../services/db');
const { getNavMetrics } = require('../../utils/util');
const fs = wx.getFileSystemManager();

const LOCAL_PATH = `${wx.env.USER_DATA_PATH}/header-kitchen.jpg`;
const FLAG_KEY = 'header_kitchen_saved';

Component({
  data: {
    m: null,
    headerUrl: ''
  },

  lifetimes: {
    attached() {
      this.setData({ m: getNavMetrics() });
      this.load();
    }
  },

  methods: {
    load() {
      // 1) 本地缓存优先，零网络
      try {
        if (wx.getStorageSync(FLAG_KEY)) {
          fs.accessSync(LOCAL_PATH);
          this.setData({ headerUrl: LOCAL_PATH });
          return;
        }
      } catch (e) { /* 无缓存或损坏，回源 */ }

      // 2) 回源：云函数下载 base64 → 写本地 → 展示
      api.getBgUrl('header').then(res => {
        if (!res.base64) throw new Error('empty base64');
        fs.writeFile({
          filePath: LOCAL_PATH,
          data: res.base64,
          encoding: 'base64',
          success: () => {
            try { wx.setStorageSync(FLAG_KEY, 1); } catch (e) { /* 忽略 */ }
            this.setData({ headerUrl: LOCAL_PATH });
          },
          fail: () => this.setData({ headerUrl: '' })
        });
      }).catch(() => this.setData({ headerUrl: '' }));
    },

    /** 加载失败：静默降级渐变底，不影响页面 */
    onError() {
      try { wx.removeStorageSync(FLAG_KEY); } catch (e) { /* 忽略 */ }
      this.setData({ headerUrl: '' });
    }
  }
});
