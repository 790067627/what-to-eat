// pages/history/history.js - 吃过时间线（分页加载）
const api = require('../../services/db');
const { formatDate } = require('../../utils/util');

Page({
  data: {
    loading: true,
    logs: [],
    page: 1,
    hasMore: true,
    total: 0
  },

  onLoad() {
    this.load(true);
  },

  async load(refresh = false) {
    if (this.data.loading && !refresh) return;
    const page = refresh ? 1 : this.data.page;
    this.setData({ loading: true });
    try {
      const res = await api.listEatLogs(page, 20);
      const decorated = res.list.map(l => ({
        ...l,
        dateText: formatDate(l.eatenAt)
      }));
      this.setData({
        logs: refresh ? decorated : this.data.logs.concat(decorated),
        page: page + 1,
        hasMore: page * 20 < res.total,
        total: res.total,
        loading: false
      });
    } catch (err) {
      api.handleErr(err);
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.load(false);
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  goDish(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${id}` });
  }
});
