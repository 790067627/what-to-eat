// app.js - 全局入口
const { ENV_ID } = require('./config');
const theme = require('./theme/theme-manager');

App({
  globalData: {
    // 跨页面传参：菜品库筛选条件（tabBar 页无法通过 URL 传参，用 globalData 中转）
    dishesFilter: null
  },

  onLaunch() {
    // 主题初始化最先执行（同步读 Storage + 同步读系统深浅色）：
    // 页面 data 初始值即为最终主题，避免先粉后切
    theme.init();
    // 注册「跟随系统」深浅色监听（基础库不支持时内部静默跳过，手动模式不受影响）
    theme.watchSystem();

    // 图标字体已通过 app.wxss 内联 base64 @font-face 加载，无需 loadFontFace
    if (!wx.cloud) {
      console.error('当前基础库过低，无法使用云开发，请升级基础库（版本要求以官方文档核实）');
      return;
    }
    wx.cloud.init({
      // ENV_ID 为空时使用默认环境；多环境时在 config.js 填写
      env: ENV_ID || undefined,
      traceUser: true
    });
  },

  onShow() {
    // 前台兜底复查系统深浅色（覆盖个别机型 onThemeChange 不触发的场景）
    theme.checkSystemTheme();
  }
});
