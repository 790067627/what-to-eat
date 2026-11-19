// theme/theme-manager.js - 统一主题管理器（单例）
// 职责：当前主题状态、注册表、切换、本地持久化、订阅通知（页面栈同步）、
//       「跟随系统」模式解析（mode/manualThemeId/systemThemes）、
//       为 Canvas/动态组件提供 JS Token 读取入口。
// 约定：
//   - 主题注册在 tokens.js（样式）与 theme-assets.js（资源/布局策略），本文件不写死任何主题名；
//   - 「跟随系统」在本层 resolve 为最终主题名（currentName），下游（withTheme/themeBehavior/
//     getJs/getAssets/snapshot/广播）对 mode 零感知，全部沿用既有链路；
//   - 切换主题只改视觉配置，不触碰业务数据与页面状态；
//   - app.js onLaunch 最早调用 init()（同步读 Storage + 同步读系统深浅色），
//     页面 data 初始值即为最终主题，避免闪色。

const TOKENS = require('./tokens');
const ASSETS = require('./theme-assets');

const STORAGE_KEY = 'app_theme';
const DEFAULT_THEME = 'sakura';

// 系统深浅色 → 主题映射。可用 configureSystemThemes() 覆盖（预留自定义映射能力）
let systemThemes = { light: 'github-light', dark: 'github-dark' };

let mode = 'manual';               // 'manual'（用户手选）| 'system'（跟随系统）
let manualThemeId = DEFAULT_THEME; // 用户手动选择的主题（关闭跟随后恢复用）
let systemTheme = 'light';         // 最近一次已知的系统深浅色（'light'|'dark'）
let currentName = DEFAULT_THEME;   // 最终生效主题名（resolve 产物，下游唯一消费值）
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

/** 按当前 mode 解析最终生效主题名 */
function resolveEffective() {
  if (mode === 'system') {
    const mapped = systemThemes[systemTheme];
    if (mapped && isValid(mapped)) return mapped;
    // 映射目标未注册时防御性回落默认主题
    return DEFAULT_THEME;
  }
  return isValid(manualThemeId) ? manualThemeId : DEFAULT_THEME;
}

/** 同步读取系统深浅色（wx.getAppBaseInfo 基础库 2.20.1+，低版本回退 getSystemInfoSync；
 *  版本要求以官方文档核实。app.json 未声明 darkmode:true 时 theme 恒为 light，
 *  配合 isSystemSupported 降级不影响手动模式） */
function detectSystemTheme() {
  try {
    const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    return info && info.theme === 'dark' ? 'dark' : 'light';
  } catch (e) {
    return 'light';
  }
}

/** 「跟随系统」能力检测：wx.onThemeChange 需基础库 ≥2.11.0（以官方文档核实），
 *  且 app.json 已声明 "darkmode": true。不支持时 setMode('system') 返回 false，
 *  调用方降级提示并保持手动模式。 */
function isSystemSupported() {
  return typeof wx.onThemeChange === 'function';
}

/** 持久化：统一存对象格式 { mode, manualThemeId }（init 兼容旧字符串格式） */
function persist() {
  try { wx.setStorageSync(STORAGE_KEY, { mode, manualThemeId }); } catch (e) { /* 忽略 */ }
}

function broadcast() {
  const snap = snapshot(currentName);
  subscribers.forEach(fn => {
    try { fn(snap); } catch (e) { console.error('[theme] subscriber error', e); }
  });
}

const manager = {
  /** 应用启动最早时机调用：同步恢复用户配置（含跟随系统解析） */
  init() {
    try {
      const saved = wx.getStorageSync(STORAGE_KEY);
      if (saved && typeof saved === 'object') {
        // 新格式：{ mode, manualThemeId }
        if (saved.manualThemeId && isValid(saved.manualThemeId)) manualThemeId = saved.manualThemeId;
        mode = saved.mode === 'system' ? 'system' : 'manual';
      } else if (saved && typeof saved === 'string' && isValid(saved)) {
        // 旧格式兼容：纯主题名字符串 → 迁移为 manual 模式（下次 set 时自动升级为新格式）
        manualThemeId = saved;
        mode = 'manual';
      }
    } catch (e) { /* 读取失败用默认配置 */ }
    systemTheme = detectSystemTheme();
    // 持久化了 system 但当前环境不支持（降级场景）：回落 manual，manualThemeId 仍保留
    if (mode === 'system' && !isSystemSupported()) mode = 'manual';
    currentName = resolveEffective();
    return currentName;
  },

  /** 注册系统深浅色监听（app.js onLaunch 调用；不支持时静默跳过） */
  watchSystem() {
    if (!isSystemSupported() || this._watching) return;
    this._watching = true;
    wx.onThemeChange(res => this.handleSystemThemeChange(res && res.theme));
  },

  /** 前台兜底复查（app.js onShow 调用；覆盖个别机型监听不触发的场景） */
  checkSystemTheme() {
    this.handleSystemThemeChange(detectSystemTheme());
  },

  /** 系统深浅色变化统一入口（onThemeChange 回调 / 兜底复查共用）。
   *  manual 模式下只记录 systemTheme（开启跟随时立即可 resolve），不切换不广播。 */
  handleSystemThemeChange(theme) {
    systemTheme = theme === 'dark' ? 'dark' : 'light';
    if (mode !== 'system') return;
    const next = resolveEffective();
    if (next === currentName) return;
    currentName = next;
    broadcast();
  },

  /** 外观页状态：模式/手选主题/系统深浅色/最终生效/能力支持 */
  getMode() {
    return {
      mode,
      manualThemeId,
      systemTheme,
      effective: currentName,
      supported: isSystemSupported()
    };
  },

  /** 切换「跟随系统」开关。返回 false = 环境不支持（调用方降级提示并保持开关关闭）。
   *  关闭时自动恢复 manualThemeId（用户之前的手动选择）。 */
  setMode(nextMode) {
    const m = nextMode === 'system' ? 'system' : 'manual';
    if (m === mode) return true;
    if (m === 'system') {
      if (!isSystemSupported()) return false;
      systemTheme = detectSystemTheme();   // 开启瞬间取最新系统值，避免用陈旧值闪一下
    }
    mode = m;
    persist();
    const next = resolveEffective();
    if (next !== currentName) {
      currentName = next;
      broadcast();
    }
    return true;
  },

  /** 自定义系统深浅色映射（预留扩展）：{ light: '主题名', dark: '主题名' }。
   *  两个值都必须是已注册主题，否则拒绝。system 模式生效中则立即重解析并广播。 */
  configureSystemThemes(map) {
    if (!map || !isValid(map.light) || !isValid(map.dark)) {
      console.warn('[theme] configureSystemThemes: 映射目标必须是已注册主题');
      return false;
    }
    systemThemes = { light: map.light, dark: map.dark };
    if (mode === 'system') {
      const next = resolveEffective();
      if (next !== currentName) { currentName = next; broadcast(); }
    }
    return true;
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

  /** 手动选择主题：持久化 + 广播。已打开页面通过订阅即时同步，无需重启。
   *  跟随系统期间拒绝手动切换（外观页 UI 已禁用，此处为防御层），返回 false。 */
  setTheme(name) {
    if (mode === 'system') {
      console.warn('[theme] 跟随系统模式下忽略手动切换');
      return false;
    }
    if (!isValid(name)) {
      console.warn(`[theme] 未注册的主题: ${name}`);
      return false;
    }
    if (name === manualThemeId) return true;
    manualThemeId = name;
    currentName = name;
    persist();
    broadcast();
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
  },

  /** 内容区顶部额外视觉间距（px）：来自主题 nav.contentTopOffset。
   *  与导航高度解耦——只决定「内容起始位置」，不改变导航条高度。
   *  illustrated 主题为 0（插画带已含间距）；minimal 主题用它补齐留白。
   *  缺省/非法值一律按 0 处理，保证旧主题配置不报错。 */
  getContentTopOffset() {
    const off = ASSETS[currentName] && ASSETS[currentName].nav
      ? ASSETS[currentName].nav.contentTopOffset : 0;
    return typeof off === 'number' && off > 0 ? off : 0;
  }
};

module.exports = manager;
