// pages/category-manage/category-manage.js - 分类管理：增删改、排序
const api = require('../../services/db');
const { toast } = require('../../utils/util');

const ICONS = ['', '', '', '奈', '', '', '', '', '', '', '', '', '', '', '', ''];

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
