# Agent Hub Go Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 默认在当前会话顺序执行；用户选择委派时才使用 superpowers:subagent-driven-development。

**Goal:** 在同仓库实现仅协商 v1 的纯中间件 Go Provider，让 dev/生产共用前端缓存和聚合，并产出两个 deb 完成开发板验收。

**Architecture:** Provider 执行 APM 或对 APC 做条件读取，返回原始 JSON 文本。前端数据层校验文本、维护 service 实例级缓存，并调用现有 TS 纯函数输出页面富结果。Registry 格式使用 version 2，但 Provider Protocol 始终为 v1。

**Tech Stack:** Go 标准库（本机已安装 go1.26.5）、React 19.0.0、TypeScript 5.9.2、Vitest 3.2.4、Vite 6.1.0、debhelper 13、Linux riscv64。

**Spec:** [2026-09-07-go-provider-design.md](../specs/2026-09-07-go-provider-design.md)

## Global Constraints

- 固定入口 `/usr/libexec/bibit/bibit-agenthub provider`，只声明 `powers.list.v1`，只协商 Provider Protocol v1。
- 所有前端业务请求经 `service:store`，`serviceId: 'store'`；不新增 external-service capability 或 operation grant。
- 设置页不在修改和验收范围；不实现 settings 存储、v2、Job、传输、上传下载或旧 wire 兼容。
- Go 不做业务解析、过滤、去重、分页、facets、snapshot 计算或 reset 判断；唯一例外是比较 APC 版本标识以决定是否下载。
- APC 每次请求先检查 `resources/version`，变化时才全量下载 `resources`；不得使用未上线的 `resources/list`/`resources/tags`。
- market 缓存每次请求、翻页、筛选均检查更新；installed 每次执行 APM，并由 TS 计算 snapshot。
- 正式 HTTPS 使用受信 CA，不提供跳过 TLS 校验选项，不跟随 HTTPS 到 HTTP 的降级重定向。
- 输入 1 MiB、最终单行 RPC 响应含换行 4 MiB；超过真实宿主上限即停下决策。
- 不导入 Bibit 私有源码或 APM internal；不依赖继承 HOME/PATH，不写用户 home 下的 Registry。
- CLI 包仅拥有自己的 executable 与 drop-in；不改前端包 grant，不单独升级 React/vendor 依赖。
- 每个提交前执行项目四件套；私钥、生成的 bundle、二进制和 deb 不提交。
- 行为任务全部完成后只写一条项目 Changelog，记录所有相关提交；设计/计划文档不写行为记录。

## 执行约定与文件地图

执行前读本项目 AGENTS.md、spec、README、开发部署指南与宿主 provider-framework/host-capabilities；只读参考相邻仓库。当前没有 `demo/cli`，不得把文档里的旧路径当作存在的实现。工作区初始应干净；实施隔离按 using-git-worktrees 技能处理，本计划阶段不创建实现分支。

| 文件 | 职责 |
| --- | --- |
| `src/api/contracts.ts`、`contracts.test.ts` | 保留页面富 DTO，新增 wire envelope 与闭集校验 |
| `src/api/catalogIntegrity.ts`、`catalogIntegrity.test.ts` | 原始 APC 文本的前端 SHA-256 一致性校验 |
| `src/api/powerCatalogClient.ts`、`powerCatalogClient.test.ts` | service 实例缓存、版本检查、代次保护、共享聚合入口 |
| `src/api/apm.ts`、`apc.ts` 及原测试 | 唯一业务解析/聚合实现，保留已有语义 |
| `dev/sources.ts`、`sources.test.ts`（新） | 从 Vite 提取 Node 数据源传输，使超时/取消/条件读取可测试 |
| `dev/store.ts`、`store.test.ts`、`dev/main.tsx`、`vite.config.ts` | dev wire 迁移与 HTTP bridge |
| `src/AgentHubPage.tsx`、`AgentHubPage.test.tsx` | 只调整新客户端错误/fixtures，保留富结果 UI |
| `provider/go.mod` | 独立 module `bibit-agenthub-provider`，`go 1.26.5`，无第三方依赖 |
| `provider/cmd/bibit-agenthub/main.go` | 参数、信号、provider/self-test 入口 |
| `provider/internal/provider/{contracts,errors,server}.go` | wire、平台错误、NDJSON 状态机 |
| `provider/internal/provider/{config,apm,process_linux,apc}.go` | 显式环境、受控进程和 HTTP |
| `provider/internal/provider/*_test.go` | 对应边界测试与进程测试 |
| `provider/internal/provider/selftest.go` | 无网络/无 APM 的内置协议自检 |
| `provider/cmd/provider-probe/main.go`、`main_test.go` | 真实子进程 NDJSON 驱动与脱敏测量报告，不进入 deb |
| `debian/control`、`rules`、`agenthub-provider.json`、`changelog` | 双包构建和 v1 Registry |
| `provider/Makefile`、`.gitignore` | 本机构建/交叉构建、忽略产物 |
| `package.json`、`package-lock.json`、`bibit.feature.json` | 发布版本同步到 0.2.2，依赖矩阵不变 |
| `README.md`、两份部署指南、`debian/vendor/README.md`、`AGENTS.md` | 同步实际路径、契约和部署说明 |
| `docs/Changelog.md` | 完成后的一条请求级记录 |

每个任务均按测试先失败、最小实现、定向测试通过推进。下文代码定义关键接口和断言；实现必须覆盖列出的错误和竞争行为，不能仅满足示例成功路径。独立校验可并行运行，依赖步骤顺序执行。

统一提交门禁（在仓库根分别执行，全部 exit 0 才提交）：

```sh
npm test
npm run typecheck
npm run build:dev
npm run build:plugin
git diff --check
```

Go 任务额外在 `provider/` 执行 `go test ./...` 和 `go vet ./...`。只暂存当前任务文件，不使用 `git add .`。任务 5 的前端客户端与 dev 修改是一次协调 wire 迁移，在同一个提交内落地，避免 dev 与生产调用方短暂失配。

## Task 1: 定义薄 wire 契约，保持现有客户端暂时可运行

**Files:** 修改 `src/api/contracts.ts`、`src/api/contracts.test.ts`。

**Interfaces:** 保留 `ListPowersInput`、`ListPowersResult`、`parseListPowersInput`、`parseListPowersResult`。新增：

```ts
export type PowersWireInput =
  | { scope: 'installed'; agent: string }
  | { scope: 'market'; knownSnapshot?: string }
export type PowersWireResult =
  | { scope: 'installed'; status: 'data'; listJson: string }
  | { scope: 'market'; status: 'data'; snapshot: string; catalogJson: string }
  | { scope: 'market'; status: 'not_modified'; snapshot: string }
export function parsePowersWireInput(value: unknown): PowersWireInput
export function parsePowersWireResult(value: unknown): PowersWireResult
```

- [ ] 添加失败测试，验证成功 envelope 和禁止的旧/额外字段：

```ts
expect(parsePowersWireInput({ scope: 'market', knownSnapshot: 'abc' }))
  .toEqual({ scope: 'market', knownSnapshot: 'abc' })
expect(() => parsePowersWireInput({ scope: 'market', page: 2 })).toThrow()
expect(() => parsePowersWireInput({ scope: 'installed', agent: '' })).toThrow()
expect(parsePowersWireResult({ scope: 'installed', status: 'data', listJson: '[]' }))
  .toEqual({ scope: 'installed', status: 'data', listJson: '[]' })
expect(() => parsePowersWireResult({ status: 'ready', items: [] })).toThrow()
```

- [ ] 运行 `npm test -- src/api/contracts.test.ts`，确认新增测试因缺少 parser 失败。
- [ ] 复用文件内 assertObject/assertClosedKeys 实现两个 parser：agent 非空、knownSnapshot 出现时非空、结果 snapshot 非空、JSON 文本字段为 string；此层不解析业务条目。自有闭集严格，源 schema 仍由既有纯函数容忍未知字段。
- [ ] 补充 market 禁止 agent、installed 禁止 knownSnapshot、not_modified 禁止 catalogJson、错误 scope/status/null/数组测试。
- [ ] 定向测试及统一门禁通过后提交：`feat: define raw powers wire contracts`。现有客户端和 dev 此时仍使用原接口，下一阶段协调切换。

## Task 2: 建立 Go v1 NDJSON 协议与资源边界

**Files:** 新建 Go module、`cmd/bibit-agenthub/main.go`、`internal/provider/contracts.go`、`errors.go`、`server.go`、`server_test.go`。

**Interfaces:** 以下接口供数据源及自检注入使用：

```go
type WireInput struct {
    Scope string `json:"scope"`
    Agent string `json:"agent,omitempty"`
    KnownSnapshot string `json:"knownSnapshot,omitempty"`
}
type WireResult struct {
    Scope string `json:"scope"`
    Status string `json:"status"`
    ListJSON *string `json:"listJson,omitempty"`
    Snapshot string `json:"snapshot,omitempty"`
    CatalogJSON *string `json:"catalogJson,omitempty"`
}
type InvokeFunc func(context.Context, WireInput) (WireResult, error)
func Serve(ctx context.Context, in io.Reader, out io.Writer, invoke InvokeFunc) error
type ProviderError struct { Code string; Retryable bool }
```

JSON struct 不是唯一校验：先检查 raw 字段存在性，拒绝 null、额外键、重复键、尾随 JSON、缺失必要字段与非法联合。Go `omitempty` 不得丢失合法空文本。只接受有限长度的合法 string/number ID，响应原样回显；通知不返回带 ID 的响应，不执行未授权业务。

- [ ] 建立 module 和空接口后写 `TestInitializeV1`、`TestInvokeBeforeInitialize`、`TestUnsupportedOperation`；输入使用真实方法名：

```go
input := "{\"jsonrpc\":\"2.0\",\"id\":\"init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[2,1]}}\n"
var out bytes.Buffer
err := Serve(context.Background(), strings.NewReader(input), &out, nil)
if err != nil { t.Fatal(err) }
var response struct { Result struct { ProtocolVersion int `json:"protocolVersion"` } `json:"result"` }
if err := json.Unmarshal(bytes.TrimSpace(out.Bytes()), &response); err != nil { t.Fatal(err) }
if response.Result.ProtocolVersion != 1 { t.Fatal("must negotiate v1") }
```

- [ ] `go test ./internal/provider -run 'TestInitialize|TestInvokeBefore|TestUnsupported'`，确认失败原因属于尚未实现行为。
- [ ] 实现逐行有界读取、初始化状态、invoke 分派和响应写入；initialize 返回非空 providerVersion、`capabilities: {invoke:true}`、`operations:["powers.list.v1"]`。仅 v2 时返回 incompatible，不提前连接数据源。
- [ ] 将 timeoutMs 校验为 1..300000，用 context.WithTimeout 包住单次 invoke；JSON-RPC -32700/-32600/-32601/-32602 用固定文本和平台 data.code；数据源失败使用 -32000 与闭集平台码。
- [ ] 输出先 marshal 加换行再检查 4 MiB；溢出换成小型 resource_exhausted。输入使用 1 MiB 限制，超长行不继续无界消费。测试边界前后各 1 byte、转义增长、无换行 EOF、畸形 JSON、重复初始化、非法 serviceId、空版本交集、未知错误不泄漏内容。
- [ ] CLI 只接受固定 provider 子命令或 --self-test；此阶段 self-test 可暂未暴露，不能输出虚假通过。信号上下文和 stdout 单一写入者一并接线。
- [ ] Go 检查与统一门禁通过后提交：`feat: implement bounded v1 provider protocol`。

## Task 3: 实现 APM 透传与 APC 条件下载

**Files:** 新建 `internal/provider/config.go`、`apm.go`、`process_linux.go`、`apc.go` 及对应 `_test.go`；修改 `cmd/bibit-agenthub/main.go`。

**Interfaces:**

```go
type Config struct { APMPath, UserHome, APCBaseURL string }
func ParseConfig(args []string) (Config, error)
func APMEnvironment(cfg Config) ([]string, error)
func ReadInstalled(ctx context.Context, cfg Config, agent string) (WireResult, error)
func ReadMarket(ctx context.Context, client *http.Client, baseURL, knownSnapshot string) (WireResult, error)
func NewInvoker(cfg Config, client *http.Client) InvokeFunc
```

- [ ] 写 APM 进程测试：fixture 记录 argv/env，并输出含空白与 Unicode 的 JSON；断言输出文本原样保留，agent 是一个 argv，不通过 shell；非零退出、ENOENT、超时和超量输出分别返回安全错误。
- [ ] 写 APC TLS fixture，记录两个 URL 的调用次数：

```go
result, err := ReadMarket(ctx, tlsServer.Client(), tlsServer.URL, "same")
if err != nil { t.Fatal(err) }
if result.Status != "not_modified" || catalogCalls != 0 {
    t.Fatal("unchanged catalog must not be downloaded")
}
```

- [ ] 运行 `go test ./internal/provider -run 'TestAPM|TestAPC'` 确认失败。
- [ ] 配置默认值 `/usr/bin/apm` 与设计中的 APC URL；覆盖参数必须有效，APM 路径/user-home 为绝对路径。默认 home 用 `user.LookupId(strconv.Itoa(os.Getuid()))` 解析，避免 `user.Current()` 在纯 Go 路径依赖环境；解析失败只影响 installed。
- [ ] APM 使用 `exec.CommandContext(ctx, cfg.APMPath, "list", "--installed", "--agent="+agent, "--json")`。显式 env 含 LANG、HOME、APM_HOME、固定 PATH，APM_HOME 为用户主目录；stderr 丢弃，stdout 有界且严格 UTF-8。退出 0 才透传，不解析业务 JSON。
- [ ] Linux 配置 `SysProcAttr{Setpgid:true, Pdeathsig:syscall.SIGKILL}`，取消时杀进程组并 Wait；对 Linux Pdeathsig 的创建线程退出语义，用固定 OS 线程覆盖 start/wait 生命周期。测试宿主 kill Provider 后 fixture APM PID 消失；不只测试普通 context timeout。
- [ ] HTTP client 使用默认受信 TLS 配置，限制最多 5 次重定向并禁止降级；超时由 ctx 传递。version 只提取 catalog_sha256，正文有界；同版本直接 not_modified，否则读取目录为原始 UTF-8 文本，绝不先反序列化后序列化目录。拒绝非 2xx、不可信证书、非法 UTF-8、循环重定向和超量响应。
- [ ] 测试“APM 不存在仍可 initialize/market”“APC 错误仍可 installed”、敏感 stderr 不出现在错误、knownSnapshot 不进入上游 URL。TLS fixture 信任仅通过测试注入 client，不引入生产 insecure 选项。
- [ ] Go 检查与统一门禁通过后提交：`feat: forward raw apm and conditional apc data`。

## Task 4: 先完成自检和独立协议驱动

**Files:** 新建 `internal/provider/selftest.go`、`selftest_test.go`、`cmd/provider-probe/main.go`、`main_test.go`；修改 CLI main。

**Interfaces:** `func SelfTest() error` 使用内存输入、输出和 InvokeFunc fixture；主 CLI `--self-test` 成功退出 0，失败退出非零。驱动参数：`--executable`、`--scope`、`--agent`、`--known-snapshot`、`--apm-path`、`--user-home`、`--apc-base-url`。

- [ ] 自检测试注入一个返回 installed 原始 `[]` 的 InvokeFunc，输入 initialize + invoke 两行，断言恰好两条合法回复、协议 1、无业务聚合字段；错误分支和仅 v2 协商也必须在内置自检中执行。
- [ ] `go test ./...` 确认新自检/驱动测试失败，再实现 SelfTest 和 --self-test 接线。
- [ ] 驱动启动真实 executable，清空环境并只提供宿主同款显式变量；发送 initialize，校验回复后 invoke。stdin/stdout 协议读写必须支持 4 MiB，不能使用 Scanner 默认 64 KiB。驱动错误不输出原始目录、stderr 或个人路径。
- [ ] 驱动输出测量 JSON，字段固定为 `protocolVersion`、`scope`、`status`、`snapshot`、`rpcBytes`、`rawBytes`、`remainingBytes`；installed 无 snapshot 时省略。测试驱动处理慢进程、失败退出、非法行及过长行。
- [ ] 在 `provider/` 执行：

```sh
go test ./...
go build -o ../artifacts/provider/bibit-agenthub ./cmd/bibit-agenthub
../artifacts/provider/bibit-agenthub --self-test
go run ./cmd/provider-probe --executable ../artifacts/provider/bibit-agenthub --scope market
```

- [ ] 真实 market 成功后，用该次报告的 snapshot 再调用驱动，确认 not_modified；失败则记录 TLS/网络或响应上限证据，不关闭校验。超出 4 MiB 停下契约相关实现，不继续假定全量方案可用。
- [ ] Go 检查与统一门禁通过后提交：`test: add provider self-test and stdio probe`。此处开始前端迁移前已有独立协议证据。

## Task 5: 前端缓存迁移与 dev wire 同步切换

**Files:** 新建 `src/api/catalogIntegrity.ts`、`catalogIntegrity.test.ts`、`dev/sources.ts`、`sources.test.ts`；修改 `powerCatalogClient.ts` 及测试、`dev/store.ts` 及测试、`vite.config.ts`、`dev/main.tsx`、`src/AgentHubPage.tsx` 及测试、`apm.ts`/`apc.ts` 注释。任务 1 的旧 `toListPowersParams` 在调用方迁移后移除或改名为仅页面校验工具，不能残留旧 wire 使用。

**Interfaces:** 保留页面调用签名：

```ts
export async function listPowers(
  service: FeatureServiceApiV1<'store'>,
  input: ListPowersInput,
  signal: AbortSignal
): Promise<ListPowersResult>
// catalogIntegrity.ts
export async function verifyCatalogText(text: string, snapshot: string): Promise<void>
// dev/sources.ts
export async function readInstalled(agent: string, signal: AbortSignal): Promise<PowersWireResult>
export async function readMarket(knownSnapshot: string | undefined, signal: AbortSignal): Promise<PowersWireResult>
```

- [ ] 写客户端失败测试：同一 service 首次返回真实 SHA-256 的 data，第二次返回 not_modified；断言第二次请求仅为 `{scope:'market',knownSnapshot:hash}`，筛选参数不出现在 wire，仍产出与现有 buildPowersResult 一致的结果。
- [ ] 写 integrity 测试，用测试侧 Node createHash 计算 fixture 真值，覆盖 Unicode、空白与转义。生产实现仅使用 Web Crypto：

```ts
const bytes = new TextEncoder().encode(text)
const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
const actual = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('')
if (actual !== snapshot) {
  throw { version: 1, code: 'unavailable', retryable: true, message: 'Catalog changed during refresh.' }
}
```

- [ ] 执行 `npm test -- src/api/powerCatalogClient.test.ts src/api/catalogIntegrity.test.ts`，确认新测试失败。确认 Dev Host localhost 与目标 WebView 均提供 crypto.subtle；若目标不支持，先报告运行时冲突，不把 Node crypto 打进 bundle。
- [ ] 实现 `WeakMap<FeatureServiceApiV1<'store'>, Map<string, CacheEntry>>`：market 键固定，installed 键带 agent；CacheEntry 包含 generation 和已校验数据。每次请求保存本次缓存引用及代次，await service、hash 后都检查 AbortSignal；提交缓存前再次检查代次，过期请求以 cancelled 结束。
- [ ] market data 先验 hash，再调用 `parseApcCatalog(JSON.parse(catalogJson))`；not_modified 仅取本次请求持有的匹配缓存。最终调用现有 `buildPowersResult(records,input,snapshot)` 和富结果 parser。installed 调用现有 `parseApmInstalledList`、`buildInstalledPowersResult`。不得复制其中算法。
- [ ] 加测试：page 2 更新返回 reset_required；筛选和重试仍请求 version；两个 agent 不串缓存；两个 service 不共享缓存；无缓存 not_modified/错误 scope 被拒绝；hash 失败不污染；较慢旧请求晚到不覆盖；取消在 fetch 后/hash 中也不能提交缓存。
- [ ] dev/store 改为校验新 wire 并透传 runner 结果，保留原设置 mock 分支不改其行为。移除 buildPowersResult/buildInstalledPowersResult 的 import。`dev/sources.ts` 仅实现与 Go 同语义的 transport，不解析业务字段；注入 signal，设置 30 秒截止与相同响应预算，删除固定 insecure TLS 路径。
- [ ] Vite 接入新的 sources；HTTP bridge 在请求 aborted 或响应未完成即 close 时取消下游，不在正常请求 body end 时误取消。解析 body 有界，错误使用固定文案；dev/main.tsx 保留 storeEndpoint 功能并同步契约说明。
- [ ] 更新 dev 测试为“原始 envelope + 同一 listPowers”的端到端测试。用超过 20 个系列且第 21 个独有 tag 的 fixture 验证：

```ts
expect(result.status).toBe('ready')
if (result.status === 'ready') {
  expect(result.items).toHaveLength(20)
  expect(result.facets.tags).toContain('only-on-page-two')
}
```

- [ ] 更新页面 service fixtures 为原始 wire；保留 Reset、Retry、卸载取消、快速切换断言。页面不直接消费 raw JSON，不改设置组件。
- [ ] 执行所有前端检查、Go 检查及统一门禁；用 `rg -n 'buildPowersResult|buildInstalledPowersResult|parseApcCatalog|parseApmInstalledList' src dev vite.config.ts provider` 确認业务函数只由前端及测试使用。提交：`feat: share frontend catalog cache across dev and production`。

## Task 6: 同一 Debian source package 产出两个包

**Files:** 修改 `debian/control`、`debian/rules`、`debian/changelog`、`.gitignore`、版本文件；新建 `debian/agenthub-provider.json`、`provider/Makefile`。

**Interfaces:** `make -C provider build` 产出本机 ignored binary，`make -C provider build GOARCH=riscv64` 产出目标 binary；debian/rules 根据 DEB_HOST_ARCH 选择 amd64/arm64/riscv64，未知架构显式失败。CLI 不安装 probe。

- [ ] 在打包前写文件归属验收脚本式命令清单：两个 deb 分别只包含设计指定的功能文件；Registry 与宿主 serde 字段逐项比较。此任务以实际 dpkg 输出验证，不添加仅镜像 install 命令的单元测试。
- [ ] 给 control 增加 Go 工具链 Build-Depends（版本足够读取 `go 1.26.5`）、Architecture: any CLI 包和 `${misc:Depends}`；使用纯标准库 `CGO_ENABLED=0`，不对 APM 加硬依赖。
- [ ] Makefile 核心构建命令：

```make
build:
	CGO_ENABLED=0 GOOS=linux GOARCH=$(GOARCH) go build -trimpath -o ../artifacts/provider/$(GOARCH)/bibit-agenthub ./cmd/bibit-agenthub
```

默认 GOARCH 由 `go env GOARCH` 获取。debian/rules 显式使用相同 GOARCH 和产物路径；提供 clean 删除构建产物，不删除公司提供的签名 bundle。交叉架构 strip 使用匹配工具，纯 Go 构建可在构建时去调试符号并覆盖 dh_strip，避免调用错误架构的 strip。

- [ ] Registry 写入 spec 的完整 JSON：version 2、store、managed、protocolVersions [1]、固定 executable/args、30000 ms。安装到 CLI staging 的 `/etc/bibit/external-services.d/agenthub.json`，executable mode 0755；不在 maintainer script 改用户配置或重启宿主。
- [ ] 同步发布版本：package.json、lockfile 根版本、bibit.feature.json 与 debian/changelog 为 0.2.2；不修改 vendor 依赖值。更新 ignore 覆盖 CLI staging、Go 临时产物及 `.debhelper/`。
- [ ] 运行前端四件套后按现有流程取得当前版本的受信签名 bundle，记录 SHA-256/key ID；开发签名不能代替目标 Release 的信任链。置于 `debian/vendor/agent-hub.bibit-plugin.tgz` 后执行：

```sh
dpkg-buildpackage -us -uc -b
dpkg-deb --info ../bibit-agenthub-plugin_0.2.2_all.deb
dpkg-deb --contents ../bibit-agenthub-plugin_0.2.2_all.deb
dpkg-deb --info ../bibit-agenthub-cli_0.2.2_amd64.deb
dpkg-deb --contents ../bibit-agenthub-cli_0.2.2_amd64.deb
dpkg-buildpackage -us -uc -b -a riscv64
dpkg-deb --info ../bibit-agenthub-cli_0.2.2_riscv64.deb
```

- [ ] 解包 riscv64 CLI 到临时目录，用 `file`/`readelf -h` 确认 RISC-V；核对没有 probe、grant、前端 bundle 或 home 内容。Build-Depends 或签名材料不足时记录具体阻塞，不能以跳依赖检查或修改系统信任掩盖。
- [ ] Go 检查与统一门禁通过后提交：`build: package standalone v1 agenthub provider`。

## Task 7: 页面联调、开发板安装与故障恢复验收

**Files:** 无必需源码改动；验收证据最终写入任务 8 的文档。任何发现的修复返回对应任务测试后再继续。

**Interfaces:** 使用 task 4 probe、两个 riscv64/all deb 与当前插件，不引入新 operation。

- [ ] 先读远程 Python 规则（若要用 Python），以及宿主实际进程/Registry 加载文档。SSH 只读采集：

```sh
ssh bianbu@board-host 'uname -m'
ssh bianbu@board-host 'dpkg-query -W bi-bit bibit-agenthub-plugin bibit-agenthub-cli'
ssh bianbu@board-host 'command -v apm'
```

- [ ] 检查 board 的 `/etc/bibit/external-services.d/`、当前 Bibit 进程和显式配置覆盖，确认没有已有 store 冲突；记录当前 deb 版本和可恢复包。不要删除其他服务条目或修改 home Registry。
- [ ] 需要 dev UI 联调时，先用现有 HTTP mock 获取真实源数据验证共享客户端；若增加 Go bridge，置于开发工具中仅翻译 HTTP envelope ↔ RPC，使用 task 4 已验证协议，不在插件或 bridge 添加聚合。按需才做，不使 bridge 成为正式包依赖。
- [ ] 复制准确文件到板端临时目录，安装两包：

```sh
scp ../bibit-agenthub-plugin_0.2.2_all.deb ../bibit-agenthub-cli_0.2.2_riscv64.deb bianbu@board-host:/tmp/
ssh bianbu@board-host 'sudo apt-get install -y /tmp/bibit-agenthub-plugin_0.2.2_all.deb /tmp/bibit-agenthub-cli_0.2.2_riscv64.deb'
ssh bianbu@board-host '/usr/libexec/bibit/bibit-agenthub --self-test'
```

- [ ] 根据实际进程管理方式正常退出并重启唯一正式 Bibit GUI，不猜测 systemd unit、不批量 kill 无关进程；验证宿主加载新插件版本、store drop-in、协商 protocol=1。
- [ ] 观察页面 installed/market 真实数据，核对至少一个已安装条目和一个市场系列；翻页/筛选每次 version 检查，缓存命中不下载全量，type 的完整 tag 集不受分页影响。记录网络调用计数或脱敏 probe/日志证据；不单凭页面肉眼声称缓存命中。
- [ ] 使用受控 TLS fixture 验证目录版本更新和 page 2 reset，不修改公开 APC；真实 APC 仅做只读验证。快速切换/卸载页面确认取消后无旧数据覆盖。
- [ ] 将测试 Provider 的 APM 路径临时配置为不存在的绝对路径，验证 installed Retry 与 market 可用，随后恢复 Registry 原内容并重启/重验。用陷阱清理或显式恢复检查防止遗留故障配置。
- [ ] 记录 APM PID 清理、RPC 字节余量、两包归属、安装版本、TLS 结果和 UI 证据。远程 UI 无法观察时明确“协议通过、页面未验收”，不要宣称完成。

## Task 8: 文档同步与请求级交付记录

**Files:** 修改 `README.md`、`docs/development-and-deployment-guide.md`、`docs/cli-provider-development-and-deployment.md`、`debian/vendor/README.md`、`AGENTS.md`；行为任务全部完成后修改 `docs/Changelog.md`。

- [ ] README 写实际命令、v1 范围、两个 deb 和 cache-on-check 行为；修正不存在的 demo 路径，不创建旧协议示例来迎合文档。
- [ ] 开发指南 10.4–10.6 写 raw wire、共享聚合位置、APM 非零退出降级、APC 全量约束；CLI 指南用新的 Go v1 契约替换作为正式要求的旧 agents/v2 内容，设置明确不属本期。
- [ ] AGENTS.md 仅修正已不存在的 src/storeContracts.ts 引用为 src/api/contracts.ts；保留其余项目约束。记录两个 deb 的文件归属、签名过程和 Registry version/protocolVersion 区别。
- [ ] 自查 spec 覆盖：逐条对应本计划任务 1–7；运行 `rg -n 'resources/list|resources/tags|protocolVersions|storeContracts|demo/cli' README.md docs AGENTS.md`，人工区分明确禁止/历史说明与错误的当前操作指令。
- [ ] 重新执行 Go 测试、vet、自检和前端四件套（仅在最终代码有新变化时扩大检查）；运行 `git diff --check`，确认不包含产物/密钥。
- [ ] 文档提交 `docs: document v1 provider deployment and verification`。若板端/签名/响应上限仍阻塞，只报告已完成与阻塞，不写“已完成”Changelog。
- [ ] 全部验收完成后按 `~/.codex/docs/Changelog.md` 模板在最上方新增一条记录，列出设计提交 `473fdab` 及本请求实现/文档提交的真实 hash、验证结果和必要限制。再按统一提交门禁提交该条记录，不拆成每个子任务一条。

## 计划自查与交付边界

覆盖映射：spec 1–3 → task 1/2/5；spec 4 → task 3/5；spec 5–6 → task 2/3/4；spec 7 → task 6；spec 8 → task 4/5/7；spec 9 → task 8。所有 task 共用 Global Constraints。

计划只规定后续实现与检查。本次输出计划不创建 Provider、不修改业务源码、不安装 deb、不修改板端。实施完成的报告必须分别列明：前端四件套、Go 自检/驱动、两个 deb 路径及 hash、真实目录响应预算、开发板 UI 验收；不能用其中一项代替其余项。
