# AgentHub CLI Provider 开发与部署指南

AgentHub 前端不能执行命令、传 executable/argv 或接触本机路径。installed 与 market 两个 scope 的所有业务请求统一走：

```text
AgentHub UI -> Feature SDK -> Bibit external-service gateway
            -> Provider Protocol v1 -> AgentHub CLI (Go)
```

CLI 是纯 Go 标准库实现（`provider/` 独立 module），只声明 Provider Protocol v1 与四个 operation `powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1`。上传/下载、job、文件传输、settings 归属均不在本期 CLI 范围内。

## 1. 系统入口与进程约束

正式 CLI 包提供固定入口：

```bash
/usr/libexec/bibit/bibit-agenthub provider
```

Provider 从 stdin 读取 UTF-8 NDJSON，stdout 只输出完整单行 JSON-RPC 2.0，日志只写 stderr。宿主以 `env_clear()` 启动，只显式注入 `LANG`、`BIBIT_PROVIDER_PROTOCOL` 和 `BIBIT_PROVIDER_DATA_DIR`；Provider 不依赖继承的 `HOME`、`PATH` 或当前工作目录，用户主目录按进程 UID 经操作系统账户记录解析。

资源边界固定：

- 输入行上限 1 MiB；RPC 响应行（含换行）上限 4 MiB；
- `timeoutMs` 合法区间 `1..300000`；
- APM stdout 与 APC catalog 均受 4 MiB 响应预算约束，超出映射为 `resource_exhausted`；
- `resources/version` 单独使用 64 KiB 预算。

进程卫生与 Go 侧一致：子进程置入独立进程组，`Setpgid` + `Pdeathsig=SIGKILL`，取消时 `kill` 整个进程组，避免孤儿子进程持有 stdout 管道。

## 2. 协议协商（v1）

初始化请求：

```json
{"jsonrpc":"2.0","id":"session:initialize","method":"bibit.initialize","params":{"protocolName":"bibit-provider","supportedProtocolVersions":[1],"serviceId":"store","client":{"name":"Bibit"}}}
```

支持传输的 Provider 返回：

```json
{"jsonrpc":"2.0","id":"session:initialize","result":{"protocolVersion":1,"providerVersion":"0.2.3","capabilities":{"invoke":true},"operations":["powers.list.v1","powers.inspect.v1","powers.install.v1","powers.uninstall.v1"]}}
```

初始化前拒绝 `bibit.invoke`。Provider 只声明 `invoke`，不声明 v2 的 `jobs`/`cancellation`/`maxConcurrentJobs`。`bibit.shutdown` 通知结束会话，`bibit.cancel`（v2 保留字）在 v1 会话中被忽略。

## 3. powers.list.v1

`bibit.invoke` 承载短请求：

```json
{"jsonrpc":"2.0","id":"req-1","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.list.v1","params":{"scope":"market"},"timeoutMs":30000}}
```

wire 输入是闭集，只校验信封形状，不携带任何业务过滤字段（type/tags/page/sort 全部留在前端数据层）：

```text
{scope:"installed", agent:"<selected>"}        // installed 每次必带 agent
{scope:"market", knownSnapshot?:"<sha256>"}    // 首次省略，命中缓存后携带
```

wire 结果也是闭集，`listJson` / `catalogJson` 携带原始 UTF-8 JSON 文本，Provider 原样透传、不重序列化：

```text
{scope:"installed", status:"data", listJson:"[...]"}
{scope:"market", status:"data", snapshot:"<sha256>", catalogJson:"{...}"}
{scope:"market", status:"not_modified", snapshot:"<sha256>"}
```

Provider 的唯一业务比较是 `catalog_sha256`；不解析 Agent 包字段，不聚合、不排序、不分页。

### 3.1 installed（APM CLI）

固定 argv（无 shell）：

```text
apm list --installed --agent=<selected> --json
```

语义与开发端一致：

- 启动失败（含 apm 不存在）或非零退出 → 可重试的 `unavailable`，绝不伪造空清单；
- exit 0 且 stdout 为 `[]` → 数据态空清单（前端渲染空内容）；
- 非法 UTF-8 → `unavailable`；超 4 MiB → `resource_exhausted`。

### 3.2 market（APC 公共接口）

每次请求先 `GET {base}/resources/version`；`catalog_sha256` 等于 `knownSnapshot` 时返回 `not_modified`，否则下载 `GET {base}/resources` 全量目录并回传同一 snapshot。默认 base 为 `https://developer.bianbu.xyz/api-server/apc/api/v1`。不调用 `resources/list` 或 `resources/tags`。HTTP 客户端使用系统受信 CA，重定向 ≤5 跳且禁止 https→http 降级，无跳过 TLS 校验的开关。

### 3.3 powers.inspect.v1

```json
{"jsonrpc":"2.0","id":"req-2","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.inspect.v1","params":{"agent":"bibit","type":"skill","name":"demo"},"timeoutMs":30000}}
```

固定 argv（无 shell）：

```text
apm list demo --installed --json --agent=bibit --type=skill
```

exit 0 时透传 `{listJson: stdout}`（原始 UTF-8 JSON）；apm 不存在或非零退出 → `unavailable`。目标是否已安装由前端预检逻辑判断，Provider 只透传命令输出。

### 3.4 powers.install.v1 / powers.uninstall.v1

```json
{"jsonrpc":"2.0","id":"req-3","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.install.v1","params":{"agent":"bibit","type":"skill","name":"demo","version":"v1.0.0"},"timeoutMs":120000}}
{"jsonrpc":"2.0","id":"req-4","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.uninstall.v1","params":{"agent":"bibit","type":"skill","name":"demo"},"timeoutMs":120000}}
```

固定 argv（无 shell）：

```text
apm install demo=v1.0.0 --agent=bibit --type=skill
apm uninstall demo --agent=bibit --type=skill
```

写入语义：

- 写超时 120 秒；Provider 用 `context.WithTimeout` 预留 1000ms 子进程清理预算，超时后 kill 整个进程组并映射 `timeout`；
- 非零退出是正常结果，返回 `{status:"exited", exitCode:N}`，由前端 `operationMessage` 映射为固定失败文案，Provider 不透传 stderr；
- apm 启动失败（含不存在）→ `{status:"unavailable"}`；
- 安装的 `version` 必须是规范版本 `v<major>.<minor>.<patch>`，卸载/详情不带 version；`name` 必须满足 APM 规范命名（1–64 字节小写 kebab）。

## 4. 错误闭集

Provider 错误的 `data.code` 仅使用平台闭集：

```text
cancelled offline timeout unauthorized incompatible unavailable
provider_crashed resource_exhausted unknown
```

可重试：`offline`、`timeout`、`unavailable`、`provider_crashed`。HTTP 401/403 → `unauthorized`，408/504 → `timeout`，426 → `incompatible`，其余非 2xx → `unavailable`。

## 5. 自检

```bash
/usr/libexec/bibit/bibit-agenthub --self-test
```

自检离线运行 5 项子检查：初始化与 v1 协商、power operations（inspect/install/uninstall 的 argv 与结果形状）、纯 v2 不支持路径、invoke 错误映射、malformed NDJSON（`-32700`），exit 0 表示通过。不要求真实 APM 或公网服务。

## 6. Registry 与双 deb

Registry 严格对齐宿主 `RawConnectionRegistry`（serde camelCase）：

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
      "requestTimeoutMs": 120000
    }
  }
}
```

`version: 2` 只是 Registry 文件格式版本；Provider 始终协商协议 v1，`protocolVersions` 固定 `[1]`。CLI 不安装 probe。

构建与交叉构建：

```bash
make -C provider build                 # 本机 GOARCH
make -C provider build GOARCH=riscv64  # 目标架构
```

纯标准库 `CGO_ENABLED=0`，构建期 `-ldflags="-s -w"` 去调试符号，`debian/rules` 据此覆盖 `dh_strip` 避免错误架构 strip。默认 GOARCH 取自 `go env GOARCH`；`debian/rules` 仅接受 `amd64`/`arm64`/`riscv64`，未知架构显式失败。

拆包归属：

```text
bibit-agenthub-plugin (Architecture: all)
    -> plugin bundle + /etc/bibit/feature-capability-grants.d/agenthub.json
bibit-agenthub-cli (Architecture: any)
    -> /usr/libexec/bibit/bibit-agenthub + /etc/bibit/external-services.d/agenthub.json
```

CLI 包不依赖 APM 或 bi-bit；APM 缺失允许降级为 `unavailable` 而非阻止安装。maintainer script 不修改用户 home 下的 Registry，也不重启宿主。

## 7. 最小验收

1. `make -C provider test vet`；`make -C provider build GOARCH=riscv64` 后 `readelf -h` 确认 RISC-V。
2. `/usr/libexec/bibit/bibit-agenthub --self-test`（或本机二进制路径）exit 0。
3. `go run ./cmd/provider-probe --executable <binary> --scope market` 记录 snapshot，再用该 snapshot 复调确认 `not_modified`。
4. 板端安装两包后，宿主协商 `protocol=1`，页面 installed/market 真实数据、翻页/筛选每次 version 检查、缓存命中不下载全量，详情与安装/卸载走 `apm`（读 30s / 写 120s）。
