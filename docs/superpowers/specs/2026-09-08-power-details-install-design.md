# Power 详情、安装与卸载设计

日期：2026-09-08

状态：对话设计及新增 operation/grant 范围已确认；本文待审阅，尚未进入实现。

## 1. 交付目标与边界

在当前已实现的列表、前端缓存和 Go Provider 基础上增加 Power 详情及安装/卸载，开发成果必须在真实 Bibit 中可用。同步交付前端、正式 Go Provider、dev transport、契约测试、operation grant、前端/CLI 两个 deb 和板端验收。不能以 Mock 页面或单独 CLI 成功代替宿主验收。

Provider Protocol 保持 v1，Registry 格式保持 version 2/managed/protocolVersions [1]。不开发 v2、Job、上传下载、设置页或 APM 新功能，不修改相邻仓库。新增的三个 operation 及其 serviceOperations grant 已获用户授权，其他 capability 和 grant 不变。沿用当前依赖矩阵（当前 vendor 0.3.0），不退回旧计划中的版本。

用户确定的产品规则：installed 侧仅提供卸载；market 卡片打开详情窗口，详情提供描述、标签、版本、目标 Agent 和安装管理；已有安装时只允许卸载，必须先卸载再安装。这个规则是前端交互约束：APM 本身支持升级/降级，外部进程可能在查询与执行间改变安装状态，本期不承诺原子的 install-if-absent。

## 2. UI 与版本选择

### Installed

保留现有 Agent 列表上下文和筛选，每张卡片增加卸载按钮，显示实际安装版本。卸载参数固定为当前 Agent/type/name，不带 version。不新增从 installed 安装其他版本的入口。卸载中、确认状态中显示局部状态和错误。

### Market 详情

点击卡片主体打开 Power 详情，卡片内版本选择器不触发打开。提供显式可聚焦详情入口，不能把交互控件嵌套在大按钮里。弹窗使用可访问 dialog 语义、焦点约束、Escape 关闭和关闭后焦点返回；所有新增样式使用 `.agent-hub*` 命名空间。

详情区展示名称、类型、版本选择器、所选版本的完整描述与标签。标签仅展示，不改变背景筛选。管理区展示目标 Agent、安装查询状态、实际安装版本和操作按钮。

卡片与详情共用按 `(type,name)` 保存的 selectedVersion；打开、关闭、筛选重渲染和重新获取目录不能重置仍有效的选择。实际安装版本独立保存，不能写回 selectedVersion。目录更新或筛选使该版本不可选时，明确提示并选取当前有效版本，不静默显示旧描述。首版详情使用当前卡片的可选版本集合，不另建远程详情接口。

目标 Agent 单选 `bibit`、`codex`、`claude-code`，显示名可友好化；初值继承页面当前 Agent，之后由页面状态统一保存，切回 installed 沿用该值。禁止 all。type=agent 只支持 bibit；若当前为其他 Agent，显示限制和显式“切换到 Bibit”入口，不暗中换目标。

未安装且查询成功时显示“安装 vX 到 Agent”。已有安装时显示实际版本，仅显示卸载，禁用版本选择并保留待安装版本，说明“切换版本需先卸载”；卸载并刷新确认后恢复版本选择及安装按钮。正在查询或查询失败不能推断未安装，所有写操作禁用；提供只读重试。

## 3. 操作与 wire 契约

保留 `powers.list.v1` 的现有 wire 和聚合。新增闭集 DTO，定义在前端契约模块和 Go 对应契约模块，协议输入作为不可信边界校验。

```ts
type PowerTarget = { agent: string; type: PowerType; name: string }
// powers.inspect.v1
type InspectInput = PowerTarget
type InspectResult = { listJson: string }
// powers.install.v1
type InstallInput = PowerTarget & { version: string }
// powers.uninstall.v1
type UninstallInput = PowerTarget
// 两个写 operation 共用：仅在子进程正常退出且取得退出码时返回
type MutationResult = { status: 'exited'; exitCode: number }
```

APM 映射使用绝对 binary 路径、无 shell、独立 argv：

```text
apm list <name> --installed --json --agent=<agent> --type=<type>
apm install <name>=<version> --agent=<agent> --type=<type>
apm uninstall <name> --agent=<agent> --type=<type>
```

name/type/agent/version 必须按操作做闭集校验；name 不允许选项注入、路径或安装语法分隔符，version 为现有 canonical vMAJOR.MINOR.PATCH。校验以 APM 公共名称约定为依据，不随意收紧合法名称。inspect 原样传 UTF-8 listJson，由前端既有 parser 解析；非零退出不接受可能存在的部分输出为完整事实。

Go 只区分进程正常退出码、启动失败、超时、信号终止和资源限制，不解析 stdout 的 installed/unchanged 等业务文本，不匹配 stderr，不引入 APM internal。写操作 stdout/stderr 均不返回前端，并有界消费或丢弃，避免管道阻塞和泄漏。

正常退出非零码仍通过 JSON-RPC result 返回 MutationResult，表示“已观察到子进程执行结果”，不表示业务成功。协议错误和 Provider/进程启动失败等走平台闭集 error。宿主会将 error.message 改写为固定消息，所以前端使用已知操作上下文、平台 code、exitCode 和刷新结果生成安全提示，不依赖 Provider 自定义 error.message。

## 4. 共享状态和查询一致性

扩展当前 service 实例级数据层为可订阅共享仓库，由 installed、market 和详情共同读取。组件只拥有展示状态，不各自维护 isInstalled。分开保存：market 目录、按 Agent 的完整安装集合、按 `(agent,type,name)` 的单项检查状态、selectedVersion 和当前写操作。

打开详情、切换版本或 Agent 时发 inspect；即使版本不影响安装身份，仍按用户要求重新检查。安装前再次 inspect：已有安装则停止安装并切换到仅卸载状态。所有查询带 AbortSignal 和请求代次，取消、关闭弹窗及旧参数请求不得更新当前详情。

单项查询成功只更新指定项，不能覆盖该 Agent 的完整安装缓存。若发现与完整缓存不一致，标记完整缓存失效，刷新完整清单时更新所有项。单项与全量查询共享 Agent 级失效 epoch，并有各自请求序号；写操作开始及结束均使操作前查询失效，不能只依赖现有“成功提交后 generation +1”。写期间延迟针对 store 的自动刷新，防止 v1 串行 Provider 被等待的短查询超时影响。

每个写操作完成、失败或中断后获取该 Agent 的完整原始清单，重新计算 installed 的 facets/total/page，并通知 market/详情更新安装状态。市场目录不因本地安装而清空。卸载后当前页失效则回到第一页。

对外部 CLI 操作，在进入页面、切换 scope/Agent、窗口重新获得焦点和手动刷新时进行状态检查；合并短时间重复触发，写期间延迟处理。本期保证本应用内同步与重新查询后的外部一致性，不保证跨进程即时推送。

## 5. v1 写操作生命周期

状态路径为 idle → preflight → running → reconciling → settled；失败结果也必须经过 reconciling。页面级同步互斥保证同一时间仅一个写操作，从前置检查前获取至状态确认结束释放；重复点击立即拒绝，不排队自动执行用户已忘记的写操作。Provider v1 本身串行分派；外部 APM 并发继续由 APM 自身锁处理。

执行期间固定操作参数，禁用所有写按钮和详情目标/版本编辑。允许关闭详情，不取消写请求；操作与 AbortController 归页面协调器管理，重新打开仍可观察。只显示安装中/卸载中，不提供百分比或取消按钮。

离开 Agent Hub 页面时按项目规则取消异步请求，宿主可能终止 v1 Provider；Provider 必须清理 APM 子进程。离开前失效安装缓存，重新进入无条件查询，不把中断等同回滚，不自动重试写操作。跨应用重启无执行中持久任务恢复机制，重新查询磁盘事实即可。

写请求初始预算设为 120000 ms，列表/inspect 保持 30000 ms；Registry requestTimeoutMs 上限同步为 120000 ms，核对 Host/SDK 实际截断规则。Provider 子进程截止预留小量返回/清理时间；不得以延长超时冒充 v2 后台任务。实测超时不足时记录问题，不无界增长或新增协议。

## 6. APM 业务流程与保守错误提示

源码依据：`../apm/internal/cli/install.go`、`uninstall.go`、`install_render.go`、`uninstall_render.go`、`../apm/internal/lifecycle/install.go`、`uninstall.go`。当前写命令只有文本结果，未绑定 --json。流程可能涉及获取全局锁、恢复历史事务、刷新 Agent、目录选择、下载/适配/事务执行、释放锁；非零退出不能证明目标完全未变化。用户已选择本仓库保守提示方案，不为精确原因扩展 APM，也不以 stderr 文案猜测业务阶段。

| 证据 | UI 提示/行为 |
| --- | --- |
| inspect 失败 | 无法确认安装状态，禁用操作，提供查询重试 |
| 已知 APM 未启动 | 无法启动安装工具，请检查 APM 后重试；不能从任意 unavailable 错误武断推断二进制缺失 |
| exitCode=0 且状态符合目标 | 安装完成 / 卸载完成 |
| exitCode=0 但状态不符合目标 | 命令已结束，但当前安装状态与预期不一致；显示实际状态 |
| exitCode 非零，原安装仍存在 | 命令执行失败，当前仍安装 vX |
| exitCode 非零，但状态符合目标 | 命令报告异常；当前已确认安装 vX / 当前未安装 |
| 超时、连接中断、信号终止 | 操作结果待确认，刷新实际状态；不承诺未修改或回滚 |
| exitCode=0，随后查询失败 | 命令已执行完成，安装状态确认失败，请刷新 |
| 非零或平台错误，随后查询失败 | 执行异常，且无法确认当前安装状态；只提供状态刷新 |
| 请求不支持/授权未部署 | 当前 Provider 不支持该操作 / 当前安装未授权此操作，不建议重复执行 |

已知证据不足时使用通用安全文案，保留宿主诊断 ID（若有），不输出原始 stderr、URL、路径或凭据。刷新成功后允许用户根据实际状态主动选择下一次操作；刷新失败的目标保留 unknown 并禁用写入。全局执行锁可在刷新失败后释放，使其他已确认目标可用。不自动执行 apm fix、重新安装或回滚。

APM 自身可能调用 Agent 工具；复用并核对显式环境和工具路径策略，不能仅证明 `apm list` 能运行就认定安装可用。TLS 仍使用受信 CA，不添加 insecure 选项。

## 7. 实现边界与文件职责

- `src/api/contracts.ts` 或其同目录专用 mutation 契约模块：三个新 operation 及输入/结果校验，保留现有列表。
- `src/api/powerCatalogClient.ts` 与新增共享状态/操作协调模块：缓存、订阅、epoch、inspect、mutate、reconcile，复用现有 apm/apc 聚合。
- `src/components/PowerCard.tsx`：受控 selectedVersion、详情入口、installed 卸载；新增 `PowerDetailsDialog.tsx` 负责详情展示和交互，不执行 CLI。
- `src/AgentHubPage.tsx`：页面级协调器生命周期、目标 Agent、订阅、列表刷新；设置组件不变。
- `provider/internal/provider/`：operation 分派改为按类型请求，新增 APM inspect/mutation runner，复用显式配置、资源限制和子进程清理。不能继续让所有 operation 复用只适用于列表的 WireInput。
- `dev/store.ts`、Node sources 与 Vite bridge：实现相同 operation envelope 和过程状态，业务逻辑不再复制一份；同步 `dev/main.tsx` 和 fixtures。
- `debian/agenthub-feature-grants.json`：保留现有 grant，追加 inspect/install/uninstall；CLI initialize 声明同步。CLI drop-in 只调整超时，不把 grant 移入 CLI 包。
- README、部署指南和测试：区分前端已支持、Provider 已声明、宿主已授权、真实执行成功四层证据。

## 8. 验收及发布

1. 契约：闭集字段、版本/Agent/type/name 校验、inspect 原始透传、正常非零退出 DTO、平台错误与业务结果区分。
2. APM fixture：固定 argv/env、退出码、超时、信号、异常输出、子进程清理、stderr 脱敏。安装/卸载 CLI 仅验证流程，不在测试中修改开发者已有 Power。
3. 前端：双向版本同步、描述/tags 随版本、已安装禁用安装、卸载后恢复待安装版本、Agent 隔离、单项结果不覆盖全量、旧查询不回写、双击/跨视图重复写被阻止。
4. 生命周期：关闭弹窗继续、重开观察、页面卸载中断后重查、命令成功但刷新失败、命令报错但状态已改变、查询失败不当作未安装。
5. 运行 `npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 和 Go tests/vet/self-test；更新独立 stdio probe 支持三个新 operation，并先验证真实协议再做 UI 联调。
6. 按现有流程提升插件/Provider/包版本，同步产出 all 前端 deb 与 riscv64 CLI deb，记录 SHA-256，验证 grant 归前端、executable/drop-in 归 CLI，不提交私钥和构建产物。
7. 在 `bianbu@10.0.91.51` 目标 Bibit 安装两包并重启，确认新 bundle 被信任、三个 operation 被授权、Provider 协商 v1。使用预先确认未安装且可清理的测试 Power，验证市场详情安装→installed 出现→installed 卸载→详情恢复安装，以及反向由详情卸载的同步。
8. 不卸载用户原有 Power、不以改 trust/grant 范围掩盖部署问题；需要额外外部授权或契约扩张时说明。真实板端测试先记录基线，结束只清理本次测试安装项，保留 UI 与 RPC 证据。远程 Python 遵循项目 Python 3.13/.venv313 规则。

完成条件包含真实 Bibit 的闭环验收，不只四件套或开发预览。行为开发全部完成后按项目模板写一条本请求 Changelog，合并所有相关提交；仅设计或阻塞期间不写完成记录。
