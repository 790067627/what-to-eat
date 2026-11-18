// utils/util.js - 通用工具函数

/** 日期格式化：Date -> 'YYYY-MM-DD' */
function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 相对时间描述：'今天' / '3天前' / '2026-10-01' */
function timeAgo(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 30) return `${diffDays}天前`;
  return formatDate(d);
}

/** 价格：分 -> '48' / '48.5'（内部统一用分存储） */
function fenToYuan(fen) {
  if (fen === null || fen === undefined || fen === '') return '';
  const n = Number(fen);
  if (isNaN(n)) return '';
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2).replace(/\.?0+$/, '');
}

/** 价格：元字符串 -> 分 */
function yuanToFen(yuan) {
  const n = parseFloat(yuan);
  if (isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** 数组洗牌（Fisher-Yates） */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 轻提示 */
function toast(title, icon = 'none') {
  wx.showToast({ title, icon, duration: 1800 });
}

module.exports = { formatDate, timeAgo, fenToYuan, yuanToFen, shuffle, toast };
