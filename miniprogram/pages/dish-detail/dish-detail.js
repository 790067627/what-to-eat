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
    shareToken: '',      // 定向分享凭证模式
    publicId: '',        // 公开菜品快照模式
    viewMode: 'own',     // own | shared | public
    myPub: null,         // 本菜的公开发布记录（null=未发布）
    showPublishSheet: false,
    pubOpts: { includePrice: false, includeDescription: true, anonymous: false },
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
    // 三种访问模式：id=自己的菜；token=好友定向分享凭证；pid=公开菜品快照
    if (options.token) {
      this.setData({ shareToken: options.token, viewMode: 'shared' });
    } else if (options.pid) {
      this.setData({ publicId: options.pid, viewMode: 'public' });
    } else {
      this.setData({ id: options.id || '', viewMode: 'own' });
      // 自己的菜：预签发定向分享 token（onShareAppMessage 同步可用）
      if (options.id) {
        api.createShareToken(options.id).then(res => {
          this._shareToken = res.token;
        }).catch(() => { /* 分享降级为小程序首页 */ });
      }
    }
    // 获取导航栏高度
    const systemInfo = wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const navbarHeight = systemInfo.statusBarHeight + menuButtonInfo.height + (menuButtonInfo.top - systemInfo.statusBarHeight) * 2;
    this.setData({ navbarHeight });
  },

  onShow() {
    if (this.data.viewMode === 'shared' && this.data.shareToken) this.loadShared();
    else if (this.data.viewMode === 'public' && this.data.publicId) this.loadPublic();
    else if (this.data.id) this.loadDish();
  },

  /** 定向分享快照（token 凭证） */
  async loadShared() {
    try {
      const dish = await api.getSharedDish(this.data.shareToken);
      this.setData({ loading: false, dish, isShared: true, shareMode: 'token' });
    } catch (err) {
      api.handleErr(err, '分享链接已过期或无效');
      this.setData({ loading: false, shareExpired: true });
    }
  },

  /** 公开菜品快照 */
  async loadPublic() {
    try {
      const dish = await api.getPublicDish(this.data.publicId);
      this.setData({
        loading: false, dish, isShared: true, shareMode: 'public',
        publicLiked: !!dish.liked, publicLikeCount: dish.likeCount || 0,
        publicSaved: !!dish.savedDishId
      });
    } catch (err) {
      api.handleErr(err, '该公开菜品不可访问');
      this.setData({ loading: false, shareExpired: true });
    }
  },

  async loadDish() {
    try {
      const [dish, categories] = await Promise.all([
        api.getDish(this.data.id),
        api.listCategories()
      ]);
      const cat = categories.find(c => c._id === dish.categoryId);
      // getDish 已收紧为仅 owner 可读，这里读到的必定是自己的菜
      this.setData({
        loading: false,
        dish,
        categoryName: cat ? cat.name : '',
        priceYuan: fenToYuan(dish.price),
        statusText: STATUS_TEXT[dish.status] || '',
        lastEatenText: dish.lastEatenAt ? `上次吃：${timeAgo(dish.lastEatenAt)}（${formatDate(dish.lastEatenAt)}）` : '还没吃过这道菜',
        isShared: false,
        // 来源记录展示：灵感广场副本带 sourcePublicDishId + sourceAuthor
        sourceInfo: dish.sourcePublicDishId ? {
          publicDishId: dish.sourcePublicDishId,
          nickname: (dish.sourceAuthor && dish.sourceAuthor.nickname) || '原作者'
        } : null
      });
      this.loadMyPublication();
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

  /** 跳转来源原公开菜（可能已撤回 → 提示不可访问） */
  goSource() {
    const src = this.data.sourceInfo;
    if (!src) return;
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?pid=${src.publicDishId}` });
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
      return { title: 'Yuki小厨房', path: '/pages/index/index' };
    }
    // 定向分享必须携带服务端签发的 token（旧 ?id= 直读他人菜品已废除）
    if (this.data.viewMode === 'own' && this._shareToken) {
      return {
        title: `${dish.name} | Yuki小厨房`,
        path: `/pages/dish-detail/dish-detail?token=${this._shareToken}`,
        imageUrl: dish.coverImageUrl || dish.coverImage || ''
      };
    }
    return { title: 'Yuki小厨房', path: '/pages/index/index' };
  },

  /** 保存到我的菜单：公开快照走 savePublicDish，定向分享走 token 版 saveSharedDish */
  async onCopyToMyMenu() {
    if (!this.data.dish) return;
    wx.showLoading({ title: '保存中' });
    try {
      if (this.data.shareMode === 'public') {
        const res = await api.savePublicDish(this.data.publicId);
        wx.hideLoading();
        wx.showToast({ title: res.duplicated ? '已在你的菜单中' : '已加入想吃清单', icon: 'success' });
        this.setData({ publicSaved: true });
      } else {
        await api.saveSharedDish(this.data.shareToken);
        wx.hideLoading();
        wx.showToast({ title: '已保存到我的菜单', icon: 'success' });
      }
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err, '保存失败');
    }
  },

  /** 公开菜品点赞/取消 */
  async onToggleLike() {
    const next = !this.data.publicLiked;
    try {
      const res = await api.likePublicDish(this.data.publicId, next);
      this.setData({ publicLiked: res.liked, publicLikeCount: res.likeCount });
      api.logBehavior(res.liked ? 'like' : 'unlike', 'public', this.data.publicId).catch(() => {});
    } catch (err) { api.handleErr(err); }
  },

  /* ==================== 公开发布（灵感广场） ==================== */

  async loadMyPublication() {
    try {
      const list = await api.listMyPublications();
      const mine = (list || []).find(p => p.sourceDishId === this.data.id) || null;
      this.setData({ myPub: mine });
    } catch (e) { /* 静默 */ }
  },

  openPublishSheet() {
    this.setData({ showPublishSheet: true });
  },
  closePublishSheet() {
    this.setData({ showPublishSheet: false });
  },
  togglePubOpt(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`pubOpts.${key}`]: !this.data.pubOpts[key] });
  },

  /** 提交发布：用户已在弹窗确认公开范围（价格默认不公开、可选匿名） */
  async submitPublish() {
    wx.showLoading({ title: '提交中' });
    try {
      const res = await api.publishDish(this.data.id, this.data.pubOpts);
      wx.hideLoading();
      this.setData({ showPublishSheet: false });
      const msg = res.reviewStatus === 'approved' ? '已发布' : '已提交审核';
      wx.showToast({ title: msg, icon: 'success' });
      this.loadMyPublication();
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err, '发布失败');
    }
  },

  /** 重新送审（rejected 后编辑内容再发布） */
  async republish() {
    this.openPublishSheet();
  },

  async withdrawPub() {
    const res = await wx.showModal({
      title: '撤回公开',
      content: '撤回后该菜立即退出灵感广场，已保存到你菜单的他人副本不受影响。确定撤回？',
      confirmColor: themeManager.getJs().confirmColor
    });
    if (!res.confirm) return;
    try {
      await api.withdrawPublicDish({ publicDishId: this.data.myPub._id });
      wx.showToast({ title: '已撤回', icon: 'success' });
      this.loadMyPublication();
    } catch (err) { api.handleErr(err); }
  }
}));
