// components/immersive-nav/index.js - 四 Tab 页共用顶部导航（主题资源层驱动）
// 布局模式来自 theme-assets：
//   illustrated（樱花）：云端厨房插画头图 + base64 本地持久缓存（免费环境存储不可公开读、临时链接会过期）
//   minimal（GitHub）：不加载图片，纯 Token 渐变底 + 页面底色渐隐，无插画带（高度由 getNavMetrics 统一让位）
// 注：本组件有自定义图片加载逻辑，不使用通用 themeBehavior，自行订阅主题变化（单一订阅，避免泄漏）。
const api = require('../../services/db');
const themeManager = require('../../theme/theme-manager');
const { getNavMetrics } = require('../../utils/util');
const fs = wx.getFileSystemManager();

// 本地缓存按 cloudKey 分文件（切回旧主题零网络恢复）；'header' 沿用旧路径，老用户缓存不失效
const OLD_LOCAL_PATH = `${wx.env.USER_DATA_PATH}/header-kitchen.jpg`;
const OLD_FLAG_KEY = 'header_kitchen_saved';
const LOCAL_PATH = key => key === 'header' ? OLD_LOCAL_PATH : `${wx.env.USER_DATA_PATH}/nav-${key}.jpg`;
const FLAG_KEY = key => key === 'header' ? OLD_FLAG_KEY : `nav_${key}_saved`;

const snap0 = themeManager.get();

Component({
  data: {
    themeVars: snap0.varsString,
    m: null,
    headerUrl: '',
    navMode: snap0.assets.nav.mode
  },

  lifetimes: {
    attached() {
      this.setData({ m: getNavMetrics() });
      this._unsub = themeManager.subscribe(s => this._onTheme(s));
      this._onTheme(themeManager.get());
    },
    detached() {
      if (this._unsub) { this._unsub(); this._unsub = null; }
    }
  },

  methods: {
    /** 主题变化：一次 setData 同步 CSS 变量 + 导航模式 + 让位高度；
     *  minimal 立即隐藏图片并收紧高度，illustrated 恢复插画 */
    _onTheme(snap) {
      const mode = snap.assets.nav.mode;
      const key = snap.assets.nav.cloudKey || '';
      this.setData({ themeVars: snap.varsString, navMode: mode, m: getNavMetrics() });
      if (mode === 'minimal' || !key) {
        // 不卸载缓存文件（切回插画主题可复用），仅不渲染
        if (this.data.headerUrl) this.setData({ headerUrl: '' });
        return;
      }
      this._load(key);
    },

    _load(key) {
      const localPath = LOCAL_PATH(key);
      const flagKey = FLAG_KEY(key);
      // 1) 本地缓存优先，零网络
      try {
        if (wx.getStorageSync(flagKey)) {
          fs.accessSync(localPath);
          this.setData({ headerUrl: localPath });
          return;
        }
      } catch (e) { /* 无缓存或损坏，回源 */ }

      // 2) 回源：云函数下载 base64 → 写本地 → 展示
      api.getBgUrl(key).then(res => {
        if (!res.base64) throw new Error('empty base64');
        fs.writeFile({
          filePath: localPath,
          data: res.base64,
          encoding: 'base64',
          success: () => {
            try { wx.setStorageSync(flagKey, 1); } catch (e) { /* 忽略 */ }
            // 加载期间可能已切走主题，仅在仍是同一插画 key 时上屏
            const cur = themeManager.getAssets().nav;
            if (cur.mode === 'illustrated' && cur.cloudKey === key) this.setData({ headerUrl: localPath });
          },
          fail: () => this.setData({ headerUrl: '' })
        });
      }).catch(() => this.setData({ headerUrl: '' }));
    },

    /** 加载失败：静默降级渐变底（Token 提供），不影响页面 */
    onError() {
      const key = themeManager.getAssets().nav.cloudKey || 'header';
      try { wx.removeStorageSync(FLAG_KEY(key)); } catch (e) { /* 忽略 */ }
      this.setData({ headerUrl: '' });
    }
  }
});
