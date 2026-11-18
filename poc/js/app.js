/* =====================================================================
   app.js —— POC 启动入口
   初始化主题、手机壳缩放、导航返回、路由启动
   ===================================================================== */
(function () {
  'use strict';

  function fitPhone() {
    var phone = document.querySelector('.phone');
    var pad = 24;
    var maxW = window.innerWidth - pad;
    var maxH = window.innerHeight - 110;
    var scale = Math.min(1, maxW / 390, maxH / 844);
    phone.style.transform = 'scale(' + scale + ')';
  }

  function boot() {
    fitPhone();
    window.addEventListener('resize', fitPhone);

    // 初始主题（localStorage 持久化）
    UI.theme.apply(UI.theme.get());

    // 导航栏返回
    document.querySelector('#navBack').addEventListener('click', function () {
      if (this.style.visibility === 'hidden') return;
      UI.router.backOrHome();
    });

    // 主题变化后重渲染当前页（保持页面与状态不丢失）
    UI.theme.onChange(function () {
      var cur = UI.router.current();
      if (cur && cur.ctx && cur.ctx._render) cur.ctx._render();
    });

    // 键盘 Esc 返回上一页（方便演示）
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var overlayTop = document.querySelector('#overlayHost .wx-preview, #overlayHost .wx-mask, #overlayHost .poster-mask, #overlayHost .fab-mask');
        if (!overlayTop) UI.router.backOrHome();
      }
    });

    // 启动到首页
    UI.router.switchTab('index');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
