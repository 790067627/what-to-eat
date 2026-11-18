/* =====================================================================
   poster.js —— 分享海报组件（移植 components/poster/index.js，canvas 2d）
   布局与绘制逻辑与小程序版一致：品牌头 → 大图 → 菜名/分类/描述 → 分割线 → 品牌引导
   ===================================================================== */
(function (global) {
  'use strict';

  var BRAND = '#D4779A';
  var BRAND_LIGHT = '#FBE9F0';
  var TEXT_PRIMARY = '#292929';
  var TEXT_SECONDARY = '#777777';
  var DIVIDER = '#EEEEEE';

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxW) {
    if (!text) return [];
    var lines = [];
    var line = '';
    var chars = Array.from(text);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var test = line + ch;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = (ch === ' ') ? '' : ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function drawHeader(ctx, W) {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = BRAND;
    ctx.font = '600 15px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
    ctx.fillText('Yuki小厨房', 20, 34);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#BBBBBB';
    ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('今日菜单', W - 20, 33);
  }

  function drawCover(ctx, cover, W) {
    var x = 20, y = 46, w = W - 40, h = 210;
    if (cover) {
      var ir = cover.width / cover.height;
      var br = w / h;
      var sx = 0, sy = 0, sw = cover.width, sh = cover.height;
      if (ir > br) { sw = cover.height * br; sx = (cover.width - sw) / 2; }
      else { sh = cover.width / br; sy = (cover.height - sh) / br * 0 + (cover.height - cover.width / br) / 2; }
      roundRect(ctx, x, y, w, h, 14);
      ctx.save();
      ctx.clip();
      ctx.drawImage(cover, sx, sy, sw, sh, x, y, w, h);
      ctx.restore();
    } else {
      roundRect(ctx, x, y, w, h, 14);
      ctx.fillStyle = BRAND_LIGHT;
      ctx.fill();
      var cx = x + w / 2, cy = y + h / 2;
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
  }

  function drawInfo(ctx, dish, W, L, descLines, categoryName) {
    var left = 20;
    var contentTop = L.coverTop + L.coverH;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    var y = contentTop + L.gapImgName;
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = 'bold 21px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
    ctx.fillText(String(dish.name || '').slice(0, 16), left, y + 19);
    y += L.nameH + L.gapNameChip;

    var chipX = left;
    ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
    if (categoryName) {
      var tw = ctx.measureText(categoryName).width + 16;
      roundRect(ctx, chipX, y, tw, L.chipH, L.chipH / 2);
      ctx.fillStyle = BRAND_LIGHT;
      ctx.fill();
      ctx.fillStyle = BRAND;
      ctx.fillText(categoryName, chipX + 8, y + 15);
      chipX += tw + 8;
    }
    if (dish.priceYuan) {
      ctx.fillStyle = BRAND;
      ctx.font = 'bold 13px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('¥' + dish.priceYuan, chipX, y + 15);
    }
    y += L.chipH + L.gapChipDesc;

    ctx.font = '13px -apple-system, "PingFang SC", sans-serif';
    if (descLines && descLines.length) {
      ctx.fillStyle = TEXT_SECONDARY;
      descLines.forEach(function (line, i) {
        ctx.fillText(line, left, y + 12 + i * L.descLineH);
      });
      y += descLines.length * L.descLineH;
    } else {
      ctx.fillStyle = '#BBBBBB';
      ctx.fillText('不知道吃啥？来抽一抽', left, y + 12);
      y += L.descLineH;
    }
    return y;
  }

  function drawFooter(ctx, W, fy) {
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
  }

  /**
   * 生成海报并弹窗预览
   * @param {Object} opts { dish, coverImageUrl, categoryName }
   */
  function generate(opts) {
    var dish = opts.dish;
    if (!dish || !dish.name) { UI.toast('没有可分享的菜品'); return Promise.resolve(); }
    UI.loading({ title: '生成中', mask: true });

    var W = 375;
    var dpr = Math.min(2, window.devicePixelRatio || 2);
    var canvas = document.createElement('canvas');
    var coverSrc = opts.coverImageUrl || dish.coverImage || dish.coverImageUrl || '';

    return loadImage(coverSrc).then(function (cover) {
      var probe = canvas.getContext('2d');
      probe.font = '13px -apple-system, "PingFang SC", sans-serif';
      var desc = String(dish.description || '').replace(/\n/g, ' ').trim();
      var descLines = desc ? wrapText(probe, desc, W - 40) : [];
      var descLineCount = Math.max(1, descLines.length);

      var L = {
        coverTop: 46, coverH: 210,
        gapImgName: 12, nameH: 26,
        gapNameChip: 10, chipH: 22,
        gapChipDesc: 10, descLineH: 20,
        gapDescFooter: 28, footerH: 58
      };
      var infoH = L.gapImgName + L.nameH + L.gapNameChip + L.chipH + L.gapChipDesc + descLineCount * L.descLineH;
      var H = L.coverTop + L.coverH + infoH + L.gapDescFooter + L.footerH;

      canvas.width = W * dpr;
      canvas.height = H * dpr;
      var ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      drawHeader(ctx, W);
      drawCover(ctx, cover, W);
      var infoBottom = drawInfo(ctx, dish, W, L, descLines, opts.categoryName || '');
      drawFooter(ctx, W, infoBottom + L.gapDescFooter);

      UI.hideLoading();
      showPosterModal(canvas.toDataURL('image/png'));
    }).catch(function (e) {
      UI.hideLoading();
      UI.toast('海报生成失败：' + (e.message || '未知错误'));
    });
  }

  function showPosterModal(url) {
    var mask = UI.el('div', 'poster-mask');
    var box = UI.el('div', 'poster-box');
    box.innerHTML =
      '<div class="poster-close-btn bi">&#xf659;</div>' +
      '<div class="poster-preview-scroll"><img class="poster-preview" src="' + url + '" alt="海报"></div>' +
      '<div class="poster-actions">' +
      '<button class="poster-btn-share"><span class="bi">&#xf52e;</span> 分享给好友</button>' +
      '<div class="poster-btn-save"><span class="bi">&#xf30a;</span> 保存到相册</div>' +
      '</div>';
    mask.appendChild(box);
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
    box.querySelector('.poster-close-btn').addEventListener('click', function () { mask.remove(); });
    box.querySelector('.poster-btn-share').addEventListener('click', function () {
      UI.toast('原型演示：微信分享能力未接入');
    });
    var saveBtn = box.querySelector('.poster-btn-save');
    saveBtn.addEventListener('click', function () {
      saveBtn.classList.add('poster-btn-disabled');
      saveBtn.innerHTML = '保存中…';
      setTimeout(function () {
        var a = document.createElement('a');
        a.href = url;
        a.download = 'yuki-poster.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        saveBtn.classList.remove('poster-btn-disabled');
        saveBtn.innerHTML = '<span class="bi">&#xf30a;</span> 保存到相册';
        UI.toast('已保存（浏览器下载）');
      }, 500);
    });
    UI.$('#overlayHost').appendChild(mask);
  }

  global.Poster = { generate: generate };
})(window);
