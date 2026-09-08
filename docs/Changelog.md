# Changelog

## 2026-09-08 — Power 详情与安装/卸载，双 deb 上板部署，真实 GUI 闭环在 Bibit 0.1.4 通过

分类：功能变更

设计 `e218a13`；计划 `docs/superpowers/plans/2026-09-08-power-details-install.md`。实现/文档提交：`3cca5f5`（operation 契约）、`5a85718`（Go v1 Provider 执行 APM）、`9ace521`（共享安装状态与写互斥）、`bbf690e`（详情弹窗与卸载接线）、`6511356`（dev 与正式 Provider 同契约）、`1aebdf3`（grant、超时、双 deb）、`06adfe1` `b963adc` `88ddcde` `2b9f1a7` `50af82c` `3634357`（验证与文档）。

用户需求：

为 Agent Hub 增加 Power 详情（inspect）与安装/卸载（install/uninstall），经 Go v1 Provider 的 `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` 走 `service:store` 执行 APM 命令；前端用可订阅的安装状态仓库管理写互斥、串行写入与事后确认；dev 传输层与正式 Provider 保持同一 wire 契约；追加 operation grant、写请求 120000ms 超时与双 deb，并在真实 Bibit 中验证完整操作闭环。

相关文件：

- 新 `src/api/powerOperations.ts`/`installationStore.ts`/`operationMessages.ts` 及测试：闭集 parser、可订阅状态、写互斥与安全文案
- 新 `src/components/PowerDetailsDialog.tsx` 及测试；`PowerCard.tsx`、`AgentHubPage.tsx`、`agentHub.css` 受控化接线
- `provider/internal/provider/{contracts,server,config,operations,apm,process_linux,selftest}.go` 及测试：operation 联合分派与 APM 子进程执行
- `dev/store.ts`/`sources.ts`/`vite.config.ts`/`dev/main.tsx`：dev 与 Go 同 argv/env/返回规则
- `debian/agenthub-feature-grants.json`/`agenthub-provider.json`：追加 inspect/install/uninstall、120000ms 上限
- 文档：`docs/verification/2026-09-08-power-management.md`、`docs/verification/2026-09-08-bibit-host-token-rotation.md`

解决方案或完成结果：

Provider 声明 list/inspect/install/uninstall 四枚 operation（协议 v1、`providerVersion:0.2.3`）；installed 每次 `apm list --installed --agent=<agent> --json`，inspect 执行 `apm list <name> --installed --json --agent --type` 并按目标 agent/type/name 校验记录归属，install/uninstall 执行明确 argv、非零退出码作为 `{status:"exited",exitCode}` 正常结果回传（不读 stderr、不猜失败原因），版本号强制 `vMAJOR.MINOR.PATCH`。前端 `installationStore` 用 epoch 丢弃迟到查询、写前检查、串行执行、事后独立预算刷新；详情弹窗共享版本选择，installed 仅卸载、market 打开详情。grant 追加三枚 operation 但 capability 仍只有 `service:store`；Registry 写请求上限 120000ms。

验证结果或限制：

前端 `npm test` 161→272 全绿，`typecheck`/`build:dev`/`build:plugin`/`git diff --check` 通过；Go `go test ./...`/`go vet ./...`/`go build`/`--self-test` 退出 0。双 deb 构建并上板：`bibit-agenthub-plugin_0.2.3_all.deb`（sha256 `f3f77aef…9fba`）、`bibit-agenthub-cli_0.2.3_riscv64.deb`（sha256 `7db10b43…ba37`），`apm` 装入 `/usr/bin/apm`，Provider 装入 `/usr/libexec/bibit/bibit-agenthub`。板端部署后的正式产物经 NDJSON 全链路通过：initialize → list（空/含 `foo-before-summary v0.0.1`/空）→ install/uninstall `exitCode:0` → inspect 单条。开发阶段按指示使用开发签名。

限制（已解决）：真实 Bibit GUI 内 UI 闭环最初被板端 bi-bit 0.1.3 的宿主缺陷阻塞——`voice-overlay` 与 `main` 两个 surface 都执行 `loadTrustedPluginEntries`→`trusted_plugin_prepare_active`，后者 `force_rotate=true` 轮换 feature-instance token，使主窗口插件 token 失效，任何 `service:*` 请求均 `request_unauthorized`。根因与修复建议见 `docs/verification/2026-09-08-bibit-host-token-rotation.md`。

随后用 `~/Downloads/bi-bit_0.1.4_riscv64.deb`（sha256 `4b2e81b4…3125`）升级板端宿主到 0.1.4 后，阻塞消除：启动日志仅一条 `Loaded trusted plugins: agent-hub@0.2.3`（0.1.3 为两条）、无 `restricted to the main window` 报错、无 `request_unauthorized`，`external_service.provider_ready service=store provider=0.2.3 protocol=1 operations=4` 正常出现。真实 GUI 全闭环验证通过：market 详情→安装（`apm list --installed --agent=bibit` 含 `foo-before-summary v0.0.1`）→「我的 Power」卡片→卸载（installed 清空）→market 详情恢复「未安装 + 安装」且显示「卸载完成」。详见 `docs/verification/2026-09-08-power-management.md` 的「板端真实 GUI 闭环验证（Bibit 0.1.4）」。板端 0.1.3 二进制已备份至 `/home/bianbu/bibit-backup-0.1.3/`。

## 2026-09-07 — 实现 v1 Go Provider、前端目录缓存与双 deb 上板验收

分类：功能变更

提交（设计 `473fdab`，计划 `45abcf2`，实现/文档见下）：

- `473fdab` 设计、`45abcf2` 计划
- `e9a544b` raw wire 契约、`d390e5e` 有界 v1 协议、`6ab97c4` APM/APC、`d5805ee` 自检与 stdio 驱动
- `e2ebdba` 前端缓存迁移、`e2e9b56` 双 deb、`7f717c3` 文档
- `01d4bd1` vendor SDK 同步 0.3.0、`f3a5163` 交叉编译 strip 修复、`409a05e` Provider 接受宿主 client 字段

用户需求：

用独立 Go 标准库 stdio Provider 通过宿主 `service:store` 接通 APM installed 清单与 APC 公开全量目录，Provider 只做纯中间件（不解析业务字段、只比较 `catalog_sha256`），业务解析/过滤/聚合/去重/分页/facets/snapshot 判断全部留在前端数据层，dev 与生产共用同一实现。系统部署拆分为前端 bundle（`bibit-agenthub-plugin`，Architecture: all）与 CLI Provider（`bibit-agenthub-cli`，Architecture: any）两个 deb。

相关文件：

- 新增 `provider/` Go module：`internal/provider/{server,contracts,errors,config,apm,apc,process_linux,process_other,selftest}.go`、`cmd/bibit-agenthub`、`cmd/provider-probe`、`Makefile`
- `src/api/{contracts,catalogIntegrity,powerCatalogClient,apc,apm}.ts`：wire 信封闭集、Web Crypto SHA-256 校验、`WeakMap` 缓存客户端
- `dev/{sources,store}.ts`：与 Go 同语义的 transport 与 wire 校验 store；`vite.config.ts`、`dev/main.tsx`
- `debian/{control,rules,changelog,agenthub-provider.json}`：双 deb + Registry v2 drop-in
- `vendor/`：`@bibit/feature-*` 同步 0.3.0（`service:store` 规范名称）
- 文档：`README.md`、两份部署指南、`AGENTS.md`、`debian/vendor/README.md`

解决方案或完成结果：

Provider 只声明 `powers.list.v1`、协商协议 v1；installed 每次执行 `apm list --installed --agent=<agent> --json`（退出码非 0 映射可重试 `unavailable`，绝不伪造空清单），market 每次查 `resources/version`、`catalog_sha256` 相同返回 `not_modified`、变化才下载 `resources`。前端 `WeakMap` 按 service + 缓存键隔离，generation 提交前复查、过期/取消的慢请求以 `cancelled` 结束不覆盖缓存。Registry 写入 `version:2`、`transport:stdio`、`lifecycle:managed`、`protocolVersions:[1]`、`requestTimeoutMs:30000`，CLI 包拥有 `/usr/libexec/bibit/bibit-agenthub` 与 `/etc/bibit/external-services.d/agenthub.json`。

验证结果或限制：

前端 `npm test` 161/161、`typecheck`、`build:dev`、`build:plugin` 全过；Go `go test ./...` + `go vet` 过；`--self-test` exit 0；provider-probe 对真实 APC 得到 market data（snapshot `152e5780…`、5738 字节）与 not_modified。两个 deb 实际构建（amd64 + riscv64），`readelf -h` 确认 RISC-V，`dpkg-deb --contents` 核对归属（CLI 无 probe/grant/bundle）。开发板 `bianbu@10.0.91.51`（riscv64）安装两包并激活插件 0.2.2，宿主 spawn provider 并协商 `protocol=1`（`provider_ready service=store provider=0.2.2 protocol=1 operations=1`），market 可浏览/筛选；installed 因板上无 `/usr/bin/apm` 正确降级为可重试 `unavailable`（页面显示 "Power catalog is unavailable"，非空清单伪造）。

限制：正式发布仍需公司签名 bundle + 平台公钥登记（目标 Bibit `plugin-trusted-keys.json` 为空）；构建套件无 `golang-go ≥1.26.5`（本地 `/usr/local/bin/go` 1.26.5 交叉构建）；板上无 apm，installed 真实数据未验收；settings 持久化、v2 jobs/文件传输不在本期。

## 2026-09-07（后续）— list --json 恒带 description/tags，恢复 installed 描述与标签显示

分类：功能变更

用户需求：

`../apm` 合入 ADR-029 后，`apm list --json` 成为完整机器接口：每条记录恒带 `description`（空为 `""`）与 `tags`（空为 `[]`、非 `null`），installed 记录多 `agent`，使前端通过 `list --installed` 批量获取本地资源时能拿到描述与标签；`show` 是 Cloud-only、单 name，覆盖不了本地清单与批量场景。上一轮"身份记录"对齐需要据此反转，恢复 installed 范围 description/tags 与 tag 过滤的展示。

相关文件：

- `src/api/apm.ts`：`APMPowerRecord`/`parseApmInstalledList` 注释改为"list --json 恒带 description/tags"，解析与聚合逻辑不变
- `vite.config.ts`：注释同步（argv 保持 `apm list --installed --agent=<agent> --json`，不带 `--all`）
- `src/api/contracts.ts`：`INSTALLED_AGENTS` 注释同步
- `src/api/apm.test.ts`、`dev/store.test.ts`：installed 样例改回带元数据，补充 description/tags 传递与 `facets.tags` 派生断言
- `docs/development-and-deployment-guide.md`：§10.4 / §11.2 恢复元数据契约与"切版本同步变化"冒烟说明

解决方案或完成结果：

installed 范围继续按所选 Agent 执行 `apm list --installed --agent=<agent> --json` 并解析记录；`APMPowerRecord.description?/tags?` 保持可选容忍字段，聚合时归一化 `""`/`[]`，正常元数据随 list --json 传入并展示。未安装（exit 1、空 stdout）与空清单（exit 0、`[]`）仍渲染空内容，spawn 失败仍映射可重试 unavailable；market（APC）与 settings 行为不变。

验证结果或限制：

`npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 均通过（exit 0）。协议边界为 `../apm` HEAD `73785da`（ADR-029 生效）；旧版 apm 若在 `--json` 下缺元数据，解析器仍容忍并归一化为空。

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
