// components/custom-navbar/custom-navbar.js - 子页面透明导航栏
// 文字/图标颜色走 CSS 变量（--navbar-fg / --navbar-shadow），
// 由所在页面 page-meta 注入并经 CSS 变量继承穿透到组件，无需自带订阅。
Component({
  properties: {
    title: {
      type: String,
      value: ''
    }
  },

  data: {
    statusBarHeight: 0,
    navbarHeight: 0,
    contentHeight: 0,
    capsuleWidth: 87
  },

  lifetimes: {
    attached() {
      this.initNavbar();
    }
  },

  methods: {
    initNavbar() {
      const systemInfo = wx.getSystemInfoSync();
      const statusBarHeight = systemInfo.statusBarHeight || 20;
      const menuButtonInfo = wx.getMenuButtonBoundingClientRect();

      // 导航栏高度 = 状态栏高度 + 胶囊按钮高度 + 胶囊按钮上下边距 * 2
      const navbarHeight = statusBarHeight + menuButtonInfo.height + (menuButtonInfo.top - statusBarHeight) * 2;
      const contentHeight = menuButtonInfo.height + (menuButtonInfo.top - statusBarHeight) * 2;

      this.setData({
        statusBarHeight,
        navbarHeight,
        contentHeight,
        capsuleWidth: menuButtonInfo.width || 87
      });
    },

    onBack() {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.switchTab({ url: '/pages/index/index' });
        }
      });
    }
  }
});
