# Changelog

## 2026-09-24 — 修复 Power 市场误报「请求已取消」（0.3.2）

分类：缺陷修复

用户反馈：

Power 市场出现「Power 目录请求已取消。」。

问题与根因：

- **`cancelled` 被当成终止态错误**：`cancelled` 不在 `RETRYABLE_CODES` 内，错误渲染时没有 Retry 按钮，用户除切 scope 或离开页面外没有出口。但该码在架构里表达的是「被更新的请求取代」或「provider 会话被拆掉」，并非用户主动取消，也不是数据错误。
- **自取消**：页面 effect 依赖含 `retry`，而窗口 `focus` 事件会无条件 `setRetry(+1)`；每次 bump 触发 cleanup 的 `listController.abort()`，把正在飞的 market 请求掐掉再重发。market 是唯一走网络且耗时可观的 scope（板上实测 APC 全量目录约 0.95s），所以最容易被命中。
- **缓存代次竞争**：`commitCache` 在 `slot.generation !== generation` 时抛 `cancelled`，此时 `signal.aborted` 为 false，页面 catch 的 abort 护栏拦不住，于是渲染成用户可见错误。

相关文件：

- `src/AgentHubPage.tsx`：`RETRYABLE_CODES` 加入 `cancelled`；`focus` 监听在 `view.status === 'loading'` 时不再 bump `retry`（改用 `viewStatusRef` 读取，监听器保持稳定）
- `src/api/powerCatalogClient.ts`：`commitCache` 返回 `'committed' | 'superseded'`，代次落后时不再抛错，改为从更新的缓存作答；被中止的请求仍然拒绝提交
- `src/AgentHubPage.test.tsx`：`cancelled` 纳入错误映射的参数化用例（期望可重试）；新增「market 飞行中窗口获焦不得重发请求、不得渲染 cancelled」
- `src/api/powerCatalogClient.test.ts`：原「过期请求以 cancelled 结束」用例改为「过期请求从更新的缓存作答」

解决方案或完成结果：

被取代（superseded）不再是错误：慢请求发现自己落后时，直接用新提交的缓存产出结果，不再抛 `cancelled`；窗口获焦只在空闲态触发刷新，不会中断进行中的 market 读取；即便 `cancelled` 仍从宿主或 provider 冒出来（会话拆除等），页面也会给出 Retry 而不是死路。

验证结果或限制：

`npm test` 337/337（22 个文件，较 0.3.1 的 335 增 2 条）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 与改动文件的 `git diff --check` 均通过；Go Provider 未涉及，`go test ./...` 复跑通过。三条新断言在回滚源码后均失败（重发请求计数 3≠1、cancelled 无 Retry、过期请求抛 Unknown Error），确认测试确实覆盖修复点。

限制：板端真实 GUI 复核未执行。注意宿主 `install_bundle` 对同版本 bundle 走 `AlreadyInstalled` 幂等跳过，因此本修复要上板生效必须先提升版本号（如 0.3.2），否则宿主不会替换 0.3.1 的已安装内容。

## 2026-09-18 — Power 市场卡片布局、滚动条与标题定版（0.3.1）

分类：需求改进 + 缺陷修复

说明：本条记录一次连续迭代的最终落地结果，过程中的中间版本号（0.3.2–0.3.5）已合并进 0.3.1 这一个版本，中间版本的产物移到 `artifacts/superseded-0.3.1-pre-unify/`；文档与代码只保留这一版。

用户需求与反馈：

1. 默认窗口化（BiBit 主窗口 1200×800）进入 Power 市场时，卡片被描述撑得又高又窄、页面没有上下滚动，第 5 张卡片和翻页按钮都被裁掉；需要卡片布局适应不同窗口，描述允许只显示一部分、用无边框滚动区浏览。
2. 卡片里的滚动条要隐藏（像 tags 那样），不要描述区的横向滚动条，描述框提高到 5 行。随后澄清：不是完全隐藏，而是**静止时不显示、滚动时显示当前位置**，并且要覆盖插件页面里**所有**滚动条，包括页面那根大滚动条。
3. 上述滚动条改法在真实 GUI 里没有生效——卡片滚动条与页面大滚动条一样“常显示”。
4. Power 名字不要换行，字号调整到能在一行里显示完，使卡片排版可以对齐。

问题与根因：

- **页面不能滚动**：宿主给页面 contribution 的盒子是 `min-h-svh`（`SidebarProvider` / `SidebarInset` 只有 `min-height`，没有确定高度），`div.size-full` 与 `FeatureContributionHost` 的 `h-full` 在这条链上解析不出确定值——页面高度退回 `auto`、随内容变高，`overflow-y: auto` 永不触发，超出窗口的内容直接不可达。宿主自己的全高页面用的是视口单位（`h-svh`）。Local Preview 的 Dev Host 画布是自适应高度，掩盖了这个问题，所以本地看不出来。
- **滚动条 CSS 是死代码**（两次改法无效的原因）：宿主全局样式 `* { scrollbar-width: thin; scrollbar-color: oklch(...) }`（`web-app/src/index.css`）覆盖所有元素；按规范 `scrollbar-width` 非 `auto` 时所有 `::-webkit-scrollbar` 规则失效，WebKitGTK 又完全忽略 `scrollbar-color`、且对运行时样式变更永不重绘（开发板实测数据见开发指南 7.2.1）。结论：平台滚动条无法做到“静止隐藏、滚动时出现”，插件写任何滚动条伪元素都是死代码。
- **标题换行导致卡片不齐**：`.power-card h2` 原为 `-webkit-line-clamp: 2`，名字长的卡片标题占两行、短的占一行，网格行（`grid-template-rows: auto …`）高度不一致，描述区起始位置参差不齐。

相关提交（同一版本内的连续修正）：

- `fix: bound the Power card grid and let the page scroll`
- `fix: size the page against the viewport so it really scrolls`
- `fix: make every plugin scrollbar auto-hide instead of disappearing`（方案本身无效，见上）
- `fix: draw the scrollbar indicator instead of styling the platform bar`
- `feat: fit Power names on a single line`

相关文件（最终状态）：

- `src/agentHub.css`：`.agent-hub` 用 `height: 100vh; height: 100svh` + `overflow-y: auto` 自持滚动；`.power-card` 删掉 `min-height`、`align-content: start`；`.power-card__description` 固定 5 行（`7.5em`）无边框滚动区、`overflow-x: hidden`；`.power-card h2` 固定 `height/line-height: 26px` + `nowrap` + `ellipsis`；`.power-pagination` 吸底；五个滚动容器（页面、描述、两处标签行、弹窗内容区）`scrollbar-width: none` + `position: relative`，`.agent-hub__scroll-thumb` 自绘指示条
- `src/AgentHubPage.tsx`：`useLayoutEffect` 量出 `window.innerHeight - rect.top` 写成内联高度并在 resize 时重算；换页/换范围/换 Agent/换类型/换 tags 时回顶
- 新 `src/ScrollThumb.tsx`：自绘 overlay 指示条（按 `client/scroll` 比例算长度与位置，滚动时显示、停 1s 淡出，`pointer-events: none`）
- 新 `src/useFittedFontSize.ts`：在 19px 上限下量一次文本自然宽度（`Range.getBoundingClientRect()`），按 `max × 盒子宽 ÷ 自然宽` 反解字号并夹在 `[13, 19]`，`ResizeObserver` / `window.resize` 触发重算
- `src/components/PowerCard.tsx`、`PowerFilters.tsx`、`PowerDetailsDialog.tsx`：给描述区、卡片标签行、筛选标签行、弹窗内容区挂 `ScrollThumb`；标题挂 `useFittedFontSize`
- 测试：新 `src/ScrollThumb.test.tsx`、新 `src/useFittedFontSize.test.tsx`，`src/agentHubLayout.test.ts` 扩到 8 条 CSS 契约，`src/AgentHubPage.test.tsx` / `src/components/PowerCard.test.tsx` 补齐量与接线回归
- 新 `dev/devHostViewport.css` 与 `dev/main.tsx` 改动：把 Local Preview 画布压成固定一个视口高，复现宿主给插件的盒子（仅预览，不进 bundle）
- `package.json`、`package-lock.json`、`bibit.feature.json`、`debian/changelog`：0.3.0 → 0.3.1（中间版本号合并）
- 文档：开发指南 7.2 重写 + 新增 7.2.1（WebKitGTK 实测表）与本文

解决方案或完成结果：

- 页面自己承担滚动：高度用视口单位兜底、再由 `useLayoutEffect` 按宿主盒子校准，一页最多 20 张卡片都能滚到，分页控件 `position: sticky; bottom: 0` 常驻底部；
- 描述区固定 5 行、无横向滚动条，完整描述仍在详情弹窗内；
- 所有插件滚动条“静止不可见、滚动时显示位置、停约 1 秒淡出”：插件关掉原生条（`scrollbar-width: none`，这是插件能设的属性），由 `ScrollThumb` 自绘指示条，鼠标停在区域上也不会一直挂着；
- 标题永远一行：盒子固定 26px（所有卡片标题行等高），字号按名字长度在 13–19px 之间自适应，`text-overflow: ellipsis` 只作极端长名字的兜底——卡片网格的标题行、描述区、标签行因此全部对齐。

验证结果或限制：

`npm test`（22 个文件、335 项测试）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 全绿；CSS 契约测试会拦住“再写死 `::-webkit-scrollbar`”“把滚动条彻底藏掉”“重新引入 `-webkit-line-clamp`”等回退。开发板（`bianbu@10.0.91.51`，riscv64，WebKitGTK 2.52）实测：

- 滚动条：`scrollbar-color` 被忽略、`::-webkit-scrollbar` 仅在规则一开始就匹配时生效且运行时永不重绘、`scrollbar-width: none/thin` 生效（表见 7.2.1）——据此选定自绘方案；
- 标题：用真实字体与真实卡片内容宽（182 / 223 / 238px）量真实目录名，最长 `foo-before-summary`（19px 下 193px）在最窄 182px 列里缩到 17.5px 正好放下，`markdown-maker`（165px）及其余全部名字任何断点都是满号 19px，所有用例单行、盒高 26px；构造出的 368px 超长名字落到 13px 下限并被省略号截断。

板端只保留 `bibit-agenthub-plugin 0.3.1` + `bibit-agenthub-cli 0.3.1`（从 0.3.5 降级到统一版本），bundle sha256 与本地产物一致，provider `--self-test` 退出 0；真实观感与布局最终仍需重启 Bibit 后按开发指南 16.4 步骤 9 复核。

## 2026-09-10 — 插件中英文跟随 Bibit 系统语言

分类：功能变更

用户需求：

给 Agent Hub 插件增加随 Bibit 系统切换中英文的能力，参考 `../bibit-runtime-plugin` 的实现方式。

相关提交：

- `feat: follow the host language for all plugin copy`（本条记录所在提交）。

相关文件：

- 新 `src/agentHubI18n.tsx` 及 `src/agentHubI18n.test.tsx`：英文源串词典、`en` / `zh-CN` 菜单资源、Provider、稳定 `t`、`withAgentHubI18n`
- `src/api/operationMessages.ts`、`src/api/installationStore.ts`：文案改为 `TranslatableText { text, values? }`，语言不在数据层持有
- `src/AgentHubPage.tsx`、`src/AgentHubSettingsPage.tsx`、`src/components/*`：所有标签、状态、错误与 aria 文案经 `t(...)` 渲染
- `src/feature.tsx`、`src/plugin.tsx`、`bibit.feature.json`：`locales`、`pluginLocales` 导出、设置导航 `titleKey`、版本 0.3.0
- `dev/main.tsx`：语言下拉框与 `?lang=zh-CN`
- `vendor/bibit-feature-*.tgz`、`package-lock.json`：按目标 Bibit `b538783`（`bianbu/0.1.8`）重新打包并同步 integrity
- 文档：`docs/verification/2026-09-10-plugin-i18n.md`、本指南 1 / 3 / 6.1 / 6.2 / 7.1 / 11.2 / 16.4 / 18 / 19 与 `README.md`
- `src/components/PowerFilters.test.tsx`：修掉 2026-09-09 记录过的键盘焦点时序失败（等待触发键的 `requestAnimationFrame` 落定后再继续按键）

解决方案或完成结果：

页面、设置页与全部组件的自有文案以英文为源语言，按宿主传入的 `language`（`en` 或 `zh-CN`）翻译成中文；菜单、导航与描述键通过插件入口的 `pluginLocales` 导出交给宿主注册。`withAgentHubI18n` 只注入 Provider，不加 `key`，列表 effect 依赖不含 `language`，因此切换语言时已加载列表、筛选、分页与已打开的详情弹窗保持不变且不重新请求。安装状态与操作文案以 `{ text, values }` 形式在渲染边界翻译，状态机不持有语言。Dev Host 支持 `?lang=zh-CN` 与右上角语言下拉框。

验证结果或限制：

`npm test`（19 个文件、313 项测试，连续 5 次全量运行与 8 次 `PowerFilters` 单独运行全绿）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 与 `git diff --check` 均通过；产物 `artifacts/agent-hub-0.3.0.bibit-plugin.tgz` 内 `plugin.json` 声明 `["en","zh-CN"]`，`dist/plugin.js` 确认导出 `pluginLocales` 并含中文词条。宿主契约由发布版 `bi-bit 0.1.4` 二进制与 `../bibit` 提交 `b0bcc45` 确认。板端真实 GUI 下的系统语言切换尚未执行，需按开发指南 16.4 步骤 7–8 复核；0.1.4 之前的宿主不传 `language`，页面固定英文。

## 2026-09-09 — 接入 APM Hermes Agent

分类：新增功能

用户需求：

为 Agent Hub 插件增加 `../apm` 已适配的 `hermes-agent`，与 Bibit、Codex、Claude Code 并列管理 Power。

相关提交：

- `feat: add Hermes Agent support via APM`（本条记录所在提交）。

解决方案或完成结果：

扩展前端 Agent 列表及 Go Provider 操作白名单；“我的 Power”筛选与详情安装目标支持 `hermes-agent`，列表、详情、安装和卸载复用 `service:store` 及现有版本化 operation，以 `--agent=hermes-agent` 调用 APM。Hermes 支持 Skill、MCP、Plugin，`agent` 类型仍仅支持 Bibit。开发入口与组件说明、README 和开发指南同步更新，增加菜单选择、契约校验、Provider argv 和安装/卸载后刷新回归覆盖。

验证结果或限制：

`npm test`（17 个文件、284 项测试）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet`、`make -C provider build`、本机 Provider `--self-test` 和 `git diff --check` 均通过。独立代码审查未发现正确性问题。并行构建期间现有 PowerFilters 键盘焦点测试出现一次时序失败，单独重跑完整测试通过。APM 命令验证使用隔离替身；未进行真实 Hermes 安装/卸载或设备部署，运行环境需提供支持 Hermes 的 APM 及对应 Agent 依赖。

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
