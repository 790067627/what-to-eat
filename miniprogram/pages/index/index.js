// pages/index/index.js - 首页：AI 饮食灵感（方案 A 卡栈）+ 个性化推荐 feed
// 数据流：getFeed(cursor) → 队列缓存 → card-stack 组件消费；滑动接近队尾自动预加载下一页。
// 行为上报：曝光/换一道/不感兴趣/点赞/想吃 全部走 logBehavior，按 openid 服务端隔离。
const api = require('../../services/db');
const { getNavMetrics, shuffle } = require('../../utils/util');
const { withTheme } = require('../../theme/theme-page');

Page(withTheme({
  data: {
    navHeight: 88,
    loading: true,
    inited: false,
    greeting: '',
    // feed
    feedQueue: [],        // 全量已取回队列
    cursorIdx: 0,         // 当前卡指针
    visibleItems: [],     // 传给 card-stack 的可见切片（4 张）
    nextCursor: '',
    hasMore: true,
    feedLoading: false,
    coldStart: false,
    legacyCloud: false,   // 云端 dish 函数为旧版（无 getFeed）时的降级标记
    // 抽屉
    sheetShow: false,
    sheetItem: null,
    // 操作区状态
    curLiked: false,
    curSaved: false,
    idxText: '',
    stackHeightPx: 480   // 卡栈区确定高度（px），真机 WKWebView 对 auto 高度内的百分比解析为 0
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    const nav = getNavMetrics().headerHeight;
    const safeBottom = sys.safeArea ? sys.screenHeight - sys.safeArea.bottom : 0;
    // POC 卡片宽高比 ≈ 1:1.9（390 视口下卡宽 ~285 高 ~540）；
    // 可用高度 = 视口 - 导航 - 紧凑问候(64) - 操作区(64) - 提示(24) - TabBar(56+安全区) - 间距(40)
    const cardW = sys.windowWidth * 0.92 * 0.8;
    const idealH = cardW * 1.9;
    const availH = sys.windowHeight - nav - 64 - 64 - 24 - 56 - safeBottom - 40;
    // 优先 POC 比例；空间不足时压到可用高度（小屏压缩次要信息，保大图）
    const h = Math.max(320, Math.min(idealH, availH));
    this.setData({
      navHeight: nav,
      greeting: this.buildGreeting(),
      stackHeightPx: Math.round(h)
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 首次加载 or 从其他页回来时轻量刷新（节流 30s，避免 onShow 高频请求）
    const now = Date.now();
    if (!this.data.feedQueue.length) {
      this.checkInited().then(() => this.loadFeed(true));
    } else if (!this._lastShow || now - this._lastShow > 30000) {
      this.refreshCurrentStates();
    }
    this._lastShow = now;
  },

  onPullDownRefresh() {
    this.loadFeed(true).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  async checkInited() {
    try {
      const stats = await api.getStats();
      this.setData({ inited: stats.dishCount > 0 });
    } catch (e) { /* 静默 */ }
  },

  buildGreeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了，今天吃什么？';
    if (h < 11) return '早上好，今天吃什么？';
    if (h < 14) return '中午好，今天吃什么？';
    if (h < 18) return '下午好，今天吃什么？';
    return '晚上好，今天吃什么？';
  },

  /* ==================== feed 加载 ==================== */

  async loadFeed(reset) {
    if (this.data.feedLoading) return;
    this.setData({ feedLoading: true, loading: reset ? true : this.data.loading });
    try {
      const cursor = reset ? '' : this.data.nextCursor;
      const res = await api.getFeed(cursor, 6);
      const merged = reset ? res.items : this.data.feedQueue.concat(res.items);
      this.setData({
        loading: false,
        feedLoading: false,
        feedQueue: merged,
        cursorIdx: reset ? 0 : this.data.cursorIdx,
        nextCursor: res.nextCursor || '',
        hasMore: !!res.hasMore,
        coldStart: !!(res.profile && res.profile.coldStart)
      });
      this.syncVisible();
      // 曝光上报（只报页首两张，失败静默）
      res.items.slice(0, 2).forEach(it => {
        api.logBehavior('expose', it.type, it.id).catch(() => {});
      });
    } catch (err) {
      // 云端 dish 函数尚未部署新版时（未知操作: getFeed），降级为本地自有菜单卡栈，首页不白屏不报错
      if (/未知操作/.test((err && err.message) || '')) {
        return this.loadLocalFeed();
      }
      this.setData({ loading: false, feedLoading: false });
      api.handleErr(err, '推荐加载失败');
    }
  },

  /** 旧云降级：仅用 listDishes 自有菜组卡栈（无公开池/无 AI 理由，模板文案） */
  async loadLocalFeed() {
    try {
      const dishes = await api.listDishes();
      const pool = dishes.filter(d => d.status !== 'never');
      const items = shuffle(pool).map(d => ({
        type: 'own',
        id: d._id,
        name: d.name,
        coverImageUrl: d.coverImageUrl || d.coverImage || '',
        coverFileID: d.coverImage || '',
        tags: (d.tags || []).slice(0, 3),
        reason: d.description ? String(d.description).slice(0, 46) : `你菜单里的「${d.name}」，要不要试试`,
        matchTag: '你的菜单',
        author: null,
        liked: false,
        likeCount: 0,
        savedDishId: d._id,
        rating: d.rating || 0,
        status: d.status
      }));
      this.setData({
        loading: false, feedLoading: false, legacyCloud: true,
        feedQueue: items, cursorIdx: 0, nextCursor: '', hasMore: false,
        inited: items.length > 0
      });
      this.syncVisible();
    } catch (e) {
      this.setData({ loading: false, feedLoading: false });
      api.handleErr(e, '加载失败');
    }
  },

  /** 降级态点提示条：重试云端推荐（部署新版云函数后即可恢复） */
  retryFeed() {
    this.setData({ legacyCloud: false });
    this.loadFeed(true);
  },

  /** 同步可见切片 + 操作区状态 */
  syncVisible() {
    const { feedQueue, cursorIdx } = this.data;
    const visibleItems = feedQueue.slice(cursorIdx, cursorIdx + 4).map(it =>
      Object.assign({}, it, { ratingText: (Number(it.rating) || 0).toFixed(1) }));
    const cur = feedQueue[cursorIdx];
    this.setData({
      visibleItems,
      curLiked: cur ? !!cur.liked : false,
      curSaved: !!(cur && cur.savedDishId),
      idxText: cur ? `${cursorIdx + 1} / ${feedQueue.length}` : ''
    });
  },

  /** 从详情/抽屉返回后刷新当前卡的互动状态（仅公开卡需要回源） */
  async refreshCurrentStates() {
    const cur = this.data.feedQueue[this.data.cursorIdx];
    if (!cur || cur.type !== 'public') return;
    try {
      const p = await api.getPublicDish(cur.id);
      const patch = {};
      patch[`feedQueue[${this.data.cursorIdx}].liked`] = !!p.liked;
      patch[`feedQueue[${this.data.cursorIdx}].likeCount`] = p.likeCount || 0;
      patch[`feedQueue[${this.data.cursorIdx}].savedDishId`] = p.savedDishId || '';
      this.setData(patch);
      this.syncVisible();
    } catch (e) { /* 撤回等情况静默 */ }
  },

  /* ==================== 卡栈事件 ==================== */

  /** card-stack 提交换卡：推进指针 + 预加载 + 行为上报 */
  onAdvance() {
    const { feedQueue, cursorIdx } = this.data;
    const cur = feedQueue[cursorIdx];
    if (cur) api.logBehavior('next', cur.type, cur.id).catch(() => {});
    if (cursorIdx >= feedQueue.length - 1) {
      if (this.data.hasMore && this.data.nextCursor) {
        // 队尾：等下一页（loadFeed 完成后 syncVisible 自然推进到重置位）
        this.loadFeed(false).then(() => {
          if (this.data.cursorIdx < this.data.feedQueue.length - 1) {
            this.setData({ cursorIdx: this.data.cursorIdx + 1 });
            this.syncVisible();
          }
        });
        return;
      }
      // 环形：游标耗尽从头再来
      this.setData({ cursorIdx: 0 });
      this.syncVisible();
      return;
    }
    this.setData({ cursorIdx: cursorIdx + 1 });
    this.syncVisible();
    // 接近队尾预加载下一批
    if (this.data.cursorIdx + 3 >= feedQueue.length && this.data.hasMore && this.data.nextCursor) {
      this.loadFeed(false);
    }
    const nxt = this.data.feedQueue[this.data.cursorIdx];
    if (nxt) api.logBehavior('expose', nxt.type, nxt.id).catch(() => {});
  },

  onCardTap(e) {
    const item = e.detail.item;
    if (!item) return;
    this.setData({ sheetItem: this.decorateSheet(item), sheetShow: true });
  },

  onNotInterest(e) {
    const item = e.detail.item;
    if (!item) return;
    api.logBehavior('not_interest', item.type, item.id).catch(() => {});
    wx.showToast({ title: '好的，少推这类', icon: 'none' });
    this.onAdvance();
  },

  onSheetClose() {
    this.setData({ sheetShow: false });
  },

  /** 抽屉数据装饰（互动状态映射到统一字段） */
  decorateSheet(item) {
    return Object.assign({}, item, {
      liked: !!item.liked,
      saved: !!item.savedDishId
    });
  },

  onSheetLike() { this.onLike(); },
  onSheetWant() { this.onWant(); },

  /* ==================== 操作区：喜欢 / 换一道 / 想吃 ==================== */

  async onLike() {
    const cur = this.data.feedQueue[this.data.cursorIdx];
    if (!cur) return;
    if (cur.type !== 'public') {
      wx.showToast({ title: '自己的菜用评分表达喜好哦', icon: 'none' });
      return;
    }
    const next = !cur.liked;
    try {
      const res = await api.likePublicDish(cur.id, next);
      const patch = {};
      patch[`feedQueue[${this.data.cursorIdx}].liked`] = res.liked;
      patch[`feedQueue[${this.data.cursorIdx}].likeCount`] = res.likeCount;
      this.setData(patch);
      this.syncVisible();
      if (this.data.sheetItem && this.data.sheetItem.id === cur.id) {
        this.setData({ 'sheetItem.liked': res.liked, 'sheetItem.likeCount': res.likeCount });
      }
      api.logBehavior(res.liked ? 'like' : 'unlike', 'public', cur.id).catch(() => {});
    } catch (err) { api.handleErr(err); }
  },

  onNext() {
    const stack = this.selectComponent('#cardStack');
    if (stack) stack.advanceByButton();
  },

  async onWant() {
    const cur = this.data.feedQueue[this.data.cursorIdx];
    if (!cur) return;
    if (cur.type === 'public') {
      if (cur.savedDishId) {
        wx.showToast({ title: '已在你的菜单', icon: 'none' });
        return;
      }
      wx.showLoading({ title: '加入中' });
      try {
        const res = await api.savePublicDish(cur.id);
        wx.hideLoading();
        const patch = {};
        patch[`feedQueue[${this.data.cursorIdx}].savedDishId`] = res.dishId;
        this.setData(patch);
        this.syncVisible();
        if (this.data.sheetItem && this.data.sheetItem.id === cur.id) {
          this.setData({ 'sheetItem.saved': true, 'sheetItem.savedDishId': res.dishId, sheetShow: false });
        }
        wx.showToast({ title: res.duplicated ? '已在你的菜单' : '已加入想吃清单', icon: 'success' });
        api.logBehavior('save', 'public', cur.id).catch(() => {});
      } catch (err) { wx.hideLoading(); api.handleErr(err); }
    } else {
      // 自己的菜：不复制数据、不覆盖吃过记录，引导按现有状态操作
      wx.showToast({ title: cur.status === 'want' ? '已是想吃状态' : '自己的菜可在详情页调整状态', icon: 'none' });
    }
  },

  /* ==================== 旧入口保留 ==================== */

  goRandom() {
    wx.switchTab({ url: '/pages/random/random' });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' });
  },

  async onInitDemo() {
    wx.showLoading({ title: '初始化中' });
    try {
      await api.initDemo();
      wx.hideLoading();
      wx.showToast({ title: '已添加示例菜品', icon: 'success' });
      await this.checkInited();
      this.loadFeed(true);
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err);
    }
  },

  goTastePrefs() {
    wx.navigateTo({ url: '/pages/taste-prefs/taste-prefs' });
  },

  /** 页面级 tap：Kitty 弹跳（装饰组件自带 pointer-events:none） */
  onPageTap(e) {
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const kitty = this.selectComponent('#kitty');
    if (kitty) kitty.tryTapBounce(t.clientX, t.clientY);
  },

  onShareTimeline() {
    return { title: 'Yuki小厨房——不知道吃啥的时候抽一抽' };
  },

  onShareAppMessage() {
    return { title: 'Yuki小厨房｜不知道吃啥？帮你决定', path: '/pages/index/index' };
  }
}));
