// pages/dish-edit/dish-edit.js - 添加/编辑菜品（含图片上传云存储）
const api = require('../../services/db');
const { fenToYuan, yuanToFen, toast } = require('../../utils/util');

const MAX_IMAGES = 9;

Page({
  data: {
    id: '',                  // 有值 = 编辑模式
    isEdit: false,
    submitting: false,
    uploading: false,

    // 表单
    name: '',
    categoryId: '',
    categories: [],
    categoryIndex: 0,
    categoryNames: [],
    description: '',
    priceYuan: '',           // 元（展示），提交时转分
    tags: [],
    tagInput: '',
    rating: 0,
    stars: [1, 2, 3, 4, 5],
    status: 'want',
    statusList: [
      { key: 'want', text: '想吃', icon: '' },
      { key: 'often', text: '常吃', icon: '' },
      { key: 'never', text: '不想再吃', icon: '' }
    ],

    // 图片：{ local: 本地路径, fileID: 云端ID }，新增图只有 local
    images: [],
    coverIndex: 0,           // 第一张为封面
    maxImages: MAX_IMAGES,

    // ---- AI 识别 ----
    aiMode: false,           // ?ai=1 进入：AI 引导卡脉冲高亮
    aiRecognized: false,     // 本次会话是否 AI 识别过（控制封面「重新识别」角标显隐）
    aiScanning: false,       // 全屏扫描 loading
    aiScanStep: 0,           // 扫描文案步骤 0/1/2
    aiBanner: { show: false, text: '' },   // 回填结果横幅
    catSuggest: { show: false, name: '' }  // 新分类确认条
  },

  onLoad(options) {
    const id = options.id || '';
    const aiMode = options.ai === '1';
    // AI 相关私有状态（不放 data）
    this._dirty = { name: false, categoryId: false, priceYuan: false, description: false, tags: false };
    this._aiTmpFileID = '';
    this._aiCancelled = false;
    this._hasRecognized = false;
    this._aiUnsavedCover = false;
    this._scanTimer = null;
    this.setData({ id, isEdit: !!id, aiMode });
    wx.setNavigationBarTitle({ title: id ? '编辑菜品' : '添加菜品' });
    this.loadCategories(id);
    if (aiMode) this.openAiPicker();
  },

  onUnload() {
    if (this._scanTimer) clearInterval(this._scanTimer);
    // 识别后未保存就离开：清理 ai-tmp 临时图（持久封面绝不删）
    if (this._aiUnsavedCover && this._aiTmpFileID) {
      wx.cloud.deleteFile({ fileList: [this._aiTmpFileID] }).catch(() => {});
    }
  },

  async loadCategories(dishId) {
    try {
      const categories = await api.listCategories();
      this.setData({
        categories,
        categoryNames: ['不分类'].concat(categories.map(c => c.name))
      });
      if (dishId) this.loadDish(dishId, categories);
    } catch (err) {
      api.handleErr(err);
    }
  },

  async loadDish(id, categories) {
    try {
      const dish = await api.getDish(id);
      const allImgs = [dish.coverImage, ...(dish.images || [])].filter(Boolean)
        .map(fileID => ({ local: fileID, fileID }));
      const catIdx = categories.findIndex(c => c._id === dish.categoryId);
      this.setData({
        name: dish.name,
        categoryId: dish.categoryId || '',
        categoryIndex: catIdx >= 0 ? catIdx + 1 : 0,
        description: dish.description || '',
        priceYuan: dish.price === null || dish.price === undefined ? '' : fenToYuan(dish.price),
        tags: dish.tags || [],
        rating: dish.rating || 0,
        status: dish.status || 'want',
        images: allImgs
      });
    } catch (err) {
      api.handleErr(err);
    }
  },

  // ---- 表单输入 ----
  // 注意：bindinput/picker bindchange 仅由用户操作触发，程序 setData 不触发，
  // 因此在这里打标即可区分「用户手改」与「AI 回填」
  onNameInput(e) { this._dirty.name = true; this.setData({ name: e.detail.value }); },
  onDescInput(e) { this._dirty.description = true; this.setData({ description: e.detail.value }); },
  onPriceInput(e) { this._dirty.priceYuan = true; this.setData({ priceYuan: e.detail.value }); },

  onCategoryChange(e) {
    const idx = Number(e.detail.value);
    const cat = idx === 0 ? null : this.data.categories[idx - 1];
    this._dirty.categoryId = true;
    this.setData({ categoryIndex: idx, categoryId: cat ? cat._id : '' });
  },

  onRate(e) {
    this.setData({ rating: Number(e.currentTarget.dataset.star) });
  },

  onStatusTap(e) {
    this.setData({ status: e.currentTarget.dataset.status });
  },

  // ---- 标签 ----
  onTagInput(e) { this.setData({ tagInput: e.detail.value }); },
  addTag() {
    const tag = (this.data.tagInput || '').trim();
    if (!tag) return;
    if (tag.length > 8) return toast('标签最长 8 字');
    if (this.data.tags.includes(tag)) return toast('标签已存在');
    if (this.data.tags.length >= 10) return toast('最多 10 个标签');
    this._dirty.tags = true;
    this.setData({ tags: [...this.data.tags, tag], tagInput: '' });
  },
  removeTag(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const tags = this.data.tags.slice();
    tags.splice(idx, 1);
    this._dirty.tags = true;
    this.setData({ tags });
  },

  // ---- 图片选择与上传 ----
  async chooseImages() {
    const remain = MAX_IMAGES - this.data.images.length;
    if (remain <= 0) return toast(`最多 ${MAX_IMAGES} 张`);
    try {
      const res = await wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']   // 压缩图，省云存储空间（E-10）
      });
      const newImgs = res.tempFiles.map(f => ({ local: f.tempFilePath, fileID: '' }));
      this.setData({ images: [...this.data.images, ...newImgs] });
    } catch (err) {
      // 用户取消选择不提示
      if (err && err.errMsg && !err.errMsg.includes('cancel')) {
        api.handleErr(err, '选图失败');
      }
    }
  },

  removeImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const images = this.data.images.slice();
    const [removed] = images.splice(idx, 1);
    // 已上传过的图，异步清理云端文件（失败不阻塞）
    if (removed.fileID) {
      wx.cloud.deleteFile({ fileList: [removed.fileID] }).catch(() => {});
    }
    this.setData({ images });
  },

  previewImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    wx.previewImage({
      current: idx,
      urls: this.data.images.map(i => i.local)
    });
  },

  /** 上传所有未上传的本地图片，返回 fileID 数组（与 images 顺序一致） */
  async uploadImages() {
    const { images } = this.data;
    const todo = images
      .map((img, idx) => ({ img, idx }))
      .filter(({ img }) => !img.fileID);
    if (!todo.length) return images.map(i => i.fileID);

    this.setData({ uploading: true });
    const results = await Promise.all(todo.map(({ img, idx }) => {
      const ext = (img.local.match(/\.(\w+)$/) || [, 'jpg'])[1];
      const cloudPath = `dishes/${Date.now()}-${idx}-${Math.floor(Math.random() * 10000)}.${ext}`;
      return wx.cloud.uploadFile({ cloudPath, filePath: img.local });
    }));

    // 回填 fileID
    const updated = images.slice();
    todo.forEach(({ idx }, i) => {
      updated[idx] = { ...updated[idx], fileID: results[i].fileID };
    });
    this.setData({ images: updated, uploading: false });
    return updated.map(i => i.fileID);
  },

  // ---- AI 识别（系统原生选图：拍摄+相册，wx.chooseMedia 自动弹来源菜单）----

  /** 唯一 AI 入口：引导卡 / 封面「重新识别」/ 失败弹窗「换图」都走这里 */
  openAiPicker() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],   // 系统原生菜单：拍摄 / 从相册选择
      sizeType: ['compressed']
    }).then(res => {
      const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
      if (path) this.startAiRecognize(path);
    }).catch(err => {
      // 用户取消不提示
      if (err && err.errMsg && !err.errMsg.includes('cancel')) toast('选图失败');
    });
  },

  /** 封面格「重新识别」：同一条链路，_hasRecognized 决定增量回填 */
  onRescanCover() { this.openAiPicker(); },

  /** 识别主链路：上传 ai-tmp → 云函数识别 → 回填/降级 */
  async startAiRecognize(localPath) {
    if (this.data.aiScanning) return;
    this._aiCancelled = false;
    this.setData({ aiScanning: true, aiScanStep: 0 });
    this._scanTimer = setInterval(() => {
      this.setData({ aiScanStep: Math.min(2, this.data.aiScanStep + 1) });
    }, 4000);

    let tmpFileID = '';
    try {
      const ext = (localPath.match(/\.(\w+)$/) || [, 'jpg'])[1];
      const cloudPath = `ai-tmp/${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;
      // 上传云存储（封面需要 fileID）；识别走 fileID，云函数侧下载
      // 注意：base64 直传 callFunction 会超数据包上限（全分辨率原图 base64 数 MB），不可用
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: localPath });
      tmpFileID = up.fileID;
      const result = await api.recognizeDish(tmpFileID);

      // 用户已取消：忽略迟到结果并清理临时图
      if (this._aiCancelled) {
        wx.cloud.deleteFile({ fileList: [tmpFileID] }).catch(() => {});
        return;
      }

      // 非食物图：删图 + 弹窗换图，不阻断表单
      if (!result.isFood) {
        wx.cloud.deleteFile({ fileList: [tmpFileID] }).catch(() => {});
        const m = await wx.showModal({
          title: '没认出这是菜',
          content: '这张照片里似乎不是菜品，换一张试试？',
          confirmText: '换图',
          cancelText: '手动填写',
          confirmColor: '#FF8FB8'
        });
        if (m.confirm) this.openAiPicker();
        return;
      }

      // 旧封面清理：只删 aiTmp 标记的旧临时图，持久 fileID 绝不删
      const oldCover = this.data.images[0];
      if (oldCover && oldCover.aiTmp && oldCover.fileID && oldCover.fileID !== tmpFileID) {
        wx.cloud.deleteFile({ fileList: [oldCover.fileID] }).catch(() => {});
      }

      // 封面就位：fileID 非空 → 保存时 uploadImages 自动跳过，不二次上传
      this._aiTmpFileID = tmpFileID;
      this._aiUnsavedCover = true;
      const images = this.data.images.slice();
      images[0] = { local: localPath, fileID: tmpFileID, aiTmp: true };
      this.setData({ images, aiRecognized: true });

      this.applyAiResult(result);
    } catch (err) {
      if (tmpFileID) wx.cloud.deleteFile({ fileList: [tmpFileID] }).catch(() => {});
      if (!this._aiCancelled) {
        let msg = (err && err.message) || '识别失败';
        // 云函数超时（默认3s/未配置）时给可读提示，避免甩原始 errMsg
        if (/timed out|TIME_LIMIT_EXCEEDED|-504003/i.test(msg)) {
          msg = '识别超时（云函数超时限制），请稍后重试或手动填写';
        }
        const m = await wx.showModal({
          title: '识别失败',
          content: `${msg}。可以换张图重试，或直接手动填写。`,
          confirmText: '换图',
          cancelText: '手动填写',
          confirmColor: '#FF8FB8'
        });
        if (m.confirm) this.openAiPicker();
      }
    } finally {
      if (this._scanTimer) clearInterval(this._scanTimer);
      this._scanTimer = null;
      this.setData({ aiScanning: false, aiMode: false });
    }
  },

  onCancelScan() {
    this._aiCancelled = true;
    if (this._scanTimer) clearInterval(this._scanTimer);
    this._scanTimer = null;
    this.setData({ aiScanning: false });
    toast('已取消识别');
  },

  /** 增量回填：只填空字段和未手改字段；手改的绝不覆盖 */
  applyAiResult(r) {
    const d = this._dirty;
    const cur = this.data;
    let updated = 0, kept = 0;
    const patch = {};

    if (d.name) kept++; else { patch.name = r.name; updated++; }

    if (r.priceYuan !== null && r.priceYuan !== undefined) {
      if (d.priceYuan) kept++; else { patch.priceYuan = String(r.priceYuan); updated++; }
    }

    if (r.description) {
      if (d.description) kept++; else { patch.description = r.description; updated++; }
    }

    if (r.tags && r.tags.length) {
      if (d.tags) kept++; else { patch.tags = r.tags.slice(0, 10); updated++; }
    }

    // 分类：命中现有分类直接设；否则出确认条（不直接改分类、不计数）
    if (r.matchedCategoryName) {
      if (d.categoryId) kept++;
      else {
        const idx = cur.categories.findIndex(c => c.name === r.matchedCategoryName);
        if (idx >= 0) {
          patch.categoryIndex = idx + 1;
          patch.categoryId = cur.categories[idx]._id;
          updated++;
        }
      }
    } else if (r.suggestedCategory && !d.categoryId) {
      patch.catSuggest = { show: true, name: r.suggestedCategory };
    }

    const mockTag = r.mock ? '（mock）' : '';
    patch.aiBanner = {
      show: true,
      text: this._hasRecognized
        ? `AI 更新 ${updated} 个字段，保留 ${kept} 个手改字段${mockTag}`
        : `AI 已识别并填写 ${updated} 个字段${kept ? `，保留 ${kept} 个手改字段` : ''}${mockTag}`
    };
    this.setData(patch);
    this._hasRecognized = true;
  },

  closeAiBanner() { this.setData({ 'aiBanner.show': false }); },

  /** 确认条「创建并使用」：复用 addCategory 的重名检查 */
  async onCreateSuggestedCat() {
    const name = this.data.catSuggest.name;
    if (!name) return;
    try {
      await api.addCategory({ name, icon: '\uf46d' });
      const categories = await api.listCategories();
      const idx = categories.findIndex(c => c.name === name);
      this.setData({
        categories,
        categoryNames: ['不分类'].concat(categories.map(c => c.name)),
        categoryIndex: idx >= 0 ? idx + 1 : 0,
        categoryId: idx >= 0 ? categories[idx]._id : '',
        'catSuggest.show': false
      });
      toast(`分类「${name}」已创建`);
    } catch (err) {
      api.handleErr(err, '创建分类失败');
    }
  },

  onDismissSuggestedCat() {
    this.setData({ 'catSuggest.show': false });
  },

  // ---- 提交 ----
  async onSubmit() {
    if (this.data.submitting) return;
    const name = (this.data.name || '').trim();
    if (!name) return toast('给菜品起个名字吧');
    if (name.length > 30) return toast('名称最长 30 字');

    this.setData({ submitting: true });
    wx.showLoading({ title: this.data.uploading ? '上传图片中' : '保存中', mask: true });

    try {
      let fileIDs = [];
      if (this.data.images.some(i => !i.fileID)) {
        wx.showLoading({ title: '上传图片中', mask: true });
        fileIDs = await this.uploadImages();
      } else {
        fileIDs = this.data.images.map(i => i.fileID);
      }

      const data = {
        name,
        categoryId: this.data.categoryId,
        description: this.data.description,
        price: this.data.priceYuan === '' ? null : yuanToFen(this.data.priceYuan),
        tags: this.data.tags,
        rating: this.data.rating,
        status: this.data.status,
        coverImage: fileIDs[0] || '',
        images: fileIDs.slice(1)
      };

      wx.showLoading({ title: '保存中', mask: true });
      if (this.data.isEdit) {
        await api.updateDish(this.data.id, data);
      } else {
        await api.addDish(data);
      }
      wx.hideLoading();
      // 保存成功后 AI 临时封面归菜品所有，onUnload 不再清理
      this._aiUnsavedCover = false;
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (err) {
      wx.hideLoading();
      this.setData({ submitting: false, uploading: false });
      api.handleErr(err, '保存失败，请重试');
      return;
    }
    this.setData({ submitting: false });
  }
});
