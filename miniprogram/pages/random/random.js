// pages/random/random.js - 随机抽卡：核心决策页（v2 游戏级抽卡揭晓弹层）
// 动画方案经 experiments/compat-check 真机验证（iPhone 12 Pro / iOS 27.3 / 基础库 3.18.0）：
//   3D 翻牌逐帧 setData 60fps 掉0、粒子 canvas 节点 raf 满帧、setData 单次 0.33ms。
// 关键约束：
//   1) 小程序逻辑层无全局 requestAnimationFrame / wx.requestAnimationFrame，
//      统一用 canvas(type=2d) 节点 raf，setTimeout(16) 兜底；
//   2) preserve-3d 子树禁止跑 CSS transform 动画（合成层会压平 3D），
//      卡牌 transform 全部由 JS 逐帧写入 cardTf。
//   3) 粒子颜色不写死：每次生成时从 Theme Manager 读取当前主题 JS Token。
const api = require('../../services/db');
const { getNavMetrics } = require('../../utils/util');
const { fenToYuan, timeAgo } = require('../../utils/util');
const { withTheme } = require('../../theme/theme-page');
const themeManager = require('../../theme/theme-manager');

// 缓动
const EASE = {
  outBack: k => { const c = 2.0; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
  outCubic: k => 1 - Math.pow(1 - k, 3),
  inCubic: k => k * k * k
};
const CHARGE_MIN = 650;   // 最短蓄力 ms（卡背进场 500 + 嗡鸣 150）
const FLIP_MS = 450;      // 翻牌
const LAND_MS = 420;      // 落位回弹
const FLY_MS = 240;       // 换一道飞出
const SWAP_MS = 420;      // 换一道翻入

Page(withTheme({
  data: {
    navHeight: 88,
    // 筛选条件
    excludeDays: 3,          // 排除最近 N 天吃过的（0 = 不排除）
    onlyWant: false,         // 只从"想吃"里抽
    weightByRating: true,    // 高分优先：按评分加权抽取
    // 抽卡状态机：idle | charging | bursting | revealing | revealed | switching | closing
    phase: 'idle',
    result: null,            // { dish(含priceYuan), categoryName, lastEatenAt, poolSize }
    lastEatenText: '',
    errorMessage: '',
    categories: [],
    categoryNames: ['不限'],  // picker 用
    categoryFilter: '',      // 限定分类
    categoryFilterName: '',
    // ---- 弹层视图状态 ----
    ovShow: false,           // 弹层是否挂载
    ovIn: false,             // 弹层渐显（挂载后下一帧置 true 触发 transition）
    ovReady: false,          // 操作按钮/关闭钮可用
    ovTop: 0,                // 上占位 = 导航实际底边 T（px，实测）
    ovBottom: 0,             // 下占位 = 窗口高 - TabBar 凸起顶边 B（px，实测）
    // ---- 顶层面板（与抽卡弹层互斥，同一时刻只有一个可交互） ----
    shareMounted: false,     // 抽屉是否挂载（退出动画完成后才卸载）
    shareOpen: false,        // 抽屉展开态（驱动滑入/滑出过渡）
    posterOpen: false,       // 全屏海报预览
    posterUrl: '',
    pfTop: 96,               // 海报头行 padding-top（胶囊底边实测值，px）
    zoneClass: '',           // card-zone 状态类：enter-back/flipped/flyout/swapin
    cardTf: 'rotateY(180deg)', // 卡牌内联 transform（JS 逐帧驱动；初始背面朝上防闪面）
    glowOn: false,           // 蓄力光晕
    flashGo: false,          // 中心闪光
    zoomPunch: false         // 空间缩放脉冲
  },

  _timers: [],
  _rafCard: null,
  _rafFx: null,
  _alive: false,
  _humTimer: null,
  _pending: null,
  _pendingErr: null,
  _chargeStart: 0,
  _particles: [],
  _rings: [],
  _ctx: null,
  _cardCenter: null,

  onLoad() {
    this.setData({ navHeight: getNavMetrics().headerHeight });
  },

  onReady() {
    this.initCanvas();
    this.measureLayout();
  },

  /** 实测 T（导航底边）与 B（TabBar 含凸起的顶边），写入上下占位高度。
   *  H = B - T 的可用区由 .ov-body flex:1 承担，内容在其中居中；无硬编码 top/margin。 */
  measureLayout() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const winH = win.windowHeight;
    // 海报头行顶边 = 原生胶囊底边 + 8px（实测，避免与胶囊重叠）
    try {
      const mb = wx.getMenuButtonBoundingClientRect();
      if (mb && mb.bottom) this.setData({ pfTop: mb.bottom + 8 });
    } catch (e) { /* 忽略 */ }
    // T：导航组件根节点底边（组件实例选择器）
    const nav = this.selectComponent('#immersiveNav');
    const navQ = nav ? nav.createSelectorQuery().select('.imm-nav') : null;
    const applyB = (B) => {
      this.setData({ ovTop: this._navBottom || 0, ovBottom: Math.max(winH - B, 0) });
    };
    // B：自定义 TabBar 凸起顶边（组件实例选择器）
    const tb = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tb) {
      tb.createSelectorQuery().select('.center-btn').boundingClientRect(r => {
        const B = r && r.top ? r.top : winH - 56;
        applyB(B);
      }).exec();
    } else {
      applyB(winH - 56);
    }
    if (navQ) {
      navQ.boundingClientRect(r => {
        if (r && r.bottom) { this._navBottom = r.bottom; this.setData({ ovTop: r.bottom }); }
      }).exec();
    } else {
      this._navBottom = this.data.navHeight;
      this.setData({ ovTop: this.data.navHeight });
    }
  },

  onShow() {
    const tb = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tb) tb.setData({ selected: 2 });
    // 系统返回/切后台回流：面板若残留则立即复位（不走动画），恢复交互状态
    if (this.data.shareMounted || this.data.posterOpen) {
      this._shareBusy = false;
      this._keepTabHidden = false;
      this.setData({ shareMounted: false, shareOpen: false, posterOpen: false });
    }
    this.syncTabBar();
    // 恢复"高分优先"上次选择
    try {
      const v = wx.getStorageSync('random_weight');
      if (v !== '' && v !== undefined) this.setData({ weightByRating: !!v });
    } catch (e) { /* 忽略 */ }
    this.loadNames();
  },

  /** 屏幕尺寸变化（旋转/分屏）：重测 T/B */
  onResize() { this.measureLayout(); },

  onHide() {
    // 动画中途切走：彻底复位，避免 phase 卡在 charging/switching 导致回来后无法再抽
    this.stopAll();
    this.setData({
      phase: 'idle', ovShow: false, ovIn: false, ovReady: false,
      zoneClass: '', cardTf: 'rotateY(180deg)', glowOn: false,
      flashGo: false, zoomPunch: false, result: null
    });
  },
  onUnload() { this.stopAll(); },

  /** 资源清理：动画帧、定时器、粒子（页面卸载/隐藏/弹层关闭统一走这里） */
  stopAll() {
    this._alive = false;
    this.caf(this._rafCard); this._rafCard = null;
    this.caf(this._rafFx); this._rafFx = null;
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
    if (this._humTimer) { clearInterval(this._humTimer); this._humTimer = null; }
    this._particles = []; this._rings = [];
    if (this._ctx && this._cw) { try { this._ctx.clearRect(0, 0, this._cw, this._ch); } catch (e) { /* 忽略 */ } }
  },

  T(fn, ms) { this._timers.push(setTimeout(fn, ms)); },

  /** 帧调度器：canvas 节点 raf 优先，setTimeout(16) 兜底（逻辑层无全局 rAF） */
  raf(cb) {
    if (this._cv && typeof this._cv.requestAnimationFrame === 'function') {
      return { kind: 'c', id: this._cv.requestAnimationFrame(cb) };
    }
    return { kind: 't', id: setTimeout(() => cb(Date.now()), 16) };
  },
  caf(h) {
    if (!h) return;
    if (h.kind === 'c') { if (this._cv && this._cv.cancelAnimationFrame) this._cv.cancelAnimationFrame(h.id); }
    else clearTimeout(h.id);
  },

  /** 预加载菜名列表（空池校验用） */
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

  // ==================== 抽卡主流程 ====================

  /** 服务端随机抽取。
   *  注意：db.js 的 randomPick(filters) 会自行包一层 { filters }，
   *  这里必须传扁平对象，否则云函数收到 filters.filters 导致筛选失效 */
  _pick() {
    return api.randomPick({
      excludeRecentDays: this.data.excludeDays,
      onlyStatus: this.data.onlyWant ? 'want' : '',
      categoryId: this.data.categoryFilter,
      weightByRating: this.data.weightByRating
    });
  },

  /** 换一个专用：排除当前菜品（云函数无 exclude 参数，客户端重抽一次兜底） */
  async _pickExcluding(dishId) {
    let res = await this._pick();
    if (dishId && res.dish && res.dish._id === dishId && (res.poolSize || 0) > 1) {
      res = await this._pick();  // 重抽一次；仍相同则接受（池子极小时无解）
    }
    return res;
  },

  async onRoll() {
    if (this.data.phase !== 'idle') return;   // 防连点
    const names = this._names || [];
    if (!names.length) {
      this.setData({ errorMessage: '菜品库是空的，先去添加几道菜吧' });
      return;
    }
    this.setData({
      phase: 'charging', errorMessage: '', result: null,
      ovShow: true, ovIn: false, ovReady: false, flashGo: false, zoomPunch: false,
      zoneClass: 'enter-back', glowOn: true, cardTf: 'rotateY(180deg)'
    });
    this._alive = true;
    this._pending = null; this._pendingErr = null; this._chargeStart = Date.now();

    // 弹层挂载后初始化 canvas（wx:if 需要等渲染完成）并触发渐显；同时重测 T/B
    this.T(() => { this.initCanvas(); this.measureLayout(); this.setData({ ovIn: true }); }, 60);

    // 卡背悬浮进场 → 蓄力嗡鸣
    this.animBackIn(() => {
      this.measureCard();
      if (this.data.phase === 'charging') this.startHum();
    });
    this.T(() => this.spawnGather(), 120);
    if (this._humTimer) clearInterval(this._humTimer);
    this._humTimer = setInterval(() => {
      if (this.data.phase === 'charging') this.spawnGather();
      else { clearInterval(this._humTimer); this._humTimer = null; }
    }, 420);

    // 并发请求服务端结果（结果先于动画确定，动画只是表演）
    this._pick().then(res => { this._pending = res; this.tryReveal(); })
      .catch(err => { this._pendingErr = err; this.tryReveal(); });
    this.T(() => { if (this.data.phase === 'charging') this.tryReveal(); }, CHARGE_MIN);
  },

  tryReveal() {
    if (this.data.phase !== 'charging') return;
    if (this._pendingErr) {   // 失败恢复：收弹层回 idle
      const err = this._pendingErr;
      this.closeOverlay(() => {
        this.setData({
          phase: 'idle',
          errorMessage: (err.message && err.message.includes('没有符合条件'))
            ? '没有符合条件的菜品，放宽筛选试试' : '网络异常，再抽一次试试'
        });
      });
      return;
    }
    if (!this._pending || Date.now() - this._chargeStart < CHARGE_MIN) return; // 结果未回或蓄力未满→继续等待
    this.reveal(this._pending);
  },

  reveal(res) {
    this.setData({ phase: 'bursting' });
    if (this._humTimer) { clearInterval(this._humTimer); this._humTimer = null; }
    this.applyResult(res);
    this.setData({ glowOn: false, flashGo: true, zoomPunch: true });
    this.spawnBurst();
    wx.vibrateShort({ type: 'medium', fail: () => {} });
    this.animFlip(() => {
      this.setData({ phase: 'revealing', zoneClass: 'flipped' });
      this.animLand(() => {
        this.setData({ phase: 'revealed', ovReady: true, zoomPunch: false });
      });
    });
  },

  applyResult(res) {
    const dish = res.dish;
    this.setData({
      result: {
        ...res,
        // 价格为 0/未填时不显示 ¥0：priceYuan 置空串，wxml 的 wx:if 自动隐藏标签
        dish: { ...dish, priceYuan: Number(dish.price) > 0 ? fenToYuan(dish.price) : '' }
      },
      lastEatenText: res.lastEatenAt ? `上次吃是 ${timeAgo(res.lastEatenAt)}` : '还没吃过，尝个鲜'
    });
  },

  /** 不想吃：侧翻飞出 → 短程翻入（不重复蓄力，排除当前菜品） */
  onReject() {
    if (this.data.phase !== 'revealed') return;  // 防连点
    const cur = this.data.result;
    this.setData({ phase: 'switching', ovReady: false, zoneClass: 'flipped flyout' });
    this.animFlyOut(() => {
      this._pickExcluding(cur ? cur.dish._id : '').then(res => {
        this.applyResult(res);
        this.setData({ zoneClass: 'flipped swapin', flashGo: false });
        this.T(() => this.setData({ flashGo: true }), 30);
        this.spawnPop();
        wx.vibrateShort({ type: 'light', fail: () => {} });
        this.animSwapIn(() => {
          this.setData({ phase: 'revealed', ovReady: true, zoneClass: 'flipped' });
        });
      }).catch(() => {   // 换菜失败：原卡翻回，保留当前结果
        this.setData({ zoneClass: 'flipped swapin' });
        this.animSwapIn(() => {
          this.setData({ phase: 'revealed', ovReady: true, zoneClass: 'flipped' });
          wx.showToast({ title: '网络异常，没换成', icon: 'none' });
        });
      });
    });
  },

  /** 就它了：记一笔吃过，状态自动升级"常吃" */
  async onAccept() {
    const { result } = this.data;
    if (!result || this.data.phase !== 'revealed') return;
    wx.showLoading({ title: '记录中' });
    try {
      await api.logEat(result.dish._id);
      wx.hideLoading();
      wx.showToast({ title: `就吃${result.dish.name}！`, icon: 'success' });
      this.closeOverlay(() => {
        this.setData({ phase: 'idle', result: null });
        this.loadNames(); // 刷新菜名池
      });
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err);
    }
  },

  /** 生成分享海报（旧入口保留兼容：直接进全屏预览） */
  onPoster() {
    if (this.data.phase !== 'revealed') return;
    this.openPosterPreview();
  },

  /** 卡片右上分享图标 → 打开 Bottom Sheet（挂载→下一帧展开，触发滑入过渡） */
  onShareTap() {
    if (this.data.phase !== 'revealed' || this._shareBusy) return;
    this._shareBusy = true;
    this.setData({ shareMounted: true });
    this.syncTabBar();
    // 下一帧再置 open：让 translateY(110%) 先落位，过渡才生效
    this.T(() => {
      this.setData({ shareOpen: true });
      this.syncTabBar();   // 与滑入同帧：TabBar 同步淡出
      this.T(() => { this._shareBusy = false; }, 300);
    }, 30);
  },

  /** 关闭抽屉：滑出 220ms 完成后卸载；取消/遮罩/系统返回统一走这里 */
  closeShare() {
    if (!this.data.shareOpen || this._shareBusy) return;
    this._shareBusy = true;
    this.setData({ shareOpen: false });
    this.syncTabBar();   // 与滑出同帧：TabBar 随遮罩同步淡入，无瞬间跳变
    this.T(() => {
      this.setData({ shareMounted: false });
      this._shareBusy = false;
    }, 240);
  },

  /** TabBar 可见性统一同步（常驻 opacity 过渡，不卸载不重排）：
   *  隐藏条件看展开态 shareOpen——关闭起点即淡入，与抽屉滑出同帧同步 */
  syncTabBar() {
    const hide = !!(this.data.shareOpen || this.data.posterOpen || this._keepTabHidden);
    const tb = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tb && tb.data.hidden !== hide) tb.setData({ hidden: hide });
  },

  /** Sheet：生成分享海报 → 全屏预览（静默生成，不叠组件自带弹窗）；
   *  抽屉滑出与海报打开衔接期间 TabBar 保持隐藏，避免闪一下 */
  onSharePoster() {
    this._keepTabHidden = true;
    this.setData({ shareOpen: false });
    this.T(() => {
      this.setData({ shareMounted: false });
      this.syncTabBar();
    }, 240);
    this.openPosterPreview().then(() => { this._keepTabHidden = false; });
  },

  async openPosterPreview() {
    const poster = this.selectComponent('#poster');
    if (!poster) return;
    const url = await poster.generateSilent();
    if (!url) {
      this._keepTabHidden = false;
      this.syncTabBar();
      wx.showToast({ title: '海报生成失败', icon: 'none' });
      return;
    }
    this.setData({ posterUrl: url, posterOpen: true });
    this.syncTabBar();
  },

  closePoster() {
    // 恢复原抽卡结果，菜品不变（result 未动，仅关预览层）
    this.setData({ posterOpen: false });
    this.syncTabBar();
  },

  onSavePoster() {
    const poster = this.selectComponent('#poster');
    if (poster) poster.saveToAlbum();
  },

  /** 微信转发（结果态分享当前菜品） */
  onShareAppMessage() {
    const { result } = this.data;
    if (result && result.dish) {
      return {
        title: `${result.dish.name} | Yuki小厨房`,
        path: `/pages/dish-detail/dish-detail?id=${result.dish._id}`
      };
    }
    return { title: 'Yuki小厨房｜不知道吃啥？帮你决定', path: '/pages/index/index' };
  },

  /** 关闭弹层（右上角 ✕） */
  onCloseOverlay() {
    if (['revealed', 'revealing', 'bursting', 'switching'].indexOf(this.data.phase) < 0) return;
    this.closeOverlay(() => this.setData({ phase: 'idle', result: null }));
  },

  closeOverlay(done) {
    this.setData({ phase: 'closing', ovReady: false, ovIn: false });
    this.T(() => {
      this.stopAll();
      this.setData({
        ovShow: false, zoneClass: '', cardTf: 'rotateY(180deg)', glowOn: false,
        flashGo: false, zoomPunch: false
      });
      if (done) done();
    }, 320);
  },

  /** 看详情 */
  goDetail() {
    const { result } = this.data;
    if (!result || this.data.phase !== 'revealed') return;
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${result.dish._id}` });
  },

  /** 去加菜 */
  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' });
  },

  /** 弹层内阻断滚动穿透 */
  noop() {},

  // ==================== 卡牌 tween（JS 逐帧写 cardTf，保 3D） ====================

  tween(dur, fn, done) {
    this._alive = true;
    this.caf(this._rafCard);
    const t0 = Date.now();
    const step = () => {
      if (!this._alive) return;
      const k = Math.min((Date.now() - t0) / dur, 1);
      fn(k);
      if (k < 1) this._rafCard = this.raf(step);
      else { this._rafCard = null; if (done) done(); }
    };
    this._rafCard = this.raf(step);
  },

  animBackIn(done) {
    this.tween(500, k => {
      const e = EASE.outBack(k);
      this.setData({
        cardTf: `translateY(${90 * (1 - e)}px) scale(${0.6 + 0.4 * e}) rotateY(180deg) rotateX(${14 * (1 - e)}deg)`
      });
    }, done);
  },

  /** 蓄力嗡鸣：rotateY(180) 附近正弦微颤 */
  startHum() {
    this.caf(this._rafCard);
    const t0 = Date.now();
    const loop = () => {
      if (!this._alive || this.data.phase !== 'charging') return;
      const t = (Date.now() - t0) / 1000;
      const w = Math.sin(t * 7);
      this.setData({ cardTf: `translateY(${-3.5 - w * 3.5}px) scale(${1.009 + w * 0.009}) rotateY(${180 + w * 4}deg)` });
      this._rafCard = this.raf(loop);
    };
    this._rafCard = this.raf(loop);
  },

  animFlip(done) {
    this.tween(FLIP_MS, k => {
      const e = EASE.outBack(k);
      const ry = 180 * (1 - e);
      const sc = 1.06 + 0.07 * Math.sin(Math.min(k, 1) * Math.PI);
      this.setData({ cardTf: `scale(${sc}) rotateY(${ry}deg)` });
    }, done);
  },

  animLand(done) {
    this.tween(LAND_MS, k => {
      let sc, ty;
      if (k < 0.6) { const e = k / 0.6; sc = 1.05 - 0.065 * EASE.outCubic(e); ty = -6 + 8 * EASE.outCubic(e); }
      else { const e = (k - 0.6) / 0.4; sc = 0.985 + 0.015 * e; ty = 2 - 2 * e; }
      this.setData({ cardTf: `translateY(${ty}px) scale(${sc}) rotateY(0deg)` });
    }, () => { this.setData({ cardTf: '' }); if (done) done(); });
  },

  animFlyOut(done) {
    this.tween(FLY_MS, k => {
      const e = EASE.inCubic(k);
      this.setData({ cardTf: `translateX(${135 * e}%) rotateY(${-105 * e}deg) rotate(${9 * e}deg) scale(${1 - 0.28 * e})` });
    }, done);
  },

  animSwapIn(done) {
    this.tween(SWAP_MS, k => {
      const e = EASE.outBack(k);
      this.setData({ cardTf: `translateX(${-115 * (1 - e)}%) rotateY(${150 * (1 - e)}deg) scale(${0.72 + 0.28 * e})` });
    }, () => { this.setData({ cardTf: '' }); if (done) done(); });
  },

  // ==================== Canvas 2D 粒子（星芒+冲击波+能量汇聚） ====================

  initCanvas() {
    this.createSelectorQuery().select('#fx').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) return;
      const cv = res[0].node, ctx = cv.getContext('2d');
      const dpr = Math.min((wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2, 3);
      cv.width = res[0].width * dpr;
      cv.height = res[0].height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._cv = cv; this._ctx = ctx; this._cw = res[0].width; this._ch = res[0].height;
    });
  },

  /** 量一次卡片中心（viewport 坐标 = 全屏 fixed canvas 的 CSS 坐标） */
  measureCard() {
    this.createSelectorQuery().select('.card-zone').boundingClientRect(r => {
      if (r && r.width) this._cardCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }).exec();
  },

  cardCenter() {
    return this._cardCenter || { x: (this._cw || 375) / 2, y: (this._ch || 667) * 0.4 };
  },

  /** 蓄力：能量粒子向卡心汇聚 */
  spawnGather() {
    if (!this._ctx) return;
    const c = this.cardCenter();
    const pal = themeManager.getJs().particles;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, d = 160 + Math.random() * 130;
      this._particles.push({
        gather: true, x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d,
        tx: c.x, ty: c.y, t: 0, dur: 26 + Math.random() * 20,
        s: 1.2 + Math.random() * 2.2, color: Math.random() < 0.7 ? pal.gather[0] : pal.gather[1]
      });
    }
    this.kickFx();
  },

  /** 揭晓爆发：星芒粒子 + 双冲击波环 */
  spawnBurst() {
    if (!this._ctx) return;
    const c = this.cardCenter();
    const pal = themeManager.getJs().particles;
    const colors = pal.burst;
    for (let i = 0; i < 52; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2.4 + Math.random() * 7;
      this._particles.push({
        x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.4,
        s: 1.5 + Math.random() * 3, life: 1, decay: 0.013 + Math.random() * 0.017,
        color: colors[(Math.random() * colors.length) | 0], star: Math.random() < 0.6,
        rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.26
      });
    }
    this._rings.push({ x: c.x, y: c.y, r: 10, max: 230, life: 1, decay: 0.026, w: 5, color: pal.rings[0] });
    this._rings.push({ x: c.x, y: c.y, r: 4, max: 150, life: 1, decay: 0.04, w: 3, color: pal.rings[1] });
    this.kickFx();
  },

  /** 换一道轻量点缀 */
  spawnPop() {
    if (!this._ctx) return;
    const c = this.cardCenter();
    const colors = themeManager.getJs().particles.pop;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 3;
      this._particles.push({
        x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        s: 1.2 + Math.random() * 2, life: 1, decay: 0.022 + Math.random() * 0.02,
        color: colors[(Math.random() * colors.length) | 0], star: Math.random() < 0.5,
        rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.2
      });
    }
    this.kickFx();
  },

  kickFx() {
    if (this._rafFx || !this._ctx) return;
    this._rafFx = this.raf(() => this.tickFx());
  },

  tickFx() {
    this._rafFx = null;
    const ctx = this._ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._cw, this._ch);
    let alive = false;
    this._particles = this._particles.filter(p => {
      if (p.gather) {   // 汇聚粒子：缓动移向卡心
        p.t += 1;
        const k = Math.min(p.t / p.dur, 1), e = k * k * (3 - 2 * k);
        const x = p.x + (p.tx - p.x) * e, y = p.y + (p.ty - p.y) * e;
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = 'rgba(' + p.color + ',1)';
        ctx.shadowColor = 'rgba(' + p.color + ',.9)'; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(x, y, p.s * (1 - k * 0.5), 0, 7); ctx.fill();
        ctx.restore();
        if (k < 1) alive = true;
        return k < 1;
      }
      p.life -= p.decay;
      if (p.life <= 0) return false;
      alive = true;
      p.x += p.vx; p.y += p.vy; p.vy += 0.07; p.vx *= 0.985; p.vy *= 0.985; p.rot += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 6 * p.life;
      if (p.star) {
        const s = p.s * 1.7;
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.18, -s * 0.18, s, 0);
        ctx.quadraticCurveTo(s * 0.18, s * 0.18, 0, s);
        ctx.quadraticCurveTo(-s * 0.18, s * 0.18, -s, 0);
        ctx.quadraticCurveTo(-s * 0.18, -s * 0.18, 0, -s);
        ctx.fill();
      } else { ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 7); ctx.fill(); }
      ctx.restore();
      return true;
    });
    this._rings = this._rings.filter(r => {
      r.life -= r.decay;
      if (r.life <= 0) return false;
      alive = true;
      r.r += (r.max - r.r) * 0.09;
      ctx.save();
      ctx.globalAlpha = r.life * 0.8;
      ctx.strokeStyle = 'rgba(' + r.color + ',1)';
      ctx.lineWidth = r.w * r.life;
      ctx.shadowColor = 'rgba(' + r.color + ',.9)'; ctx.shadowBlur = 14 * r.life;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.stroke();
      ctx.restore();
      return true;
    });
    if (alive) {
      this._rafFx = this.raf(() => this.tickFx());
    } else {
      ctx.clearRect(0, 0, this._cw, this._ch);   // 特效播完即静止释放
    }
  }
}));
