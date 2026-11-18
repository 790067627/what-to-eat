/* =====================================================================
   pages.js —— 八个页面的渲染与交互（1:1 移植小程序页面逻辑）
   页面：index / dishes / random / mine / dish-detail / dish-edit
        / category-manage / history
   ===================================================================== */
(function (global) {
  'use strict';

  var el = UI.el, esc = UI.esc, api = UI.api, util = UI.util;
  var R = UI.router;

  var STATUS_TEXT = { want: '想吃', often: '常吃', never: '不想再吃' };
  var STATUS_LIST = [
    { key: 'want', text: '想吃', icon: '\uf417' },
    { key: 'often', text: '常吃', icon: '\uf588' },
    { key: 'never', text: '不想再吃', icon: '\uf567' }
  ];

  // ---------- 通用小组件 ----------

  function starsHtml(cur, cls) {
    var h = '<div class="stars">';
    for (var i = 1; i <= 5; i++) {
      h += '<span class="star' + (i <= cur ? ' on' : '') + '" data-star="' + i + '">★</span>';
    }
    return h + '</div>';
  }

  /** 自绘 switch（模拟 wx switch） */
  function makeSwitch(on, onChange) {
    var sw = el('div', 'wx-switch' + (on ? ' on' : ''));
    sw.innerHTML = '<div class="sw-knob"></div>';
    sw.addEventListener('click', function () {
      var next = !sw.classList.contains('on');
      sw.classList.toggle('on', next);
      if (onChange) onChange(next);
    });
    return sw;
  }

  /** 自绘 slider（模拟 wx slider，min/max/step） */
  function makeSlider(min, max, step, value, onChange) {
    var box = el('div', 'filter-slider');
    var dragging = false;
    var cur = value;
    function pct(v) { return (v - min) / (max - min); }
    function paint(v) {
      cur = v;
      var fill = box.querySelector('.sl-fill');
      var blk = box.querySelector('.sl-block');
      fill.style.width = (pct(v) * 100) + '%';
      blk.style.left = (6 + pct(v) * 88) + '%';
    }
    box.innerHTML =
      '<div class="sl-track"><div class="sl-fill"></div></div>' +
      '<div class="sl-block"></div>';
    function valueFromX(clientX) {
      var rect = box.getBoundingClientRect();
      var ratio = Math.min(1, Math.max(0, (clientX - rect.left - rect.width * 0.06) / (rect.width * 0.88)));
      var v = min + ratio * (max - min);
      v = Math.round(v / step) * step;
      return Math.min(max, Math.max(min, v));
    }
    box.addEventListener('pointerdown', function (e) {
      dragging = true;
      box.setPointerCapture(e.pointerId);
      var v = valueFromX(e.clientX);
      paint(v); onChange(v, true);
    });
    box.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var v = valueFromX(e.clientX);
      paint(v); onChange(v, true);
    });
    box.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false;
      onChange(cur, false);
    });
    paint(value);
    return box;
  }

  /** 底部滚轮式选择（模拟 wx picker），返回 Promise(index|null) */
  function showPicker(items, curIndex) {
    return new Promise(function (resolve) {
      var mask = el('div', 'fab-mask');
      mask.style.zIndex = '1160';
      var sheet = el('div', 'fab-sheet');
      sheet.style.paddingBottom = '34px';
      var h = '<div class="fab-handle"></div><div style="max-height:280px;overflow-y:auto">';
      items.forEach(function (it, i) {
        h += '<div class="pk-item' + (i === curIndex ? ' pk-on' : '') + '" data-i="' + i + '" style="padding:13px 0;text-align:center;font-size:15px;color:var(--c-text);cursor:pointer;border-bottom:1px solid var(--c-input)">' + esc(it) + '</div>';
      });
      h += '</div><div class="fab-cancel" data-cancel="1" style="margin-top:10px">取消</div>';
      sheet.innerHTML = h;
      mask.appendChild(sheet);
      UI.$('#overlayHost').appendChild(mask);
      sheet.addEventListener('click', function (e) {
        var t = e.target;
        if (t.dataset.cancel) { mask.remove(); resolve(null); return; }
        if (t.classList.contains('pk-item')) { mask.remove(); resolve(Number(t.dataset.i)); }
      });
      mask.addEventListener('click', function (e) { if (e.target === mask) { mask.remove(); resolve(null); } });
    });
  }

  function skeletonList(n) {
    var h = '';
    for (var i = 0; i < n; i++) {
      h += '<div class="skeleton-item"><div class="skeleton-img"></div><div style="flex:1"><div class="skeleton-line" style="width:60%"></div><div class="skeleton-line" style="width:40%"></div></div></div>';
    }
    return h;
  }

  // ==================================================================
  // 首页 pages/index
  // ==================================================================
  UI.registerPage('index', {
    title: 'Yuki小厨房',
    mount: function (ctx) {
      ctx.data = { loading: true, inited: false, todayDish: null, categories: [], greeting: '' };

      function buildGreeting() {
        var h = new Date().getHours();
        if (h < 6) return '夜深了，来点宵夜灵感？';
        if (h < 11) return '早上好，今天想吃点啥？';
        if (h < 14) return '中午好，午饭有着落了吗？';
        if (h < 18) return '下午好，先想想晚饭吃啥';
        return '晚上好，今天吃点好的';
      }
      ctx.data.greeting = buildGreeting();

      ctx._render = function () {
        var d = ctx.data;
        // Kitty 装饰（装饰层，仅首页显示）
        var deco = UI.$('#decoLayer');
        if (R.current().name === 'index') {
          deco.innerHTML = '<img class="kitty-deco" src="assets/kitty-deco.svg" alt="">';
        } else {
          deco.innerHTML = '';
        }

        if (d.loading) {
          ctx.body.innerHTML = skeletonList(2);
          return;
        }
        var h = '';
        h += '<div class="card hero">' +
          '<div class="hero-greeting">' + esc(d.greeting) + '</div>' +
          '<div class="hero-sub">' + (d.inited ? '纠结的话，交给运气吧 ' : '先建个菜品库，再让运气帮你选 ') + '</div>' +
          '<div class="btn-primary hero-btn" data-act="random"><span class="bi">\uf2fb</span> 帮我随机抽一道</div>' +
          '</div>';
        if (!d.inited) {
          h += '<div class="card init-card">' +
            '<div class="section-title">菜品库还是空的</div>' +
            '<div class="init-desc">两种方式开始：</div>' +
            '<div class="btn-primary" style="margin-bottom:8px" data-act="add">＋ 手动添加第一道菜</div>' +
            '<div class="btn-ghost" style="width:100%" data-act="demo">一键载入示例数据（6道菜+5个分类）</div>' +
            '</div>';
        } else {
          if (d.todayDish) {
            var t = d.todayDish;
            h += '<div class="section-title">今日推荐</div>';
            h += '<div class="card today-card" data-act="detail" data-id="' + t._id + '">' +
              (t.coverImage
                ? '<img class="today-img" src="' + esc(t.coverImage) + '" alt="">'
                : '<div class="today-img today-img-placeholder img-ph"><span class="bi">\uf312</span></div>') +
              '<div class="today-info">' +
              '<div class="today-name ellipsis">' + esc(t.name) + '</div>' +
              (t.description ? '<div class="today-desc ellipsis-2">' + esc(t.description) + '</div>' : '') +
              '<div class="today-meta">' +
              (t.rating ? '<span class="today-rating">★ ' + t.rating + '</span>' : '') +
              (t.categoryName ? '<span class="chip chip-plain">' + esc(t.categoryName) + '</span>' : '') +
              (t.priceYuan ? '<span class="chip">¥' + t.priceYuan + '</span>' : '') +
              '</div></div></div>';
          }
          h += '<div class="flex-between"><div class="section-title">分类速览</div>' +
            '<div class="more-link" data-act="dishes">全部菜品 ›</div></div>';
          h += '<div class="cat-grid">';
          d.categories.forEach(function (c) {
            h += '<div class="cat-cell card" data-act="cat" data-id="' + c._id + '" data-name="' + esc(c.name) + '">' +
              '<div class="cat-icon bi">' + esc(c.icon) + '</div>' +
              '<div class="cat-name ellipsis">' + esc(c.name) + '</div></div>';
          });
          if (!d.categories.length) h += '<div class="empty-hint">还没有分类，去「我的 → 分类管理」添加</div>';
          h += '</div>';
        }
        h += '<div style="height:80px"></div>';
        ctx.body.innerHTML = h;
      };

      ctx.body.addEventListener('click', function (e) {
        var t = e.target.closest('[data-act]');
        if (!t) return;
        var act = t.dataset.act;
        if (act === 'random') R.switchTab('random');
        else if (act === 'add') R.navigateTo('dish-edit');
        else if (act === 'detail') R.navigateTo('dish-detail?id=' + t.dataset.id);
        else if (act === 'dishes') { UI.globalData.dishesFilter = null; R.switchTab('dishes'); }
        else if (act === 'cat') {
          UI.globalData.dishesFilter = { categoryId: t.dataset.id, categoryName: t.dataset.name };
          R.switchTab('dishes');
        } else if (act === 'demo') {
          UI.loading('初始化中');
          api.initDemo().then(function () {
            UI.hideLoading();
            UI.toast({ title: '已添加示例菜品', icon: 'success' });
            loadData();
          }).catch(function (err) { UI.hideLoading(); api.handleErr(err); });
        }
      });

      function loadData() {
        return Promise.all([api.listCategories(), api.listDishes(), api.getStats()]).then(function (res) {
          var categories = res[0], dishes = res[1], stats = res[2];
          var inited = stats.dishCount > 0;
          var todayDish = null;
          var pool = dishes.filter(function (d) { return d.status !== 'never'; });
          if (pool.length) {
            var dayKey = new Date().toDateString();
            var hash = 0;
            for (var i = 0; i < dayKey.length; i++) hash = (hash * 31 + dayKey.charCodeAt(i)) % 997;
            var picked = pool[hash % pool.length];
            var cat = categories.filter(function (c) { return c._id === picked.categoryId; })[0];
            todayDish = Object.assign({}, picked, {
              priceYuan: util.fenToYuan(picked.price),
              categoryName: cat ? cat.name : ''
            });
          }
          ctx.data.loading = false;
          ctx.data.inited = inited;
          ctx.data.todayDish = todayDish;
          ctx.data.categories = categories.slice(0, 6);
          ctx._render();
        }).catch(function (err) {
          api.handleErr(err);
          ctx.data.loading = false;
          ctx._render();
        });
      }

      ctx.onShow = function () {
        ctx.data.loading = true;
        ctx._render();
        loadData();
      };
      ctx.onHide = function () { UI.$('#decoLayer').innerHTML = ''; };
    }
  });

  // ==================================================================
  // 菜品库 pages/dishes
  // ==================================================================
  UI.registerPage('dishes', {
    title: '菜品库',
    mount: function (ctx) {
      var d = ctx.data = {
        loading: true, fabSheetVisible: false,
        categories: [], activeCategoryId: '', keyword: '',
        dishes: [], statusFilter: ''
      };
      var searchTimer = null;

      ctx.body.style.cssText = 'position:absolute;top:91px;left:0;right:0;bottom:76px;padding:10px 12px 0;display:flex;flex-direction:column;overflow:hidden';
      var inner = ctx.body;

      function decorate(dishes, categories) {
        var catMap = {};
        (categories || d.categories).forEach(function (c) { catMap[c._id] = c; });
        return dishes.map(function (x) {
          return Object.assign({}, x, {
            priceYuan: util.fenToYuan(x.price),
            statusText: STATUS_TEXT[x.status] || '',
            categoryName: catMap[x.categoryId] ? catMap[x.categoryId].name : ''
          });
        });
      }

      function fetchDishes() {
        var query = {};
        if (d.activeCategoryId) query.categoryId = d.activeCategoryId;
        if (d.statusFilter) query.status = d.statusFilter;
        if (d.keyword) query.keyword = d.keyword;
        return api.listDishes(query);
      }

      ctx._render = function () {
        var h = '';
        h += '<div class="search-bar"><span class="search-icon"><span class="bi">\uf52a</span></span>' +
          '<input class="search-input" placeholder="搜索菜品、标签、介绍…" value="' + esc(d.keyword) + '">' +
          (d.keyword ? '<span class="search-clear" data-act="clear">✕</span>' : '') + '</div>';
        h += '<div class="status-bar">';
        [['want', '\uf417 想吃'], ['often', '\uf588 常吃'], ['never', '\uf567 不想再吃']].forEach(function (s) {
          h += '<span class="status-chip' + (d.statusFilter === s[0] ? ' on' : '') + '" data-status="' + s[0] + '"><span class="bi">' + s[1].slice(0, 1) + '</span> ' + s[1].slice(1) + '</span>';
        });
        h += '</div>';
        h += '<div class="dishes-content">';
        // 侧栏
        h += '<div class="side">';
        h += '<div class="side-item' + (!d.activeCategoryId ? ' on' : '') + '" data-cat="" data-name="">全部</div>';
        d.categories.forEach(function (c) {
          h += '<div class="side-item' + (d.activeCategoryId === c._id ? ' on' : '') + '" data-cat="' + c._id + '" data-name="' + esc(c.name) + '"><span class="bi">' + esc(c.icon) + '</span> ' + esc(c.name) + '</div>';
        });
        h += '</div>';
        // 列表
        h += '<div class="dish-list">';
        if (d.loading) {
          h += skeletonList(4);
        } else {
          d.dishes.forEach(function (item) {
            h += '<div class="dish-card card" data-act="detail" data-id="' + item._id + '">' +
              (item.coverImage
                ? '<img class="dish-img" src="' + esc(item.coverImage) + '" alt="">'
                : '<div class="dish-img dish-img-ph img-ph bi">' + (item.status === 'never' ? '\uf567' : '\uf312') + '</div>') +
              '<div class="dish-info">' +
              '<div class="dish-name ellipsis">' + esc(item.name) + '</div>' +
              '<div class="dish-sub ellipsis">' +
              (item.rating ? '<span class="dish-rating">★' + item.rating + '</span>' : '') +
              (item.categoryName ? ' · ' + esc(item.categoryName) : '') +
              (item.priceYuan ? ' · ¥' + item.priceYuan : '') +
              '</div>' +
              '<div class="dish-tags">' +
              (item.statusText ? '<span class="chip' + (item.status === 'never' ? ' chip-plain' : '') + '">' + item.statusText + '</span>' : '') +
              (item.tags || []).map(function (t) { return '<span class="chip chip-plain">' + esc(t) + '</span>'; }).join('') +
              '</div></div></div>';
          });
          if (!d.dishes.length) {
            var filtered = d.keyword || d.activeCategoryId || d.statusFilter;
            h += '<div class="empty-state"><div class="empty-icon"></div>' +
              '<div class="empty-text">' + (filtered ? '没有符合条件的菜品' : '这个分类还空着') + '</div>';
            if (!filtered) {
              h += '<div class="btn-ai-main" data-act="addAi" style="width:80%"><span class="bi">\uf46d</span> AI 识别添加</div>' +
                '<div class="btn-ghost" data-act="add">＋ 手动添加</div>';
            } else {
              h += '<div class="btn-ghost" data-act="add">＋ 添加菜品</div>';
            }
            h += '</div>';
          }
          h += '<div style="height:20px"></div>';
        }
        h += '</div></div>';
        inner.innerHTML = h;

        // FAB（fixed 元素层）
        var fx = UI.$('#fxLayer');
        if (R.current().name === 'dishes' && !d.loading) {
          fx.innerHTML = '<div class="fab">＋</div>';
          fx.querySelector('.fab').addEventListener('click', function () {
            d.fabSheetVisible = true;
            ctx._render();
          });
        } else {
          fx.innerHTML = '';
        }

        // FAB 面板
        var oldSheet = inner.querySelector('.fab-mask');
        if (d.fabSheetVisible) {
          var mask = el('div', 'fab-mask');
          mask.innerHTML =
            '<div class="fab-sheet">' +
            '<div class="fab-handle"></div>' +
            '<div class="fab-ai-card" data-act="sheetAi">' +
            '<div class="fab-ai-glow"></div><div class="fab-ai-dot d1"></div><div class="fab-ai-dot d2"></div><div class="fab-ai-dot d3"></div>' +
            '<div class="fab-ai-icon"><span class="bi">\uf46d</span></div>' +
            '<div class="fab-ai-txt"><div class="fab-ai-t1">AI 识别添加 <span class="fab-ai-badge">AI</span></div>' +
            '<div class="fab-ai-t2">拍一张菜品照片，菜名 / 分类 / 描述 / 标签自动填好</div></div>' +
            '<div class="fab-ai-go">›</div></div>' +
            '<div class="fab-manual" data-act="sheetManual">' +
            '<div class="fab-manual-icon"><span class="bi">\uf4cb</span></div>' +
            '<div class="fab-manual-txt"><div class="fab-manual-t1">手动添加</div><div class="fab-manual-t2">自己填写菜品信息</div></div>' +
            '</div>' +
            '<div class="fab-cancel" data-act="sheetClose">取消</div></div>';
          inner.appendChild(mask);
          mask.addEventListener('click', function (e) {
            if (e.target === mask) { d.fabSheetVisible = false; ctx._render(); }
          });
        }
      };

      function refreshDishes() {
        return fetchDishes().then(function (dishes) {
          d.dishes = decorate(dishes);
          d.loading = false;
          ctx._render();
        }).catch(api.handleErr);
      }

      function loadAll() {
        d.loading = true;
        ctx._render();
        Promise.all([api.listCategories(), fetchDishes()]).then(function (res) {
          d.categories = res[0];
          d.dishes = decorate(res[1], res[0]);
          d.loading = false;
          ctx._render();
        }).catch(function (err) { api.handleErr(err); d.loading = false; ctx._render(); });
      }

      ctx.onShow = function () {
        var filter = UI.globalData.dishesFilter;
        if (filter) {
          UI.globalData.dishesFilter = null;
          d.activeCategoryId = filter.categoryId || '';
        }
        loadAll();
      };
      ctx.onHide = function () { UI.$('#fxLayer').innerHTML = ''; };

      inner.addEventListener('click', function (e) {
        var t = e.target.closest('[data-act],[data-status],[data-cat]');
        if (!t) return;
        if (t.dataset.status !== undefined && !t.dataset.act) {
          var s = t.dataset.status;
          d.statusFilter = d.statusFilter === s ? '' : s;
          refreshDishes();
          return;
        }
        if (t.dataset.cat !== undefined && t.classList.contains('side-item')) {
          if (t.dataset.cat === d.activeCategoryId) return;
          d.activeCategoryId = t.dataset.cat;
          refreshDishes();
          return;
        }
        var act = t.dataset.act;
        if (act === 'clear') { d.keyword = ''; refreshDishes().then(function () { var i = inner.querySelector('.search-input'); if (i) i.focus(); }); }
        else if (act === 'detail') R.navigateTo('dish-detail?id=' + t.dataset.id);
        else if (act === 'add') R.navigateTo('dish-edit');
        else if (act === 'addAi') R.navigateTo('dish-edit?ai=1');
        else if (act === 'fab') { d.fabSheetVisible = true; ctx._render(); }
        else if (act === 'sheetAi') { d.fabSheetVisible = false; ctx._render(); R.navigateTo('dish-edit?ai=1'); }
        else if (act === 'sheetManual') { d.fabSheetVisible = false; ctx._render(); R.navigateTo('dish-edit'); }
        else if (act === 'sheetClose') { d.fabSheetVisible = false; ctx._render(); }
      });

      inner.addEventListener('input', function (e) {
        if (!e.target.classList.contains('search-input')) return;
        d.keyword = e.target.value;
        if (searchTimer) clearTimeout(searchTimer);
        // 仅更新清除按钮，不整页重绘（避免输入框失焦）
        var bar = inner.querySelector('.search-bar');
        var oldClear = bar.querySelector('.search-clear');
        if (d.keyword && !oldClear) {
          var c = el('span', 'search-clear', '✕');
          c.dataset.act = 'clear';
          bar.appendChild(c);
        } else if (!d.keyword && oldClear) oldClear.remove();
        searchTimer = setTimeout(refreshDishes, 400);
      });
    }
  });

  // ==================================================================
  // 抽一抽 pages/random
  // ==================================================================
  UI.registerPage('random', {
    title: '抽一抽',
    mount: function (ctx) {
      var d = ctx.data = {
        excludeDays: 3, onlyWant: false, weightByRating: true,
        phase: 'idle', rollingName: '', result: null, lastEatenText: '',
        errorMessage: '', categories: [], categoryFilter: '', categoryFilterName: ''
      };
      var rollTimer = null;
      var names = [];

      ctx.body.style.padding = '0';
      var inner = el('div', 'pg-body');
      inner.style.cssText = 'display:flex;flex-direction:column;min-height:100%;padding:12px 12px 0';
      ctx.body.appendChild(inner);

      function renderFilters() {
        var h = '<div class="card filters">';
        h += '<div class="filter-row"><span class="filter-label">排除最近吃过的</span><div class="slider-slot"></div>' +
          '<span class="filter-value">' + (d.excludeDays === 0 ? '不排除' : d.excludeDays + '天') + '</span></div>';
        h += '<div class="filter-row"><span class="filter-label">只从「想吃」里抽</span><span class="switch-slot" style="margin-left:auto"></span></div>';
        h += '<div class="filter-row"><span class="filter-label">高分优先 <span class="bi">\uf588</span></span><span class="switch-slot2" style="margin-left:auto"></span></div>';
        h += '<div class="filter-row"><span class="filter-label">限定分类</span><span class="filter-picker" data-act="picker" style="margin-left:auto">' + esc(d.categoryFilterName || '不限') + ' ▾</span></div>';
        h += '</div>';
        return h;
      }

      function renderStage() {
        var h = '<div class="stage-area">';
        if (d.phase === 'idle') {
          h += '<div class="idle"><div class="dice bi">\uf2fb</div>' +
            '<div class="idle-title">今天吃啥？</div><div class="idle-sub">让命运替你决定</div>' +
            (d.errorMessage ? '<div class="error-tip">' + esc(d.errorMessage) + '</div>' : '') + '</div>';
        } else if (d.phase === 'rolling') {
          h += '<div class="roll-card shake"><span class="roll-name">' + esc(d.rollingName) + '</span></div>';
        } else {
          var r = d.result;
          h += '<div class="result-card pop-in">' +
            (r.dish.coverImage
              ? '<img class="result-img" src="' + esc(r.dish.coverImage) + '" alt="">'
              : '<div class="result-img result-img-ph img-ph"><span class="bi">\uf312</span></div>') +
            '<div class="result-name">' + esc(r.dish.name) + '</div>' +
            '<div class="result-meta">' +
            (r.categoryName ? '<span class="chip chip-plain">' + esc(r.categoryName) + '</span>' : '') +
            (r.dish.priceYuan ? '<span class="chip">¥' + r.dish.priceYuan + '</span>' : '') +
            (r.dish.rating ? '<span class="chip chip-plain">★' + r.dish.rating + '</span>' : '') +
            '</div>' +
            '<div class="result-last">' + esc(d.lastEatenText) + ' · 从 ' + r.poolSize + ' 道里抽中</div>' +
            (r.dish.description ? '<div class="result-desc ellipsis-2" data-act="detail">' + esc(r.dish.description) + '</div>' : '') +
            '<div class="result-link" data-act="detail">查看详情 ›</div>' +
            '</div>';
        }
        return h + '</div>';
      }

      function renderActions() {
        var h = '<div class="actions">';
        if (d.phase === 'result') {
          h += '<div class="action-row">' +
            '<div class="btn-ghost action-reject" data-act="reject"><span class="bi">\uf659</span> 不想吃，换一个</div>' +
            '<div class="btn-primary action-accept" data-act="accept">✓ 就它了，记一笔</div></div>' +
            '<div class="btn-ghost poster-btn" data-act="poster"><span class="bi">\uf3cd</span> 生成分享海报</div>';
        } else {
          h += '<div class="btn-primary' + (d.phase === 'rolling' ? ' btn-disabled' : '') + '" data-act="roll">' +
            (d.phase === 'rolling' ? '抽取中…' : ' 开始抽') + '</div>' +
            '<div class="add-hint" data-act="add">菜品库不够丰富？去加几道 ›</div>';
        }
        return h + '</div>';
      }

      ctx._render = function () {
        inner.innerHTML = renderFilters() + renderStage() + renderActions();
        // 挂载自绘控件
        var slider = makeSlider(0, 14, 1, d.excludeDays, function (v, changing) {
          d.excludeDays = v;
          inner.querySelector('.filter-value').textContent = v === 0 ? '不排除' : v + '天';
        });
        inner.querySelector('.slider-slot').appendChild(slider);
        inner.querySelector('.switch-slot').appendChild(makeSwitch(d.onlyWant, function (v) { d.onlyWant = v; }));
        inner.querySelector('.switch-slot2').appendChild(makeSwitch(d.weightByRating, function (v) {
          d.weightByRating = v;
          UI.storage.set(UI.WEIGHT_KEY, v ? 1 : 0);
        }));
      };

      function loadNames() {
        return Promise.all([api.listDishes(), api.listCategories()]).then(function (res) {
          names = res[0].filter(function (x) { return x.status !== 'never'; }).map(function (x) { return x.name; });
          d.categories = res[1];
        }).catch(function (err) { names = []; api.handleErr(err); });
      }

      function onRoll() {
        if (d.phase === 'rolling') return;
        if (!names.length) {
          d.errorMessage = '菜品库是空的，先去添加几道菜吧';
          ctx._render();
          return;
        }
        d.phase = 'rolling'; d.errorMessage = ''; d.result = null;
        ctx._render();
        var i = 0;
        rollTimer = setInterval(function () {
          d.rollingName = names[i % names.length];
          var n = inner.querySelector('.roll-name');
          if (n) n.textContent = d.rollingName;
          i++;
        }, 80);
        api.randomPick({
          excludeRecentDays: d.excludeDays,
          onlyStatus: d.onlyWant ? 'want' : '',
          categoryId: d.categoryFilter,
          weightByRating: d.weightByRating
        }).then(function (res) {
          setTimeout(function () { showResult(res); }, 1200);
        }).catch(function (err) {
          clearInterval(rollTimer);
          if (err.message && err.message.indexOf('没有符合条件') >= 0) {
            d.phase = 'idle'; d.errorMessage = '没有符合条件的菜品，放宽筛选试试';
          } else {
            d.phase = 'idle'; d.errorMessage = '网络异常，再抽一次试试';
          }
          ctx._render();
        });
      }

      function showResult(res) {
        clearInterval(rollTimer);
        var dish = res.dish;
        d.phase = 'result';
        d.result = Object.assign({}, res, {
          dish: Object.assign({}, dish, { priceYuan: util.fenToYuan(dish.price) })
        });
        d.lastEatenText = res.lastEatenAt ? '上次吃是 ' + util.timeAgo(res.lastEatenAt) : '还没吃过，尝个鲜';
        ctx._render();
        UI.vibrate();
      }

      inner.addEventListener('click', function (e) {
        var t = e.target.closest('[data-act]');
        if (!t) return;
        var act = t.dataset.act;
        if (act === 'roll') onRoll();
        else if (act === 'reject') onRoll();
        else if (act === 'accept') {
          if (!d.result) return;
          UI.loading('记录中');
          api.logEat(d.result.dish._id).then(function () {
            UI.hideLoading();
            UI.toast({ title: '就吃' + d.result.dish.name + '！', icon: 'success' });
            d.phase = 'idle'; d.result = null;
            ctx._render();
            loadNames();
          }).catch(function (err) { UI.hideLoading(); api.handleErr(err); });
        } else if (act === 'poster') {
          Poster.generate({ dish: d.result.dish, categoryName: d.result.categoryName });
        } else if (act === 'detail') {
          R.navigateTo('dish-detail?id=' + d.result.dish._id);
        } else if (act === 'add') {
          R.navigateTo('dish-edit');
        } else if (act === 'picker') {
          var items = ['不限'].concat(d.categories.map(function (c) { return c.name; }));
          showPicker(items).then(function (idx) {
            if (idx === null) return;
            if (idx === 0) { d.categoryFilter = ''; d.categoryFilterName = ''; }
            else { d.categoryFilter = d.categories[idx - 1]._id; d.categoryFilterName = d.categories[idx - 1].name; }
            ctx._render();
          });
        }
      });

      ctx.onShow = function () {
        var v = UI.storage.get(UI.WEIGHT_KEY);
        if (v !== '' && v !== undefined) d.weightByRating = !!v;
        loadNames().then(function () { ctx._render(); });
      };
      ctx.onHide = function () { if (rollTimer) clearInterval(rollTimer); };
    }
  });

  // ==================================================================
  // 我的 pages/mine
  // ==================================================================
  UI.registerPage('mine', {
    title: '我的',
    mount: function (ctx) {
      var d = ctx.data = {
        stats: { dishCount: 0, categoryCount: 0, eatCount: 0 },
        weekNames: ['日', '一', '二', '三', '四', '五', '六'],
        calTitle: '', calCells: [], calLoading: true, monthTotal: 0,
        categoryStats: [], isCurrentMonth: true,
        dayDetail: [], dayDetailTitle: '', showImport: false, importText: ''
      };
      var now = new Date();
      var curY = now.getFullYear(), curM = now.getMonth() + 1;
      var calY = curY, calM = curM;
      var monthLogs = [];

      ctx._render = function () {
        var h = '';
        h += '<div class="card stats-card"><div class="stats-title">我的小厨房 </div><div class="stats-row">' +
          '<div class="stat-cell"><div class="stat-num">' + d.stats.dishCount + '</div><div class="stat-label">菜品</div></div>' +
          '<div class="stat-divider"></div>' +
          '<div class="stat-cell"><div class="stat-num">' + d.stats.categoryCount + '</div><div class="stat-label">分类</div></div>' +
          '<div class="stat-divider"></div>' +
          '<div class="stat-cell"><div class="stat-num">' + d.stats.eatCount + '</div><div class="stat-label">吃过记录</div></div>' +
          '</div></div>';

        h += '<div class="card calendar-card"><div class="cal-head">' +
          '<span class="cal-nav" data-act="prev">‹</span>' +
          '<span class="cal-title">' + esc(d.calTitle) + '</span>' +
          '<span class="cal-nav' + (d.isCurrentMonth ? ' cal-nav-disabled' : '') + '" data-act="next">›</span></div>';
        h += '<div class="cal-week">' + d.weekNames.map(function (w) { return '<span class="cal-week-cell">' + w + '</span>'; }).join('') + '</div>';
        h += '<div class="cal-grid">';
        d.calCells.forEach(function (c) {
          h += '<div class="cal-cell' + (c.empty ? ' cal-empty' : '') + (c.isToday ? ' cal-today' : '') + '" data-day="' + (c.day || '') + '">';
          if (!c.empty) {
            h += '<span class="cal-day-num">' + c.day + '</span>';
            if (c.count) h += '<span class="cal-dot heat-' + c.heat + '">' + c.count + '</span>';
          }
          h += '</div>';
        });
        h += '</div>';
        if (d.categoryStats.length) {
          h += '<div class="cat-stats"><div class="cat-stats-title">本月分类占比</div>';
          d.categoryStats.forEach(function (s) {
            h += '<div class="cat-bar-row"><span class="cat-bar-label"><span class="bi">' + esc(s.icon) + '</span> ' + esc(s.name) + '</span>' +
              '<div class="cat-bar-track"><div class="cat-bar-fill" style="width:' + s.percent + '%"></div></div>' +
              '<span class="cat-bar-count">' + s.count + '</span></div>';
          });
          h += '</div>';
        }
        if (!d.calLoading && !d.monthTotal) h += '<div class="cal-empty-tip">这个月还没有吃过记录，去抽一抽吧 <span class="bi">\uf2fb</span></div>';
        h += '</div>';

        // 功能入口
        h += '<div class="card menu-card">' +
          '<div class="menu-item" data-act="add"><span class="menu-icon">＋</span><span class="menu-text">添加菜品</span><span class="menu-arrow">›</span></div>' +
          '<div class="menu-item" data-act="catmgr"><span class="menu-icon bi">\uf3d9</span><span class="menu-text">分类管理</span><span class="menu-arrow">›</span></div>' +
          '<div class="menu-item" data-act="history"><span class="menu-icon"><span class="bi">\uf292</span></span><span class="menu-text">吃过时间线</span><span class="menu-arrow">›</span></div>' +
          '<div class="menu-item" data-act="export"><span class="menu-icon"><span class="bi">\uf1c6</span></span><span class="menu-text">导出数据</span><span class="menu-arrow">›</span></div>' +
          '<div class="menu-item" data-act="import"><span class="menu-icon"><span class="bi">\uf1bc</span></span><span class="menu-text">导入数据</span><span class="menu-arrow">›</span></div>' +
          '<div class="menu-item" data-act="about"><span class="menu-icon bi">\uf431</span><span class="menu-text">关于</span><span class="menu-arrow">›</span></div>' +
          '</div>';

        // POC 专属：主题切换（原型新增入口）
        var curTheme = UI.theme.get();
        h += '<div class="card theme-card"><div class="section-title">原型主题（POC 专属）</div>' +
          '<div class="theme-row">' +
          '<div class="theme-opt' + (curTheme === 'sakura' ? ' on' : '') + '" data-theme-opt="sakura">' +
          '<span class="theme-check">✓</span><div class="theme-swatch sw-sakura"></div>' +
          '<div class="theme-opt-name">樱花粉</div><div class="theme-opt-sub">当前小程序视觉</div></div>' +
          '<div class="theme-opt' + (curTheme === 'glass' ? ' on' : '') + '" data-theme-opt="glass">' +
          '<span class="theme-check">✓</span><div class="theme-swatch sw-glass"></div>' +
          '<div class="theme-opt-name">Liquid Glass</div><div class="theme-opt-sub">iOS 液态玻璃概念</div></div>' +
          '</div></div>';

        // POC 专属：演示控制
        var pref = MockDB.getPref();
        h += '<div class="card theme-card"><div class="section-title">演示控制（POC 专属）</div>' +
          '<div class="menu-item" data-act="reset"><span class="menu-icon">↺</span><span class="menu-text">重置为示例数据</span><span class="menu-arrow">›</span></div>' +
          '<div class="menu-item" data-act="clear"><span class="menu-icon">🗑</span><span class="menu-text">清空数据（看空态）</span><span class="menu-arrow">›</span></div>' +
          '<div class="menu-item" data-act="slow"><span class="menu-icon">🐢</span><span class="menu-text">模拟慢网络（加载中状态）</span>' +
          '<span style="margin-left:auto">' + makeSwitchStaticHtml(!!pref.slow) + '</span></div>' +
          '</div>';

        h += '<div class="footer">Yuki小厨房 · 个人点菜灵感工具</div>';
        h += '<div style="height:80px"></div>';

        // 导入弹层
        if (d.showImport) {
          h += '<div class="import-mask" data-act="closeImport"><div class="import-panel" data-noop>' +
            '<div class="import-title">导入数据</div>' +
            '<div class="import-tip">粘贴之前「导出数据」复制的 JSON，已存在的内容会自动跳过，不会覆盖现有数据。</div>' +
            '<textarea class="import-textarea" placeholder=\'{"categories":[...],"dishes":[...],"eatLogs":[...]}\'></textarea>' +
            '<div class="import-actions"><div class="import-btn-ghost" data-act="closeImport">取消</div>' +
            '<div class="import-btn-primary" data-act="doImport">开始导入</div></div></div></div>';
        }
        // 当日吃历弹层
        if (d.dayDetail.length) {
          h += '<div class="import-mask" data-act="closeDay"><div class="import-panel day-panel" data-noop>' +
            '<div class="import-title">' + esc(d.dayDetailTitle) + '</div>';
          d.dayDetail.forEach(function (item) {
            h += '<div class="day-item">' +
              (item.coverImage ? '<img class="day-thumb" src="' + esc(item.coverImage) + '">' : '<div class="day-thumb day-thumb-ph"><span class="bi">\uf312</span></div>') +
              '<div class="day-info"><span class="day-name">' + esc(item.dishName) + '</span>' +
              (item.note ? '<span class="day-note">' + esc(item.note) + '</span>' : '') + '</div></div>';
          });
          h += '<div class="import-actions"><div class="import-btn-primary" data-act="closeDay">关闭</div></div></div></div>';
        }

        ctx.body.innerHTML = h;
        // 绑定慢网络开关
        var slowItem = ctx.body.querySelector('[data-act="slow"] .wx-switch');
        if (slowItem) {
          slowItem.addEventListener('click', function (e) {
            e.stopPropagation();
            var on = !slowItem.classList.contains('on');
            slowItem.classList.toggle('on', on);
            slowItem.querySelector('.sw-knob').style.transform = on ? 'translateX(20px)' : '';
            MockDB.setPref('slow', on);
            UI.toast(on ? '已开启慢网络模拟' : '已关闭慢网络模拟');
          });
        }
      };

      function makeSwitchStaticHtml(on) {
        return '<div class="wx-switch' + (on ? ' on' : '') + '"><div class="sw-knob"' + (on ? ' style="transform:translateX(20px)"' : '') + '></div></div>';
      }

      function loadStats() {
        return api.getStats().then(function (s) { d.stats = s; ctx._render(); }).catch(api.handleErr);
      }

      function loadMonth() {
        var ym = calY + '-' + String(calM).padStart(2, '0');
        d.calLoading = true;
        return api.listEatLogsByMonth(ym).then(function (res) {
          monthLogs = res.logs || [];
          var countByDay = {};
          monthLogs.forEach(function (l) { countByDay[new Date(l.eatenAt).getDate()] = (countByDay[new Date(l.eatenAt).getDate()] || 0) + 1; });
          var first = new Date(calY, calM - 1, 1);
          var firstWeekday = first.getDay();
          var daysInMonth = new Date(calY, calM, 0).getDate();
          var isTodayMonth = curY === calY && curM === calM;
          var cells = [];
          for (var i = 0; i < firstWeekday; i++) cells.push({ empty: true });
          for (var day = 1; day <= daysInMonth; day++) {
            var count = countByDay[day] || 0;
            cells.push({ day: day, count: count, heat: count >= 3 ? 3 : count, isToday: isTodayMonth && day === new Date().getDate() });
          }
          var total = res.total || 0;
          d.calCells = cells;
          d.calTitle = calY + '年' + calM + '月';
          d.categoryStats = (res.categoryStats || []).map(function (s) {
            return Object.assign({}, s, { percent: total ? Math.round(s.count * 100 / total) : 0 });
          });
          d.monthTotal = total;
          d.isCurrentMonth = curY === calY && curM === calM;
          d.calLoading = false;
          ctx._render();
        }).catch(function (err) { d.calLoading = false; api.handleErr(err, '吃历加载失败'); });
      }

      ctx.onShow = function () { loadStats(); loadMonth(); };

      ctx.body.addEventListener('click', function (e) {
        if (e.target.closest('[data-noop]')) return;
        var t = e.target.closest('[data-act],[data-day],[data-theme-opt]');
        if (!t) return;
        if (t.dataset.themeOpt) {
          var theme = t.dataset.themeOpt;
          if (theme === UI.theme.get()) return;
          var rect = t.getBoundingClientRect();
          var screenRect = UI.$('#screen').getBoundingClientRect();
          UI.theme.apply(theme, {
            animate: true,
            x: ((rect.left + rect.width / 2 - screenRect.left) / screenRect.width * 100),
            y: ((rect.top + rect.height / 2 - screenRect.top) / screenRect.height * 100)
          });
          setTimeout(function () { ctx._render(); }, 60);
          return;
        }
        if (t.dataset.day && t.dataset.day !== '') {
          var day = Number(t.dataset.day);
          var items = monthLogs.filter(function (l) { return new Date(l.eatenAt).getDate() === day; });
          if (!items.length) return;
          d.dayDetail = items;
          d.dayDetailTitle = calM + '月' + day + '日 · 吃了 ' + items.length + ' 顿';
          ctx._render();
          return;
        }
        var act = t.dataset.act;
        if (!act) return;
        if (act === 'prev') { calM--; if (calM < 1) { calM = 12; calY--; } loadMonth(); }
        else if (act === 'next') { if (d.isCurrentMonth) return; calM++; if (calM > 12) { calM = 1; calY++; } loadMonth(); }
        else if (act === 'add') R.navigateTo('dish-edit');
        else if (act === 'catmgr') R.navigateTo('category-manage');
        else if (act === 'history') R.navigateTo('history');
        else if (act === 'about') {
          UI.modal({
            title: '关于「Yuki小厨房」',
            content: '个人点菜灵感小工具：不知道吃啥时来抽一抽，随手维护自己的菜品库。数据存于微信云开发，仅自己可见。',
            showCancel: false, confirmColor: '#FF8FB8'
          });
        } else if (act === 'export') {
          UI.loading({ title: '导出中', mask: true });
          api.exportData().then(function (data) {
            var json = JSON.stringify(data, null, 2);
            UI.hideLoading();
            UI.actionSheet({ itemList: ['复制到剪贴板', '仅预览前几条'] }).then(function (a) {
              if (a.tapIndex === 0) {
                UI.clipboard({
                  data: json,
                  success: function () { UI.toast('已复制，记得粘到备忘录'); }
                });
              } else {
                UI.modal({
                  title: '导出预览',
                  content: '共 ' + data.categories.length + ' 个分类、' + data.dishes.length + ' 道菜、' + data.eatLogs.length + ' 条记录。（浏览器原型：完整数据可在控制台查看 window.__lastExport）',
                  showCancel: false, confirmColor: '#FF8FB8'
                });
                global.__lastExport = data;
              }
            }).catch(function () {});
          }).catch(function (err) { UI.hideLoading(); api.handleErr(err, '导出失败'); });
        } else if (act === 'import') { d.showImport = true; d.importText = ''; ctx._render(); }
        else if (act === 'closeImport') { d.showImport = false; ctx._render(); }
        else if (act === 'doImport') {
          var ta = ctx.body.querySelector('.import-textarea');
          var text = (ta.value || '').trim();
          if (!text) { UI.toast('先粘贴导出的 JSON'); return; }
          var data;
          try { data = JSON.parse(text); } catch (err) { UI.toast('JSON 格式不合法'); return; }
          var cats = Array.isArray(data.categories) ? data.categories : [];
          var dishes = Array.isArray(data.dishes) ? data.dishes : [];
          var logs = Array.isArray(data.eatLogs) ? data.eatLogs : [];
          if (!cats.length && !dishes.length && !logs.length) { UI.toast('没有可导入的数据'); return; }
          UI.modal({
            title: '确认导入',
            content: '将合并导入 ' + cats.length + ' 个分类、' + dishes.length + ' 道菜、' + logs.length + ' 条记录；已存在的自动跳过，不会覆盖现有数据。',
            confirmColor: '#FF8FB8'
          }).then(function (m) {
            if (!m.confirm) return;
            UI.loading({ title: '导入中', mask: true });
            api.importData(data).then(function (stat) {
              UI.hideLoading();
              d.showImport = false;
              ctx._render();
              UI.toast('新增 ' + stat.categories + ' 分类 ' + stat.dishes + ' 菜 ' + stat.eatLogs + ' 记录，跳过 ' + stat.skipped, 3000);
              loadStats(); loadMonth();
            }).catch(function (err) { UI.hideLoading(); api.handleErr(err, '导入失败'); });
          });
        } else if (act === 'closeDay') { d.dayDetail = []; ctx._render(); }
        else if (act === 'reset') {
          UI.modal({ title: '重置数据', content: '将恢复为初始示例数据（8 道菜 + 5 分类 + 吃历样本），当前修改会丢失。', confirmColor: '#FF8FB8' }).then(function (m) {
            if (!m.confirm) return;
            MockDB.resetDemo();
            UI.toast('已重置为示例数据');
            loadStats(); loadMonth();
          });
        } else if (act === 'clear') {
          UI.modal({ title: '清空数据', content: '清空全部 Mock 数据，用于演示空态引导流程。可在本页「重置为示例数据」恢复。', confirmColor: '#FF8FB8' }).then(function (m) {
            if (!m.confirm) return;
            MockDB.clearAll();
            UI.toast('已清空，去看看首页和菜品库');
            loadStats(); loadMonth();
          });
        } else if (act === 'slow') { /* switch 自行处理 */ }
      });
    }
  });

  // ==================================================================
  // 菜品详情 pages/dish-detail（自定义透明导航栏）
  // ==================================================================
  UI.registerPage('dish-detail', {
    title: '菜品详情',
    customNav: true,
    mount: function (ctx) {
      var d = ctx.data = {
        id: ctx.params.id || '', loading: true, dish: null,
        categoryName: '', priceYuan: '', lastEatenText: '', isShared: false
      };

      ctx.body.style.padding = '0';
      var inner = el('div', 'pg-body');
      inner.style.padding = '12px';
      ctx.body.appendChild(inner);

      ctx._render = function () {
        if (d.loading) {
          inner.innerHTML =
            '<div class="skeleton-item" style="height:150px"></div>' +
            '<div class="skeleton-item"><div style="flex:1"><div class="skeleton-line" style="width:50%"></div><div class="skeleton-line" style="width:80%"></div></div></div>';
          return;
        }
        if (!d.dish) { inner.innerHTML = '<div class="empty-state"><div class="empty-icon">🍽</div><div class="empty-text">菜品不存在或已删除</div></div>'; return; }
        var dish = d.dish;
        var h = '';
        if (dish.coverImage) {
          h += '<img class="cover" src="' + esc(dish.coverImage) + '" data-act="preview" data-url="' + esc(dish.coverImage) + '" alt="">';
        } else {
          h += '<div class="cover cover-ph img-ph"><span class="bi">\uf312</span></div>';
        }
        h += '<div class="card info-card"><div class="name-row"><div class="name">' + esc(dish.name) + '</div>' +
          '<div class="edit-btn" data-act="edit"><span class="bi">\uf4cb</span> 编辑</div></div>';
        h += '<div class="meta">' +
          (d.categoryName ? '<span class="chip chip-plain">' + esc(d.categoryName) + '</span>' : '') +
          (d.priceYuan ? '<span class="chip">¥' + d.priceYuan + '</span>' : '') +
          (d.lastEatenText ? '<span class="last-eaten">' + esc(d.lastEatenText) + '</span>' : '') +
          '</div>';
        h += '<div class="rate-row"><span class="rate-label">我的评分</span>' + starsHtml(dish.rating || 0) + '</div>';
        h += '<div class="status-row">';
        STATUS_LIST.forEach(function (s) {
          h += '<div class="status-btn' + (dish.status === s.key ? ' on' : '') + '" data-act="status" data-status="' + s.key + '"><span class="bi">' + s.icon + '</span> ' + s.text + '</div>';
        });
        h += '</div></div>';
        if (dish.description) {
          h += '<div class="card"><div class="section-title">介绍 / 做法笔记</div><div class="desc">' + esc(dish.description) + '</div></div>';
        }
        if (dish.tags && dish.tags.length) {
          h += '<div class="card"><div class="section-title">标签</div><div>' +
            dish.tags.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') + '</div></div>';
        }
        if (dish.images && dish.images.length) {
          h += '<div class="card"><div class="section-title">图片</div><div class="img-grid">' +
            dish.images.map(function (u) { return '<img class="grid-img" src="' + esc(u) + '" data-act="preview" data-url="' + esc(u) + '">'; }).join('') +
            '</div></div>';
        }
        if (!d.isShared) {
          h += '<div class="action-section">' +
            '<button class="btn-primary log-btn" data-act="log"><span class="bi">\uf588</span> 记一笔「今天吃了」</button>' +
            '<div class="share-row">' +
            '<button class="share-btn" data-act="poster"><span class="bi">\uf42a</span> 生成分享海报</button>' +
            '<button class="share-btn" data-act="share"><span class="bi">\uf52e</span> 分享给好友</button>' +
            '</div>' +
            '<div class="delete-link" data-act="del">删除这道菜</div></div>';
        } else {
          h += '<div class="action-section"><button class="btn-primary log-btn" data-act="copy"><span class="bi">\uf588</span> 保存到我的菜单</button></div>';
        }
        h += '<div style="height:30px"></div>';
        inner.innerHTML = h;
      };

      function loadDish() {
        if (!d.id) { d.loading = false; ctx._render(); return; }
        Promise.all([api.getDish(d.id), api.listCategories()]).then(function (res) {
          var dish = res[0], categories = res[1];
          var cat = categories.filter(function (c) { return c._id === dish.categoryId; })[0];
          d.loading = false;
          d.dish = dish;
          d.categoryName = cat ? cat.name : '';
          d.priceYuan = util.fenToYuan(dish.price);
          d.lastEatenText = dish.lastEatenAt
            ? '上次吃：' + util.timeAgo(dish.lastEatenAt) + '（' + util.formatDate(dish.lastEatenAt) + '）'
            : '还没吃过这道菜';
          d.isShared = false; // Mock：全部视为本人菜品
          ctx._render();
        }).catch(function (err) {
          console.error('[dish-detail] load fail:', err);
          api.handleErr(err);
          d.loading = false; d.dish = null;
          ctx._render();
        });
      }

      ctx.onShow = function () { loadDish(); };

      inner.addEventListener('click', function (e) {
        var t = e.target.closest('[data-act]');
        if (!t) return;
        var act = t.dataset.act;
        if (act === 'preview') {
          var coverUrl = d.dish.coverImage;
          var imgs = d.dish.images || [];
          var urls = [coverUrl].concat(imgs).filter(Boolean);
          UI.previewImage({ current: t.dataset.url, urls: urls });
        } else if (act === 'edit') {
          R.navigateTo('dish-edit?id=' + d.id);
        } else if (act === 'status') {
          var status = t.dataset.status;
          if (status === d.dish.status) return;
          api.updateDish(d.id, { status: status }).then(function () {
            UI.toast({ title: '已更新', icon: 'success' });
            loadDish();
          }).catch(api.handleErr);
        } else if (act === 'log') {
          UI.loading('记录中');
          api.logEat(d.id).then(function () {
            UI.hideLoading();
            UI.toast({ title: '记好啦，吃得开心！', icon: 'success' });
            loadDish();
          }).catch(function (err) { UI.hideLoading(); api.handleErr(err); });
        } else if (act === 'poster') {
          Poster.generate({ dish: Object.assign({}, d.dish, { priceYuan: d.priceYuan }), categoryName: d.categoryName });
        } else if (act === 'share') {
          UI.toast('原型演示：微信分享能力未接入');
        } else if (act === 'del') {
          UI.modal({
            title: '删除菜品',
            content: '确定删除「' + d.dish.name + '」吗？删除后不再出现在随机推荐里。',
            confirmColor: '#FF8FB8'
          }).then(function (m) {
            if (!m.confirm) return;
            api.deleteDish(d.id).then(function () {
              UI.toast({ title: '已删除', icon: 'success' });
              setTimeout(function () { R.navigateBack(); }, 600);
            }).catch(api.handleErr);
          });
        } else if (act === 'copy') {
          UI.loading('保存中');
          api.saveSharedDish(d.dish._id).then(function () {
            UI.hideLoading();
            UI.toast({ title: '已保存到我的菜单', icon: 'success' });
            loadDish();
          }).catch(function (err) { UI.hideLoading(); api.handleErr(err, '保存失败'); });
        }
      });

      // 星级评分
      inner.addEventListener('click', function (e) {
        var star = e.target.closest('.star');
        if (!star || !d.dish) return;
        var v = Number(star.dataset.star);
        api.updateDish(d.id, { rating: v }).then(function () {
          d.dish.rating = v;
          inner.querySelectorAll('.rate-row .star').forEach(function (s) {
            s.classList.toggle('on', Number(s.dataset.star) <= v);
          });
        }).catch(api.handleErr);
      });
    }
  });

  // ==================================================================
  // 添加/编辑菜品 pages/dish-edit
  // ==================================================================
  UI.registerPage('dish-edit', {
    title: '添加菜品',
    mount: function (ctx) {
      var id = ctx.params.id || '';
      var aiMode = ctx.params.ai === '1';
      var d = ctx.data = {
        id: id, isEdit: !!id, submitting: false,
        name: '', categoryId: '', categories: [], categoryIndex: 0,
        description: '', priceYuan: '', tags: [], tagInput: '',
        rating: 0, status: 'want',
        images: [], maxImages: 9,
        aiMode: aiMode, aiRecognized: false, aiScanning: false, aiScanStep: 0,
        aiBanner: { show: false, text: '' }, catSuggest: { show: false, name: '' }
      };
      var dirty = { name: false, categoryId: false, priceYuan: false, description: false, tags: false };
      var hasRecognized = false;
      var scanTimer = null;
      var aiCancelled = false;

      UI.$('#navTitle').textContent = id ? '编辑菜品' : '添加菜品';

      ctx.body.style.padding = '0';
      var inner = el('div', 'pg-body');
      inner.style.padding = '12px';
      ctx.body.appendChild(inner);

      // 演示用图片池（模拟相册选图，data URI）
      var demoImgs = [
        MockDB.foodImg('🍜', '#ffe9c9', '#ffb85c'),
        MockDB.foodImg('🍚', '#fff0d0', '#ffc977'),
        MockDB.foodImg('🍤', '#ffe0d0', '#ff9d6b'),
        MockDB.foodImg('🥘', '#ffd9d9', '#ff8d8d')
      ];

      ctx._render = function () {
        var h = '';
        // 图片卡
        h += '<div class="card"><div class="section-title">菜品图片 <span class="title-hint">（第一张为封面，最多' + d.maxImages + '张）</span></div>';
        if (!d.images.length) {
          h += '<div class="ai-guide' + (d.aiMode ? ' pulse' : '') + '" data-act="aiPick">' +
            '<div class="ai-guide-icon"><span class="bi">\uf46d</span></div>' +
            '<div class="ai-guide-text"><div class="ai-guide-title">AI 识别添加 <span class="ai-tag">AI</span></div>' +
            '<div class="ai-guide-sub">拍照或选一张菜品图，自动填写菜名、分类、价格、描述、标签</div></div>' +
            '<span class="ai-guide-arrow">›</span></div>';
        }
        h += '<div class="img-grid-edit">';
        d.images.forEach(function (img, i) {
          h += '<div class="img-cell"><img class="cell-img" src="' + esc(img.local) + '" data-act="pvImg" data-i="' + i + '">' +
            (i === 0 ? '<div class="cover-badge">封面</div>' : '') +
            '<div class="img-del" data-act="rmImg" data-i="' + i + '">✕</div>' +
            (i === 0 && d.aiRecognized ? '<div class="re-scan" data-act="reScan"><span class="bi">\uf46d</span> 重新识别</div>' : '') +
            '</div>';
        });
        if (d.images.length < d.maxImages) {
          h += '<div class="img-cell img-add" data-act="choose"><div class="add-icon"><span class="bi">\uf220</span></div><div class="add-text">上传图片</div></div>';
        }
        h += '</div></div>';

        // 基本信息
        h += '<div class="card">' +
          '<div class="form-item"><span class="form-label">名称 <span class="required">*</span></span>' +
          '<input class="form-input" data-field="name" placeholder="如：番茄牛腩煲" maxlength="30" value="' + esc(d.name) + '"></div>' +
          '<div class="form-item"><span class="form-label">分类</span>' +
          '<div class="form-picker" data-act="catPick">' + esc(d.categoryNames ? d.categoryNames[d.categoryIndex] : '不分类') + ' ▾</div></div>';
        if (d.catSuggest.show) {
          h += '<div class="cat-suggest"><span class="bi cat-suggest-icon">\uf46d</span>' +
            '<div class="cat-suggest-text">AI 建议新分类「' + esc(d.catSuggest.name) + '」</div>' +
            '<div class="cat-suggest-btns"><div class="cat-suggest-btn primary" data-act="createCat">创建并使用</div>' +
            '<div class="cat-suggest-btn" data-act="dismissCat">不用</div></div></div>';
        }
        h += '<div class="form-item"><span class="form-label">价格（选填）</span>' +
          '<div class="price-wrap"><span class="price-symbol">¥</span>' +
          '<input class="form-input price-input" type="number" inputmode="decimal" placeholder="48" data-field="price" value="' + esc(d.priceYuan) + '"></div></div>' +
          '<div class="form-item"><span class="form-label">评分</span>' + starsHtml(d.rating) + '</div>' +
          '<div class="form-item"><span class="form-label">状态</span><div class="status-row" style="flex:1">';
        STATUS_LIST.forEach(function (s) {
          h += '<div class="status-btn' + (d.status === s.key ? ' on' : '') + '" data-act="status" data-status="' + s.key + '"><span class="bi">' + s.icon + '</span> ' + s.text + '</div>';
        });
        h += '</div></div></div>';

        // 标签
        h += '<div class="card"><div class="section-title">标签 <span class="title-hint">（辣、快手、聚餐…最多10个）</span></div>';
        h += '<div class="tag-list">' + d.tags.map(function (t, i) {
          return '<span class="chip tag-item">' + esc(t) + ' <span class="tag-del" data-act="rmTag" data-i="' + i + '">✕</span></span>';
        }).join('') + '</div>';
        h += '<div class="tag-input-row"><input class="form-input tag-input" placeholder="输入标签后点添加" maxlength="8" data-field="tagInput" value="' + esc(d.tagInput) + '">' +
          '<div class="tag-add-btn" data-act="addTag">添加</div></div></div>';

        // 介绍
        h += '<div class="card"><div class="section-title">介绍 / 做法笔记（选填）</div>' +
          '<textarea class="form-textarea" placeholder="记点做法要点、口味心得，比如：番茄要多炒出沙…" maxlength="2000" data-field="desc">' + esc(d.description) + '</textarea>' +
          '<div class="count">' + d.description.length + '/2000</div></div>';

        // AI 回填横幅
        if (d.aiBanner.show) {
          h += '<div class="ai-banner"><span class="bi">\uf633</span>' +
            '<span class="ai-banner-text">' + esc(d.aiBanner.text) + '</span>' +
            '<span class="bi ai-banner-close" data-act="closeBanner">\uf659</span></div>';
        }

        h += '<div class="btn-primary submit-btn' + (d.submitting ? ' btn-disabled' : '') + '" data-act="submit">' +
          (d.submitting ? '保存中…' : (d.isEdit ? '保存修改' : '保存菜品')) + '</div>';
        h += '<div style="height:30px"></div>';

        // 全屏扫描层
        if (d.aiScanning) {
          h += '<div class="scan-overlay"><div class="scan-box">' +
            '<div class="scan-corner tl"></div><div class="scan-corner tr"></div>' +
            '<div class="scan-corner bl"></div><div class="scan-corner br"></div>' +
            '<div class="scan-line"></div></div>' +
            '<div class="scan-title">AI 正在识别…</div>' +
            '<div class="scan-steps">' + ['正在上传图片…', 'AI 识别中，一般 10 秒内…', '快好了，整理信息…'][d.aiScanStep] + '</div>' +
            '<div class="scan-cancel" data-act="cancelScan">取消识别</div></div>';
        }

        inner.innerHTML = h;
        // 输入框绑定（局部事件，不重绘避免失焦）
        inner.querySelectorAll('[data-field]').forEach(function (inp) {
          inp.addEventListener('input', function () {
            var f = inp.dataset.field;
            if (f === 'name') { dirty.name = true; d.name = inp.value; }
            else if (f === 'price') { dirty.priceYuan = true; d.priceYuan = inp.value; }
            else if (f === 'desc') { dirty.description = true; d.description = inp.value; var c = inner.querySelector('.count'); if (c) c.textContent = inp.value.length + '/2000'; }
            else if (f === 'tagInput') { d.tagInput = inp.value; }
          });
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && inp.dataset.field === 'tagInput') addTag();
          });
        });
      };

      function setCategoryNames() {
        d.categoryNames = ['不分类'].concat(d.categories.map(function (c) { return c.name; }));
      }

      function loadCategories() {
        return api.listCategories().then(function (cats) {
          d.categories = cats;
          setCategoryNames();
          if (id) return loadDish();
          ctx._render();
        }).catch(api.handleErr);
      }

      function loadDish() {
        return api.getDish(id).then(function (dish) {
          var allImgs = [dish.coverImage].concat(dish.images || []).filter(Boolean).map(function (u) { return { local: u, fileID: u }; });
          var catIdx = d.categories.findIndex(function (c) { return c._id === dish.categoryId; });
          d.name = dish.name;
          d.categoryId = dish.categoryId || '';
          d.categoryIndex = catIdx >= 0 ? catIdx + 1 : 0;
          d.description = dish.description || '';
          d.priceYuan = dish.price === null || dish.price === undefined ? '' : util.fenToYuan(dish.price);
          d.tags = dish.tags || [];
          d.rating = dish.rating || 0;
          d.status = dish.status || 'want';
          d.images = allImgs;
          ctx._render();
        }).catch(api.handleErr);
      }

      // ---- AI 识别（mock）----
      function openAiPicker() {
        // 模拟 wx.chooseMedia 系统菜单：这里直接弹来源选择
        UI.actionSheet({ itemList: ['模拟拍照识别', '模拟相册选图（非食物 → 失败演示）', '取消'] }).then(function (a) {
          if (a.tapIndex === 0) startAiRecognize(true);
          else if (a.tapIndex === 1) startAiRecognize(false);
        }).catch(function () {});
      }

      function startAiRecognize(isFood) {
        if (d.aiScanning) return;
        aiCancelled = false;
        d.aiScanning = true; d.aiScanStep = 0;
        ctx._render();
        scanTimer = setInterval(function () {
          d.aiScanStep = Math.min(2, d.aiScanStep + 1);
          var s = inner.querySelector('.scan-steps');
          if (s) s.textContent = ['正在上传图片…', 'AI 识别中，一般 10 秒内…', '快好了，整理信息…'][d.aiScanStep];
        }, 4000);

        var img = demoImgs[Math.floor(Math.random() * demoImgs.length)];
        var work = isFood ? api.recognizeDish() : Promise.resolve({ isFood: false });
        work.then(function (result) {
          if (aiCancelled) return;
          if (!result.isFood) {
            UI.modal({
              title: '没认出这是菜',
              content: '这张照片里似乎不是菜品，换一张试试？',
              confirmText: '换图', cancelText: '手动填写', confirmColor: '#FF8FB8'
            }).then(function (m) { if (m.confirm) openAiPicker(); });
            return;
          }
          // 封面就位（mock：用演示图）
          d.images[0] = { local: img, fileID: 'mock://ai-tmp/' + Date.now(), aiTmp: true };
          d.aiRecognized = true;
          applyAiResult(result);
        }).catch(function (err) {
          if (!aiCancelled) {
            UI.modal({
              title: '识别失败',
              content: (err.message || '识别失败') + '。可以换张图重试，或直接手动填写。',
              confirmText: '换图', cancelText: '手动填写', confirmColor: '#FF8FB8'
            }).then(function (m) { if (m.confirm) openAiPicker(); });
          }
        }).finally(function () {
          if (scanTimer) clearInterval(scanTimer);
          scanTimer = null;
          d.aiScanning = false;
          d.aiMode = false;
          ctx._render();
        });
      }

      function applyAiResult(r) {
        var updated = 0, kept = 0;
        if (dirty.name) kept++; else { d.name = r.name; updated++; }
        if (r.priceYuan !== null && r.priceYuan !== undefined) {
          if (dirty.priceYuan) kept++; else { d.priceYuan = String(r.priceYuan); updated++; }
        }
        if (r.description) {
          if (dirty.description) kept++; else { d.description = r.description; updated++; }
        }
        if (r.tags && r.tags.length) {
          if (dirty.tags) kept++; else { d.tags = r.tags.slice(0, 10); updated++; }
        }
        if (r.matchedCategoryName) {
          if (dirty.categoryId) kept++;
          else {
            var idx = d.categories.findIndex(function (c) { return c.name === r.matchedCategoryName; });
            if (idx >= 0) {
              d.categoryIndex = idx + 1;
              d.categoryId = d.categories[idx]._id;
              updated++;
            }
          }
        } else if (r.suggestedCategory && !dirty.categoryId) {
          d.catSuggest = { show: true, name: r.suggestedCategory };
        }
        var mockTag = r.mock ? '（mock）' : '';
        d.aiBanner = {
          show: true,
          text: hasRecognized
            ? 'AI 更新 ' + updated + ' 个字段，保留 ' + kept + ' 个手改字段' + mockTag
            : 'AI 已识别并填写 ' + updated + ' 个字段' + (kept ? '，保留 ' + kept + ' 个手改字段' : '') + mockTag
        };
        hasRecognized = true;
      }

      function addTag() {
        var tag = (d.tagInput || '').trim();
        if (!tag) return;
        if (tag.length > 8) return UI.toast('标签最长 8 字');
        if (d.tags.indexOf(tag) >= 0) return UI.toast('标签已存在');
        if (d.tags.length >= 10) return UI.toast('最多 10 个标签');
        dirty.tags = true;
        d.tags = d.tags.concat([tag]);
        d.tagInput = '';
        ctx._render();
      }

      function onSubmit() {
        if (d.submitting) return;
        var name = (d.name || '').trim();
        if (!name) return UI.toast('给菜品起个名字吧');
        if (name.length > 30) return UI.toast('名称最长 30 字');
        d.submitting = true;
        ctx._render();
        UI.loading({ title: '保存中', mask: true });
        var data = {
          name: name,
          categoryId: d.categoryId,
          description: d.description,
          price: d.priceYuan === '' ? null : util.yuanToFen(d.priceYuan),
          tags: d.tags,
          rating: d.rating,
          status: d.status,
          coverImage: d.images.length ? (d.images[0].fileID && d.images[0].fileID.indexOf('data:') === 0 ? d.images[0].fileID : d.images[0].local) : '',
          images: d.images.slice(1).map(function (i) { return i.local; })
        };
        var p = d.isEdit ? api.updateDish(d.id, data) : api.addDish(data);
        p.then(function () {
          UI.hideLoading();
          UI.toast({ title: '保存成功', icon: 'success' });
          setTimeout(function () { R.navigateBack(); }, 700);
        }).catch(function (err) {
          UI.hideLoading();
          d.submitting = false;
          ctx._render();
          api.handleErr(err, '保存失败，请重试');
        });
      }

      inner.addEventListener('click', function (e) {
        var star = e.target.closest('.star');
        if (star) { d.rating = Number(star.dataset.star); ctx._render(); return; }
        var t = e.target.closest('[data-act]');
        if (!t) return;
        var act = t.dataset.act;
        if (act === 'aiPick' || act === 'reScan') openAiPicker();
        else if (act === 'cancelScan') {
          aiCancelled = true;
          if (scanTimer) clearInterval(scanTimer);
          scanTimer = null;
          d.aiScanning = false;
          ctx._render();
          UI.toast('已取消识别');
        } else if (act === 'choose') {
          // 模拟 wx.chooseMedia：直接给一张演示图
          if (d.images.length >= d.maxImages) return UI.toast('最多 ' + d.maxImages + ' 张');
          var img = demoImgs[d.images.length % demoImgs.length];
          d.images = d.images.concat([{ local: img, fileID: '' }]);
          ctx._render();
        } else if (act === 'rmImg') {
          var i = Number(t.dataset.i);
          d.images.splice(i, 1);
          ctx._render();
        } else if (act === 'pvImg') {
          UI.previewImage({ current: Number(t.dataset.i), urls: d.images.map(function (x) { return x.local; }) });
        } else if (act === 'catPick') {
          showPicker(d.categoryNames, d.categoryIndex).then(function (idx) {
            if (idx === null) return;
            dirty.categoryId = true;
            d.categoryIndex = idx;
            d.categoryId = idx === 0 ? '' : d.categories[idx - 1]._id;
            ctx._render();
          });
        } else if (act === 'createCat') {
          var name = d.catSuggest.name;
          api.addCategory({ name: name, icon: '\uf46d' }).then(function () {
            return api.listCategories();
          }).then(function (cats) {
            d.categories = cats;
            setCategoryNames();
            var idx = cats.findIndex(function (c) { return c.name === name; });
            d.categoryIndex = idx >= 0 ? idx + 1 : 0;
            d.categoryId = idx >= 0 ? cats[idx]._id : '';
            d.catSuggest.show = false;
            ctx._render();
            UI.toast('分类「' + name + '」已创建');
          }).catch(function (err) { api.handleErr(err, '创建分类失败'); });
        } else if (act === 'dismissCat') { d.catSuggest.show = false; ctx._render(); }
        else if (act === 'status') { d.status = t.dataset.status; ctx._render(); }
        else if (act === 'addTag') addTag();
        else if (act === 'rmTag') { dirty.tags = true; d.tags.splice(Number(t.dataset.i), 1); ctx._render(); }
        else if (act === 'closeBanner') { d.aiBanner.show = false; ctx._render(); }
        else if (act === 'submit') onSubmit();
      });

      ctx.onShow = function () {
        UI.$('#navTitle').textContent = id ? '编辑菜品' : '添加菜品';
        loadCategories().then(function () {
          if (aiMode && !d._aiOpened) { d._aiOpened = true; openAiPicker(); }
        });
      };
      ctx.onHide = function () { if (scanTimer) clearInterval(scanTimer); };
    }
  });

  // ==================================================================
  // 分类管理 pages/category-manage
  // ==================================================================
  UI.registerPage('category-manage', {
    title: '分类管理',
    mount: function (ctx) {
      var ICONS = ['\uf312', '\uf182', '\uf2df', '🍱', '\uf7f6', '\uf6ed', '\uf46d', '\uf180', '\uf179', '\uf3ec', '\uf2e0', '\uf7eb', '\uf30d', '\uf5a2', '\uf496', '\uf415'];
      var d = ctx.data = {
        loading: true, categories: [],
        showModal: false, editingId: '', inputName: '', inputIcon: ICONS[0], submitting: false
      };

      function renderModal() {
        if (!d.showModal) return '';
        var h = '<div class="mask" data-act="closeModal"><div class="modal" data-noop>' +
          '<div class="modal-title">' + (d.editingId ? '编辑分类' : '新增分类') + '</div>' +
          '<div class="field"><span class="field-label">名称</span>' +
          '<input class="form-input field-input" placeholder="如：家常菜" maxlength="10" data-field="catName" value="' + esc(d.inputName) + '"></div>' +
          '<div class="field-col"><span class="field-label">图标</span><div class="icon-grid">';
        ICONS.forEach(function (ic) {
          h += '<div class="icon-cell bi' + (d.inputIcon === ic ? ' on' : '') + '" data-icon="' + ic + '">' + esc(ic) + '</div>';
        });
        h += '</div></div><div class="modal-btns">' +
          '<div class="modal-btn cancel" data-act="closeModal">取消</div>' +
          '<div class="modal-btn confirm" data-act="saveCat">' + (d.submitting ? '保存中' : '保存') + '</div>' +
          '</div></div></div>';
        return h;
      }

      ctx._render = function () {
        var h = '';
        if (d.loading) {
          h += '<div class="skeleton-item"><div style="flex:1"><div class="skeleton-line"></div><div class="skeleton-line" style="width:50%"></div></div></div>';
        } else {
          h += '<div class="tip">分类用于归置菜品，排序影响菜品库侧栏顺序。删除前需清空分类下的菜品。</div>';
          d.categories.forEach(function (c, i) {
            h += '<div class="card cat-row"><div class="cat-main">' +
              '<span class="cat-icon bi">' + esc(c.icon) + '</span>' +
              '<span class="cat-name">' + esc(c.name) + '</span></div>' +
              '<div class="cat-ops">' +
              '<span class="op" data-act="move" data-i="' + i + '" data-dir="-1">↑</span>' +
              '<span class="op" data-act="move" data-i="' + i + '" data-dir="1">↓</span>' +
              '<span class="op bi" data-act="editCat" data-i="' + i + '">\uf4cb</span>' +
              '<span class="op op-del" data-act="delCat" data-i="' + i + '"><span class="bi">\uf659</span></span>' +
              '</div></div>';
          });
          if (!d.categories.length) {
            h += '<div class="empty-state"><div class="empty-icon bi">\uf3d9</div><div class="empty-text">还没有分类</div></div>';
          }
          h += '<div class="btn-primary add-btn" data-act="addCat">＋ 新增分类</div>';
        }
        h += '<div style="height:30px"></div>';
        h += renderModal();
        ctx.body.innerHTML = h;
        var inp = ctx.body.querySelector('[data-field="catName"]');
        if (inp) {
          inp.addEventListener('input', function () { d.inputName = inp.value; });
          setTimeout(function () { inp.focus(); }, 50);
        }
      };

      function load() {
        d.loading = true;
        ctx._render();
        api.listCategories().then(function (cats) {
          d.categories = cats;
          d.loading = false;
          ctx._render();
        }).catch(function (err) { api.handleErr(err); d.loading = false; ctx._render(); });
      }

      ctx.onShow = function () { load(); };

      ctx.body.addEventListener('click', function (e) {
        if (e.target.closest('[data-noop]')) {
          // 图标选择
          var cell = e.target.closest('.icon-cell');
          if (cell) { d.inputIcon = cell.dataset.icon; ctx._render(); }
          return;
        }
        var t = e.target.closest('[data-act]');
        if (!t) return;
        var act = t.dataset.act;
        if (act === 'addCat') { d.showModal = true; d.editingId = ''; d.inputName = ''; d.inputIcon = ICONS[0]; d.submitting = false; ctx._render(); }
        else if (act === 'editCat') {
          var c = d.categories[Number(t.dataset.i)];
          d.showModal = true; d.editingId = c._id; d.inputName = c.name; d.inputIcon = c.icon || ICONS[0]; d.submitting = false;
          ctx._render();
        } else if (act === 'closeModal') { d.showModal = false; ctx._render(); }
        else if (act === 'saveCat') {
          var name = (d.inputName || '').trim();
          if (!name) return UI.toast('分类名不能为空');
          if (name.length > 10) return UI.toast('分类名最长 10 字');
          if (d.submitting) return;
          d.submitting = true;
          var p = d.editingId
            ? api.updateCategory(d.editingId, { name: name, icon: d.inputIcon })
            : api.addCategory({ name: name, icon: d.inputIcon });
          p.then(function () {
            d.showModal = false; d.submitting = false;
            UI.toast({ title: '已保存', icon: 'success' });
            load();
          }).catch(function (err) { d.submitting = false; ctx._render(); api.handleErr(err); });
        } else if (act === 'delCat') {
          var c2 = d.categories[Number(t.dataset.i)];
          UI.modal({
            title: '删除分类',
            content: '确定删除「' + c2.name + '」吗？分类下有菜品时无法删除。',
            confirmColor: '#FF8FB8'
          }).then(function (m) {
            if (!m.confirm) return;
            api.deleteCategory(c2._id).then(function () {
              UI.toast({ title: '已删除', icon: 'success' });
              load();
            }).catch(api.handleErr);
          });
        } else if (act === 'move') {
          var i = Number(t.dataset.i), dir = Number(t.dataset.dir);
          var target = i + dir;
          if (target < 0 || target >= d.categories.length) return;
          var a = d.categories[i], b = d.categories[target];
          var tmpSort = a.sortOrder;
          Promise.all([
            api.updateCategory(a._id, { sortOrder: b.sortOrder }),
            api.updateCategory(b._id, { sortOrder: tmpSort })
          ]).then(load).catch(api.handleErr);
        }
      });
    }
  });

  // ==================================================================
  // 吃过时间线 pages/history
  // ==================================================================
  UI.registerPage('history', {
    title: '吃过时间线',
    mount: function (ctx) {
      var d = ctx.data = { loading: true, logs: [], page: 1, hasMore: true, total: 0 };

      ctx._render = function () {
        var h = '';
        if (d.total) h += '<div class="summary">共记录 ' + d.total + ' 次「今天吃了」<span class="bi">\uf588</span></div>';
        h += '<div class="timeline">';
        d.logs.forEach(function (item, i) {
          h += '<div class="log-item" data-act="dish" data-id="' + item.dishId + '">' +
            '<div class="log-dot"></div>' +
            (i < d.logs.length - 1 ? '<div class="log-line"></div>' : '') +
            '<div class="card log-card">' +
            (item.coverImage ? '<img class="log-img" src="' + esc(item.coverImage) + '" alt="">' : '<div class="log-img log-img-ph img-ph"><span class="bi">\uf312</span></div>') +
            '<div class="log-info"><div class="log-name ellipsis">' + esc(item.dishName) + '</div>' +
            '<div class="log-date">' + esc(item.dateText) + '</div>' +
            (item.note ? '<div class="log-note ellipsis-2">' + esc(item.note) + '</div>' : '') +
            '</div><div class="log-arrow">›</div></div></div>';
        });
        h += '</div>';
        if (d.loading) h += '<div class="loading-tip">加载中…</div>';
        else if (!d.logs.length) h += '<div class="empty-state"><div class="empty-icon"><span class="bi">\uf292</span></div><div class="empty-text">还没有记录，抽中啥就记一笔吧</div></div>';
        else if (!d.hasMore) h += '<div class="loading-tip">— 到底啦 —</div>';
        h += '<div style="height:30px"></div>';
        ctx.body.innerHTML = h;
      };

      function load(refresh) {
        if (d.loading && !refresh) return Promise.resolve();
        var page = refresh ? 1 : d.page;
        d.loading = true;
        if (refresh) ctx._render();
        return api.listEatLogs(page, 20).then(function (res) {
          var decorated = res.list.map(function (l) {
            return Object.assign({}, l, { dateText: util.formatDate(l.eatenAt) });
          });
          d.logs = refresh ? decorated : d.logs.concat(decorated);
          d.page = page + 1;
          d.hasMore = page * 20 < res.total;
          d.total = res.total;
          d.loading = false;
          ctx._render();
        }).catch(function (err) { api.handleErr(err); d.loading = false; ctx._render(); });
      }

      ctx.onShow = function () { load(true); };
      ctx.onScroll = function (scrollTop, pageEl) {
        if (scrollTop + pageEl.clientHeight >= pageEl.scrollHeight - 40) {
          if (d.hasMore && !d.loading) load(false);
        }
      };

      ctx.body.addEventListener('click', function (e) {
        var t = e.target.closest('[data-act="dish"]');
        if (t) R.navigateTo('dish-detail?id=' + t.dataset.id);
      });
    }
  });
})(window);
