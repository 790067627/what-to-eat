// pages/dishes/dishes.js - 菜品库：分类侧栏 + 列表 + 搜索
const api = require('../../services/db');
const { getNavMetrics } = require('../../utils/util');
const { fenToYuan, timeAgo } = require('../../utils/util');
const { withTheme } = require('../../theme/theme-page');

const STATUS_TEXT = { want: '想吃', often: '常吃', never: '不想再吃' };

Page(withTheme({
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
    statusFilter: '',        // '' | want | often | never
    fabX: 0,                 // 悬浮添加按钮 left（px，可拖动）
    fabY: 0,                 // 悬浮添加按钮 top（px，可拖动）
    fabDragging: false       // 拖动中（放大反馈 + 抑制点击）
  },

  // 搜索节流定时器
  _searchTimer: null,
  // FAB 拖动状态（实例级，不进 data）
  _fabSize: 50,              // 按钮边长 px（100rpx）
  _fabStart: null,           // { x, y, left, top, moved }
  _fabBounds: null,          // { minX, minY, maxX, maxY }

  onLoad() {
    this.setData({ navHeight: getNavMetrics().headerHeight });
    this.initFabPos();
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

  /** FAB 初始位置：优先读记忆位置，越界或无记忆则回落到默认右下角 */
  initFabPos() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rpx2px = win.windowWidth / 750;
    this._fabSize = 100 * rpx2px;
    // 自定义 tabbar：内容区 112rpx（=56px）+ 底部安全区，与 custom-tab-bar 高度模型一致
    const tabBarH = 56 + (win.safeArea ? win.windowHeight - win.safeArea.bottom : 0);
    const pad = 12;
    this._fabBounds = {
      minX: pad,
      minY: this.data.navHeight + pad,
      maxX: win.windowWidth - this._fabSize - pad,
      maxY: win.windowHeight - tabBarH - this._fabSize - pad
    };
    const saved = wx.getStorageSync('dishesFabPos');
    let left = null;
    let top = null;
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      const b = this._fabBounds;
      // 记忆位置在当前屏幕范围内才采用（换机型/转屏后自动回落）
      if (saved.left >= b.minX - 1 && saved.left <= b.maxX + 1 && saved.top >= b.minY - 1 && saved.top <= b.maxY + 1) {
        left = saved.left;
        top = saved.top;
      }
    }
    if (left === null) {
      left = win.windowWidth - this._fabSize - 40 * rpx2px;  // 原 right: 40rpx
      top = win.windowHeight - tabBarH - this._fabSize - 90 * rpx2px; // 原 bottom 视觉位
    }
    this.setData({ fabX: left, fabY: top });
  },

  /** FAB 拖动：touchstart 记录起点 */
  onFabTouchStart(e) {
    const t = e.touches[0];
    this._fabStart = { x: t.clientX, y: t.clientY, left: this.data.fabX, top: this.data.fabY, moved: false };
  },

  /** FAB 拖动：跟手移动，限制在屏幕内（避开导航栏与 tabbar） */
  onFabTouchMove(e) {
    const s = this._fabStart;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // 死区，防误触
    s.moved = true;
    const b = this._fabBounds;
    const left = Math.min(Math.max(s.left + dx, b.minX), b.maxX);
    const top = Math.min(Math.max(s.top + dy, b.minY), b.maxY);
    this.setData({ fabX: left, fabY: top, fabDragging: true });
  },

  /** FAB 拖动：松手——位移小视为点击弹面板；否则按中轴线自动吸附到最左/最右，高度保持 */
  onFabTouchEnd() {
    const s = this._fabStart;
    this._fabStart = null;
    if (!s) return;
    if (!s.moved) {
      this.setData({ fabSheetVisible: true });
      return;
    }
    const b = this._fabBounds;
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    // 按钮中心点落在屏幕中轴线哪一侧，就吸附到哪条边
    const centerX = this.data.fabX + this._fabSize / 2;
    const snapX = centerX < win.windowWidth / 2 ? b.minX : b.maxX;
    this.setData({ fabX: snapX, fabY: this.data.fabY, fabDragging: false });
    wx.setStorageSync('dishesFabPos', { left: snapX, top: this.data.fabY });
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
}));
