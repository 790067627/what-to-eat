// services/db.js
/** icon 清洗：仅接受 PUA 码位（U+E000~U+F8FF，图标字体子集范围），其余一律换 apple 字形 */
function sanitizeIcon(icon) {
  if (typeof icon === 'string' && icon.length === 1) {
    const cp = icon.charCodeAt(0);
    if (cp >= 0xE000 && cp <= 0xF8FF) return icon;
  }
  return '\uf65b';
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
  /** 分类列表：icon 统一清洗——非图标字体码位（汉字/emoji 等历史脏数据）替换为 apple 字形。
   *  原因：CJK 区码位（如「奈」U+5948）在真机渲染时系统汉字字体优先于 web 字体 cmap，
   *  字体层映射不生效，故在数据层兜底 */
  listCategories: async () => {
    const res = await call('listCategories');
    if (res && Array.isArray(res.categories)) {
      res.categories = res.categories.map(c => ({
        ...c,
        icon: sanitizeIcon(c.icon)
      }));
    }
    return res;
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
  listEatLogsByMonth: (yearMonth) => call('listEatLogsByMonth', { yearMonth }),
  importData: (data) => call('importData', { data }),
  
  // ---- 用户信息 ----
  getUserInfo: () => call('getUserInfo'),
  
  // ---- 分享菜品 ----
  saveSharedDish: (dishId) => call('saveSharedDish', { dishId }),

  // ---- AI 识别（独立云函数 airec，长超时，与 dish CRUD 解耦）----
  recognizeDish: async (fileID) => {
    const res = await wx.cloud.callFunction({ name: 'airec', data: { fileID } });
    const result = res.result || {};
    if (result.code !== 0) throw new Error(result.msg || '识别失败');
    return result.data;
  },

  handleErr
};
