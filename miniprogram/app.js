// app.js - 全局入口
const { ENV_ID } = require('./config');

App({
  globalData: {
    // 跨页面传参：菜品库筛选条件（tabBar 页无法通过 URL 传参，用 globalData 中转）
    dishesFilter: null
  },

  onLaunch() {
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
  }
});
