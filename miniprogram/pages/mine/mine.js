// pages/mine/mine.js - 我的：统计、分类管理、时间线、数据导出
const api = require('../../services/db');
const { getNavMetrics } = require('../../utils/util');

Page({
  data: {
    navHeight: 88,
    stats: { dishCount: 0, categoryCount: 0, eatCount: 0 },
    loading: true,
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

  goCategoryManage() {
    wx.navigateTo({ url: '/pages/category-manage/category-manage' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' });
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
          confirmColor: '#FF8FB8'
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
      const firstWeekday = new Date(firstTs).getUTCDay();
      const daysInMonth = new Date(firstTs + 86400000 * 32).getUTCDate();
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
      confirmColor: '#FF8FB8'
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
      confirmColor: '#FF8FB8'
    });
  }
});
