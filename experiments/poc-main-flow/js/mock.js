/* =====================================================================
   mock.js —— 本地 Mock 数据层
   模拟 cloudfunctions/dish 的全部 action + airec 识别，不连接任何真实服务。
   数据持久化在 localStorage（key: yuki_poc_db_v1），仅原型内部使用。
   ===================================================================== */
(function (global) {
  'use strict';

  var DB_KEY = 'yuki_poc_db_v2';
  var PREF_KEY = 'yuki_poc_pref_v1';

  // ---------- 小工具 ----------
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }
  function nowISO() { return new Date().toISOString(); }
  function daysAgoISO(n, hour) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour === undefined ? 12 : hour, Math.floor(Math.random() * 50), 0, 0);
    return d.toISOString();
  }
  /** 生成菜品封面图（本地 SVG data URI，无网络依赖） */
  function foodImg(emoji, h1, h2) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + h1 + '"/><stop offset="1" stop-color="' + h2 + '"/></linearGradient></defs>' +
      '<rect width="300" height="300" fill="url(#g)"/>' +
      '<circle cx="150" cy="160" r="92" fill="rgba(255,255,255,.55)"/>' +
      '<circle cx="150" cy="160" r="74" fill="rgba(255,255,255,.75)"/>' +
      '<text x="150" y="196" font-size="96" text-anchor="middle">' + emoji + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // ---------- 初始示例数据（对应云函数 initDemo + 吃历样本） ----------
  function buildSeed() {
    var cats = [
      { _id: 'c_home', name: '家常菜', icon: '', sortOrder: 1 },
      { _id: 'c_noodle', name: '面食粉类', icon: '', sortOrder: 2 },
      { _id: 'c_salad', name: '轻食沙拉', icon: '奈', sortOrder: 3 },
      { _id: 'c_hotpot', name: '火锅烧烤', icon: '', sortOrder: 4 },
      { _id: 'c_dessert', name: '甜品饮品', icon: '', sortOrder: 5 }
    ].map(function (c) {
      return {
        _id: c._id, openid: 'mock_user', name: c.name, icon: c.icon,
        sortOrder: c.sortOrder, deleted: false, createdAt: daysAgoISO(30), updatedAt: daysAgoISO(30)
      };
    });

    var D = [
      ['d_tomato', '番茄牛腩煲', 'c_home', '浓郁番茄汤底，牛腩炖到软烂。番茄要多炒出沙。', 4800, 5, 'want', ['家常', '炖菜'], '🍲', '#ffd9c9', '#ff9d7e'],
      ['d_noodle', '葱油拌面', 'c_noodle', '小葱熬到焦黄，酱油糖调汁，十分钟搞定。', 1800, 4, 'often', ['快手', '面食'], '🍜', '#ffe9c9', '#ffc46b'],
      ['d_salad', '鸡胸肉沙拉', 'c_salad', '鸡胸肉煎前用盐和黑胡椒腌 15 分钟，油醋汁。', 3200, 4, 'want', ['低卡', '健身'], '🥗', '#dcf3d0', '#9ed47f'],
      ['d_pot', '麻辣香锅', 'c_hotpot', '荤素一锅出，豆瓣酱+火锅底料炒香。', 6800, 5, 'often', ['辣', '聚餐'], '🍢', '#ffd2d2', '#ff7d7d'],
      ['d_mango', '杨枝甘露', 'c_dessert', '芒果+西柚+西米+椰浆，冷藏后更好喝。', 2200, 4, 'want', ['甜品', '夏日'], '🥭', '#fff0c2', '#ffcf5c'],
      ['d_pear', '冰糖雪梨', 'c_dessert', '雪梨去核加冰糖慢炖，润肺止咳，秋冬必备。', 1800, 5, 'want', ['甜品', '养生'], '🍐', '#e8f6e2', '#b7e0a6'],
      ['d_steak', '黑椒牛排', 'c_home', '大火封边再转中火，静置五分钟再切。', 8800, 4, 'want', ['硬菜', '周末'], '🥩', '#ffd9d0', '#e8836f'],
      ['d_ramen', '豚骨拉面', 'c_noodle', '浓白汤头，溏心蛋腌一晚更入味。', 4200, 0, 'never', ['汤面'], '🍥', '#e3ecff', '#9fb8e8']
    ];
    var dishes = D.map(function (d, i) {
      return {
        _id: d[0], openid: 'mock_user', name: d[1], categoryId: d[2],
        coverImage: foodImg(d[8], d[9], d[10]), images: [],
        description: d[3], price: d[4], rating: d[5], status: d[6], tags: d[7],
        deleted: false, createdAt: daysAgoISO(28 - i), updatedAt: daysAgoISO(20 - i)
      };
    });

    // 吃历样本：本月 + 上月若干条
    var logs = [];
    var plan = [
      ['d_noodle', 0, 12], ['d_tomato', 1, 19], ['d_mango', 2, 15], ['d_pot', 4, 18],
      ['d_noodle', 6, 12], ['d_salad', 7, 12], ['d_pear', 9, 21], ['d_tomato', 11, 19],
      ['d_steak', 13, 18], ['d_mango', 15, 15], ['d_pot', 18, 19], ['d_noodle', 21, 12],
      ['d_salad', 26, 12], ['d_pear', 33, 20], ['d_tomato', 38, 19], ['d_pot', 41, 18]
    ];
    plan.forEach(function (p, i) {
      var dish = dishes.filter(function (d) { return d._id === p[0]; })[0];
      logs.push({
        _id: 'l_' + i, openid: 'mock_user', dishId: p[0], dishName: dish.name,
        coverImage: dish.coverImage, note: i % 4 === 0 ? '今天状态好，多做了一份' : '',
        eatenAt: daysAgoISO(p[1], p[2]), createdAt: daysAgoISO(p[1], p[2])
      });
    });

    return { categories: cats, dishes: dishes, eatLogs: logs };
  }

  // ---------- 存储 ----------
  var db = null;
  function load() {
    if (db) return db;
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) { db = JSON.parse(raw); return db; }
    } catch (e) { /* ignore */ }
    db = buildSeed();
    save();
    return db;
  }
  function save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
  }
  function resetDemo() { db = buildSeed(); save(); }
  function clearAll() { db = { categories: [], dishes: [], eatLogs: [] }; save(); }

  // ---------- 偏好（慢网络等演示开关） ----------
  var pref = { slow: false };
  try {
    var savedPref = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    Object.keys(savedPref).forEach(function (k) { pref[k] = savedPref[k]; });
  } catch (e) { /* ignore */ }
  function setPref(k, v) { pref[k] = v; try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (e) {} }

  function delay() {
    var base = pref.slow ? 1400 : 220;
    return new Promise(function (res) { setTimeout(res, base + Math.random() * (pref.slow ? 600 : 260)); });
  }
  function ok(data) { return { code: 0, data: data }; }
  function fail(msg) { return { code: 1, msg: msg }; }

  function liveDishes() { return db.dishes.filter(function (d) { return !d.deleted; }); }
  function liveCats() {
    return db.categories.filter(function (c) { return !c.deleted; })
      .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- 云函数 action 模拟 ----------
  var actions = {
    listCategories: function () { return ok(clone(liveCats())); },

    addCategory: function (p) {
      var name = String((p.data && p.data.name) || '').trim();
      if (!name) return fail('分类名不能为空');
      if (name.length > 10) return fail('分类名最长 10 字');
      var dup = liveCats().some(function (c) { return c.name === name; });
      if (dup) return fail('已有同名分类');
      var maxSort = liveCats().reduce(function (m, c) { return Math.max(m, c.sortOrder || 0); }, 0);
      var doc = {
        _id: uid('c'), openid: 'mock_user', name: name,
        icon: (p.data && p.data.icon) || '', sortOrder: maxSort + 1,
        deleted: false, createdAt: nowISO(), updatedAt: nowISO()
      };
      db.categories.push(doc); save();
      return ok({ _id: doc._id });
    },

    updateCategory: function (p) {
      var c = db.categories.filter(function (x) { return x._id === p.id; })[0];
      if (!c) return fail('分类不存在');
      if (p.data.name !== undefined) {
        var name = String(p.data.name || '').trim();
        if (!name || name.length > 10) return fail('分类名 1-10 字');
        c.name = name;
      }
      if (p.data.icon !== undefined) c.icon = p.data.icon;
      if (p.data.sortOrder !== undefined) c.sortOrder = p.data.sortOrder;
      c.updatedAt = nowISO(); save();
      return ok(true);
    },

    deleteCategory: function (p) {
      var used = liveDishes().filter(function (d) { return d.categoryId === p.id; }).length;
      if (used > 0) return fail('该分类下还有 ' + used + ' 道菜，先移走或删除它们');
      var c = db.categories.filter(function (x) { return x._id === p.id; })[0];
      if (c) { c.deleted = true; c.updatedAt = nowISO(); save(); }
      return ok(true);
    },

    listDishes: function (p) {
      var q = (p && p.query) || {};
      var list = liveDishes().slice();
      if (q.categoryId) list = list.filter(function (d) { return d.categoryId === q.categoryId; });
      if (q.status) list = list.filter(function (d) { return d.status === q.status; });
      if (q.keyword) {
        var kw = String(q.keyword).toLowerCase();
        list = list.filter(function (d) {
          return (d.name || '').toLowerCase().indexOf(kw) >= 0 ||
            (d.description || '').toLowerCase().indexOf(kw) >= 0 ||
            (d.tags || []).some(function (t) { return t.toLowerCase().indexOf(kw) >= 0; });
        });
      }
      list.sort(function (a, b) { return b.updatedAt < a.updatedAt ? -1 : 1; });
      return ok(clone(list));
    },

    getDish: function (p) {
      var d = db.dishes.filter(function (x) { return x._id === p.id && !x.deleted; })[0];
      if (!d) return fail('菜品不存在');
      var out = clone(d);
      var logs = db.eatLogs.filter(function (l) { return l.dishId === p.id; })
        .sort(function (a, b) { return a.eatenAt < b.eatenAt ? 1 : -1; });
      out.lastEatenAt = logs.length ? logs[0].eatenAt : null;
      return ok(out);
    },

    addDish: function (p) {
      var data = p.data || {};
      if (!data.name || !String(data.name).trim()) return fail('菜品名称不能为空');
      if (String(data.name).trim().length > 30) return fail('菜品名称最长 30 字');
      var doc = {
        _id: uid('d'), openid: 'mock_user',
        name: String(data.name).trim(),
        categoryId: data.categoryId || '',
        coverImage: data.coverImage || '',
        images: Array.isArray(data.images) ? data.images.slice(0, 9) : [],
        description: data.description || '',
        price: data.price === '' || data.price === null || data.price === undefined ? null : Math.round(Number(data.price)),
        tags: Array.isArray(data.tags) ? data.tags.slice(0, 10) : [],
        rating: Math.min(5, Math.max(0, Number(data.rating) || 0)),
        status: ['want', 'often', 'never'].indexOf(data.status) >= 0 ? data.status : 'want',
        deleted: false, createdAt: nowISO(), updatedAt: nowISO()
      };
      db.dishes.push(doc); save();
      return ok({ _id: doc._id });
    },

    updateDish: function (p) {
      var d = db.dishes.filter(function (x) { return x._id === p.id && !x.deleted; })[0];
      if (!d) return fail('菜品不存在');
      var data = p.data || {};
      if (data.name !== undefined) {
        var name = String(data.name).trim();
        if (!name || name.length > 30) return fail('菜品名 1-30 字');
        d.name = name;
      }
      ['categoryId', 'coverImage', 'description'].forEach(function (k) {
        if (data[k] !== undefined) d[k] = data[k];
      });
      if (data.images !== undefined) d.images = Array.isArray(data.images) ? data.images.slice(0, 9) : [];
      if (data.tags !== undefined) d.tags = Array.isArray(data.tags) ? data.tags.slice(0, 10) : [];
      if (data.price !== undefined) d.price = data.price === '' || data.price === null ? null : Math.round(Number(data.price));
      if (data.rating !== undefined) d.rating = Math.min(5, Math.max(0, Number(data.rating) || 0));
      if (data.status !== undefined && ['want', 'often', 'never'].indexOf(data.status) >= 0) d.status = data.status;
      d.updatedAt = nowISO(); save();
      return ok(true);
    },

    deleteDish: function (p) {
      var d = db.dishes.filter(function (x) { return x._id === p.id; })[0];
      if (d) { d.deleted = true; d.updatedAt = nowISO(); save(); }
      return ok(true);
    },

    randomPick: function (p) {
      var f = (p && p.filters) || {};
      var pool = liveDishes().filter(function (d) { return d.status !== 'never'; });
      if (f.onlyStatus === 'want') pool = pool.filter(function (d) { return d.status === 'want'; });
      if (f.categoryId) pool = pool.filter(function (d) { return d.categoryId === f.categoryId; });
      var days = Number(f.excludeRecentDays) || 0;
      if (days > 0 && pool.length) {
        var since = Date.now() - days * 86400000;
        var recent = {};
        db.eatLogs.forEach(function (l) { if (new Date(l.eatenAt).getTime() >= since) recent[l.dishId] = 1; });
        pool = pool.filter(function (d) { return !recent[d._id]; });
      }
      if (!pool.length) return fail('没有符合条件的菜品，放宽筛选试试');
      var picked;
      if (f.weightByRating) {
        var weights = pool.map(function (d) { return 1 + Math.min(5, Math.max(0, Number(d.rating) || 0)); });
        var totalW = weights.reduce(function (a, b) { return a + b; }, 0);
        var r = Math.random() * totalW;
        picked = pool[pool.length - 1];
        for (var i = 0; i < pool.length; i++) { r -= weights[i]; if (r < 0) { picked = pool[i]; break; } }
      } else {
        picked = pool[Math.floor(Math.random() * pool.length)];
      }
      var cat = liveCats().filter(function (c) { return c._id === picked.categoryId; })[0];
      var logs = db.eatLogs.filter(function (l) { return l.dishId === picked._id; })
        .sort(function (a, b) { return a.eatenAt < b.eatenAt ? 1 : -1; });
      return ok({
        dish: clone(picked),
        categoryName: cat ? cat.name : '',
        poolSize: pool.length,
        lastEatenAt: logs.length ? logs[0].eatenAt : null
      });
    },

    logEat: function (p) {
      var d = liveDishes().filter(function (x) { return x._id === p.dishId; })[0];
      if (!d) return fail('菜品不存在');
      db.eatLogs.push({
        _id: uid('l'), openid: 'mock_user', dishId: d._id, dishName: d.name,
        coverImage: d.coverImage || '', note: String(p.note || '').slice(0, 200),
        eatenAt: nowISO(), createdAt: nowISO()
      });
      if (d.status === 'want') { d.status = 'often'; d.updatedAt = nowISO(); }
      save();
      return ok(true);
    },

    listEatLogs: function (p) {
      var page = Math.max(1, Number(p.page) || 1);
      var size = Math.min(50, Math.max(1, Number(p.size) || 20));
      var all = db.eatLogs.slice().sort(function (a, b) { return a.eatenAt < b.eatenAt ? 1 : -1; });
      return ok({ total: all.length, list: clone(all.slice((page - 1) * size, page * size)), page: page, size: size });
    },

    listEatLogsByMonth: function (p) {
      var ym = String(p.yearMonth || '');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return fail('月份格式不合法');
      var parts = ym.split('-');
      var y = Number(parts[0]), m = Number(parts[1]);
      var logs = db.eatLogs.filter(function (l) {
        var d = new Date(l.eatenAt);
        return d.getFullYear() === y && d.getMonth() + 1 === m;
      }).sort(function (a, b) { return a.eatenAt < b.eatenAt ? -1 : 1; });

      var dishCat = {};
      db.dishes.forEach(function (d) { dishCat[d._id] = d.categoryId || ''; });
      var catInfo = {};
      db.categories.forEach(function (c) { catInfo[c._id] = c; });
      var countByCat = {};
      logs.forEach(function (l) {
        var cid = dishCat[l.dishId] || '__none__';
        countByCat[cid] = (countByCat[cid] || 0) + 1;
      });
      var categoryStats = Object.keys(countByCat).map(function (cid) {
        return {
          categoryId: cid,
          name: cid === '__none__' ? '未分类/已删除' : (catInfo[cid] ? catInfo[cid].name : '未知分类'),
          icon: catInfo[cid] && catInfo[cid].icon ? catInfo[cid].icon : '',
          count: countByCat[cid]
        };
      }).sort(function (a, b) { return b.count - a.count; });
      return ok({ logs: clone(logs), categoryStats: categoryStats, total: logs.length });
    },

    getStats: function () {
      return ok({
        dishCount: liveDishes().length,
        categoryCount: liveCats().length,
        eatCount: db.eatLogs.length
      });
    },

    initDemo: function () {
      if (liveDishes().length > 0) return fail('菜品库已有数据，无需初始化');
      var seed = buildSeed();
      // 只取分类与菜品（吃历保持空，便于演示空态）
      db.categories = seed.categories;
      db.dishes = seed.dishes;
      save();
      return ok({ categories: seed.categories.length, dishes: seed.dishes.length });
    },

    exportData: function () {
      return ok({
        version: 1, appName: 'Yuki小厨房', exportedAt: nowISO(),
        categories: clone(liveCats()), dishes: clone(liveDishes()), eatLogs: clone(db.eatLogs)
      });
    },

    importData: function (p) {
      var payload = p.data;
      if (!payload || typeof payload !== 'object') return fail('数据格式不合法');
      var cats = Array.isArray(payload.categories) ? payload.categories : [];
      var dishes = Array.isArray(payload.dishes) ? payload.dishes : [];
      var logs = Array.isArray(payload.eatLogs) ? payload.eatLogs : [];
      if (cats.length + dishes.length + logs.length > 1000) return fail('单次导入不能超过 1000 条');
      var stat = { categories: 0, dishes: 0, eatLogs: 0, skipped: 0 };
      var catIdMap = {};
      cats.forEach(function (c) {
        var name = String(c.name || '').trim().slice(0, 10);
        if (!name) { stat.skipped++; return; }
        var hit = liveCats().filter(function (x) { return x.name === name; })[0];
        if (hit) { catIdMap[c._id] = hit._id; stat.skipped++; return; }
        var doc = {
          _id: uid('c'), openid: 'mock_user', name: name,
          icon: typeof c.icon === 'string' ? c.icon : '',
          sortOrder: Number(c.sortOrder) || Date.now(), deleted: false,
          createdAt: nowISO(), updatedAt: nowISO()
        };
        db.categories.push(doc); catIdMap[c._id] = doc._id; stat.categories++;
      });
      var dishIdMap = {};
      dishes.forEach(function (d) {
        var name = String(d.name || '').trim().slice(0, 30);
        var catId = catIdMap[d.categoryId] || '';
        if (!name) { stat.skipped++; return; }
        var hit = liveDishes().filter(function (x) { return x.name === name && x.categoryId === catId; })[0];
        if (hit) { dishIdMap[d._id] = hit._id; stat.skipped++; return; }
        var doc = {
          _id: uid('d'), openid: 'mock_user', name: name, categoryId: catId,
          coverImage: typeof d.coverImage === 'string' && d.coverImage.indexOf('data:') === 0 ? d.coverImage : '',
          images: [], description: String(d.description || '').slice(0, 2000),
          price: d.price === null || d.price === undefined || d.price === '' ? null : (Math.round(Number(d.price)) || null),
          tags: Array.isArray(d.tags) ? d.tags.slice(0, 10) : [],
          rating: Math.min(5, Math.max(0, Number(d.rating) || 0)),
          status: ['want', 'often', 'never'].indexOf(d.status) >= 0 ? d.status : 'want',
          deleted: false, createdAt: nowISO(), updatedAt: nowISO()
        };
        db.dishes.push(doc); dishIdMap[d._id] = doc._id; stat.dishes++;
      });
      logs.forEach(function (l) {
        var dishId = dishIdMap[l.dishId];
        if (!dishId) { stat.skipped++; return; }
        var dish = liveDishes().filter(function (x) { return x._id === dishId; })[0];
        db.eatLogs.push({
          _id: uid('l'), openid: 'mock_user', dishId: dishId,
          dishName: dish ? dish.name : String(l.dishName || ''),
          coverImage: dish ? dish.coverImage : '', note: String(l.note || '').slice(0, 200),
          eatenAt: l.eatenAt || nowISO(), createdAt: nowISO()
        });
        stat.eatLogs++;
      });
      save();
      return ok(stat);
    },

    getUserInfo: function () { return ok({ openid: 'mock_user' }); },

    saveSharedDish: function (p) {
      var src = db.dishes.filter(function (x) { return x._id === p.dishId; })[0];
      if (!src) return fail('菜品不存在');
      var dup = liveDishes().some(function (x) { return x.name === src.name && x.categoryId === (src.categoryId || ''); });
      if (dup) return fail('你已经保存过这道菜了');
      var doc = clone(src);
      doc._id = uid('d'); doc.openid = 'mock_user'; doc.status = 'want';
      doc.createdAt = nowISO(); doc.updatedAt = nowISO();
      db.dishes.push(doc); save();
      return ok({ dishId: doc._id });
    },

    // ---- AI 识别（mock airec 云函数）----
    recognizeDish: function () {
      var pool = [
        { name: '肉末红油汤面', matchedCategoryName: '面食粉类', priceYuan: 26, description: '红油汤底配肉臊，面要煮到刚断生。', tags: ['辣', '汤面'] },
        { name: '芝士焗红薯', matchedCategoryName: '', suggestedCategory: '烘焙甜点', priceYuan: 18, description: '红薯蒸熟压泥，铺马苏里拉 200 度烤 12 分钟。', tags: ['甜品', '烤箱'] },
        { name: '泰式冬阴功汤', matchedCategoryName: '', suggestedCategory: '东南亚菜', priceYuan: 58, description: '香茅南姜柠檬叶，椰浆最后放。', tags: ['酸辣', '汤'] },
        { name: '照烧鸡腿饭', matchedCategoryName: '家常菜', priceYuan: 32, description: '鸡腿去骨煎脆皮，照烧汁收浓挂勺。', tags: ['快手', '便当'] }
      ];
      var r = pool[Math.floor(Math.random() * pool.length)];
      var out = { isFood: true, mock: true };
      Object.keys(r).forEach(function (k) { out[k] = r[k]; });
      return { code: 0, data: out };
    }
  };

  /** AI 识别专用长延迟（真实识别需数秒，扫描动画要可感知） */
  var AI_DELAY = 2200;

  /** 统一入口：模拟 wx.cloud.callFunction({ name:'dish', data }) */
  function call(action, payload) {
    var wait = action === 'recognizeDish' ? AI_DELAY + Math.random() * 800 : 0;
    return delay().then(function () {
      if (wait) return new Promise(function (r) { setTimeout(r, wait); });
    }).then(function () {
      load();
      var fn = actions[action];
      if (!fn) return fail('未知操作: ' + action);
      try {
        return fn(payload || {});
      } catch (e) {
        return fail(e.message || '服务端异常');
      }
    });
  }

  global.MockDB = {
    call: call,
    load: load,
    resetDemo: resetDemo,
    clearAll: clearAll,
    setPref: setPref,
    getPref: function () { return pref; },
    foodImg: foodImg
  };
})(window);
