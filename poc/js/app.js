/* =====================================================================
   app.js —— POC 启动入口
   初始化主题、手机壳缩放、导航返回、路由启动
   ===================================================================== */
(function () {
  'use strict';

  function fitPhone() {
    // 窄屏（真机全屏模式）：CSS 媒体查询已精确匹配机型逻辑尺寸，不做缩放
    if (window.matchMedia('(max-width: 520px)').matches) {
      document.querySelector('.phone').style.transform = '';
      return;
    }
    // 桌面窗口：手机壳 clamp() 自适应；极小窗口时整体缩放兜底
    var phone = document.querySelector('.phone');
    var need = 340 + 48;
    var scale = window.innerWidth < need ? (window.innerWidth - 16) / need : 1;
    scale = Math.min(scale, (window.innerHeight - 100) / 640);
    phone.style.transform = scale < 1 ? 'scale(' + Math.max(0.5, scale) + ')' : '';
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
