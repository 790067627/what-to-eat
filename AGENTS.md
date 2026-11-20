# AGENTS.md — 点菜小程序（what-to-eat）AI 协作指引

> 本文件供 WorkBuddy / Codex / Claude Code 等 AI Coding Agent 在新会话开始时自动阅读。

## ⚠️ 涉及 UI / 页面 / 组件 / 颜色 / 主题的任何任务，必须先读：

**`docs/主题系统开发规范.md`**（项目级技术规范，与代码同步维护）

不读该文档直接改样式 = 大概率破坏三套主题（樱花粉 / GitHub Light / GitHub Dark）的一致性。重点章节：

- **4.0 新页面开发原则**：针对语义 Token 契约开发，不针对某套主题；颜色一律 `var(--token, 樱花回退值)`，禁止硬编码
- **4.1 页面三件套**：`Page(withTheme({...}))` + WXML 首节点 `page-meta` + WXSS 用 `var()`
- **2.2 Token 全清单**：103 基础 + 9 别名，选色先查表，缺语义则三主题同时加同名 Token
- **7.2 高危操作**：`app.wxss` 等 4 个文件含内联 base64 字体行，AI 编辑工具会截断超长行导致图标全变横线——改动后必须字节级比对 git HEAD
- **7.4 验收清单**：新页面/新主题必须三主题全过，深色模式四大易漏点（遮罩/图片占位/空态/输入框底色）

## 其他必读上下文

| 文件 | 内容 |
|---|---|
| `小程序项目档案.md` | 技术栈、目录结构、云函数 action 清单、数据库集合、已知债务 |
| `.workbuddy/memory/MEMORY.md` | 项目长期记忆（TabBar 高度模型、协作纪律、主题架构约定、工具结论） |
| `.workbuddy/memory/YYYY-MM-DD.md` | 每日工作日志（append-only） |

## 硬性纪律（违反会破坏协作）

1. **git 提交只 add 自己改动的文件路径**，禁止 `git add -A` / 整目录 add（本仓库有并行会话在改代码）
2. **改 wxss 后校验**：花括号配平；含 base64 字体的文件（app.wxss、custom-tab-bar/index.wxss、poster、custom-navbar）字体行与 git HEAD 字节一致
3. **体验码生成**：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli preview --project <绝对路径> --qr-format image --qr-output <绝对路径>`（qr-output 必须绝对路径）
4. **云函数部署**：微信开发者工具 CLI `cli cloud functions deploy --env cloud1-d2g70c8532117f303 --names dish --project <绝对路径> --remote-npm-install`；Updating 状态等 45s 重试
5. **云数据库/存储运维**：tcb CLI（`db nosql execute` / `storage rm|list`），先 QUERY 确认再改
6. 价格单位是**分**（前端 fenToYuan/yuanToFen 转换）；数据操作全部走云函数 `dish`（services/db.js 统一 call()），页面不直连数据库

## 项目速览

- 微信小程序（原生框架）+ 微信云开发（环境 `cloud1-d2g70c8532117f303`）
- 4 Tab（首页/菜品库/抽一抽/我的）+ 5 子页，自定义 TabBar，9 页面全部接入主题系统
- 主题系统：`miniprogram/theme/`（tokens.js / theme-assets.js / theme-manager.js / theme-page.js / theme-component.js），三层架构，含「跟随系统」模式
- 图标：bootstrap-icons 89 码位子集（内联 base64），子集外码位渲染为横线
- 远程：github.com/790067627/what-to-eat.git（main）
