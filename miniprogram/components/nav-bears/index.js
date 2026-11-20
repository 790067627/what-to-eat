// components/nav-bears/index.js - 蜂蜜主题导航角色装饰（7 层纸片人动画）
// 素材存云存储（代码不存图），经云函数 base64 → 本地用户目录持久缓存（同 kitty 链路）；
// 主题资源层门控：theme-assets decoration.bears.show=false 时不渲染、不加载、零开销。
// 动画为纯 CSS transform（GPU 合成层），页面隐藏时暂停（pageLifetimes），回前台恢复。
// 层叠序：body → head → rig-arm(arm+pan 同组绕肩转)，与 POC 验证参数一致。
const api = require('../../services/db');
const themeManager = require('../../theme/theme-manager');
const { getNavMetrics } = require('../../utils/util');
const fs = wx.getFileSystemManager();

// 7 层：[cloudKey, 短名, 本地文件名]（短名供 wxml 绑定 urls.b1 等）
const LAYERS = [
  ['bears/brown_01_body', 'b1', 'b1.png'],
  ['bears/brown_02_head_hat', 'b2', 'b2.png'],
  ['bears/brown_03_arm_panhandle', 'b3', 'b3.png'],
  ['bears/brown_04_pan_splash', 'b4', 'b4.png'],
  ['bears/white_01_body', 'w1', 'w1.png'],
  ['bears/white_02_head', 'w2', 'w2.png'],
  ['bears/white_03_spoon_arm', 'w3', 'w3.png']
];
const FLAG_KEY = 'nav_bears_saved_v1';
const localPath = file => `${wx.env.USER_DATA_PATH}/bears-${file}`;

const snap0 = themeManager.get();

Component({
  data: {
    enabled: false,
    paused: false,
    navH: 104,
    themeVars: snap0.varsString,
    urls: {}   // { b1, b2, ..., w3 } → 本地路径
  },

  lifetimes: {
    attached() {
      this._unsub = themeManager.subscribe(() => this.syncTheme());
      this.syncTheme();
    },
    detached() {
      if (this._unsub) { this._unsub(); this._unsub = null; }
    }
  },

  pageLifetimes: {
    show() { this.setData({ paused: false }); },
    hide() { this.setData({ paused: true }); }
  },

  methods: {
    syncTheme() {
      const assets = themeManager.getAssets();
      const enabled = !!(assets.decoration && assets.decoration.bears && assets.decoration.bears.show);
      this.setData({
        enabled,
        navH: getNavMetrics().headerHeight,
        themeVars: themeManager.get().varsString
      });
      if (enabled) this.load();
      // 关闭时保留本地缓存（切回蜂蜜主题零网络恢复），仅停止渲染
    },

    load() {
      if (this.data.urls.b1) return; // 本会话已加载
      // 1) 本地缓存优先：7 个文件齐全才用，缺任一回源
      try {
        if (wx.getStorageSync(FLAG_KEY)) {
          const urls = {};
          LAYERS.forEach(([key, short, file]) => {
            const p = localPath(file);
            fs.accessSync(p);
            urls[short] = p;
          });
          this.setData({ urls });
          return;
        }
      } catch (e) { /* 无缓存/缺文件，回源 */ }

      // 2) 回源：7 路并行 base64 → 写本地 → 上屏（加载期间切走主题则不上屏）
      Promise.all(LAYERS.map(([key, short, file]) =>
        api.getBgUrl(key).then(res => {
          if (!res.base64) throw new Error('empty');
          return new Promise((resolve, reject) => {
            fs.writeFile({
              filePath: localPath(file), data: res.base64, encoding: 'base64',
              success: () => resolve([short, localPath(file)]), fail: reject
            });
          });
        })
      )).then(pairs => {
        try { wx.setStorageSync(FLAG_KEY, 1); } catch (e) { /* 忽略 */ }
        const urls = {};
        pairs.forEach(([short, p]) => { urls[short] = p; });
        const deco = themeManager.getAssets().decoration;
        if (deco.bears && deco.bears.show) this.setData({ urls });
      }).catch(() => {
        // 静默降级：不渲染角色层，导航 banner 照常
        console.warn('[nav-bears] 素材不可用，跳过角色装饰');
      });
    },

    /** 单层加载失败：清标记整体回源一次 */
    onImgError() {
      if (this._retrying) return;
      this._retrying = true;
      try { wx.removeStorageSync(FLAG_KEY); } catch (e) { /* 忽略 */ }
      this.setData({ urls: {} }, () => { this._retrying = false; this.load(); });
    }
  }
});
