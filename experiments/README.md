# experiments/ — 实验与验证产物

这里存放不参与小程序构建的 POC、原型和兼容性验证工程。正式代码只在仓库根的
`miniprogram/`（前端）和 `cloudfunctions/`（云函数）里，见根 README。

| 目录 | 是什么 | 结论 / 状态 |
| --- | --- | --- |
| `poc-main-flow/` | 主流程交互 POC（纯 HTML/CSS/JS 手机壳演示）：抽一抽、菜品库、菜品管理、分类管理等页面的交互与视觉验证 | 活跃迭代，方案验证后落地到 `miniprogram/pages/` |
| `poc-gacha/` | 抽卡（扭蛋）玩法动画 POC，含状态机调试开关 | v2 翻牌方案已验证并落地到 `miniprogram/pages/random`（见提交 5c9c68b）；v3 分享交互（卡顶图标对 / 底部 sheet / 全屏海报）验证中 |
| `prototype/` | AI 识菜照片识别的静态交互原型（v2 / v3） | v3 已落地为「AI 识别添加」入口（v1.1.3） |
| `compat-check/` | 独立的兼容性验证小程序工程，用于在真机上确认动画/API 表现 | 动画方案经 iPhone 12 Pro / iOS 27.3 / 基础库 3.18.0 验证通过；换基础库版本时可复用 |
| `preview/` | 樱花背景等静态素材的浏览器预览页 | 素材确认用途 |
| `integration-shots/` | 集成/真机验证截图 | 本地产物，已在 `.gitignore` 中排除 |

## 约定

- **实验的代码入库，临时产物不入库。** 体验码/验证二维码截图（约 25 分钟过期）和
  `shots/`、`integration-shots/` 下的截图均由 `.gitignore` 排除。
- 新增实验请在本表补一行，写清「验证什么」和「结论」——文字结论比截图更耐用。
- 实验方案落地到 `miniprogram/` 后，把状态改成"已落地 + 对应页面/提交号"，方便回溯。
- 这里的目录都不参与构建（`project.config.json` 的 `miniprogramRoot` 指向 `miniprogram/`），
  可以随意增删，不会影响小程序运行。

## 本地打开方式

```bash
# 静态 POC / 原型：直接开文件或起个静态服务
open experiments/poc-main-flow/index.html
open experiments/poc-gacha/index.html
python3 -m http.server 8080   # 需要相对路径加载资源时

# compat-check：微信开发者工具 → 导入项目 → 选 experiments/compat-check
```
