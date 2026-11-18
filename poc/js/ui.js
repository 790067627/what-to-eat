/* =====================================================================
   ui.js —— 微信小程序 API 的浏览器模拟 + 路由 + 主题管理
   提供：wx.showToast / showModal / showLoading / hideLoading / showActionSheet
        / previewImage / setClipboardData / vibrateShort / setNavigationBarTitle
        路由：navigateTo / navigateBack / switchTab（带页面栈与转场动画）
        主题：sakura / glass 双主题，localStorage 持久化，切换不丢状态
   ===================================================================== */
(function (global) {
  'use strict';

  var THEME_KEY = 'yuki_poc_theme';
  var WEIGHT_KEY = 'random_weight'; // 与小程序 storage key 同名，模拟「高分优先」记忆

  // ---------- DOM 快捷 ----------
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- 存储 ----------
  var storage = {
    get: function (k) { try { var v = localStorage.getItem('wx:' + k); return v === null ? '' : JSON.parse(v); } catch (e) { return ''; } },
    set: function (k, v) { try { localStorage.setItem('wx:' + k, JSON.stringify(v)); } catch (e) {} },
    remove: function (k) { try { localStorage.removeItem('wx:' + k); } catch (e) {} }
  };

  // ---------- 主题 ----------
  var theme = storage.get(THEME_KEY) || 'sakura';
  var themeListeners = [];
  function applyTheme(t, opts) {
    opts = opts || {};
    theme = t;
    storage.set(THEME_KEY, t);
    var screen = $('#screen');
    if (opts.animate && screen) {
      screen.classList.add('theme-anim');
      var veil = el('div', 'theme-veil');
      veil.style.setProperty('--vx', (opts.x || 50) + '%');
      veil.style.setProperty('--vy', (opts.y || 50) + '%');
      screen.appendChild(veil);
      setTimeout(function () { veil.remove(); screen.classList.remove('theme-anim'); }, 700);
    }
    screen.setAttribute('data-theme', t);
    themeListeners.forEach(function (fn) { try { fn(t); } catch (e) {} });
  }
  function getTheme() { return theme; }
  function onTheme(fn) { themeListeners.push(fn); }

  // ---------- Toast / Loading / Modal / ActionSheet / Preview ----------
  var overlay = function () { return $('#overlayHost'); };
  var toastTimer = null;
  function showToast(o) {
    if (typeof o === 'string') o = { title: o };
    var host = overlay();
    var old = host.querySelector('.wx-toast');
    if (old) old.remove();
    if (toastTimer) clearTimeout(toastTimer);
    var box = el('div', 'wx-toast');
    var icon = o.icon === 'success' ? '<span class="t-ico">✓</span>' : '';
    box.innerHTML = icon + esc(o.title || '');
    host.appendChild(box);
    toastTimer = setTimeout(function () { box.remove(); }, o.duration || 1800);
  }

  var loadingBox = null;
  function showLoading(o) {
    if (typeof o === 'string') o = { title: o };
    hideLoading();
    loadingBox = el('div', 'wx-loading' + (o.mask ? ' mask' : ''));
    loadingBox.innerHTML = '<div class="wx-loading-box"><div class="wx-spin"></div><div>' + esc(o.title || '') + '</div></div>';
    overlay().appendChild(loadingBox);
  }
  function hideLoading() {
    if (loadingBox) { loadingBox.remove(); loadingBox = null; }
  }

  function showModal(o) {
    return new Promise(function (resolve) {
      var mask = el('div', 'wx-mask');
      var modal = el('div', 'wx-modal');
      var html = '';
      if (o.title) html += '<div class="wx-modal-title">' + esc(o.title) + '</div>';
      if (o.content) html += '<div class="wx-modal-content">' + esc(o.content) + '</div>';
      html += '<div class="wx-modal-btns">';
      if (o.showCancel !== false) html += '<div class="wx-modal-btn cancel">' + esc(o.cancelText || '取消') + '</div>';
      html += '<div class="wx-modal-btn confirm" style="color:' + (o.confirmColor || '#FF8FB8') + '">' + esc(o.confirmText || '确定') + '</div>';
      html += '</div>';
      modal.innerHTML = html;
      mask.appendChild(modal);
      overlay().appendChild(mask);
      function done(confirm) {
        mask.remove();
        resolve({ confirm: confirm, cancel: !confirm });
      }
      var btns = modal.querySelectorAll('.wx-modal-btn');
      btns.forEach(function (b) {
        b.addEventListener('click', function () { done(b.classList.contains('confirm')); });
      });
      if (o.showCancel === false) {
        // 单按钮：点遮罩不关闭
      } else {
        mask.addEventListener('click', function (e) { if (e.target === mask) done(false); });
      }
    });
  }

  function showActionSheet(o) {
    return new Promise(function (resolve, reject) {
      var mask = el('div', 'wx-mask');
      mask.style.alignItems = 'flex-end';
      var sheet = el('div', 'wx-sheet');
      (o.itemList || []).forEach(function (item, i) {
        var it = el('div', 'wx-sheet-item', esc(item));
        it.addEventListener('click', function () { mask.remove(); resolve({ tapIndex: i }); });
        sheet.appendChild(it);
      });
      var cancel = el('div', 'wx-sheet-item wx-sheet-cancel', '取消');
      cancel.addEventListener('click', function () { mask.remove(); reject({ errMsg: 'showActionSheet:fail cancel' }); });
      sheet.appendChild(cancel);
      mask.appendChild(sheet);
      mask.addEventListener('click', function (e) { if (e.target === mask) { mask.remove(); reject({ errMsg: 'showActionSheet:fail cancel' }); } });
      overlay().appendChild(mask);
    });
  }

  function previewImage(o) {
    var urls = o.urls || [];
    var cur = typeof o.current === 'number' ? urls[o.current] : o.current;
    var idx = Math.max(0, urls.indexOf(cur));
    var box = el('div', 'wx-preview');
    function render() {
      box.innerHTML =
        '<div class="pv-count">' + (idx + 1) + ' / ' + urls.length + '</div>' +
        '<div class="pv-close bi">&#xf659;</div>' +
        '<img src="' + esc(urls[idx]) + '" alt="">';
      box.querySelector('img').addEventListener('click', function (e) {
        e.stopPropagation();
        idx = (idx + 1) % urls.length;
        render();
      });
    }
    render();
    box.addEventListener('click', function (e) {
      if (e.target.classList.contains('pv-close')) box.remove();
      else if (e.target === box) box.remove();
    });
    overlay().appendChild(box);
  }

  function setClipboardData(o) {
    var done = function () { if (o.success) o.success(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(o.data).then(done, done);
    } else {
      var ta = el('textarea');
      ta.value = o.data;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
      done();
    }
  }

  function vibrateShort() {
    if (navigator.vibrate) navigator.vibrate(30);
  }

  // ---------- 路由 ----------
  var TABS = [
    { path: 'index', title: 'Yuki小厨房' },
    { path: 'dishes', title: '菜品库' },
    { path: 'random', title: '抽一抽' },
    { path: 'mine', title: '我的' }
  ];
  var stack = [];          // 页面栈：[{ name, params, scrollTop, html }]
  var current = null;
  var globalData = { dishesFilter: null };
  var pageRegistry = {};   // name -> { render(params, ctx), title, customNav }
  var activeCtx = null;    // 当前页面上下文（含 rerender）

  function registerPage(name, def) { pageRegistry[name] = def; }

  function hostEl() { return $('#pageHost'); }

  function buildPageEl(name, params, animCls) {
    var def = pageRegistry[name];
    var pageEl = el('div', 'page pg-' + name + (animCls ? ' ' + animCls : ''));
    var body = el('div', 'pg-body');
    pageEl.appendChild(body);
    var ctx = {
      name: name,
      params: params || {},
      el: pageEl,
      body: body,
      data: {},
      setData: function (patch) {
        Object.keys(patch).forEach(function (k) { ctx.data[k] = patch[k]; });
        if (ctx._render) ctx._render();
      },
      query: function (sel) { return pageEl.querySelector(sel); },
      queryAll: function (sel) { return Array.prototype.slice.call(pageEl.querySelectorAll(sel)); },
      on: function (sel, ev, fn) {
        pageEl.querySelectorAll(sel).forEach(function (n) { n.addEventListener(ev, fn); });
      }
    };
    def.mount(ctx);
    return { el: pageEl, ctx: ctx };
  }

  function setChrome(name) {
    var def = pageRegistry[name];
    $('#navTitle').textContent = def.title;
    var screen = $('#screen');
    screen.classList.toggle('nav-transparent', !!def.customNav);
    var isTab = TABS.some(function (t) { return t.path === name; });
    $('#navBack').style.visibility = (isTab || stack.length <= 1) ? 'hidden' : 'visible';
    $('#tabbar').style.display = isTab ? 'flex' : 'none';
    if (isTab) renderTabBar(TABS.findIndex(function (t) { return t.path === name; }));
  }

  function renderTabBar(selected) {
    var icons = [
      ['home', '首页'], ['dishes', '菜品库'], ['dice', '抽一抽'], ['mine', '我的']
    ];
    var bar = $('#tabbar');
    bar.innerHTML = '';
    icons.forEach(function (ic, i) {
      var item = el('div', 'tab-item' + (i === selected ? ' active' : ''));
      if (i === 2) {
        item.innerHTML =
          '<div class="center-btn"><img class="center-icon" src="assets/icons/' + ic[0] + '_normal.png" alt=""></div>' +
          '<span class="tab-text center-text">' + ic[1] + '</span>';
      } else {
        var suffix = i === selected ? 'active' : 'normal';
        item.innerHTML =
          '<img class="tab-icon" src="assets/icons/' + ic[0] + '_' + suffix + '.png" alt="">' +
          '<span class="tab-text">' + ic[1] + '</span>';
      }
      item.addEventListener('click', function () { switchTab(TABS[i].path); });
      bar.appendChild(item);
    });
  }

  function mountPage(name, params, animCls) {
    if (current && current.ctx.onHide) { try { current.ctx.onHide(); } catch (e) {} }
    var built = buildPageEl(name, params, animCls);
    hostEl().innerHTML = '';
    hostEl().appendChild(built.el);
    current = { name: name, params: params, ctx: built.ctx };
    activeCtx = built.ctx;
    built.el.addEventListener('scroll', function () {
      if (current && current.ctx === built.ctx) current.scrollTop = built.el.scrollTop;
      if (built.ctx.onScroll) built.ctx.onScroll(built.el.scrollTop, built.el);
    });
    setChrome(name);
    if (built.ctx.onShow) built.ctx.onShow();
    return built.ctx;
  }

  function navigateTo(url) {
    var parts = url.split('?');
    var name = parts[0].replace(/^\/?pages\//, '').replace(/\/[^/]*$/, '');
    var params = {};
    if (parts[1]) parts[1].split('&').forEach(function (kv) {
      var p = kv.split('=');
      params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    if (current) current.scrollTop = current.ctx.el.scrollTop;
    stack.push(current);
    mountPage(name, params, 'page-anim-push');
  }

  function navigateBack() {
    var prev = stack.pop();
    if (!prev) { switchTab('index'); return; }
    var ctx = mountPage(prev.name, prev.params, 'page-anim-pop');
    ctx.el.scrollTop = prev.scrollTop || 0;
  }

  function switchTab(path) {
    var name = path.replace(/^\/?pages\//, '').replace(/\/[^/]*$/, '');
    stack = [];
    mountPage(name, {}, 'page-anim-fade');
  }

  function backOrHome() {
    if (stack.length) navigateBack();
    else switchTab('index');
  }

  // ---------- 通用工具（对应 utils/util.js） ----------
  function formatDate(date) {
    if (!date) return '';
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function timeAgo(date) {
    if (!date) return '';
    var d = new Date(date);
    if (isNaN(d.getTime())) return '';
    var diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays <= 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 30) return diffDays + '天前';
    return formatDate(d);
  }
  function fenToYuan(fen) {
    if (fen === null || fen === undefined || fen === '') return '';
    var n = Number(fen);
    if (isNaN(n)) return '';
    return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2).replace(/\.?0+$/, '');
  }
  function yuanToFen(yuan) {
    var n = parseFloat(yuan);
    if (isNaN(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  // ---------- 服务层（对应 services/db.js） ----------
  function call(action, payload) {
    return MockDB.call(action, payload).then(function (result) {
      if (result.code !== 0) throw new Error(result.msg || '操作失败');
      return result.data;
    });
  }
  var api = {
    listCategories: function () { return call('listCategories'); },
    addCategory: function (data) { return call('addCategory', { data: data }); },
    updateCategory: function (id, data) { return call('updateCategory', { id: id, data: data }); },
    deleteCategory: function (id) { return call('deleteCategory', { id: id }); },
    listDishes: function (query) { return call('listDishes', { query: query || {} }); },
    getDish: function (id) { return call('getDish', { id: id }); },
    addDish: function (data) { return call('addDish', { data: data }); },
    updateDish: function (id, data) { return call('updateDish', { id: id, data: data }); },
    deleteDish: function (id) { return call('deleteDish', { id: id }); },
    randomPick: function (filters) { return call('randomPick', { filters: filters }); },
    logEat: function (dishId, note) { return call('logEat', { dishId: dishId, note: note || '' }); },
    listEatLogs: function (page, size) { return call('listEatLogs', { page: page, size: size }); },
    getStats: function () { return call('getStats'); },
    initDemo: function () { return call('initDemo'); },
    exportData: function () { return call('exportData'); },
    listEatLogsByMonth: function (ym) { return call('listEatLogsByMonth', { yearMonth: ym }); },
    importData: function (data) { return call('importData', { data: data }); },
    getUserInfo: function () { return call('getUserInfo'); },
    saveSharedDish: function (dishId) { return call('saveSharedDish', { dishId: dishId }); },
    recognizeDish: function () { return call('recognizeDish'); },
    handleErr: function (err, fallbackMsg) { showToast((err && err.message) || fallbackMsg || '网络异常，请稍后再试'); }
  };

  global.UI = {
    $: $, el: el, esc: esc,
    storage: storage,
    theme: { get: getTheme, apply: applyTheme, onChange: onTheme },
    toast: showToast, loading: showLoading, hideLoading: hideLoading,
    modal: showModal, actionSheet: showActionSheet, previewImage: previewImage,
    clipboard: setClipboardData, vibrate: vibrateShort,
    router: { navigateTo: navigateTo, navigateBack: navigateBack, switchTab: switchTab, backOrHome: backOrHome, stackLen: function () { return stack.length; }, current: function () { return current; } },
    globalData: globalData,
    registerPage: registerPage,
    api: api,
    util: { formatDate: formatDate, timeAgo: timeAgo, fenToYuan: fenToYuan, yuanToFen: yuanToFen },
    WEIGHT_KEY: WEIGHT_KEY
  };
})(window);
