// pages/dishes/dishes.js - 菜品库：分类侧栏 + 列表 + 搜索
const api = require('../../services/db');
const { getNavMetrics } = require('../../utils/util');
const { fenToYuan, timeAgo } = require('../../utils/util');

const STATUS_TEXT = { want: '想吃', often: '常吃', never: '不想再吃' };

Page({
  data: {
    sideScrollInto: '',   // 选中分类自动滚动锚点
    navHeight: 88,
    loading: true,
    fabSheetVisible: false,  // FAB 添加方式面板
    categories: [],          // [{ _id, name, icon }]，首项为"全部"
    activeCategoryId: '',    // '' = 全部
    activeCategoryName: '',
    keyword: '',
    dishes: [],              // 渲染用（含 priceYuan 等派生字段）
    statusFilter: ''         // '' | want | often | never
  },

  // 搜索节流定时器
  _searchTimer: null,

  onLoad() {
    this.setData({ navHeight: getNavMetrics().headerHeight });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    // 接收首页分类跳转的筛选条件
    const app = getApp();
    const filter = app.globalData.dishesFilter;
    if (filter) {
      app.globalData.dishesFilter = null;
      this.setData({
        activeCategoryId: filter.categoryId || '',
        activeCategoryName: filter.categoryName || ''
      });
    }
    this.loadAll();
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  },

  async loadAll() {
    this.setData({ loading: true });
    try {
      const [categories, dishes] = await Promise.all([
        api.listCategories(),
        this.fetchDishes()
      ]);
      this.setData({
        categories,
        dishes: this.decorate(dishes, categories),
        loading: false
      });
    } catch (err) {
      api.handleErr(err);
      this.setData({ loading: false });
    }
  },

  async fetchDishes() {
    const query = {};
    if (this.data.activeCategoryId) query.categoryId = this.data.activeCategoryId;
    if (this.data.statusFilter) query.status = this.data.statusFilter;
    if (this.data.keyword) query.keyword = this.data.keyword;
    return await api.listDishes(query);
  },

  decorate(dishes, categories) {
    const catMap = {};
    (categories || this.data.categories).forEach(c => { catMap[c._id] = c; });
    return dishes.map(d => ({
      ...d,
      priceYuan: fenToYuan(d.price),
      statusText: STATUS_TEXT[d.status] || '',
      categoryName: catMap[d.categoryId] ? catMap[d.categoryId].name : '',
      updatedAgo: timeAgo(d.updatedAt),
      // 优先使用临时URL（跨用户访问），否则用云文件ID
      coverImageUrl: d.coverImageUrl || d.coverImage || ''
    }));
  },

  async refreshDishes() {
    try {
      const dishes = await this.fetchDishes();
      this.setData({ dishes: this.decorate(dishes) });
    } catch (err) {
      api.handleErr(err);
    }
  },

  // 切换分类
  async onCategoryTap(e) {
    const { id, name } = e.currentTarget.dataset;
    if (id === this.data.activeCategoryId) return;
    const idx = id ? this.data.categories.findIndex(c => c._id === id) : -1;
    this.setData({
      activeCategoryId: id || '',
      activeCategoryName: name || '',
      sideScrollInto: idx >= 0 ? 'cat-' + idx : ''
    });
    this.refreshDishes();
  },

  // 状态筛选
  async onStatusTap(e) {
    const { status } = e.currentTarget.dataset;
    this.setData({ statusFilter: this.data.statusFilter === status ? '' : status });
    this.refreshDishes();
  },

  // 搜索（节流 400ms）
  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.refreshDishes(), 400);
  },

  onSearchClear() {
    this.setData({ keyword: '' });
    this.refreshDishes();
  },

  goDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${id}` });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' });
  },

  /** AI 识别入口：进表单并自动弹系统选图（拍摄/相册） */
  goAddAi() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit?ai=1' });
  },

  /** FAB：弹自绘添加方式面板（AI 卡片 + 手动行） */
  onFabTap() {
    this.setData({ fabSheetVisible: true });
  },
  closeFabSheet() {
    this.setData({ fabSheetVisible: false });
  },
  onSheetAi() {
    this.setData({ fabSheetVisible: false });
    this.goAddAi();
  },
  onSheetManual() {
    this.setData({ fabSheetVisible: false });
    this.goAdd();
  },
  noop() {}
});
