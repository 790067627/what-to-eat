// pages/dish-detail/dish-detail.js - 菜品详情
const api = require('../../services/db');
const { withTheme } = require('../../theme/theme-page');
const themeManager = require('../../theme/theme-manager');
const { fenToYuan, timeAgo, formatDate } = require('../../utils/util');

const STATUS_TEXT = { want: '想吃', often: '常吃', never: '不想再吃' };
const STATUS_LIST = [
  { key: 'want', text: '想吃', icon: '' },
  { key: 'often', text: '常吃', icon: '' },
  { key: 'never', text: '不想再吃', icon: '' }
];

Page(withTheme({
  data: {
    id: '',
    loading: true,
    dish: null,
    categoryName: '',
    priceYuan: '',
    statusText: '',
    statusList: STATUS_LIST,
    lastEatenText: '',
    stars: [1, 2, 3, 4, 5],
    showDelete: false,
    navbarHeight: 0
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
    // 获取导航栏高度
    const systemInfo = wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const navbarHeight = systemInfo.statusBarHeight + menuButtonInfo.height + (menuButtonInfo.top - systemInfo.statusBarHeight) * 2;
    this.setData({ navbarHeight });
  },

  onShow() {
    if (this.data.id) this.loadDish();
  },

  async loadDish() {
    try {
      const [dish, categories] = await Promise.all([
        api.getDish(this.data.id),
        api.listCategories()
      ]);
      const cat = categories.find(c => c._id === dish.categoryId);
      
      // 判断是否是别人分享的菜品（通过 openid 比较）
      const userInfo = await api.getUserInfo();
      const isShared = dish.openid !== userInfo.openid;
      
      this.setData({
        loading: false,
        dish,
        categoryName: cat ? cat.name : '',
        priceYuan: fenToYuan(dish.price),
        statusText: STATUS_TEXT[dish.status] || '',
        lastEatenText: dish.lastEatenAt ? `上次吃：${timeAgo(dish.lastEatenAt)}（${formatDate(dish.lastEatenAt)}）` : '还没吃过这道菜',
        isShared
      });
    } catch (err) {
      api.handleErr(err);
      this.setData({ loading: false });
    }
  },

  // 图片预览
  previewImage(e) {
    const { url } = e.currentTarget.dataset;
    // 优先使用临时 URL（跨用户访问），否则用 fileID
    const coverUrl = this.data.dish.coverImageUrl || this.data.dish.coverImage;
    const imageUrls = this.data.dish.imagesUrl || this.data.dish.images || [];
    const urls = [coverUrl, ...imageUrls].filter(Boolean);
    wx.previewImage({ current: url, urls });
  },

  // 切换状态
  async onStatusTap(e) {
    const { status } = e.currentTarget.dataset;
    if (status === this.data.dish.status) return;
    try {
      await api.updateDish(this.data.id, { status });
      wx.showToast({ title: '已更新', icon: 'success' });
      this.loadDish();
    } catch (err) {
      api.handleErr(err);
    }
  },

  // 评分
  async onRate(e) {
    const { star } = e.currentTarget.dataset;
    try {
      await api.updateDish(this.data.id, { rating: star });
      this.setData({ 'dish.rating': star });
    } catch (err) {
      api.handleErr(err);
    }
  },

  // 记一笔吃过
  async onLogEat() {
    wx.showLoading({ title: '记录中' });
    try {
      await api.logEat(this.data.id);
      wx.hideLoading();
      wx.showToast({ title: '记好啦，吃得开心！', icon: 'success' });
      this.loadDish();
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err);
    }
  },

  // 编辑
  goEdit() {
    wx.navigateTo({ url: `/pages/dish-edit/dish-edit?id=${this.data.id}` });
  },

  // 删除（二次确认）
  async onDelete() {
    const res = await wx.showModal({
      title: '删除菜品',
      content: `确定删除「${this.data.dish.name}」吗？删除后不再出现在随机推荐里。`,
      confirmColor: themeManager.getJs().confirmColor
    });
    if (!res.confirm) return;
    try {
      await api.deleteDish(this.data.id);
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (err) {
      api.handleErr(err);
    }
  },

  /** 生成分享海报 */
  onPoster() {
    const poster = this.selectComponent('#poster');
    if (poster) poster.generate();
  },

  onShareTimeline() {
    return { title: 'Yuki小厨房——不知道吃啥的时候抽一抽' };
  },

  onShareAppMessage() {
    const dish = this.data.dish;
    if (!dish) {
      return {
        title: 'Yuki小厨房',
        path: '/pages/index/index'
      };
    }
    
    return {
      title: `${dish.name} | Yuki小厨房`,
      path: `/pages/dish-detail/dish-detail?id=${dish._id}`,
      imageUrl: dish.coverImageUrl || dish.coverImage || ''
    };
  },

  /** 保存别人分享的菜品到自己的菜单 */
  async onCopyToMyMenu() {
    const dish = this.data.dish;
    if (!dish) return;
    
    wx.showLoading({ title: '保存中' });
    try {
      const res = await api.saveSharedDish(dish._id);
      wx.hideLoading();
      wx.showToast({ title: '已保存到我的菜单', icon: 'success' });
      // 刷新当前页面，显示"已保存"状态
      this.loadDish(dish._id);
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err, '保存失败');
    }
  }
}));
