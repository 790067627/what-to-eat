// custom-tab-bar/index.js - 自定义 tabBar（暖色主题 + 中间凸起"抽一抽"按钮）
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页', iconPath: '/custom-tab-bar/icons/home_normal.png', selectedIconPath: '/custom-tab-bar/icons/home_active.png' },
      { pagePath: '/pages/dishes/dishes', text: '菜品库', iconPath: '/custom-tab-bar/icons/dishes_normal.png', selectedIconPath: '/custom-tab-bar/icons/dishes_active.png' },
      { pagePath: '/pages/random/random', text: '抽一抽', iconPath: '/custom-tab-bar/icons/dice_normal.png', selectedIconPath: '/custom-tab-bar/icons/dice_active.png', center: true },
      { pagePath: '/pages/mine/mine', text: '我的', iconPath: '/custom-tab-bar/icons/mine_normal.png', selectedIconPath: '/custom-tab-bar/icons/mine_active.png' }
    ]
  },

  methods: {
    onTap(e) {
      const { index, path } = e.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: path });
    }
  }
});
