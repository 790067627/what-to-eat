// pages/appearance/appearance.js - 外观设置：跟随系统开关 + 主题预览卡片
// 手动模式：点击卡片即全局切换（setTheme 内部持久化+广播）；
// 跟随系统：卡片仅预览不可点，系统深浅色变化由 theme-manager（app.js 注册的
//   wx.onThemeChange + onShow 兜底）驱动广播，本页订阅刷新「当前生效」标识。
// 切换仅更新视觉配置，不触碰任何业务数据。
const { withTheme } = require('../../theme/theme-page');
const themeManager = require('../../theme/theme-manager');
const TOKENS = require('../../theme/tokens');

Page(withTheme({
  data: {
    themes: [],                // [{ name, label, desc, preview, selected }]（selected = 当前生效主题）
    followSystem: false,       // 跟随系统开关状态
    systemSupported: true,     // 基础库是否支持（不支持时隐藏开关卡片）
    systemThemeText: '浅色'    // 当前系统深浅色文案（跟随期间展示）
  },

  onLoad() {
    // withTheme 内部已订阅主题快照（更新 themeVars 等）；此处独立句柄再订阅一份
    // 用于刷新列表态（selected/followSystem/系统文案），onUnload 各自退订互不干扰
    this._modeUnsub = themeManager.subscribe(() => this._buildList());
    this._buildList();
  },

  onUnload() {
    if (this._modeUnsub) { this._modeUnsub(); this._modeUnsub = null; }
  },

  _buildList() {
    const st = themeManager.getMode();
    const themes = themeManager.list().map(name => {
      const t = TOKENS[name];
      return {
        name,
        label: t.meta.label,
        desc: t.meta.desc,
        preview: t.meta.preview,
        selected: name === st.effective
      };
    });
    this.setData({
      themes,
      followSystem: st.mode === 'system',
      systemSupported: st.supported,
      systemThemeText: st.systemTheme === 'dark' ? '深色' : '浅色'
    });
  },

  /** 跟随系统开关：开启→按系统明暗映射（浅=GitHub Light / 深=GitHub Dark）；
   *  关闭→theme-manager 自动恢复用户之前的手动选择（manualThemeId） */
  onToggleFollow(e) {
    const want = !!e.detail.value;
    const ok = themeManager.setMode(want ? 'system' : 'manual');
    if (!ok) {
      // 基础库不支持：降级提示；开关受控于 data.followSystem，重建列表即回弹
      this._buildList();
      wx.showToast({ title: '当前微信版本过低，不支持跟随系统', icon: 'none', duration: 2000 });
      return;
    }
    this._buildList();
    if (want) {
      wx.showToast({ title: `已跟随系统（当前${this.data.systemThemeText}）`, icon: 'none', duration: 1500 });
    }
  },

  /** 点击主题卡片：手动模式下即点即切；跟随系统期间仅预览（UI 已禁点，此处防御） */
  onSelect(e) {
    const st = themeManager.getMode();
    if (st.mode === 'system') {
      wx.showToast({ title: '跟随系统期间不可手动切换，请先关闭上方开关', icon: 'none', duration: 1800 });
      return;
    }
    const { name } = e.currentTarget.dataset;
    if (name === st.effective) return;
    themeManager.setTheme(name);
    this._buildList();
    wx.showToast({ title: `已切换 ${TOKENS[name].meta.label}`, icon: 'none', duration: 1200 });
  }
}));
