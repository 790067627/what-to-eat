# AI 饮食灵感 · 实施与上线文档（feature/ai-food-discovery）

> 分支：`feature/ai-food-discovery`（worktree `../what-to-eat-discovery`，基线 main@2c21ed0）
> 提交序列：P0 `718a5ad` → P1 `5a56e9e` → P4 `de92f9b` → P2/P3 测试 `551ce11` → fix `a308642`
> 云函数**未部署**、线上库**未变更**——部署与迁移步骤见 §5，需人工确认后执行。

## 1. 修改文件清单

| 文件 | 变更 |
|---|---|
| `cloudfunctions/dish/index.js` | getDish 收紧仅 owner；路由挂 15 个新 action；旧 saveSharedDish 删除；getProfile/saveProfile 增公开身份字段；importData 来源字段白名单 |
| `cloudfunctions/dish/lib/discovery.js` | 新增：公开发布/审核/撤回、定向分享 token、点赞、一键加入、行为记录 |
| `cloudfunctions/dish/lib/recommend.js` | 新增：口味画像（复用 tags/rating/status/eat_logs）、召回→硬过滤→band 排序→多样性重排、游标分页、AI 理由缓存与模板回退 |
| `miniprogram/services/db.js` | 新增全部 action 封装；saveSharedDish 签名 dishId→token |
| `miniprogram/pages/dish-detail/*` | 三模式（own/shared/public）；发布到灵感广场弹层（预览+范围确认）；点赞行；分享消息带 token |
| `miniprogram/pages/mine/*` | 公开身份设置弹层（公开昵称/匿名），展示名不再固定 |
| `miniprogram/pages/index/*` | 重构为 AI 灵感卡栈首页（方案 A），移除分类宫格，保留初始化引导/Kitty/nav-bears/TabBar |
| `miniprogram/components/card-stack/*` | 新增：WXS 手势卡栈（方案 A 同参：阈值 96px/速度 0.55/旋转 0.045°/出场 13°） |
| `miniprogram/components/dish-sheet/*` | 新增：底部详情抽屉（视觉冻结：遮罩 300ms + 上滑 420ms 过冲回弹） |
| `miniprogram/pages/taste-prefs/*` | 新增：口味偏好（5 维滑杆）+ 忌口（硬过滤） |
| `miniprogram/theme/tokens.js` | 四主题同步新增 `--bg-glass` / `--glass-border` |
| `miniprogram/app.json` | 注册 taste-prefs 页面 |
| `test/cloud-logic.test.js` | 23 项云函数逻辑单测（mock db） |

## 2. 数据结构与索引设计

### 新集合（云函数首次调用自动 createCollection）

```
public_dishes        公开菜品快照
  sourceDishId       原私人菜品 ID（服务端内部）
  authorOpenid       作者（服务端内部，所有响应剔除）
  authorNickname/authorAvatar/anonymous   作者公开身份
  name/coverImage/images/description/tags/categoryName   白名单快照
  includePrice/price 价格默认不公开，勾选才携带
  reviewStatus       pending | approved | rejected | withdrawn
  secCheck           pass | review | unavailable（msgSecCheck 结果）
  likeCount/saveCount 服务端原子计数（_.inc）
  publishedAt/withdrawnAt/createdAt/updatedAt

dish_shares          好友定向分享凭证
  token(32hex)  openid(签发者)  dishId
  snapshot{name,coverImage,images,description,tags,categoryName}   白名单，无价格/openid/status
  expiresAt(7天)  createdAt

public_dish_likes    点赞关系（确定性 _id = openid_publicDishId → 天然唯一）
  openid  publicDishId  deleted(取消=软删，复活复用)

user_behaviors       行为记录（openid 隔离）
  type: expose|like|unlike|save|next|not_interest|eat|rate
  refType: own|public   refId   createdAt

ai_reason_cache      AI 理由缓存（_id = md5(菜名|标签|画像摘要)）

dishes（存量集合新增字段，仅增量）
  sourcePublicDishId  公开快照来源（幂等键成分）
  sourceAuthor{nickname,avatar}  可展示来源
  sourceShareToken    定向分享来源
  副本 _id 确定性：cp_<openid>_<publicDishId> / cs_<openid>_<md5(token)>
```

### 索引建议（控制台 → 数据库 → 索引管理，上线前建）

| 集合 | 索引 | 用途 |
|---|---|---|
| public_dishes | `{reviewStatus:1, updatedAt:-1}` | 推荐池召回（非唯一） |
| public_dishes | `{sourceDishId:1, authorOpenid:1}` 唯一 | 防重复发布 |
| public_dish_likes | `{openid:1, publicDishId:1}` 唯一 | 幂等（_id 已确定性，双保险） |
| dishes | `{openid:1, sourcePublicDishId:1}` | 已加入判断/批量回查 |
| user_behaviors | `{openid:1, createdAt:-1}` | 画像读取/清理 |
| dish_shares | `{token:1}` 唯一 | 凭证查找 |
| eat_logs | `{openid:1, eatenAt:-1}` | 画像近期信号 |

## 3. 云函数 action 变更

| action | 类型 | 说明 |
|---|---|---|
| getDish | **行为收紧** | 仅 owner（旧版可跨用户读——越权漏洞，P0 修复） |
| saveSharedDish | **签名变更** | `{dishId}` → `{token}`；旧参数直接拒绝 |
| createShareToken / getSharedDish | 新增 | 定向分享签发/读取 |
| publishDish / withdrawPublicDish / listMyPublications / getPublicDish | 新增 | 公开发布链路 |
| reviewPublicDish | 新增 | 管理员审核（`ADMIN_OPENIDS` 环境变量，逗号分隔） |
| likePublicDish / savePublicDish / logBehavior | 新增 | 社区互动 |
| getFeed / saveTastePrefs / getTastePrefs | 新增 | 推荐与偏好 |
| getProfile / saveProfile | 扩展 | +publicNickname/publicMode（向后兼容，缺省 nickname 模式） |
| importData | 扩展 | 白名单保留 sourcePublicDishId/sourceAuthor.nickname；审核状态不可导入伪造 |
| 其余（listDishes/randomPick/logEat/exportData…） | 不变 | 兼容性验收项 |

**推荐算法**：画像=tags 关键词映射 5 维口味向量 ×（often/高评分/吃过=正，never=负，want=弱 0.3）+ profiles.tastePrefs 显式覆盖；管道=召回(own+approved public ≤100) → 忌口/曝光去重硬过滤 → **band(口味带)为第一排序键**、带内 0.6×口味+0.1×热度 → 相邻 3 张多样性重排 → 游标(base64 seenKeys)分页 6/页。**AI 理由**：默认关闭（`AI_REASON_ENABLED=true` 才调用），复用 AI_MODELS 配置，5s 超时，md5 缓存，失败回退模板——大模型不在滑动实时链路。**回退**：AI 失败→模板理由；getFeed 失败→前端 toast 重试；公开池为空→纯私有菜推荐照常工作。

## 4. 测试结果

### 本地单测（`node test/cloud-logic.test.js`，23/23 通过）
验收映射：①越权读取封死(getDish owner-only) ②token 定向分享(白名单快照/过期拒绝) ③pending 不可见、审核通过才可见 ④点赞幂等不穿负 ⑤⑥一键加入独立副本+10 连点幂等 ⑦分类按名映射不继承 ⑧评分不继承 ⑨副本修改隔离 ⑩撤回后不可读/不可加入 ⑪三画像不同排序 ⑫AI 关闭回退模板 ⑭行为 openid 隔离。

### 编译验证
微信开发者工具 CLI preview 编译通过，体验码 `preview/qr.png`（约 25 分钟过期，仅项目成员可扫）。

### 待真机执行的 A/B 双账号验收（需两台设备/两个微信号）
1. 账号 A 添加菜 → 账号 B 用任意方式拿 A 的 dishId 调 getDish → 应「菜品不存在」
2. A 详情页「分享给好友」→ B 打开分享 → 应看到 token 快照页（无价格）→「保存到我的菜单」成功
3. A「发布到灵感广场」→ B 首页 feed 刷新 → 审核前应不出现；管理员 `reviewPublicDish approve` 后出现
4. B 对公开菜点赞/取消 → 计数 1→0→1，不重复
5. B「想吃」连点 10 次 → dishes 中 B 名下 sourcePublicDishId 副本仅 1 条
6. B 的副本 categoryId ∈ B 自己的分类或 ''，≠ A 的 catId；rating=0
7. B 改副本名字/评分 → A 原件不变
8. A 撤回公开 → B（新会话）getPublicDish/savePublicDish 均拒绝
9. 三账号设不同口味偏好 → 首页前 3 卡顺序不同
10. 断网/AI 环境变量删除 → feed 仍返回（模板理由）
11. 抽一抽、记一笔、吃历、导入导出、海报回归
12. iPhone 真机：卡栈跟手/回弹/出场旋转、抽屉上滑回弹接近方案 A 录屏（experiments/qa-out/A-drag.mp4）
13. 四主题切换回归（含深色遮罩/占位/空态/输入框底色四漏点）

## 5. 部署与迁移步骤（人工确认后执行）

```bash
# 1) 数据备份（tcb CLI；授权路径：登录页→其他登录方式→小程序公众号→扫码→选 yuki小厨房）
tcb db nosql execute --env cloud1-d2g70c8532117f303 \
  --query 'db.collection("dishes").where({}).limit(1000).get()' > backup-dishes.json
# profiles/eat_logs/categories 同样导出

# 2) 部署云函数（Updating 卡住等 45s 重试）
/Applications/wechatwebdevtools.app/Contents/MacOS/cli cloud functions deploy \
  --env cloud1-d2g70c8532117f303 --names dish \
  --project /Users/wx/WorkBuddy/what-to-eat-discovery --remote-npm-install

# 3) 控制台配置环境变量：ADMIN_OPENIDS=<审核人openid>（必填，否则无人能过审）
#    可选：AUTO_APPROVE=pass_security（联调用：安检通过自动 approved；生产建议不配）
#    可选：AI_REASON_ENABLED=true + AI_MODELS（复用 airec 同款 JSON 数组格式）

# 4) 建 §2 索引（控制台手工，或 tcb）

# 5) 真机 A/B 验收（§4 清单）→ 通过后合 main
```

**回滚方案**：
- 云函数回滚：重新部署 main 分支的 `cloudfunctions/dish`（git checkout main 后同命令），新 action 消失、getDish 恢复旧行为；
- 数据回滚：新集合（public_dishes 等）可直接整集合删除，不影响存量；dishes 新增字段为增量字段，旧版云函数不读取，无需清理；副本菜（`_id` 以 `cp_`/`cs_` 前缀）可按前缀批量软删；
- 前端回滚：小程序代码未发版，回滚 = 不发布该分支。

**已知限制（如实说明）**：
1. `msgSecCheck` 云调用需云函数侧开通权限且基础库/服务端版本支持（以官方文档核实）；调用失败按「转人工 pending」处理，不自动放行。
2. 公开图片复制会占用云存储配额（封面必复制，附图限 3 张）；撤回公开暂不删图片文件（保留审计），可后续加定时清理 withdrawn>30 天的文件。
3. user_behaviors 未做 TTL 清理，量大后需定时触发器归档（expose 类保留 90 天即可）。
4. 审核后台暂无 UI，管理员用微信开发者工具「云开发控制台→云函数→云端测试」调 reviewPublicDish。
