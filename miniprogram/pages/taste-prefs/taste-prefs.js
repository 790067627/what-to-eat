// pages/taste-prefs/taste-prefs.js - 口味偏好设置（推荐冷启动 + 忌口）
// 数据落 profiles.tastePrefs / avoidTags（服务端 recommend.saveTastePrefs），不重建用户表。
const api = require('../../services/db');
const { getNavMetrics } = require('../../utils/util');
const { withTheme } = require('../../theme/theme-page');

const DIMS = [
  { key: 'spicy', label: '香辣', hint: '无辣不欢 ←→ 一点不辣' },
  { key: 'light', label: '清淡', hint: '清淡养生 ←→ 重油重味' },
  { key: 'carb', label: '面食主食', hint: '面食控 ←→ 少主食' },
  { key: 'sweet', label: '甜口', hint: '嗜甜 ←→ 不碰甜' },
  { key: 'rich', label: '浓郁下饭', hint: '浓郁下饭 ←→ 清爽简单' }
];
const AVOID_PRESETS = ['辣', '甜', '香菜', '葱', '蒜', '海鲜', '牛肉', '油炸'];

Page(withTheme({
  data: {
    navHeight: 88,
    dims: DIMS,
    avoidPresets: AVOID_PRESETS,
    prefs: {},          // { spicy: 0~100 ... }（slider 用 0-100 整数，提交时 /100）
    avoidTags: [],
    saving: false
  },

  onLoad() {
    this.setData({ navHeight: getNavMetrics().headerHeight });
    const prefs = {};
    DIMS.forEach(d => { prefs[d.key] = 50; });   // 默认中位（不臆测口味）
    this.setData({ prefs });
    this.loadPrefs();
  },

  async loadPrefs() {
    try {
      const res = await api.getTastePrefs();
      const prefs = Object.assign({}, this.data.prefs);
      if (res.tastePrefs) {
        DIMS.forEach(d => {
          const v = Number(res.tastePrefs[d.key]);
          if (isFinite(v)) prefs[d.key] = Math.round(v * 100);
        });
      }
      this.setData({ prefs, avoidTags: res.avoidTags || [] });
    } catch (e) { /* 首次进入用默认 */ }
  },

  onSlider(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`prefs.${key}`]: e.detail.value });
  },

  toggleAvoid(e) {
    const tag = e.currentTarget.dataset.tag;
    const tags = this.data.avoidTags.slice();
    const i = tags.indexOf(tag);
    if (i >= 0) tags.splice(i, 1); else tags.push(tag);
    this.setData({ avoidTags: tags });
  },

  async onSave() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    const tastePrefs = {};
    DIMS.forEach(d => { tastePrefs[d.key] = (this.data.prefs[d.key] || 0) / 100; });
    try {
      await api.saveTastePrefs(tastePrefs, this.data.avoidTags);
      wx.showToast({ title: '已保存，推荐将按此更新', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (err) {
      api.handleErr(err, '保存失败');
    } finally {
      this.setData({ saving: false });
    }
  }
}));
