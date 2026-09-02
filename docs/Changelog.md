# Changelog

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
