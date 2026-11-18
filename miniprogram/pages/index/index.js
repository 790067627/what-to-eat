// pages/index/index.js - 首页：随机入口 + 今日推荐 + 分类速览
const api = require('../../services/db');
const { getNavMetrics } = require('../../utils/util');
const { fenToYuan, shuffle } = require('../../utils/util');

Page({
  data: {
    navHeight: 88,
    loading: true,
    inited: false,        // 是否已有数据
    todayDish: null,      // 今日推荐
    categories: [],
    greeting: ''
  },

  onLoad() {
    // 沉浸式导航：内容区让位高度（与组件同一度量源）
    this.setData({ navHeight: getNavMetrics().headerHeight });

    this.setData({ greeting: this.buildGreeting() });
  },

  /** 页面级 tap：坐标命中 Kitty 区域时触发弹跳（Kitty 本体 pointer-events:none 不挡点击） */
  onPageTap(e) {
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const kitty = this.selectComponent('#kitty');
    if (kitty) kitty.tryTapBounce(t.clientX, t.clientY);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.loadData();
  },

  buildGreeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了，来点宵夜灵感？';
    if (h < 11) return '早上好，今天想吃点啥？';
    if (h < 14) return '中午好，午饭有着落了吗？';
    if (h < 18) return '下午好，先想想晚饭吃啥';
    return '晚上好，今天吃点好的';
  },

  async loadData() {
    try {
      const [categories, dishes, stats] = await Promise.all([
        api.listCategories(),
        api.listDishes(),
        api.getStats()
      ]);
      const inited = stats.dishCount > 0;

      // 今日推荐：从非"不想再吃"的菜里，按当天日期做稳定伪随机（当天不变）
      let todayDish = null;
      const pool = dishes.filter(d => d.status !== 'never');
      if (pool.length) {
        const dayKey = new Date().toDateString();
        let hash = 0;
        for (let i = 0; i < dayKey.length; i++) {
          hash = (hash * 31 + dayKey.charCodeAt(i)) % 997;
        }
        const picked = pool[hash % pool.length];
        const cat = categories.find(c => c._id === picked.categoryId);
        todayDish = {
          ...picked,
          priceYuan: fenToYuan(picked.price),
          categoryName: cat ? cat.name : ''
        };
      }

      this.setData({
        loading: false,
        inited,
        todayDish,
        categories: categories.slice(0, 6)
      });
    } catch (err) {
      api.handleErr(err);
      this.setData({ loading: false });
    }
  },

  // 去随机页
  goRandom() {
    wx.switchTab({ url: '/pages/random/random' });
  },

  // 点分类 -> 菜品库并带筛选
  goCategory(e) {
    const { id, name } = e.currentTarget.dataset;
    const app = getApp();
    app.globalData.dishesFilter = { categoryId: id, categoryName: name };
    wx.switchTab({ url: '/pages/dishes/dishes' });
  },

  // 看全部菜品
  goDishes() {
    getApp().globalData.dishesFilter = null;
    wx.switchTab({ url: '/pages/dishes/dishes' });
  },

  // 点今日推荐 -> 详情
  goDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${id}` });
  },

  // 一键初始化示例数据
  async onInitDemo() {
    wx.showLoading({ title: '初始化中' });
    try {
      await api.initDemo();
      wx.hideLoading();
      wx.showToast({ title: '已添加示例菜品', icon: 'success' });
      this.loadData();
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err);
    }
  },

  // 添加菜品
  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' });
  },

  onShareTimeline() {
    return { title: 'Yuki小厨房——不知道吃啥的时候抽一抽' };
  },

  onShareAppMessage() {
    return { title: 'Yuki小厨房｜不知道吃啥？帮你决定', path: '/pages/index/index' };
  }
});
