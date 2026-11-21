// services/db.js
const LEAF_ICON = '\uE000';
const DEFAULT_CATEGORY_ICON = '\uF312';

function normalizeCategoryIcon(icon) {
  // Bootstrap Icons 的旧叶子码位 U+F90C 在 Unicode 中等同于「奈」U+5948。
  if (icon === '\uF90C' || icon === '\u5948') return LEAF_ICON;
  if (typeof icon === 'string' && icon.length === 1) {
    const cp = icon.charCodeAt(0);
    if (cp >= 0xE000 && cp <= 0xF8FF) return icon;
  }
  return DEFAULT_CATEGORY_ICON;
}
// - 数据服务层（统一走云函数 dish，前端不直连数据库，权限收敛在服务端）
const { toast } = require('../utils/util');

/** 调用云函数统一入口 */
async function call(action, payload = {}) {
  try {
    const res = await wx.cloud.callFunction({
      name: 'dish',
      data: { action, ...payload }
    });
    const result = res.result || {};
    if (result.code !== 0) {
      throw new Error(result.msg || '操作失败');
    }
    return result.data;
  } catch (err) {
    console.error(`[cloud:dish] action=${action} 失败:`, err);
    throw err;
  }
}

/** 失败统一提示（页面 catch 里调用） */
function handleErr(err, fallbackMsg = '网络异常，请稍后再试') {
  toast((err && err.message) || fallbackMsg);
}

module.exports = {
  // ---- 分类 ----
  listCategories: async () => {
    const categories = await call('listCategories');
    return categories.map(category => ({
      ...category,
      icon: normalizeCategoryIcon(category.icon)
    }));
  },
  addCategory: (data) => call('addCategory', { data }),
  updateCategory: (id, data) => call('updateCategory', { id, data }),
  deleteCategory: (id) => call('deleteCategory', { id }),

  // ---- 菜品 ----
  listDishes: (query = {}) => call('listDishes', { query }),
  getDish: (id) => call('getDish', { id }),
  addDish: (data) => call('addDish', { data }),
  updateDish: (id, data) => call('updateDish', { id, data }),
  deleteDish: (id) => call('deleteDish', { id }),

  // ---- 随机推荐 ----
  // filters: { excludeRecentDays, onlyStatus, categoryId }
  randomPick: (filters = {}) => call('randomPick', { filters }),

  // ---- 吃过记录 ----
  logEat: (dishId, note = '') => call('logEat', { dishId, note }),
  listEatLogs: (page = 1, size = 20) => call('listEatLogs', { page, size }),

  // ---- 统计与初始化 ----
  getStats: () => call('getStats'),
  initDemo: () => call('initDemo'),
  exportData: () => call('exportData'),
  getBgUrl: (key) => call('getBgUrl', { key }),
  listEatLogsByMonth: async (yearMonth) => {
    const result = await call('listEatLogsByMonth', { yearMonth });
    return {
      ...result,
      categoryStats: (result.categoryStats || []).map(category => ({
        ...category,
        icon: normalizeCategoryIcon(category.icon)
      }))
    };
  },
  importData: (data) => call('importData', { data }),
  
  // ---- 用户信息 ----
  getUserInfo: () => call('getUserInfo'),
  // 用户资料（头像 fileID / 昵称）：按 openid 云端持久化
  getProfile: () => call('getProfile'),
  saveProfile: (data) => call('saveProfile', data),
  
  // ---- 分享菜品（定向分享：token 凭证模式，2026-11 安全收紧） ----
  createShareToken: (dishId) => call('createShareToken', { dishId }),
  getSharedDish: (token) => call('getSharedDish', { token }),
  saveSharedDish: (token) => call('saveSharedDish', { token }),

  // ---- 公开发布（灵感广场） ----
  publishDish: (dishId, options = {}) => call('publishDish', { dishId, options }),
  withdrawPublicDish: (params) => call('withdrawPublicDish', params),
  listMyPublications: () => call('listMyPublications'),
  getPublicDish: (id) => call('getPublicDish', { id }),

  // ---- 社区互动 ----
  likePublicDish: (id, like) => call('likePublicDish', { id, like }),
  savePublicDish: (id) => call('savePublicDish', { id }),
  logBehavior: (type, refType, refId) => call('logBehavior', { type, refType, refId }),

  // ---- 个性化推荐 ----
  getFeed: (cursor = '', size = 6) => call('getFeed', { cursor, size }),
  saveTastePrefs: (tastePrefs, avoidTags) => call('saveTastePrefs', { tastePrefs, avoidTags }),
  getTastePrefs: () => call('getTastePrefs'),

  // ---- AI 识别（独立云函数 airec，长超时，与 dish CRUD 解耦）----
  recognizeDish: async (fileID) => {
    const res = await wx.cloud.callFunction({ name: 'airec', data: { fileID } });
    const result = res.result || {};
    if (result.code !== 0) throw new Error(result.msg || '识别失败');
    return result.data;
  },

  handleErr
};
