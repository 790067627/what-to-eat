// theme/theme-manager.js - 统一主题管理器（单例）
// 职责：当前主题状态、注册表、切换、本地持久化、订阅通知（页面栈同步）、
//       为 Canvas/动态组件提供 JS Token 读取入口。
// 约定：
//   - 主题注册在 tokens.js（样式）与 theme-assets.js（资源/布局策略），本文件不写死任何主题名；
//   - 切换主题只改视觉配置，不触碰业务数据与页面状态；
//   - app.js onLaunch 最早调用 init()（同步读 Storage），页面 data 初始值即为最终主题，避免闪色。

const TOKENS = require('./tokens');
const ASSETS = require('./theme-assets');

const STORAGE_KEY = 'app_theme';
const DEFAULT_THEME = 'sakura';

let currentName = DEFAULT_THEME;
const subscribers = [];

function isValid(name) {
  return Object.prototype.hasOwnProperty.call(TOKENS, name) &&
         Object.prototype.hasOwnProperty.call(ASSETS, name);
}

/** 组装当前主题的完整视图对象 */
function snapshot(name) {
  const t = TOKENS[name];
  return {
    name,
    css: t.css,
    js: t.js,
    meta: t.meta,
    assets: ASSETS[name],
    varsString: t.varsString
  };
}

const manager = {
  /** 应用启动最早时机调用：同步恢复用户上次选择 */
  init() {
    try {
      const saved = wx.getStorageSync(STORAGE_KEY);
      if (saved && isValid(saved)) currentName = saved;
    } catch (e) { /* 读取失败用默认主题 */ }
    return currentName;
  },

  /** 全部已注册主题名（外观页遍历用） */
  list() {
    return Object.keys(TOKENS).filter(isValid);
  },

  /** 当前主题快照 */
  get() {
    return snapshot(currentName);
  },

  /** JS Token（Canvas/粒子/海报/showModal/slider 等动态场景） */
  getJs() {
    return TOKENS[currentName].js;
  },

  /** 资源与布局策略（导航模式/装饰开关/tabbar 图标模式） */
  getAssets() {
    return ASSETS[currentName];
  },

  /** 切换主题：持久化 + 广播。已打开页面通过订阅即时同步，无需重启 */
  setTheme(name) {
    if (!isValid(name)) {
      console.warn(`[theme] 未注册的主题: ${name}`);
      return false;
    }
    if (name === currentName) return true;
    currentName = name;
    try { wx.setStorageSync(STORAGE_KEY, name); } catch (e) { /* 忽略 */ }
    const snap = snapshot(name);
    subscribers.forEach(fn => {
      try { fn(snap); } catch (e) { console.error('[theme] subscriber error', e); }
    });
    return true;
  },

  /** 订阅主题变化，返回退订函数 */
  subscribe(fn) {
    subscribers.push(fn);
    return () => {
      const i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  },

  /** 导航内容高度（px）：胶囊底边 + 主题的插画延伸带。
   *  单一事实源，页面 padding-top 与 immersive-nav 组件共用 */
  getNavHeaderHeight() {
    const mb = wx.getMenuButtonBoundingClientRect();
    return mb.top + mb.height + ASSETS[currentName].nav.extraHeight;
  }
};

module.exports = manager;
