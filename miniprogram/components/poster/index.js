// components/poster/index.js - 简约美食分享卡片（canvas 2d）
// 设计：白色主体 + 淡粉点缀，菜品照片为视觉中心
// 布局：品牌头 → 大图 → 菜名/分类/描述 → 分割线 → 品牌引导

const BRAND = '#D4779A';
const BRAND_LIGHT = '#FBE9F0';
const TEXT_PRIMARY = '#292929';
const TEXT_SECONDARY = '#777777';
const DIVIDER = '#EEEEEE';

Component({
  properties: {
    dish: { type: Object, value: null },
    coverImageUrl: { type: String, value: '' },
    categoryName: { type: String, value: '' },
    slogan: { type: String, value: '不知道吃啥？来抽一抽' }
  },

  data: {
    visible: false,
    posterUrl: '',
    saving: false,
    canvasH: 500   // 动态画布高度（px）
  },

  methods: {
    noop() {},

    onClose() {
      this.setData({ visible: false });
    },

    async generate() {
      const dish = this.data.dish || this.properties.dish;
      if (!dish || !dish.name) {
        wx.showToast({ title: '没有可分享的菜品', icon: 'none' });
        return;
      }
      wx.showLoading({ title: '生成中', mask: true });
      try {
        const canvas = await this.getCanvas();
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
        const W = 375;

        // 先加载图片，再按内容动态算高（画布高度 = 各区块实际高度之和，消除中部空白）
        const imgSrc = this.properties.coverImageUrl || dish.coverImage;
        const cover = await this.loadImage(canvas, imgSrc);

        // 预排描述行数（用于计算总高）
        const probeCtx = canvas.getContext('2d');
        probeCtx.font = '13px -apple-system, "PingFang SC", sans-serif';
        const desc = (dish.description || '').replace(/\n/g, ' ').trim();
        // 介绍完整展示：不限行数、无省略号，海报高度随实际行数增长
        const descLines = desc ? this.wrapText(probeCtx, desc, W - 40, Infinity) : [];
        const descLineCount = Math.max(1, descLines.length); // 无描述时 slogan 占 1 行

        // 布局常量（px）：图→名 12，名→类 10，类→描述 10，描述→品牌区 28
        const L = {
          coverTop: 46, coverH: 210,
          gapImgName: 12, nameH: 26,
          gapNameChip: 10, chipH: 22,
          gapChipDesc: 10, descLineH: 20,
          gapDescFooter: 28, footerH: 58
        };
        const infoH = L.gapImgName + L.nameH + L.gapNameChip + L.chipH
          + L.gapChipDesc + descLineCount * L.descLineH;
        const H = L.coverTop + L.coverH + infoH + L.gapDescFooter + L.footerH;

        canvas.width = W * dpr;
        canvas.height = H * dpr;
        this.setData({ canvasH: H });
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // 1. 纯白背景
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, W, H);

        // 2. 品牌头部
        this.drawHeader(ctx, W);

        // 3. 菜品大图（比例/圆角不变）
        this.drawCover(ctx, cover, W);

        // 4. 菜品信息（返回内容底部 y，供品牌区定位）
        const infoBottom = this.drawInfo(ctx, dish, W, L, descLines);

        // 5. 底部品牌区（紧跟内容，无大面积空白）
        this.drawFooter(ctx, W, infoBottom + L.gapDescFooter);

        // 6. 导出
        const posterUrl = await new Promise((resolve, reject) => {
          wx.canvasToTempFilePath({
            canvas,
            success: r => resolve(r.tempFilePath),
            fail: reject
          }, this);
        });
        wx.hideLoading();
        this.setData({ visible: true, posterUrl });
      } catch (e) {
        wx.hideLoading();
        console.error('[poster] 海报生成失败:', e);
        wx.showToast({ title: `海报生成失败：${e.message || e.errMsg || '未知错误'}`, icon: 'none', duration: 3000 });
      }
    },

    getCanvas() {
      return new Promise((resolve, reject) => {
        this.createSelectorQuery().in(this)
          .select('#posterCanvas')
          .fields({ node: true, size: true })
          .exec(res => (res && res[0] && res[0].node) ? resolve(res[0].node) : reject(new Error('canvas 未就绪')));
      });
    },

    loadImage(canvas, src) {
      if (!src) return Promise.resolve(null);
      const local = src.indexOf('cloud://') === 0
        ? new Promise(resolve => wx.cloud.downloadFile({
            fileID: src,
            success: r => resolve(r.tempFilePath),
            fail: () => resolve('')
          }))
        : Promise.resolve(src);
      return local.then(path => new Promise(resolve => {
        if (!path) return resolve(null);
        const img = canvas.createImage();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = path;
      }));
    },

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    // ① 品牌头部：左上品牌名，右侧小字
    drawHeader(ctx, W) {
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillStyle = BRAND;
      ctx.font = '600 15px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
      ctx.fillText('Yuki小厨房', 20, 34);
      
      ctx.textAlign = 'right';
      ctx.fillStyle = '#BBBBBB';
      ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('今日菜单', W - 20, 33);
    },

    // ② 菜品大图：圆角 14px，居中裁切
    drawCover(ctx, cover, W) {
      const x = 20, y = 46, w = W - 40, h = 210;
      if (cover) {
        const ir = cover.width / cover.height;
        const br = w / h;
        let sx = 0, sy = 0, sw = cover.width, sh = cover.height;
        if (ir > br) { sw = cover.height * br; sx = (cover.width - sw) / 2; }
        else { sh = cover.width / br; sy = (cover.height - sh) / 2; }
        this.roundRect(ctx, x, y, w, h, 14);
        ctx.save();
        ctx.clip();
        ctx.drawImage(cover, sx, sy, sw, sh, x, y, w, h);
        ctx.restore();
      } else {
        // 无图占位：淡粉底 + 简约餐具线条
        this.roundRect(ctx, x, y, w, h, 14);
        ctx.fillStyle = BRAND_LIGHT;
        ctx.fill();
        const cx = x + w / 2, cy = y + h / 2;
        ctx.strokeStyle = '#E8C4D4';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx - 6, cy, 26, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx - 6, cy, 17, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = BRAND;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx + 16, cy - 22); ctx.lineTo(cx + 24, cy + 20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 22, cy - 23); ctx.lineTo(cx + 30, cy + 19); ctx.stroke();
      }
    },

    // ③ 菜品信息：菜名 + 分类/价格 + 描述（最多 3 行），返回内容底部 y
    drawInfo(ctx, dish, W, L, descLines) {
      const left = 20;
      const contentTop = L.coverTop + L.coverH;   // 图底 = 256

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // 菜名：图→名间距 12
      let y = contentTop + L.gapImgName;
      ctx.fillStyle = TEXT_PRIMARY;
      ctx.font = 'bold 21px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
      const name = String(dish.name || '').slice(0, 16);
      ctx.fillText(name, left, y + 19);           // 基线 ≈ 顶部 + 字号*0.9
      y += L.nameH + L.gapNameChip;               // 名→类间距 10

      // 分类标签 + 价格（同一行）
      const cat = this.properties.categoryName;
      let chipX = left;
      ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
      if (cat) {
        const tw = ctx.measureText(cat).width + 16;
        this.roundRect(ctx, chipX, y, tw, L.chipH, L.chipH / 2);
        ctx.fillStyle = BRAND_LIGHT;
        ctx.fill();
        ctx.fillStyle = BRAND;
        ctx.fillText(cat, chipX + 8, y + 15);
        chipX += tw + 8;
      }
      if (dish.priceYuan) {
        ctx.fillStyle = BRAND;
        ctx.font = 'bold 13px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText(`¥${dish.priceYuan}`, chipX, y + 15);
      }
      y += L.chipH + L.gapChipDesc;               // 类→描述间距 10

      // 描述（浅灰，完整换行不限行数；无描述时展示 slogan）
      ctx.font = '13px -apple-system, "PingFang SC", sans-serif';
      if (descLines && descLines.length) {
        ctx.fillStyle = TEXT_SECONDARY;
        descLines.forEach((line, i) => {
          ctx.fillText(line, left, y + 12 + i * L.descLineH);
        });
        y += descLines.length * L.descLineH;
      } else {
        ctx.fillStyle = '#BBBBBB';
        ctx.fillText(this.properties.slogan, left, y + 12);
        y += L.descLineH;
      }
      return y;
    },

    // ④ 底部品牌区：浅灰分割线 + 左对齐两行文字（无厨师帽图标）
    drawFooter(ctx, W, fy) {
      // 细分割线
      ctx.strokeStyle = DIVIDER;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(20, fy);
      ctx.lineTo(W - 20, fy);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = TEXT_SECONDARY;
      ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('发现更多家常美味', 20, fy + 22);

      ctx.fillStyle = BRAND;
      ctx.fillText('微信搜索「Yuki 小厨房」', 20, fy + 42);
    },

    /** 逐字换行（适配中文无空格文本）：超宽即断行；maxLines=Infinity 时不截断 */
    wrapText(ctx, text, maxW, maxLines) {
      if (!text) return [];
      const lines = [];
      let line = '';
      for (const ch of text) {
        const test = line + ch;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = (ch === ' ') ? '' : ch;   // 行首空格丢弃
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      if (maxLines !== Infinity && lines.length > maxLines) {
        let truncated = lines[maxLines - 1];
        while (ctx.measureText(truncated + '…').width > maxW && truncated.length > 0) {
          truncated = truncated.slice(0, -1);
        }
        lines[maxLines - 1] = truncated + '…';
        lines.length = maxLines;
      }
      return lines;
    },

    async onSave() {
      if (this.data.saving) return;
      this.setData({ saving: true });
      try {
        await new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({
            filePath: this.data.posterUrl,
            success: resolve,
            fail: reject
          });
        });
        wx.showToast({ title: '已保存到相册' });
      } catch (e) {
        const msg = (e && e.errMsg) || '';
        if (msg.includes('auth deny') || msg.includes('authorize') || msg.includes('privacy')) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存海报需要允许访问相册，去设置里开启一下？',
            confirmText: '去设置',
            confirmColor: BRAND,
            success: r => { if (r.confirm) wx.openSetting(); }
          });
        } else {
          wx.showToast({ title: '保存失败，重试一下', icon: 'none' });
        }
      } finally {
        this.setData({ saving: false });
      }
    }
  }
});
