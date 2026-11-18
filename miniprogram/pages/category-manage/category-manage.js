// pages/category-manage/category-manage.js - 分类管理：增删改、排序
const api = require('../../services/db');
const { toast } = require('../../utils/util');

const ICONS = [
  // 经典图标（历史分类在用，保留）
  '\uF312', '\uF220', '\uF42A', '\uF46D', '\uF4CB', '\uF52A', '\uF417',
  '\uF567', '\uF179', '\uF180', '\uF182', '\uF17D', '\uF292', '\uF3CD',
  // 食物饮品
  '\uF313', '\uF311', '\uF65B', '\uF6E0', '\uF6ED', '\uF6EE', '\uF7EB',
  '\uF2E0', '\uF2DE', '\uF2DF', '\uF30D', '\uF30B', '\uF30C', '\uF7F6',
  '\uF6C1', '\uF4A9', '\uF5D2', '\uF184', '\uF242', '\uF543', '\uF542',
  // 家居生活
  '\uF425', '\uF776', '\uF1DD', '\uF616', '\uF102', '\uF46B', '\uF3EC',
  '\uF709', '\uF708', '\uF706', '\uF327', '\uF31F', '\uF59E', '\uF415',
  '\uF586', '\uF5E7',
  // 出行
  '\uF7CD', '\uF7E1', '\uF87F', '\uF18D', '\uF5FD',
  // 娱乐兴趣
  '\uF49E', '\uF3C3', '\uF194', '\uF4B1', '\uF1D8', '\uF448', '\uF2D4',
  // 自然
  '\uF5A2', '\uF496', '\uF2C1', '\uF56D', '\uF617', '\uF5E2', '\uF3CE',
  '\uF3CF', '\uF46F'
];

Page({
  data: {
    loading: true,
    categories: [],
    // 新增/编辑弹层
    showModal: false,
    editingId: '',           // 空 = 新增
    inputName: '',
    inputIcon: '',
    iconOptions: ICONS,
    submitting: false
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const categories = await api.listCategories();
      this.setData({ categories, loading: false });
    } catch (err) {
      api.handleErr(err);
      this.setData({ loading: false });
    }
  },

  // ---- 弹层 ----
  openAdd() {
    this.setData({ showModal: true, editingId: '', inputName: '', inputIcon: '' });
  },
  openEdit(e) {
    const { id, name, icon } = e.currentTarget.dataset;
    this.setData({ showModal: true, editingId: id, inputName: name, inputIcon: icon || '\uf312' });
  },
  closeModal() {
    this.setData({ showModal: false });
  },
  noop() {}, // 阻止冒泡

  onNameInput(e) { this.setData({ inputName: e.detail.value }); },
  onIconChoose(e) { this.setData({ inputIcon: e.currentTarget.dataset.icon }); },

  async onSave() {
    const name = (this.data.inputName || '').trim();
    if (!name) return toast('分类名不能为空');
    if (name.length > 10) return toast('分类名最长 10 字');
    if (this.data.submitting) return;

    this.setData({ submitting: true });
    try {
      if (this.data.editingId) {
        await api.updateCategory(this.data.editingId, { name, icon: this.data.inputIcon });
      } else {
        await api.addCategory({ name, icon: this.data.inputIcon });
      }
      this.setData({ showModal: false, submitting: false });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.load();
    } catch (err) {
      this.setData({ submitting: false });
      api.handleErr(err);
    }
  },

  async onDelete(e) {
    const { id, name } = e.currentTarget.dataset;
    const res = await wx.showModal({
      title: '删除分类',
      content: `确定删除「${name}」吗？分类下有菜品时无法删除。`,
      confirmColor: '#FF8FB8'
    });
    if (!res.confirm) return;
    try {
      await api.deleteCategory(id);
      wx.showToast({ title: '已删除', icon: 'success' });
      this.load();
    } catch (err) {
      api.handleErr(err);
    }
  },

  // ---- 排序：上移/下移（交换 sortOrder）----
  async onMove(e) {
    const { index, dir } = e.currentTarget.dataset;
    const list = this.data.categories.slice();
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    // 交换位置与 sortOrder
    [list[index], list[target]] = [list[target], list[index]];
    const a = list[index], b = list[target];
    const tmpSort = a.sortOrder;
    try {
      await Promise.all([
        api.updateCategory(a._id, { sortOrder: b.sortOrder }),
        api.updateCategory(b._id, { sortOrder: tmpSort })
      ]);
      this.load();
    } catch (err) {
      api.handleErr(err);
    }
  }
});
