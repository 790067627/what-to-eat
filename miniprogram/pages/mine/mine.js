// pages/mine/mine.js - 我的：统计、分类管理、时间线、数据导出
const api = require('../../services/db');
const { getNavMetrics } = require('../../utils/util');
const { withTheme } = require('../../theme/theme-page');
const themeManager = require('../../theme/theme-manager');

Page(withTheme({
  data: {
    navHeight: 88,
    stats: { dishCount: 0, categoryCount: 0, eatCount: 0 },
    loading: true,
    // 用户资料
    avatarUrl: '',        // 头像展示地址（云存储 fileID，image 组件可直接渲染临时/云路径）
    avatarLoading: false, // 头像上传中标记（防重复点击）
    displayName: '我的小厨房',   // 展示名：公开昵称 > 默认
    publicMode: 'nickname',      // nickname | anonymous
    showPublicSheet: false,
    publicNicknameInput: '',
    // 吃历
    weekNames: ['日', '一', '二', '三', '四', '五', '六'],
    calTitle: '',
    calCells: [],
    calLoading: true,
    monthTotal: 0,
    categoryStats: [],
    isCurrentMonth: true,
    dayDetail: [],
    dayDetailTitle: '',
    // 导入
    showImport: false,
    importText: ''
  },

  onLoad() {
    this.setData({ navHeight: getNavMetrics().headerHeight });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    this.loadStats();
    this.loadProfile();
    const now = new Date();
    this._curY = now.getFullYear();
    this._curM = now.getMonth() + 1;
    if (!this._calY) { this._calY = this._curY; this._calM = this._curM; }
    this.loadMonth();
  },

  async loadStats() {
    try {
      const stats = await api.getStats();
      this.setData({ stats, loading: false });
    } catch (err) {
      api.handleErr(err);
      this.setData({ loading: false });
    }
  },

  // ==================== 用户头像 ====================

  /** 读取云端用户资料（按 openid 持久化）。失败静默用默认头像，不打扰用户 */
  async loadProfile() {
    try {
      const p = await api.getProfile();
      const fileID = (p && p.avatarFileID) || '';
      this._avatarFileID = fileID;   // 缓存当前云端头像，换头像时据此删旧图
      const publicMode = (p && p.publicMode) || 'nickname';
      this.setData({
        avatarUrl: fileID,
        publicMode,
        displayName: publicMode === 'anonymous' ? '匿名厨友' : ((p && p.publicNickname) || '我的小厨房'),
        publicNicknameInput: (p && p.publicNickname) || ''
      });
    } catch (err) {
      // 首次进入或集合未建：保持默认头像
      console.warn('[profile] 读取失败，使用默认头像', err);
    }
  },

  /** button open-type="chooseAvatar" 回调：用户主动选择头像
   *  流程：拿到本地临时路径 → 上传云存储 avatars/<openid 由云函数关联> → saveProfile 存 fileID
   *  → 删旧头像文件 → 本地即时回显临时路径（零等待） */
  async onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl;
    if (!tempPath) return;
    if (this.data.avatarLoading) return;

    const oldFileID = this._avatarFileID || '';
    // 先用临时路径即时回显，避免等待上传的空白
    this.setData({ avatarUrl: tempPath, avatarLoading: true });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const ext = (tempPath.match(/\.(\w+)$/) || [, 'png'])[1];
      const cloudPath = `avatars/${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath });
      const fileID = up.fileID;
      await api.saveProfile({ avatarFileID: fileID });
      this._avatarFileID = fileID;
      // 持久化成功后用云端 fileID 覆盖临时路径（重进小程序也能显示）
      this.setData({ avatarUrl: fileID, avatarLoading: false });
      wx.hideLoading();
      wx.showToast({ title: '头像已更新', icon: 'success' });
      // 清理上一张头像（延迟删，确保新图已渲染；失败忽略）
      if (oldFileID && oldFileID !== fileID) {
        wx.cloud.deleteFile({ fileList: [oldFileID] }).catch(() => {});
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ avatarLoading: false });
      // 回滚到已保存的云端头像（若有）
      this.setData({ avatarUrl: oldFileID || '' });
      api.handleErr(err, '头像保存失败');
    }
  },

  // ==================== 公开身份设置（灵感广场展示） ====================

  openPublicSheet() {
    this.setData({ showPublicSheet: true });
  },
  closePublicSheet() {
    this.setData({ showPublicSheet: false });
  },
  onPublicNicknameInput(e) {
    this.setData({ publicNicknameInput: e.detail.value });
  },
  async onPublicModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.publicMode) return;
    try {
      await api.saveProfile({ publicMode: mode });
      this.setData({
        publicMode: mode,
        displayName: mode === 'anonymous' ? '匿名厨友' : (this.data.publicNicknameInput || '我的小厨房')
      });
      wx.showToast({ title: '已更新', icon: 'success' });
    } catch (err) { api.handleErr(err); }
  },
  async savePublicNickname() {
    const name = (this.data.publicNicknameInput || '').trim();
    if (name.length > 32) return api.handleErr(new Error('昵称最长 32 字'));
    try {
      await api.saveProfile({ publicNickname: name });
      this.setData({
        showPublicSheet: false,
        displayName: this.data.publicMode === 'anonymous' ? '匿名厨友' : (name || '我的小厨房')
      });
      wx.showToast({ title: '公开昵称已保存', icon: 'success' });
    } catch (err) { api.handleErr(err); }
  },

  goCategoryManage() {
    wx.navigateTo({ url: '/pages/category-manage/category-manage' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' });
  },

  /** 外观设置：主题切换入口 */
  goAppearance() {
    wx.navigateTo({ url: '/pages/appearance/appearance' });
  },

  // 导出数据：生成 JSON，复制到剪贴板（个人使用足够，防迁移丢失）
  async onExport() {
    wx.showLoading({ title: '导出中', mask: true });
    try {
      const data = await api.exportData();
      const json = JSON.stringify(data, null, 2);
      wx.hideLoading();
      const action = await wx.showActionSheet({
        itemList: ['复制到剪贴板', '仅预览前几条']
      }).catch(() => null);
      if (!action) return;
      if (action.tapIndex === 0) {
        wx.setClipboardData({
          data: json,
          success: () => wx.showToast({ title: '已复制，记得粘到备忘录', icon: 'none' })
        });
      } else {
        console.log('[导出数据预览]', data);
        wx.showModal({
          title: '导出预览',
          content: `共 ${data.categories.length} 个分类、${data.dishes.length} 道菜、${data.eatLogs.length} 条记录。完整数据已打印到控制台。`,
          showCancel: false,
          confirmColor: themeManager.getJs().confirmColor
        });
      }
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err, '导出失败');
    }
  },

  // ==================== 吃历 ====================

  /** 加载某月吃历：日历格子 + 分类占比 */
  async loadMonth() {
    const y = this._calY, m = this._calM;
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    this.setData({ calLoading: true });
    try {
      const res = await api.listEatLogsByMonth(ym);
      this._monthLogs = res.logs || [];

      // eatenAt 为 UTC 时间戳，按北京时间取"日"
      const countByDay = {};
      this._monthLogs.forEach(l => {
        const d = new Date(new Date(l.eatenAt).getTime() + 8 * 3600000);
        countByDay[d.getUTCDate()] = (countByDay[d.getUTCDate()] || 0) + 1;
      });

      const firstTs = Date.parse(`${ym}-01T00:00:00+08:00`);
      // 星期按北京时间算：firstTs 是 UTC 前一天 16:00，直接 getUTCDay 会差一天
      const firstWeekday = new Date(firstTs + 8 * 3600000).getUTCDay();
      // 当月天数：下月第 0 天 = 本月最后一天（标准公式，勿用 +32 天推算）
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const today = new Date();
      const isTodayMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
      const todayDate = today.getDate();

      const cells = [];
      for (let i = 0; i < firstWeekday; i++) cells.push({ empty: true });
      for (let day = 1; day <= daysInMonth; day++) {
        const count = countByDay[day] || 0;
        cells.push({
          day,
          count,
          heat: count >= 3 ? 3 : count,
          isToday: isTodayMonth && day === todayDate
        });
      }

      const total = res.total || 0;
      const categoryStats = (res.categoryStats || []).map(s => ({
        ...s,
        percent: total ? Math.round(s.count * 100 / total) : 0
      }));

      this.setData({
        calCells: cells,
        calTitle: `${y}年${m}月`,
        categoryStats,
        monthTotal: total,
        isCurrentMonth: y === this._curY && m === this._curM,
        calLoading: false
      });
    } catch (err) {
      this.setData({ calLoading: false });
      api.handleErr(err, '吃历加载失败');
    }
  },

  prevMonth() {
    this._calM -= 1;
    if (this._calM < 1) { this._calM = 12; this._calY -= 1; }
    this.loadMonth();
  },

  nextMonth() {
    if (this.data.isCurrentMonth) return; // 禁止查未来月
    this._calM += 1;
    if (this._calM > 12) { this._calM = 1; this._calY += 1; }
    this.loadMonth();
  },

  /** 点某天：弹当天吃过的菜 */
  onDayTap(e) {
    const day = Number(e.currentTarget.dataset.day);
    const count = Number(e.currentTarget.dataset.count);
    if (!day || !count) return;
    const items = (this._monthLogs || []).filter(l => {
      const d = new Date(new Date(l.eatenAt).getTime() + 8 * 3600000);
      return d.getUTCDate() === day;
    });
    this.setData({
      dayDetail: items,
      dayDetailTitle: `${this._calM}月${day}日 · 吃了 ${items.length} 顿`
    });
  },

  closeDayDetail() {
    this.setData({ dayDetail: [] });
  },

  // ==================== 导入数据 ====================

  openImport() {
    this.setData({ showImport: true, importText: '' });
  },

  closeImport() {
    this.setData({ showImport: false });
  },

  noop() {},

  onImportInput(e) {
    this.setData({ importText: e.detail.value });
  },

  async onImportConfirm() {
    const text = (this.data.importText || '').trim();
    if (!text) {
      wx.showToast({ title: '先粘贴导出的 JSON', icon: 'none' });
      return;
    }
    if (text.length > 2 * 1024 * 1024) {
      wx.showToast({ title: '内容过大，请分批导入', icon: 'none' });
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      wx.showToast({ title: 'JSON 格式不合法', icon: 'none' });
      return;
    }
    const cats = Array.isArray(data.categories) ? data.categories : [];
    const dishes = Array.isArray(data.dishes) ? data.dishes : [];
    const logs = Array.isArray(data.eatLogs) ? data.eatLogs : [];
    const total = cats.length + dishes.length + logs.length;
    if (!total) {
      wx.showToast({ title: '没有可导入的数据', icon: 'none' });
      return;
    }
    if (total > 1000) {
      wx.showToast({ title: '单次最多导入 1000 条', icon: 'none' });
      return;
    }
    const confirm = await wx.showModal({
      title: '确认导入',
      content: `将合并导入 ${cats.length} 个分类、${dishes.length} 道菜、${logs.length} 条记录；已存在的自动跳过，不会覆盖现有数据。`,
      confirmColor: themeManager.getJs().confirmColor
    }).catch(() => null);
    if (!confirm || !confirm.confirm) return;

    wx.showLoading({ title: '导入中', mask: true });
    try {
      const stat = await api.importData(data);
      wx.hideLoading();
      this.setData({ showImport: false });
      wx.showToast({
        title: `新增 ${stat.categories} 分类 ${stat.dishes} 菜 ${stat.eatLogs} 记录，跳过 ${stat.skipped}`,
        icon: 'none',
        duration: 3000
      });
      this.loadStats();
      this.loadMonth();
    } catch (err) {
      wx.hideLoading();
      api.handleErr(err, '导入失败');
    }
  },

  onAbout() {
    wx.showModal({
      title: '关于「Yuki小厨房」',
      content: '个人点菜灵感小工具：不知道吃啥时来抽一抽，随手维护自己的菜品库。数据存于微信云开发，仅自己可见。',
      showCancel: false,
      confirmColor: themeManager.getJs().confirmColor
    });
  }
}));
