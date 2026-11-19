// pages/appearance/appearance.js - 外观设置：主题预览卡片 + 点击即切
// 切换仅更新视觉配置（Theme Manager 广播 → 全页面栈即时同步），不触碰任何业务数据。
const { withTheme } = require('../../theme/theme-page');
const themeManager = require('../../theme/theme-manager');
const TOKENS = require('../../theme/tokens');

Page(withTheme({
  data: {
    themes: []   // [{ name, label, desc, preview, selected }]
  },

  onLoad() {
    this._buildList();
  },

  _buildList() {
    const current = themeManager.get().name;
    const themes = themeManager.list().map(name => {
      const t = TOKENS[name];
      return {
        name,
        label: t.meta.label,
        desc: t.meta.desc,
        preview: t.meta.preview,
        selected: name === current
      };
    });
    this.setData({ themes });
  },

  /** 点击主题卡片：立即全局生效 + 持久化（manager 内部完成） */
  onSelect(e) {
    const { name } = e.currentTarget.dataset;
    if (name === themeManager.get().name) return;
    themeManager.setTheme(name);
    this._buildList();
    wx.showToast({ title: `已切换 ${TOKENS[name].meta.label}`, icon: 'none', duration: 1200 });
  }
}));
