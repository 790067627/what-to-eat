// theme/theme-page.js - 页面主题包装器
// 用法：Page(withTheme({ ...原页面配置 }))
// 职责：
//   1) data 注入 themeVars（page-meta 注入 CSS 变量）/ themeName / themeJs（动态 Token）/ themeWindowBg；
//   2) onLoad 订阅主题变化 → 已打开页面即时同步（返回上一页不会看到旧主题）；
//   3) 同步原生导航栏颜色与 navHeight（插画/极简导航高度不同）；
//   4) 主题切换不触碰任何业务数据，只更新视觉相关字段。

const manager = require('./theme-manager');

function withTheme(config) {
  const userOnLoad = config.onLoad;
  const userOnShow = config.onShow;
  const userOnUnload = config.onUnload;

  // 模块加载时（app.onLaunch 之后）即为最终主题，首帧无闪色
  const snap = manager.get();
  config.data = Object.assign({
    themeVars: snap.varsString,
    themeName: snap.name,
    themeJs: snap.js,
    themeWindowBg: snap.js.windowBg
  }, config.data);

  config.onLoad = function (options) {
    this._applyTheme(manager.get());
    this._themeUnsub = manager.subscribe(s => this._applyTheme(s));
    if (userOnLoad) userOnLoad.call(this, options);
  };

  config.onShow = function () {
    // 兜底：从后台/他页回来时再对齐一次导航栏颜色
    this._syncNavBar();
    if (userOnShow) userOnShow.call(this);
  };

  config.onUnload = function () {
    if (this._themeUnsub) { this._themeUnsub(); this._themeUnsub = null; }
    if (userOnUnload) userOnUnload.call(this);
  };

  config._applyTheme = function (snap) {
    const patch = {
      themeVars: snap.varsString,
      themeName: snap.name,
      themeJs: snap.js,
      themeWindowBg: snap.js.windowBg
    };
    // 页面若维护了导航让位高度，随主题布局策略同步（illustrated 24px / minimal 0）
    if (this.data && 'navHeight' in this.data) {
      patch.navHeight = manager.getNavHeaderHeight();
    }
    this.setData(patch);
    this._syncNavBar();
  };

  config._syncNavBar = function () {
    const js = manager.getJs();
    // custom 导航页调用无视觉效果，失败静默
    wx.setNavigationBarColor({
      frontColor: js.navBar.frontColor,
      backgroundColor: js.navBar.backgroundColor,
      fail: () => {}
    });
  };

  return config;
}

module.exports = { withTheme };
