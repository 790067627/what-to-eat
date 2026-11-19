// 兼容验证工程入口
// 真机白屏根因（已定位）：微信恢复同 AppID 上次会话页面（主项目 pages/index/index），
// 本工程无该页 → onPageNotFound → 404/白屏。统一重定向到验证页。
App({
  onLaunch() {
    try {
      wx.setStorageSync('__cc_boot', Date.now());
      wx.removeStorageSync('__cc_err'); // 黄卡只显示当次会话错误，避免历史残留误导
    } catch (e) { /* 忽略 */ }
  },
  onPageNotFound() {
    wx.reLaunch({ url: '/pages/check/check' });
  },
  onError(err) {
    const s = String(err);
    if (s.indexOf('onPageNotFound') >= 0) return; // 预期的会话恢复串台，已重定向，不记
    try {
      const list = wx.getStorageSync('__cc_err') || [];
      list.push(s.slice(0, 500));
      wx.setStorageSync('__cc_err', list.slice(-5));
    } catch (e) { /* 忽略 */ }
  },
  onUnhandledRejection(res) {
    try {
      const list = wx.getStorageSync('__cc_err') || [];
      list.push('unhandled: ' + String(res && res.reason).slice(0, 400));
      wx.setStorageSync('__cc_err', list.slice(-5));
    } catch (e) { /* 忽略 */ }
  }
});
