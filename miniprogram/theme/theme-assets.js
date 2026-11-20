// theme/theme-assets.js - 主题资源层
// 管理「主题专属图片/装饰」的显示开关、布局策略与图标方案。
// 与 tokens.js（主题样式层）分离：tokens 管颜色，assets 管资源与布局模式。
//
// 字段说明：
//   nav.mode             'illustrated'（云端插画头图，樱花主题）| 'minimal'（纯色/渐变，GitHub 主题）
//   nav.extraHeight      导航条在胶囊底边之外额外延伸的插画带高度（px）——决定「导航条自身高度」，
//                        同时是 immersive-nav 组件高度与页面 padding-top 让位基准（getNavHeaderHeight）
//   nav.contentTopOffset 内容区顶部「额外视觉间距」（px）——叠加在导航让位之上，仅决定内容起始位置，
//                        不改变导航条高度。illustrated 主题插画带已含间距故为 0；minimal 主题无插画带，
//                        用它补齐卡片与导航底之间的留白（建议 16~20）。设备状态栏/胶囊高度由系统动态
//                        计算，此字段只负责主题级额外间距，禁止在此写死设备高度。
//   nav.cloudKey         getBgUrl 云资源 key（'' 表示不加载云端图）
//   decoration.kitty     首页 Hello Kitty 装饰（show=false 时组件不渲染、不加载、不占布局）
//   decoration.bears     首页导航角色装饰（nav-bears 组件，7 层纸片人动画；仅蜂蜜主题开启）
//   tabbar.iconMode      'image'（PNG 图标，樱花主题沿用现有资源）| 'font'（bi 字体图标，颜色随 CSS 变量）
//   tabbar.icons         iconMode='font' 时四个 tab 的码位（首页/菜单/抽一抽/我的）

const TAB_ICONS_GITHUB = {
  home: '\uF425',    // house
  dishes: '\uF184',  // basket3
  dice: '\uF2FB',    // dice-5
  mine: '\uF59E'     // suit-heart
};

module.exports = {
  sakura: {
    // 插画带 24px 兼作 hero 卡与导航的天然间距，contentTopOffset 保持 0（视觉与改造前一致）
    nav: { mode: 'illustrated', extraHeight: 24, contentTopOffset: 0, cloudKey: 'header' },
    decoration: { kitty: { show: true, cloudKey: 'kitty' }, bears: { show: false } },
    tabbar: { iconMode: 'image', dir: '/custom-tab-bar/icons', icons: TAB_ICONS_GITHUB }
  },
  'github-light': {
    // minimal 无插画带（extraHeight 0），用 contentTopOffset 补齐 16px 顶部留白
    nav: { mode: 'minimal', extraHeight: 0, contentTopOffset: 16, cloudKey: '' },
    decoration: { kitty: { show: false, cloudKey: '' }, bears: { show: false } },
    tabbar: { iconMode: 'font', dir: '/custom-tab-bar/icons-gh-light', icons: TAB_ICONS_GITHUB }
  },
  'github-dark': {
    nav: { mode: 'minimal', extraHeight: 0, contentTopOffset: 16, cloudKey: '' },
    decoration: { kitty: { show: false, cloudKey: '' }, bears: { show: false } },
    tabbar: { iconMode: 'font', dir: '/custom-tab-bar/icons-gh-dark', icons: TAB_ICONS_GITHUB }
  },
  honey: {
    // 蜂蜜小熊：独立 banner（cloudKey 接线后生效）+ 导航角色装饰层
    nav: { mode: 'illustrated', extraHeight: 24, contentTopOffset: 0, cloudKey: 'header-honey' },
    decoration: { kitty: { show: false, cloudKey: '' }, bears: { show: true } },
    tabbar: { iconMode: 'font', dir: '/custom-tab-bar/icons-gh-light', icons: TAB_ICONS_GITHUB }
  }
};
