# Power Details and Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户另行选择委派时可使用 superpowers:subagent-driven-development；默认当前会话顺序执行。

**Goal:** 实现 Power 详情和安装/卸载，并同步交付 Go Provider、授权和两个 deb，在真实 Bibit 中验证完整操作闭环。

**Architecture:** 详情与卡片共享版本选择，安装事实由 service 实例级可订阅状态仓库管理。前端执行前检查、串行写入、事后查询；Go v1 Provider 只执行明确的 APM 命令和返回进程事实。业务解析、聚合和用户提示留在 TS。

**Tech Stack:** React 19、TypeScript、当前 vendor 0.3.0 发布矩阵、Vitest、Go 标准库、Provider Protocol v1、Debian all/riscv64。

**Spec:** [2026-09-08-power-details-install-design.md](../specs/2026-09-08-power-details-install-design.md)，已确认设计提交 `e218a13`。

## Global Constraints

- Provider Protocol 保持 v1，Registry 格式保持 version 2/managed/protocolVersions [1]。
- 新增 `powers.inspect.v1`、`powers.install.v1`、`powers.uninstall.v1` 及对应 serviceOperations grant 已授权；保留现有 `powers.list.v1` 和所有其他 grant。
- 设置页、v2、Job、APM 源码、上传下载不在范围内；只能 spawn APM，不能导入其 internal。
- installed 仅卸载；market 打开详情，描述、标签和卡片/详情所选版本同步；已有安装只能先卸载后安装。
- “先卸载后安装”为前端交互约束，不声称抵御外部 CLI 竞争的原子保证。
- type=agent 仅允许 bibit，其他类型使用明确单个 Agent，不提供 all。
- 正常非零退出走 operation result；平台错误使用现有闭集，不返回或匹配 stderr，不猜测内部失败原因。
- 全局同时一个页面写操作；关闭详情不取消，页面卸载取消；中断后重新查询，不自动重试写入。
- 新 CSS 统一 `.agent-hub*` 命名空间；不升级或回退当前 React/vendor 依赖矩阵。
- 写请求 120000 ms，读取 30000 ms，Registry 上限 120000 ms；保留现有 1 MiB 输入、4 MiB 最终响应限制。
- TLS 受信 CA，显式 APM 环境/工具路径；CLI deb 不拥有 grant，前端包不拥有 executable/drop-in。
- 四件套必须在每个提交前通过；不提交密钥、bundle、二进制、deb。完整验收后仅记录一条本请求 Changelog。

## 执行准备与提交门禁

执行时先阅读 AGENTS.md、spec、README、两份部署指南和宿主 provider-framework/host-capabilities；检查 git 状态，按 using-git-worktrees 技能选择隔离工作区。相邻仓库仅只读。当前基线为前端 161 tests、四件套通过，实施时不能拿这个历史结果代替新验证。

所有任务遵循：添加行为测试 → 运行确认失败 → 最小实现 → 定向测试通过 → 门禁通过 → 暂存本任务文件并提交。独立读/检查可批量执行，不自动派子代理。

仓库根提交门禁：

```sh
npm test
npm run typecheck
npm run build:dev
npm run build:plugin
git diff --check
```

涉及 Go 时另在 `provider/` 执行 `go test ./...`、`go vet ./...` 和已构建 CLI 的 `--self-test`。每次提交仅暂存明确文件路径；同一任务测试红灯时不提交。

## 文件与责任

| 文件 | 责任 |
| --- | --- |
| 新 `src/api/powerOperations.ts`、`.test.ts` | 新 operation DTO、闭集 parser、Host API 读写函数 |
| 新 `src/api/installationStore.ts`、`.test.ts` | 可订阅安装事实、epoch、写互斥、刷新确认 |
| 新 `src/api/operationMessages.ts`、`.test.ts` | 进程结果与状态确认组合的安全文案 |
| `src/api/powerCatalogClient.ts` 及测试 | 将 installed 缓存接入共享状态，market 缓存不变 |
| 新 `src/components/PowerDetailsDialog.tsx`、`.test.tsx` | 详情、焦点、版本/Agent/操作展示 |
| `src/components/PowerCard.tsx` 及测试 | 受控版本、详情入口或卸载按钮 |
| `src/AgentHubPage.tsx` 及测试、`src/agentHub.css` | 页面生命周期、版本选择、共享仓库订阅 |
| `provider/internal/provider/contracts.go`、`server.go`、`config.go` 及测试 | 按 operation 校验/分派，保留 list 兼容 |
| 新 `provider/internal/provider/operations.go`、`operations_test.go` | APM inspect、install、uninstall |
| `provider/internal/provider/apm.go`、`process_linux.go` 及测试 | 复用安全进程生命周期，保留读取成功退出要求 |
| `provider/internal/provider/selftest.go`、`provider/cmd/provider-probe/main.go` 及测试 | 新协议离线与真实进程验证 |
| `dev/store.ts`、`dev/sources.ts` 及测试、`vite.config.ts`、`dev/main.tsx` | dev 同 wire 接线和取消/超时 |
| `debian/agenthub-feature-grants.json`、`agenthub-provider.json` | 新 operation grant、写请求上限 |
| 版本文件、部署指南、README、`docs/Changelog.md` | 配套版本、双 deb 和真实验收证据 |

## Task 1: 新 operation 契约与前端调用入口

**Files:** 新 `src/api/powerOperations.ts`、`src/api/powerOperations.test.ts`；引用现有 `contracts.ts`、`apm.ts` 的类型/解析器。

**Interfaces:**

```ts
export type PowerTarget = { agent: string; type: PowerType; name: string }
export type InstallInput = PowerTarget & { version: string }
export type InspectResult = { listJson: string }
export type MutationResult = { status: 'exited'; exitCode: number }
export type MutationIntent =
  | { kind: 'install'; input: InstallInput }
  | { kind: 'uninstall'; input: PowerTarget }
export function parsePowerTarget(value: unknown): PowerTarget
export function parseInstallInput(value: unknown): InstallInput
export function parseInspectResult(value: unknown): InspectResult
export function parseMutationResult(value: unknown): MutationResult
export function inspectPower(service: FeatureServiceApiV1<'store'>, target: PowerTarget, signal: AbortSignal): Promise<APMPowerRecord[]>
export function mutatePower(service: FeatureServiceApiV1<'store'>, intent: MutationIntent, signal: AbortSignal): Promise<MutationResult>
```

- [ ] 写失败测试：

```ts
expect(parseMutationResult({ status: 'exited', exitCode: 1 }))
  .toEqual({ status: 'exited', exitCode: 1 })
expect(() => parseMutationResult({ status: 'exited', exitCode: -1 })).toThrow()
expect(() => parsePowerTarget({ agent: 'codex', type: 'agent', name: 'demo' })).toThrow()
expect(() => parsePowerTarget({ agent: 'all', type: 'skill', name: 'demo' })).toThrow()
expect(() => parsePowerTarget({ agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0' })).toThrow()
```

- [ ] `npm test -- src/api/powerOperations.test.ts`，确认因 parser/函数未实现失败。
- [ ] 读取 APM 公共名称校验定义确定 name 合法字符，不从 argv 拼接风险推断整个名称语法；拒绝额外键、空值、非法类型/版本、选项注入及卸载 version。正常 exitCode 为 0..255 的整数，信号不伪装为负退出码。
- [ ] inspect 使用固定 operation、serviceId、30000 ms，先 parseInspectResult，再 `parseApmInstalledList(JSON.parse(listJson))`；校验每条记录确实属于请求 agent/type/name，否则报 incompatible，不把无关记录当该项安装事实。
- [ ] mutate 使用固定 install/uninstall operation、120000 ms、调用方 signal；非零 exitCode 正常解析返回，平台 error 原样保留。测试三种请求的精确 envelope、signal、timeout 及错误传播。
- [ ] 定向测试及门禁后提交 `feat: define power inspection and mutation contracts`。

## Task 2: 同步 Go Provider，先证明 stdio 协议可执行

**Files:** 修改 Go contracts/server/config/apm 及对应测试；新 operations.go/operations_test.go；修改 selftest 和 probe。

**Interfaces:** 将现有仅列表 InvokeFunc 改为已校验的 operation 联合，不让 runner 接受任意 executable/argv：

```go
type PowerTarget struct { Agent string `json:"agent"`; Type string `json:"type"`; Name string `json:"name"` }
type InstallInput struct { PowerTarget; Version string `json:"version"` }
type InspectResult struct { ListJSON string `json:"listJson"` }
type MutationResult struct { Status string `json:"status"`; ExitCode int `json:"exitCode"` }
type OperationRequest struct {
    OperationID string
    List *WireInput
    Target *PowerTarget
    Install *InstallInput
}
type InvokeFunc func(context.Context, OperationRequest) (any, error)
func InspectPower(context.Context, Config, PowerTarget) (InspectResult, error)
func MutatePower(context.Context, Config, OperationRequest) (MutationResult, error)
```

- [ ] 写协议测试：initialize 必须声明 list/inspect/install/uninstall 四项；inspect 与两写操作按 task 1 字段校验，卸载携带 version 拒绝；旧 list fixtures 不变。运行 `go test ./internal/provider` 确认失败。
- [ ] server 在进入 InvokeFunc 前完成 operation 专属校验；NewInvoker switch 分派四个 runner。不声明 settings，不放宽未知键以兼容旧测试；保留真实 Host initialize 的 client 字段支持。
- [ ] 为新 APM runner 添加 helper-process 测试，子进程向测试专用文件记录 argv/env，并按 fixture 输出/退出。断言：

```go
result, err := MutatePower(ctx, cfg, OperationRequest{
    OperationID: "powers.install.v1",
    Install: &InstallInput{PowerTarget: PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, Version: "v1.0.0"},
})
if err != nil { t.Fatal(err) }
if result.Status != "exited" || result.ExitCode != 1 { t.Fatalf("unexpected result: %+v", result) }
```

fixture 安装退出码设置为 1；断言 RPC 是 result 而非 error，且未回传 stdout/stderr。

- [ ] 重构现有进程执行内部公共生命周期，读取 runner 仍要求退出 0；mutation 识别 `exec.ExitError` 的正常退出与信号终止，ctx 超时优先返回 timeout。复用 pinned OS thread、进程组及 Pdeathsig 清理；不复制一份有缺陷的取消路径。
- [ ] inspect argv 为 `list,name,--installed,--json,--agent=... ,--type=...`；mutation argv 为 `install,name=version,--agent=...,--type=...` 或 uninstall 不带版本。stdout/stderr 写操作可直接 io.Discard，不读入内存也不做业务解析。
- [ ] 读取写请求 deadline，为子进程清理/返回预留至多 1000 ms，预算不足则不启动；测试超时、信号、大量输出、未知错误脱敏、APM 缺失、非法请求不 spawn、目标 type=agent 限制及显式环境。
- [ ] 扩展 SelfTest 注入 runner 覆盖三个新 operation；probe 增加 `--operation`、`--name`、`--type`、`--version`，保持原 --scope/list 用法。写操作只在显式指定 operation 时执行，默认仍为只读。
- [ ] 在 provider 目录执行：

```sh
go test ./...
go vet ./...
go build -o ../artifacts/provider/bibit-agenthub ./cmd/bibit-agenthub
../artifacts/provider/bibit-agenthub --self-test
```

- [ ] 驱动用临时 APM fixture 真实启动 Provider，按 Host 的 env_clear 初始化后 inspect/install/uninstall；验证完整 RPC、非零退出、错误、子进程清理。此阶段不操作用户已有 Power。门禁后提交 `feat: execute apm inspection and mutations through v1 provider`。

## Task 3: 共享安装状态、互斥与事后确认

**Files:** 新 installationStore.ts/.test.ts、operationMessages.ts/.test.ts；修改 powerCatalogClient.ts/.test.ts。

**Interfaces:**

```ts
export type InstallationState =
  | { status: 'unknown' | 'checking' }
  | { status: 'ready'; records: APMPowerRecord[] }
  | { status: 'error'; message: string }
export type ActiveMutation = { intent: MutationIntent; phase: 'preflight' | 'running' | 'reconciling' }
export type InstallationSnapshot = {
  revision: number
  items: ReadonlyMap<string, InstallationState>
  fullLists: ReadonlyMap<string, readonly APMPowerRecord[]>
  active?: ActiveMutation
  notices: ReadonlyMap<string, string>
}
export interface InstallationStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): InstallationSnapshot
  inspect(target: PowerTarget, signal: AbortSignal): Promise<APMPowerRecord[]>
  refreshAgent(agent: string, signal: AbortSignal): Promise<APMPowerRecord[]>
  execute(intent: MutationIntent, signal: AbortSignal): Promise<void>
  invalidateAgent(agent: string): void
}
export function getInstallationStore(service: FeatureServiceApiV1<'store'>): InstallationStore
export function operationMessage(intent: MutationIntent, execution: MutationResult | { status: 'error'; code: string }, actual: APMPowerRecord[] | undefined): string
```

- [ ] 测试 store 同一 service 同一实例，不同 service 隔离；snapshot 在没有变化时引用稳定，发布时新建快照，可被 useSyncExternalStore 使用。单项 key 使用 JSON.stringify([agent,type,name]) 避免字符串分隔符冲突。
- [ ] 写时序测试：延迟旧 full-list → execute install → 新 full-list 完成 → 旧响应晚到，断言最终安装未被旧响应覆盖；单项 inspect 返回 [] 不得清空同 Agent 的其他 Power。运行 `npm test -- src/api/installationStore.test.ts` 确认失败。
- [ ] 用 WeakMap 实现 service 实例隔离。全量读取共用一个内部原始读取函数并调用已有 apm parser；powerCatalogClient installed 分支委托 refreshAgent 后调用已有 buildInstalledPowersResult。避免客户端与 store 相互循环导入；market 缓存保持独立。
- [ ] 引入 Agent epoch、单项与全量请求序号。写开始/结束 invalidateAgent 递增 epoch，迟到或取消查询拒绝提交；单项只更新自身并使全量集合标为过期，不能以单项数组替代 fullLists。
- [ ] execute 在任何 await 前占用全局锁。安装前 inspect，发现已安装则停止写入并发布实际状态；卸载参数不带版本。finally 路径统一进入 reconcile，使用独立读取预算刷新目标 Agent；已取消的页面不再启动网络请求，仅保持缓存失效。
- [ ] 关闭弹窗不拥有 execute 的 signal；页面卸载拥有该 signal。刷新失败保留目标 unknown/error、禁用其写操作，但释放全局锁，不阻塞其他已确认目标；不自动排队/重放写请求。
- [ ] operationMessages 表驱动测试覆盖 spec 全部错误行，核心断言：

```ts
expect(operationMessage(
  { kind: 'uninstall', input: { agent: 'bibit', type: 'skill', name: 'demo' } },
  { status: 'exited', exitCode: 0 },
  undefined,
)).toContain('状态确认失败')
```

- [ ] unavailable 一律不推断 APM 缺失；没有明确进程证据时提示操作不可用。非零但实际已安装显示异常与事实，禁止“已回滚”及原始错误文本插值。新增双击、两视图同时 execute、刷新失败、外部修改、取消后重进测试。
- [ ] 定向测试与门禁后提交 `feat: synchronize installation state and reconcile mutations`。

## Task 4: 详情弹窗与 installed 卸载接入共享状态

**Files:** 新 PowerDetailsDialog.tsx/.test.tsx；修改 PowerCard、AgentHubPage 及测试、agentHub.css；按需要小范围修改 PowerFilters 的 Agent 上下文显示。

**Interfaces:** 卡片受控版本和动作，弹窗是展示组件：

```ts
type PowerCardProps = {
  series: PowerSeries; selectedVersion: string
  onVersionChange(version: string): void
  onDetails?: () => void; onUninstall?: () => void
  busy: boolean; notice?: string
}
type PowerDetailsDialogProps = {
  series: PowerSeries; selectedVersion: string; agent: string
  installation: InstallationState; active?: ActiveMutation; notice?: string
  onVersionChange(version: string): void; onAgentChange(agent: string): void
  onInstall(): void; onUninstall(): void; onRetry(): void; onClose(): void
}
```

- [ ] 写 UI 失败测试：卡片选 v2 → 打开详情显示 v2 的描述/tags → 详情改版本 → 关闭卡片一致；卡片下拉点击不打开详情。运行 `npm test -- src/components/PowerCard.test.tsx src/components/PowerDetailsDialog.test.tsx` 确认失败。
- [ ] selectedVersion 提升到页面 Map，键为 JSON.stringify([type,name])；版本仍存在则保持，不再在 series.versions 引用变化时重置。版本不再可选时给明确提示再选有效版本。实际安装版本另存并单独展示。
- [ ] 实现详情布局及无依赖的可访问 dialog（优先原生 dialog.showModal，测试补齐环境支持），关闭事件返回入口焦点。详情只显示当前卡片可选版本；描述完整、标签只展示，避免修改背景筛选。
- [ ] 安装管理行为测试：已安装 v1、所选 v2 → 显示 v1 和仅卸载、版本禁用；卸载并确认 [] 后恢复 v2 与安装。unknown/checking/error 禁止写入，type=agent 非 bibit 只提供显式切换。
- [ ] installed 卡片只传 onUninstall，market 传 onDetails；卸载按钮和选择器不会冒泡打开详情。页面通过 useSyncExternalStore 订阅 task 3 store，错误与 busy 按目标展示，任何 active 都禁用全部写按钮。
- [ ] 页面为 execute 建立独立 AbortController，关闭弹窗只取消 inspect。写期间禁用目标/版本；重新打开看到 running/reconciling。scope 变化不卸载页面协调器。页面 effect cleanup 取消全部未完成请求并使相关 Agent 过期。
- [ ] 安装/卸载后刷新 installed 聚合与分页，页失效回第一页；不清 market 目录。窗口 focus、scope/Agent 切换触发只读刷新，合并重复触发，active 期间暂缓所有自动 store 读取，完成后补一次，避免 v1 串行等待引发短超时。
- [ ] 增加交互测试：Escape、焦点返回、快速 Agent 切换、关闭不取消 mutation、卸载页面取消、重新进入重新查询、卸载另一视图即时同步。采用 `.agent-hub*` 新类，不扩大 CSS 全局选择器。
- [ ] 定向测试与门禁后提交 `feat: add power details and installation controls`。

## Task 5: dev 与正式 Provider 相同契约联调

**Files:** 修改 dev/store.ts、sources.ts 及测试、vite.config.ts、dev/main.tsx；增加 `dev/operations.integration.test.ts`。

**Interfaces:** dev source 新增 `inspect(target,signal): Promise<InspectResult>` 和 `mutate(intent,signal): Promise<MutationResult>`；handleStoreRequest 将注入参数收口为 sources 对象，保留既有 list 和设置 mock 分支。

- [ ] 写测试：通过 dev handleStoreRequest 构造 FeatureServiceApiV1，调用真实 task 3 store，完成 inspect→install→refresh→uninstall→refresh，断言共享快照和 UI 文案；fixture runner 只模拟原始清单与退出码，不复制业务聚合。
- [ ] Node sources 对三命令使用与 Go 相同的 argv/env/返回规则。支持正常非零写退出、timeout、AbortSignal，stdout/stderr 不透传；可提取公共 spawn 生命周期，不把 Node 模块导入前端。
- [ ] Vite bridge 原先固定 30 秒的处理改为按 operation 决定读 30000/写 120000；HTTP 请求断开按现有安全规则取消，response 正常完成不误取消。dev/main.tsx 保持 storeEndpoint 接线并更新说明。
- [ ] `npm test -- dev` 与 Go tests 同时使用一组语义等价 fixtures，比较三种 operation envelope、错误和实际刷新结果。设置 mock 不变。
- [ ] 先用 task 2 probe 验证真实 Provider，再做 dev 页面联调。若另加 Go HTTP bridge，仅翻译已有 envelope，不重写业务状态；开发桥接不得作为正式包依赖。
- [ ] 门禁通过后提交 `feat: align dev power management with provider contracts`。

## Task 6: Grant、超时与双 deb 发布接线

**Files:** 修改 debian/agenthub-feature-grants.json、agenthub-provider.json、changelog、package.json、package-lock.json、bibit.feature.json、Provider version；同步 selftest 版本断言和 debian/vendor/README.md。

- [ ] grant 在现有 store operations 数组中追加 inspect/install/uninstall，保留 settings/list；capability 仍只有 service:store，不新增 job/file grant。initialize 操作列表与此保持一致。
- [ ] Registry requestTimeoutMs 改 120000。已确认宿主源码使用 `request.timeout_ms.min(connection.request_timeout_ms)`；同时检查实际已安装 SDK 的请求超时限制和板端版本，确保写请求不会被 30 秒截断。若实际宿主不支持，报告契约冲突，不能偷偷修改宿主。
- [ ] 发布版本从当前 0.2.2 同步提升 0.2.3（实施前若版本已变，使用实际下一 patch）；不改依赖矩阵。前端包继续拥有 bundle/grant，CLI 包拥有 executable/drop-in，更新两包共同 source version。
- [ ] 四件套及 Go 检查通过后获取目标 Bibit 信任的当前版本签名 bundle，核对 key ID/SHA-256；不自动更换 trust。置于现有 debian/vendor 路径，执行：

```sh
dpkg-buildpackage -us -uc -b -a riscv64
dpkg-deb --info ../bibit-agenthub-plugin_0.2.3_all.deb
dpkg-deb --contents ../bibit-agenthub-plugin_0.2.3_all.deb
dpkg-deb --info ../bibit-agenthub-cli_0.2.3_riscv64.deb
dpkg-deb --contents ../bibit-agenthub-cli_0.2.3_riscv64.deb
sha256sum ../bibit-agenthub-plugin_0.2.3_all.deb ../bibit-agenthub-cli_0.2.3_riscv64.deb
```

- [ ] 解包 CLI 检查 ELF riscv64、模式 0755、Registry v1 managed/120000；检查 grant 只在前端包。不安装 probe，不提交任何生成产物。签名/构建依赖阻塞须明确记录。
- [ ] 门禁后提交 `build: authorize and package power management for Bibit`。

## Task 7: 真实 Bibit 闭环验收与文档交付

**Files:** 修改 README.md、两份部署指南；新 `docs/verification/2026-09-08-power-management.md` 保存实际证据；全部完成后修改 docs/Changelog.md。

- [ ] 只读检查开发板 `bianbu@10.0.91.51`：当前包版本、Bibit 进程、Registry override、APM 版本和工具路径。读取远程 Python 规则（仅若使用 Python），避免默认 Python。记录基线和可恢复包。
- [ ] 在目标 Agent 选一个确认未安装、适合测试且可清理的市场 Power；记录具体 type/name/version。不能对用户已有 Power 做卸载演练。APM 可能需要 Agent 自身 CLI，须验证 Provider env_clear 后该工具可解析；不得用交互 SSH 环境成功代替。
- [ ] 按 task 6 实际版本复制安装两个 deb，正常重启唯一正式 Bibit GUI，检查新 bundle 激活、operation grant 与 Provider v1 初始化。命令骨架：

```sh
scp ../bibit-agenthub-plugin_0.2.3_all.deb ../bibit-agenthub-cli_0.2.3_riscv64.deb bianbu@10.0.91.51:/tmp/
ssh bianbu@10.0.91.51 'sudo apt-get install -y /tmp/bibit-agenthub-plugin_0.2.3_all.deb /tmp/bibit-agenthub-cli_0.2.3_riscv64.deb'
ssh bianbu@10.0.91.51 '/usr/libexec/bibit/bibit-agenthub --self-test'
```

- [ ] UI 闭环 A：market 选版本→详情确认描述/tags/Agent→安装→installed 出现→installed 卸载→详情恢复安装按钮。闭环 B：再次安装测试项→详情卸载→installed 消失。分别记录 UI 和原始 APM 查询证据。
- [ ] 验证版本/Agent 切换与查询、关闭详情执行继续、重开显示状态、重复点击被阻止。超时/非零但实际已改变/刷新失败用受控 fixture 演练，不能通过破坏真实安装制造故障；真实网络只用受信 CA。
- [ ] 清理本次测试新装项并查询确认，保留用户原有条目；记录权限、协议、超时、APM 子工具和两包版本证据。UI 不可访问时标为未验收，不能宣称 Bibit 中可用。
- [ ] README 和指南写实际操作、版本规则、错误提示局限、v1 页面卸载中断语义、新 operations/grant 与部署流程。证据文档只写已执行事实，不含凭据和私人路径。
- [ ] 如验收发现修复，返回对应任务新增回归测试后重新验证受影响链路。最终门禁及 Go 检查通过后提交文档 `docs: document and verify Bibit power management`。
- [ ] 全部完成后按 `~/.codex/docs/Changelog.md` 在顶部写一条请求级记录，列出设计 `e218a13` 与所有相关实现提交真实 hash、验证结果及限制；阻塞期间不写完成记录。Changelog 单独提交前仍执行项目门禁。

## 自查与实施交接

spec 覆盖：UI/版本 → task 4；wire/Provider → task 1/2；共享状态与生命周期 → task 3/4；错误流程 → task 2/3；dev → task 5；授权/双 deb → task 6；真实 Bibit/文档 → task 7。所有任务包含 Global Constraints。

实施顺序为 1→2→3→4→5→6→7；协议测试先于页面联调。当前文件为计划，不代表已开发或部署。最后报告必须包含测试结果、两个 deb 的路径/hash、板端版本和 UI 闭环证据，不能用 Mock、构建成功或自检代替真实 Bibit 验收。
