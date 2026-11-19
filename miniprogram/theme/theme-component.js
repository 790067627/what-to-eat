// theme/theme-component.js - 组件主题 Behavior
// 用法：Component({ behaviors: [themeBehavior], ... })
// 组件根节点绑定 style="{{themeVars}}" 后可在自身 wxss 内使用全部语义 Token；
// 位于页面内的组件即使不绑定，也能继承 page-meta 注入的变量（CSS 变量继承不受样式隔离影响）。
// custom-tab-bar 等可能挂载在页面根节点之外的组件必须自行绑定。
//
// data 初始值即为「当前主题快照」（模块加载时 theme-manager 已在 app.onLaunch init 完毕），
// 保证组件首帧渲染就是正确主题，避免 attached 前的空值闪烁。

const manager = require('./theme-manager');

const initial = manager.get();

module.exports = Behavior({
  data: {
    themeVars: initial.varsString,
    themeName: initial.name,
    themeJs: initial.js,
    themeAssets: initial.assets
  },

  lifetimes: {
    attached() {
      // 兜底再对齐一次（覆盖组件复用/延迟挂载场景）
      this._applyThemeSnap(manager.get());
      this._themeUnsub = manager.subscribe(s => this._applyThemeSnap(s));
    },
    detached() {
      if (this._themeUnsub) { this._themeUnsub(); this._themeUnsub = null; }
    }
  },

  methods: {
    _applyThemeSnap(snap) {
      this.setData({
        themeVars: snap.varsString,
        themeName: snap.name,
        themeJs: snap.js,
        themeAssets: snap.assets
      });
    }
  }
});
