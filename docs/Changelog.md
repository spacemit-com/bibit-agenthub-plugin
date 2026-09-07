# Changelog

## 2026-09-07 — 对齐 apm list 身份记录契约

分类：功能变更

用户需求：

`../apm` 合入 feature-029（list 全版本查询 + show 详情）后，`apm list` 的 `-a/--all` 语义改为「对已命名 Cloud Power 展开全部版本」且缺少 name 时直接报错；list 的文本与 JSON 输出统一为身份记录（installed 每条仅含 agent、type、name、version），description/tags 不再出现在 list 输出中，详情由 Cloud-only 的 `apm show` 提供。旧版 `apm list --installed --agent=<agent> --json --all` 已对最新 apm 恒失败（`--all requires name`），需要对齐 dev-only 调用与解析契约。

相关文件：

- `src/api/apm.ts`：更新 `APMPowerRecord`/`parseApmInstalledList` 注释，明确身份记录输入与可选元数据容忍语义
- `vite.config.ts`：installed 请求 argv 去掉 `--all`，改为 `apm list --installed --agent=<agent> --json`
- `src/api/contracts.ts`：更新 `INSTALLED_AGENTS` 注释中的命令引用
- `src/api/apm.test.ts`、`dev/store.test.ts`：installed 样例改为身份记录，补充身份记录归一化断言
- `docs/development-and-deployment-guide.md`：§10.4 / §11.2 命令与冒烟说明同步

解决方案或完成结果：

installed 范围按所选 Agent 执行 `apm list --installed --agent=<agent> --json` 并解析身份记录数组；具体 Agent 未安装（exit 1、空 stdout）与已安装空清单（exit 0、`[]`）都渲染为空内容，spawn 失败仍映射为可重试的 unavailable。`APMPowerRecord.description?/tags?` 保留为可选容忍字段，聚合时归一化为 `""` / `[]`；由于最新 apm 不再输出已安装元数据，installed 卡片不展示 description/tags、`facets.tags` 恒为空。market（APC）与 settings 行为不变。

验证结果或限制：

`npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 均通过（exit 0）。已安装范围的 description/tags 展示受上游 CLI 契约限制（元数据仅 Cloud `show` 提供）；如需恢复，需等 apm 提供 installed 范围元数据通道或未来 Store 桥接，本次不改变数据流架构。

## 2026-09-02 — Power 市场接入 APC

分类：功能变更

用户需求：

将 Power 市场（`scope=market`）从本地 fixture 改为真实 APC 公开目录，彻底放弃仿真数据；市场行为与「我的 Power」对齐，每次点击类型/标签、翻页都重新拉取并解析最新列表，不保留跨请求缓存。

相关文件：

- 新增 `src/api/apc.ts`（APC 公开目录解析：分组到类型映射、字段规范化、tag 排序去重、`(type,name,version)` 去重）与 `src/api/apc.test.ts`
- `dev/store.ts` 移除 `marketFixtures`，新增 `runApcCatalog` 注入，market 复用 `buildPowersResult` 聚合
- `vite.config.ts` 新增 dev-only `runApcCatalog`（`GET /resources/version` 取快照 + `GET /resources` 跟随重定向取全量目录，测试环境关闭 TLS 校验）
- `src/AgentHubPage.tsx` 增加 APC 不可用 → 可重试 unavailable 文案
- `APC-API.md` 补齐目录条目 `tags` 字段；`docs/development-and-deployment-guide.md` 更新 Local Preview 说明

解决方案或完成结果：

market 每次 `powers.list.v1` 请求都由 dev 传输层新鲜拉取 APC 全量目录，`parseApcCatalog` 解析后用既有 `buildPowersResult` 按 `type` 过滤、聚合、分页，快照采用 `/resources/version` 的 `catalog_sha256`，目录变化时走 `reset_required` 回第 1 页。APC 公开接口无按类型列表端点，故采用「全量列表 + 客户端按类型过滤」。测试环境证书不受信，仅 dev-only 传输层关闭 TLS 校验，不进插件 bundle。

验证结果或限制：

`npm test`（10 个文件 122 个测试）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 均通过（exit 0）。APC 每个 `name` 只保留最新版本，市场卡片版本下拉恒为单版本；生产 CLI Provider（`bibit-agenthub-cli`，独立包）仍用 fixture 种子，需另行接入同一 APC 映射。

## 2026-09-02

分类：功能变更

用户需求：

将 tmp-dev 的「我的 Power」改为真实数据源：用户每次点击 Agent 选项时，从 PATH 调用 `apm`，解析 `apm list --installed --agent=<selected> --json --all` 的结果并渲染已安装 Power 页面，不再展示 mock 示例；Power 市场保持不变。前端 Agent 固定为 bibit / codex / claude-code 三个选项（`claude-code` 即 apm 中 Claude 的 id），不做 `--agent=all` 发现；list 返回「未安装」时前端显示空内容。

相关文件：
- 新增 `src/api/apm.ts`（APM JSON 解析、记录规范化、系列聚合、快照与分页）与 `src/api/apm.test.ts`
- 新增 `dev/store.ts`（纯 Store 核心，注入 `runApm`；market fixture 与 settings 不变）与 `dev/store.test.ts`
- 新增 `vite.config.ts`（dev-only Node 中间件，用固定 argv、无 shell 方式 spawn `apm`）
- `dev/main.tsx` 改用 `serviceConnections`；删除 `dev/powerCatalogMock.ts` 与 `dev/powerCatalogMock.test.ts`
- `src/AgentHubPage.tsx` Agent 菜单固定为 `INSTALLED_AGENTS`，移除基于 `facets.agents` 的发现与自动选择
- 标准化 `service:store`：`bibit.feature.json`、页面/客户端及测试统一改用 `FeatureService*` 类型

解决方案或完成结果：

installed 由 Vite 中间件按所选 Agent 逐次 spawn `apm list --installed --agent=<selected> --json --all` 并解析；`src/` 不直接执行 CLI，spawn 只存在于 dev-only 的 `vite.config.ts`。apm 缺失时映射为可重试的 `unavailable`，未安装或空列表时渲染空内容；`facets.agents` 恒为空，前端菜单由常量提供。market 与 settings 行为不变。Local Preview 中 apm 不可达时，页面区分显示「Power catalog is unavailable: the apm CLI could not be started.」并给出 Retry，而不是误报 incompatible。

验证结果或限制：

`npm test`（9 个文件 104 个测试）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 均通过（exit 0）。Remote Store、Bibit Host adapter 与正式 CLI Provider 仍未接入；installed 数据依赖本机 `apm` 位于 PATH 中。

## 2026-08-28

分类：功能变更

用户需求：

将 Agent Hub 前端重构为统一 Marketplace 风格：Agent 选择收进“我的 Power”菜单，类型与 Tags 提供选中边框和类型配色，卡片支持固定区域滚动与最多五列布局，分页改为箭头和页码输入。

相关提交：
- `27b31e7 docs: design Agent Hub marketplace layout`
- `b4ef4a1 feat: unify Agent Hub filters`
- `5deb887 feat: restyle Power card content`
- `a4be83c feat: add direct Power pagination`
- `042fa69 feat: integrate Agent Hub navigation`
- `7aa5f17 feat: apply Agent Hub marketplace layout`

解决方案或完成结果：

采用一级范围页签与独立筛选面板，保留已选 Agent；统一四种 Power 类型的筛选与卡片配色；重排版本、描述和 Tags；增加响应式五列网格以及支持 Enter/失焦提交的快速翻页。

验证结果或限制：

`npm test` 全部通过（8 个文件 84 个测试）；`npm run typecheck`、`npm run build:dev`、`git diff --check` 均通过（exit 0）。浏览器端五/四/三/二/一列布局、类型配色、固定区域滚动与悬停效果的可视化检查因本环境无浏览器工具未能执行，留待人工复核。Store DTO、每页 20 项和安装/市场数据语义未改变。

## [新增功能] 2026-08-27 — APC Power 展示原型与系列级资源接口

- 原始需求：构建 Agent Hub Power 展示原型，用统一的 Store DTO 承载 installed 与 market 数据，并将 APC 公共资源发现改为系列级分页并支持 tag 过滤。
- 类别：新增功能
- APC 文档提交：4fe396a（定义系列级资源发现契约）、b575574（修正列表示例分页）
- 插件行为提交：3bc65b5、4eee2b4、245fbb2、ceb345b、ff73768、cb81d45、18ebba1、a00ec1c
- 变更摘要：统一 Store DTO（powers.list.v1，installed 与 market 共用闭集校验）；APC 公共资源列表改为系列级分页并支持 tag 过滤与 type 级 tag 清单。
- 验证：npm test（7 个文件 73 个测试全部通过）、npm run typecheck（exit 0）、npm run build:dev（exit 0）、git diff --check（exit 0）、git diff -- src/agentHub.css（无输出）。
- 发布前置项：Remote Store、APC 服务端、Bibit Host adapter 仍未实现。
- 样式：未新增或修改任何 CSS。
