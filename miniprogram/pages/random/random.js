// pages/random/random.js - 随机抽卡：核心决策页
const api = require('../../services/db');
const { getNavMetrics } = require('../../utils/util');
const { fenToYuan, timeAgo } = require('../../utils/util');

Page({
  data: {
    navHeight: 88,
    // 筛选条件
    excludeDays: 3,          // 排除最近 N 天吃过的（0 = 不排除）
    onlyWant: false,         // 只从"想吃"里抽
    weightByRating: true,    // 高分优先：按评分加权抽取
    // 抽卡状态机：idle | rolling | result
    phase: 'idle',
    rollingName: '',         // 滚动时闪过的菜名
    result: null,            // { dish(含priceYuan), categoryName, lastEatenAt, poolSize }
    lastEatenText: '',
    errorMessage: '',
    categories: [],
    categoryNames: ['不限'],  // picker 用
    categoryFilter: '',      // 限定分类
    categoryFilterName: ''
  },

  _rollTimer: null,

  onLoad() {
    this.setData({ navHeight: getNavMetrics().headerHeight });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    // 恢复"高分优先"上次选择
    try {
      const v = wx.getStorageSync('random_weight');
      if (v !== '' && v !== undefined) this.setData({ weightByRating: !!v });
    } catch (e) { /* 忽略 */ }
    this.loadNames();
  },

  onUnload() {
    if (this._rollTimer) clearInterval(this._rollTimer);
  },

  /** 预加载菜名列表，供滚动动画使用 */
  async loadNames() {
    try {
      const [dishes, categories] = await Promise.all([api.listDishes(), api.listCategories()]);
      this._names = dishes.filter(d => d.status !== 'never').map(d => d.name);
      this.setData({
        categories,
        categoryNames: ['不限'].concat(categories.map(c => c.name))
      });
    } catch (err) {
      this._names = [];
      api.handleErr(err);
    }
  },

  // ---- 筛选交互 ----
  onDaysChange(e) {
    this.setData({ excludeDays: Number(e.detail.value) });
  },
  toggleWant() {
    this.setData({ onlyWant: !this.data.onlyWant });
  },
  toggleWeight(e) {
    const on = e.detail.value;
    this.setData({ weightByRating: on });
    try { wx.setStorageSync('random_weight', on ? 1 : 0); } catch (err) { /* 忽略 */ }
  },
  onCategoryChoose(e) {
    const idx = Number(e.detail.value);
    if (idx === 0) {
      this.setData({ categoryFilter: '', categoryFilterName: '' });
    } else {
      const c = this.data.categories[idx - 1];
      this.setData({ categoryFilter: c._id, categoryFilterName: c.name });
    }
  },

  // ---- 抽卡 ----
  async onRoll() {
    if (this.data.phase === 'rolling') return;
    const names = this._names || [];
    if (!names.length) {
      this.setData({ errorMessage: '菜品库是空的，先去添加几道菜吧' });
      return;
    }

    this.setData({ phase: 'rolling', errorMessage: '', result: null });

    // 滚动动画：菜名快速闪动
    let i = 0;
    this._rollTimer = setInterval(() => {
      this.setData({ rollingName: names[i % names.length] });
      i++;
    }, 80);

    // 请求服务端随机结果
    try {
      // 注意：db.js 的 randomPick(filters) 会自行包一层 { filters }，
      // 这里必须传扁平对象，否则云函数收到 filters.filters 导致筛选失效
      const res = await api.randomPick({
        excludeRecentDays: this.data.excludeDays,
        onlyStatus: this.data.onlyWant ? 'want' : '',
        categoryId: this.data.categoryFilter,
        weightByRating: this.data.weightByRating
      });
      // 至少滚 1.2 秒，仪式感拉满
      setTimeout(() => this.showResult(res), 1200);
    } catch (err) {
      clearInterval(this._rollTimer);
      if (err.message && err.message.includes('没有符合条件')) {
        this.setData({ phase: 'idle', errorMessage: '没有符合条件的菜品，放宽筛选试试' });
      } else {
        this.setData({ phase: 'idle', errorMessage: '网络异常，再抽一次试试' });
      }
    }
  },

  showResult(res) {
    clearInterval(this._rollTimer);
    const dish = res.dish;
    this.setData({
      phase: 'result',
      result: {
        ...res,
        dish: { ...dish, priceYuan: fenToYuan(dish.price) }
      },
      lastEatenText: res.lastEatenAt ? `上次吃是 ${timeAgo(res.lastEatenAt)}` : '还没吃过，尝个鲜'
    });
    wx.vibrateShort({ type: 'medium', fail: () => {} });
  },

  // ---- 决策闭环 ----
  /** 就它了：记一笔吃过，状态自动升级"常吃" */
  async onAccept() {
    const { result } = this.data;
    if (!result) return;
    wx.showLoading({ title: '记录中' });
    try {
      await api.logEat(result.dish._id);
      wx.hideLoading();
      wx.showToast({ title: `就吃${result.dish.name}！`, icon: 'success' });
      this.setData({ phase: 'idle', result: null });
      this.loadNames(); // 刷新菜名池
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err);
    }
  },

  /** 不想吃：直接再抽一次 */
  onReject() {
    this.onRoll();
  },

  /** 生成分享海报（结果态） */
  onPoster() {
    const poster = this.selectComponent('#poster');
    if (poster) poster.generate();
  },

  /** 看详情 */
  goDetail() {
    const { result } = this.data;
    if (!result) return;
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${result.dish._id}` });
  },

  /** 去加菜 */
  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' });
  }
});
