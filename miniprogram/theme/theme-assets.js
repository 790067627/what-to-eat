// theme/theme-assets.js - 主题资源层
// 管理「主题专属图片/装饰」的显示开关、布局策略与图标方案。
// 与 tokens.js（主题样式层）分离：tokens 管颜色，assets 管资源与布局模式。
//
// 字段说明：
//   nav.mode          'illustrated'（云端插画头图，樱花主题）| 'minimal'（纯色/渐变，GitHub 主题）
//   nav.extraHeight   导航在胶囊底边之外额外延伸的插画带高度（px），影响页面 padding-top
//   nav.cloudKey      getBgUrl 云资源 key（'' 表示不加载云端图）
//   decoration.kitty  首页 Hello Kitty 装饰（show=false 时组件不渲染、不加载、不占布局）
//   tabbar.iconMode   'image'（PNG 图标，樱花主题沿用现有资源）| 'font'（bi 字体图标，颜色随 CSS 变量）
//   tabbar.icons      iconMode='font' 时四个 tab 的码位（首页/菜单/抽一抽/我的）

const TAB_ICONS_GITHUB = {
  home: '\uF425',    // house
  dishes: '\uF184',  // basket3
  dice: '\uF2FB',    // dice-5
  mine: '\uF59E'     // suit-heart
};

module.exports = {
  sakura: {
    nav: { mode: 'illustrated', extraHeight: 24, cloudKey: 'header' },
    decoration: { kitty: { show: true, cloudKey: 'kitty' } },
    tabbar: { iconMode: 'image', dir: '/custom-tab-bar/icons', icons: TAB_ICONS_GITHUB }
  },
  'github-light': {
    nav: { mode: 'minimal', extraHeight: 0, cloudKey: '' },
    decoration: { kitty: { show: false, cloudKey: '' } },
    tabbar: { iconMode: 'font', dir: '/custom-tab-bar/icons-gh-light', icons: TAB_ICONS_GITHUB }
  },
  'github-dark': {
    nav: { mode: 'minimal', extraHeight: 0, cloudKey: '' },
    decoration: { kitty: { show: false, cloudKey: '' } },
    tabbar: { iconMode: 'font', dir: '/custom-tab-bar/icons-gh-dark', icons: TAB_ICONS_GITHUB }
  }
};
