# Agent Hub Go Provider 与前端目录缓存设计

日期：2026-09-07

状态：对话设计已确认；本文待用户审阅，尚未进入实现。

## 1. 目标与范围

在本仓库新增独立 Go module `provider/`，通过宿主 `service:store` 接通 APM 已安装清单与 APC 公开完整目录。Provider 是纯中间件；业务解析、过滤、系列聚合、去重、分页、facets 和 snapshot/reset_required 判断只存在于前端 TS 数据层。dev 与生产共用这一实现。

首版只协商 Provider Protocol v1，只声明 `powers.list.v1`。设置页不在本期修改或验收范围，不新增设置存储，也不实现 settings operations。未知 operation 返回平台 `incompatible`。不实现 v2、Job、上传下载或旧 wire 兼容，不扩大 capability grant，不导入 Bibit 私有源码或 APM internal 包。

## 2. 已确认的结构

1. `provider/`：JSON-RPC NDJSON 协议、配置解析、APM 子进程、APC HTTP 条件读取、超时、资源限制和安全错误映射。
2. `src/api/contracts.ts`：区分页面查询/富结果与新的 wire 请求/结果，并严格校验自有 envelope。
3. `src/api/powerCatalogClient.ts`：调用 Host API、维护缓存、校验目录完整性、调用共享解析和聚合函数。
4. `src/api/apm.ts`、`src/api/apc.ts`：保留现有纯函数作为唯一业务实现；更新其使用范围说明，不复制到 Go 或 dev。
5. `dev/store.ts`、`vite.config.ts`：只处理开发传输和原始数据获取，返回相同 wire envelope；移除业务解析与聚合调用。`dev/main.tsx` 和相关测试同步契约。
6. `debian/`：同一 source package 产出现有前端包和新增 CLI 包。

现有 `AGENTS.md` 引用的 `src/storeContracts.ts` 已不存在；当前契约文件为 `src/api/contracts.ts`。实现时同步修正文档引用，不另建重复契约模块。

## 3. Wire 契约

operation ID 保持 `powers.list.v1`，按用户要求同步替换其 wire 结果，不支持旧富结果。Provider 协议仍为 v1；这是业务 wire 的协调迁移，两个新包应配套验收。

页面继续使用现有 `ListPowersInput`、`ListPowersResult`。type、tags、page、pageSize 和分页 snapshot 不发送到 Provider。

Wire 请求为以下闭集联合：

```ts
type PowersWireInput =
  | { scope: 'installed'; agent: string }
  | { scope: 'market'; knownSnapshot?: string }
```

Wire 结果为以下闭集联合：

```ts
type PowersWireResult =
  | { scope: 'installed'; status: 'data'; listJson: string }
  | { scope: 'market'; status: 'data'; snapshot: string; catalogJson: string }
  | { scope: 'market'; status: 'not_modified'; snapshot: string }
```

`listJson` 和 `catalogJson` 携带原始 UTF-8 JSON 文本，不重排、删字段或归一化。文本 envelope 使 JSON-RPC 保持单行，并允许前端对完整目录的原始字节计算 SHA-256。严格拒绝无效 UTF-8，避免替换字符破坏原始字节；传输层不检查业务条目 schema。业务 JSON 解析及校验在 TS 纯函数入口完成。测试必须包含空白、转义和非 ASCII 字符，证明文本往返保持目录字节。

原始文本经过 JSON 字符串转义后可能增长，因此响应预算按最终序列化 RPC 行计算，不能仅看 APC Content-Length。

## 4. 数据获取与缓存

### Market

每次页面请求、翻页、筛选、scope 返回或重试均调用 Provider；有缓存时发送 `knownSnapshot`。Provider 每次读取 `resources/version`，提取非空 `catalog_sha256`，仅作不透明字符串比较：相同返回 `not_modified`，不同或无缓存时才读取全量 `resources`。不调用 `resources/list`、`resources/tags`，不向全量接口传筛选参数。

条件读取是已获用户确认的传输职责例外：Go 可以比较版本标识，但不得生成业务 snapshot、决定分页 reset 或解析目录内容。Provider 无目录持久缓存。

前端从 `catalogJson` 恢复原始 UTF-8 字节并计算 SHA-256，必须与返回 snapshot 一致后才能解析、聚合及替换缓存。版本查询与目录下载间的发布竞争、校验失败或非法业务数据不得污染已有缓存。哈希不匹配作为可重试的数据更新失败；不在 Provider 添加哈希算法或业务一致性重试。

### Installed

每次请求执行 `apm list --installed --agent=<agent> --json`，不加 `--all`，不发现 agent 列表，不在 Go 按 type 或 tags 过滤。前端用 `parseApmInstalledList` 和 `buildInstalledPowersResult` 解析清单、计算现有 snapshot 并产出富结果。

APM 没有独立版本探测接口，所以 installed 每次都传回完整原始清单。成功返回 `[]` 视为空；启动失败、非零退出或超时不得伪造空清单，返回安全错误供用户重试。APM 不可用不能阻止初始化或 market 请求。

### 缓存与并发语义

- 缓存仅存在于前端内存，绑定当前 service 实例；market 一份，installed 按 agent 隔离，不按筛选或页码拆分。
- 缓存保存已校验数据与版本，可保存共享纯函数产生的规范化记录，避免未变化目录重复解析。无需浏览器持久化、TTL 或后台轮询。
- `knownSnapshot` 表示缓存版本；页面的 `snapshot` 表示当前分页序列版本，两者不能混用。
- `not_modified` 必须与该次请求持有的缓存版本一致；无匹配缓存的响应视为协议错误，不能生成空目录。
- 每个缓存键有请求代次保护，已取消或过期请求不能覆盖缓存；使用调用方 AbortSignal，组件卸载时取消。不共享一个无法独立取消的 in-flight 请求。
- 每次更新检查失败时显示可重试错误，不把旧数据伪装为已确认的新结果；保留未污染缓存供后续重试。
- 新版本替换缓存后，仍由现有聚合函数根据页面查询决定 `reset_required`。翻页遇到变化回到第一页；筛选本身从第一页开始。
- tags facets 始终取当前 type 的全量去重集合，不受分页或已选 tags 影响；维持现有版本级 tag AND（交集）筛选与系列排序语义（0.3.14 前为 OR）。

## 5. Provider Protocol v1

固定入口为 `/usr/libexec/bibit/bibit-agenthub provider`。读取 UTF-8 NDJSON，stdout 只写完整单行 JSON-RPC 2.0；原样回显请求 ID。实现 `bibit.initialize`、`bibit.invoke`，初始化前拒绝 invoke。验证 protocolName、serviceId、v1 交集、method、operation 与 wire envelope；声明 `invoke: true`，不声明 v2 能力。

采用 managed 生命周期，v1 请求串行处理，不实现 v2 cancellation 消息。超时使用请求上下文同时约束 HTTP 和 APM。宿主取消 v1 请求可能终止 Provider；必须确保 APM 子进程不遗留，包括 Linux 父进程死亡路径。正常 EOF 与终止路径同样需要清理。

输入上限对齐宿主 1 MiB，输出按最终 RPC 行（含换行）限制为 4 MiB。HTTP 和 APM 输出读取有界；超限在写 stdout 前返回小型 `resource_exhausted` 错误，不能输出截断的 JSON。

JSON-RPC 标准错误保留标准数字错误码，`error.data.code` 只使用宿主平台闭集：`cancelled`、`offline`、`timeout`、`unauthorized`、`incompatible`、`unavailable`、`provider_crashed`、`resource_exhausted`、`unknown`。消息使用固定安全文本，不回显 stderr、上游响应正文、完整 URL、路径或凭据。源不可用和超时可重试，非法请求或不支持的协议不可重试。

## 6. 配置与网络

宿主源码使用 `env_clear()`，仅显式提供 LANG 和 Provider 协议/数据目录变量。配置使用 Registry `args` 中的 CLI 参数，提供 `--apm-path`、`--user-home`、`--apc-base-url` 覆盖。默认 APM 路径为 `/usr/bin/apm`，默认用户目录按进程 UID 查询操作系统账户记录，不能依赖继承 HOME/PATH 或当前工作目录。

为 APM 显式构造 HOME、APM_HOME 和必要的固定环境。APM_HOME 是用户主目录，其内部再追加 `.apm`，不能误传 `.apm` 本身。使用绝对 executable、独立 argv、无 shell；Provider 不读取 APM 内部状态文件。单个数据源的配置解析失败延迟到该 scope 请求，不导致另一个 scope 失效。

APC 默认地址沿用当前 dev 的 `https://developer.bianbu.xyz/api-server/apc/api/v1`；正式连接使用系统受信 CA，HTTPS 重定向有次数限制且禁止降级到 HTTP。不提供跳过 TLS 校验开关。测试使用本地受信 TLS fixture。若正式环境证书不受信，记录阻塞，不自动修改系统 CA 或关闭验证。

Provider 首版无业务持久数据；宿主提供的 `BIBIT_PROVIDER_DATA_DIR` 不得当作用户 HOME 或 APM_HOME。无需新增包拥有的配置文件；部署差异通过 drop-in 的 args 配置，不写用户 home 的 Registry。

## 7. Registry 与双 deb

Registry 严格对齐 `../bibit/src-tauri/src/external_services.rs` 中的 RawConnectionRegistry/RawConnection：

```json
{
  "version": 2,
  "services": {
    "store": {
      "transport": "stdio",
      "executable": "/usr/libexec/bibit/bibit-agenthub",
      "args": ["provider"],
      "lifecycle": "managed",
      "protocolVersions": [1],
      "requestTimeoutMs": 30000
    }
  }
}
```

这里 `version: 2` 仅为 Registry 格式；Provider 始终协商 v1。

`debian/control` 新增 `bibit-agenthub-cli`（Architecture: any），Go module 独立于 npm 依赖和前端构建。Go 优先仅用标准库；支持目标 riscv64 的本机构建或交叉构建，验收检查实际 ELF 架构。APM 缺失应允许降级，不作为阻止 CLI 安装的强制依赖。

CLI 包拥有 `/usr/libexec/bibit/bibit-agenthub` 与 `/etc/bibit/external-services.d/agenthub.json`。现有 Architecture: all 前端包保留安装路径、bundle/grant 归属与授权内容，仅更新实现所需的 bundle。不提交私钥、生成 bundle、Go 二进制或 deb。不替换系统信任配置，不使用开发密钥冒充正式签名；按现有签名流程产出可安装 bundle，缺少可用签名材料时报告部署阻塞。

## 8. 验证与交付顺序

1. Go 单元测试与离线 `--self-test`：初始化、v1 协商、invoke、未知方法/operation、错误闭集、malformed NDJSON、边界大小、超时和子进程清理。自检不要求真实 APM 或公网服务。
2. 独立 stdio 驱动验证真实 Provider 进程，在清空继承环境下执行 initialize/invoke；APM fixture 与受信 TLS fixture 覆盖条件命中不下载目录、变化才下载、错误隔离以及 stdout 安全。
3. 前端契约和行为测试：原始 wire 到富结果、缓存命中/更新、取消与响应竞争、hash 不匹配、page 2 reset、agent 缓存隔离、当前 type 全量 tags facets。dev 与生产使用相同 fixture 证明结果一致，无重复业务实现。
4. 执行 `npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`。检查插件 bundle 不含 Go、CLI 执行或 Node 数据源依赖。
5. 使用真实 APC，记录全量目录原始大小、转义后的完整 RPC 响应大小与 4 MiB 余量；记录 TLS、重定向、版本与 hash 校验结果。超出宿主上限即停下另行决策，不改用未上线接口。
6. 协议验证通过后再按需要将 dev 传输接到真实 Provider 做页面联调；任何 dev 桥接仍仅转发，不重新实现聚合。
7. 本机产出两个 deb，检查架构、文件归属和 Registry 内容。开发板 `bianbu@board-host` 安装两包并重启宿主，检查实际部署版本与 Registry 加载，验证两个 scope 的真实数据、翻页/筛选版本检查、目录更新、重进页面，以及 APM 缺失时 installed 可重试而 market 可用。APM 缺失可通过临时配置不存在的 executable 验证，恢复后重新验收，不移除用户工具。
8. 页面验收需保留可观察证据；仅驱动成功不能宣称 UI 验收通过。若远程使用 Python 脚本，遵循项目指定的 Python 3.13/.venv313 规则。

## 9. 文档、边界与完成标准

同步 README、开发部署指南的 10.4–10.6、CLI Provider 指南和契约测试，明确现有旧协议 demo 只供骨架参考。设置与 v2 不纳入本期正式实现描述。依赖矩阵不变。

实际行为变更全部完成后按项目模板为本用户请求写一条 `docs/Changelog.md`，列出相关提交。当前设计文档本身不记行为 changelog。

完成要求：前端四件套通过；Go 自检与协议驱动通过；聚合语义只有一处；两个 deb 已产出；真实目录在响应上限内；开发板页面验收完成。设计阶段尚未执行真实网络、打包或板端验收，以上均为后续检查，不能视为已有结论。遇到实际契约冲突、授权扩张、响应超限或信任配置问题，停止相关步骤并说明。
