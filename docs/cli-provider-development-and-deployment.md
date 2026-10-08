# AgentHub CLI Provider 开发与部署指南

AgentHub 前端不能执行命令、传 executable/argv 或接触本机路径。installed 与 market 两个 scope 的所有业务请求统一走：

```text
AgentHub UI -> Feature SDK -> Bibit external-service gateway
            -> Provider Protocol v1 -> AgentHub CLI (Go)
```

CLI 是纯 Go 标准库实现（`provider/` 独立 module），只声明 Provider Protocol v1 与十一个 operation：`powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` / `powers.custom.list.v1` / `powers.upload.v1` / `powers.delete.v1` / `settings.get.v2` / `settings.keys.add.v1` / `settings.keys.delete.v1` / `settings.keys.enable.v1`。下载、job 与文件传输不在本期 CLI 范围内。

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
{"jsonrpc":"2.0","id":"session:initialize","result":{"protocolVersion":1,"providerVersion":"0.4.0","capabilities":{"invoke":true},"operations":["powers.list.v1","powers.inspect.v1","powers.install.v1","powers.uninstall.v1","powers.custom.list.v1","powers.upload.v1","powers.delete.v1","settings.get.v2","settings.keys.add.v1","settings.keys.delete.v1","settings.keys.enable.v1"]}}
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

### 3.5 powers.custom.list.v1

```json
{"jsonrpc":"2.0","id":"req-5","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.custom.list.v1","params":{"agent":"bibit"},"timeoutMs":30000}}
```

参数是闭集 `{agent}`，agent 必须是四个已安装 Agent 之一。Provider 只做文件系统扫描，不调用 apm，因此没有超时风险，也不需要网络。

结果携带原始 JSON 文本 `itemsJson`（前端解析，Provider 不做业务聚合）：

```text
{scope:"custom", status:"data", itemsJson:"{\"items\":[…],\"skipped\":[…]}"}
```

扫描目录（`userHome` 下的相对路径，与 APM 的 Agent 目录一致）：

| Agent | 根目录 | 类型 |
| --- | --- | --- |
| `bibit` | `.bianbu-agent` | `skills/`、`plugins/`、`agents/`（类型依次为 skill/plugin/expert）|
| `codex` | `.codex` | `skills/` |
| `claude-code` | `.claude` | `skills/` |
| `hermes-agent` | `.hermes` | `skills/`、`plugins/` |

身份取**目录名**，必须满足 APM 命名规范（1–64 字节小写 kebab，不以 `-` 开头/结尾，不含 `--`）；以 `.` 开头的目录直接忽略。权威文件按类型固定：

| 类型 | 目录 | 权威文件（优先级） | 主流最低要求 |
| --- | --- | --- | --- |
| skill | `skills/` | `SKILL.md` | frontmatter 是映射，且 `name`、`description` 均非空 |
| plugin | `plugins/` | `apc-plugin.json`、`plugin.yaml`、`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json` | 清单至少有非空 `name` |
| expert | `agents/` | `agent.yaml` | 至少有非空 `agent.name` |

> 上表的「类型」是 Power 类别，取值与 apm 0.0.2 起的 `--type` 一致（`expert`）；同名的「Agent」列指的是目标 Agent（bibit / codex / …）。类别改成 `expert` 之前 apm 用 `agent`，磁盘目录名与 `agent.yaml` 是 APC 与 Bibit Runtime 的外部约定，始终不变（apm ADR-044）。

判定规则：

- **跳过还是纳入**以「能否解析出最低要求」为准，不要求满足 Power 资源 schema（`schema_version`、展示字段、长度上限等都不检查）；上传才由 `apm validate` 按 v2 严格要求。
- frontmatter 的标量解析支持**块标量**：`description: >-` / `|` 把值放在后续缩进行，`>` 折叠成一个空格分隔的长字符串（空行变成换行）、`|` 保留换行，`+`/`-`/数字缩进指示符都接受。板端多个真实 Skill 用了这种写法，必须能读出 `description`，否则会被误判为 `invalid-authority-file`。
- 目录名不合规范、以 `.` 开头、不是目录（或指向目录的符号链接）→ 完全不出现在结果里（不报 warning）。
- 看起来是候选但缺权威文件（如 Plugin 目录只有 `skills/`）→ `skipped` 项，`reason: "missing-authority-file"`，`expected` 是该类型的主权威文件名。
- 权威文件存在但低于最低要求、前半段不是 YAML 映射、非法 UTF-8 或超过 64 KiB → `skipped`，`reason: "invalid-authority-file"`。
- `version` 只接受 `v<major>.<minor>.<patch>`（不带 `v` 前缀时补上）；其它写法或缺失一律置 `""`，前端显示占位符，绝不猜测版本。
- 类型目录可以是符号链接（会跟随）；单个资源目录也可以是符号链接（会跟随读取）。
- 上限：每类型目录 200 项、总条目 1000、单文件 64 KiB、`skipped` 最多 20 条。
- 同 `(type,name)` 同时存在于 APM 清单时，**前端**以 APM 清单为准（Provider 不读取清单，也不做去重），其 `skipped` 条目也不再渲染 warning。

### 3.6 powers.upload.v1

```json
{"jsonrpc":"2.0","id":"req-6","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.upload.v1","params":{"agent":"bibit","type":"skill","name":"demo","message":"Publish the local demo skill"},"timeoutMs":120000}}
```

参数是闭集 `{agent,type,name,message}`：绝不携带路径。`message` 必须是单行、≤200 字符且非空（apm `submit` 必填）。Provider 侧重新解析目标路径（`ResolveCustomTarget`：规范名、该 Agent 支持的类型、类型目录必须是目录、解析结果必须是类型目录的直接子项），任何一步不满足即 `incompatible`。

固定 argv（无 shell，先校验后提交）：

```text
apm validate <resolvedPath> --type=skill --json
apm submit   <resolvedPath> --type=skill --message=<message>
```

凭据：从 `settings.json` 读取 APC API Key，通过环境变量注入子进程（`APC_API_KEY`，配置了 `--apc-root-url` 时额外注入 `APC_BASE_URL`）。未配置 Key 时直接返回 `unauthorized`，**不启动 apm**。Key 不会出现在结果里：失败原因会先把 Key 替换为 `***`、去掉 ANSI 转义与控制字符、压成单行并截断到 300 字节。

结果：

```text
{status:"exited", exitCode:0, stage:"submit", stdout:"outcome: accepted\nsubmission_id: …"}
{status:"exited", exitCode:N, stage:"validate", reason:"<清洗后的原因>"}
{status:"exited", exitCode:N, stage:"submit",   reason:"<清洗后的原因>"}
```

`validate` 非零退出时不会执行 `submit`。非零退出是**正常结果**而不是 RPC 错误。

`reason` 的来源按 apm 自身约定决定：**成功**的 `validate`/`submit` 把业务结果写到 stdout，**失败**时只在 stderr 写一行 slog logfmt 日志（`level=ERROR msg="command failed" error="…"`）并在其后打印 Cobra usage。因此 Provider 有界收集 stdout（4 MiB）与 stderr（8 KiB），失败时只取 stderr 那一行的 `error` 属性值作为原因，usage 块、`level=ERROR` 前缀和 Go 错误包装都不会进入结果；拿不到 `error` 属性时才回退到 stdout，最后才回退到整段 stderr。两条流都会先做凭据替换与控制字符清洗。前端拿到非零结果时优先显示 apm 的原因（`Upload failed: {reason}`），没有原因时按 stage 显示固定文案。

### 3.7 powers.delete.v1

```json
{"jsonrpc":"2.0","id":"req-7","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.delete.v1","params":{"agent":"bibit","type":"skill","name":"demo"},"timeoutMs":120000}}
```

参数是闭集 `{agent,type,name}`（不带 version），按与上传相同的规则解析路径后执行系统删除语义（Go `os.RemoveAll`）：

- 只删类型目录下的**直接子项**，且必须是目录或指向目录的符号链接；文件、越界名、未知 Agent/类型一律 `incompatible`；
- 资源目录本身是符号链接时，只删除链接，不跟随删除链接指向的内容；
- 目标不存在时返回错误（不是静默成功），避免「以为删掉了」。

结果：

```text
{status:"deleted"}
```

### 3.8 settings.get.v2 / settings.keys.add.v1 / settings.keys.delete.v1 / settings.keys.enable.v1

```json
{"jsonrpc":"2.0","id":"req-8","method":"bibit.invoke","params":{"serviceId":"store","operationId":"settings.get.v2","params":{},"timeoutMs":30000}}
{"jsonrpc":"2.0","id":"req-9","method":"bibit.invoke","params":{"serviceId":"store","operationId":"settings.keys.add.v1","params":{"apiKey":"<APC key>"},"timeoutMs":30000}}
{"jsonrpc":"2.0","id":"req-10","method":"bibit.invoke","params":{"serviceId":"store","operationId":"settings.keys.enable.v1","params":{"id":"<32 hex>"},"timeoutMs":30000}}
{"jsonrpc":"2.0","id":"req-11","method":"bibit.invoke","params":{"serviceId":"store","operationId":"settings.keys.delete.v1","params":{"id":"<32 hex>"},"timeoutMs":30000}}
```

`settings.get.v2` 参数是空对象，结果是 `{showExperimental, refreshMinutes, keys}`，其中 `keys` 是 `[{id, preview, enabled}]`——**永不返回 Key 本身**，`preview` 是 Provider 生成的 `头****尾` 遮蔽形式，`id` 是 128-bit hex 句柄，页面只能拿它做启用/删除。三个写入的入参分别是 `{apiKey}` 与 `{id}`，结果都是同一份 `SettingsView`：

```text
{apiKey: "<printable ASCII, ≤512, 非空>"} | {id: "<32 hex>"}
```

- 语义：列表为空时新增的第一条自动 `enabled`；已有 Key 时新增的保持未启用；`enable` 把目标置为唯一启用项；`delete` 删除当前启用项后**不**自动启用其它 Key（此后上传返回 `unauthorized`）；重复 Key、未知 id、超过 50 条都返回 `incompatible`。
- 存储位置：`--data-dir` 指定目录（宿主通过 `BIBIT_PROVIDER_DATA_DIR` 注入 `/var/lib` 下的私有目录），否则回退 `$HOME/.local/state/bibit-agenthub/settings.json`；目录 0700、文件 0600，写入走「临时文件 + fsync + rename」；读到符号链接、损坏 JSON、`apiKey` 与 `apiKeys` 同时出现、或超过一条 `enabled` 一律报错，不静默覆盖。
- 迁移：schemaVersion 1（单个 `apiKey`）在读取时升级为「一条已启用记录」，下一次写入落成 schemaVersion 2；v2 文件不再写 `apiKey`。
- `apiKey` 属于宿主 `credentialParameters` 声明范围，见第 6 节的 Registry 片段；未声明时宿主会直接拒绝该参数。

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

自检离线运行 6 项子检查：初始化与 v1 协商、power operations（inspect/install/uninstall 的 argv 与结果形状）、custom resources（custom.list / upload / delete / settings.get.v2 / settings.keys.add.v1 / settings.keys.delete.v1 / settings.keys.enable.v1 的参数与结果形状，且结果不得含 `apiKey` / `hasApiKey` / `key`、路径或 stderr）、纯 v2 不支持路径、invoke 错误映射、malformed NDJSON（`-32700`），exit 0 表示通过。不要求真实 APM 或公网服务。

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
      "requestTimeoutMs": 120000,
      "credentialParameters": {
        "settings.keys.add.v1": ["apiKey"]
      }
    }
  }
}
```

`version: 2` 只是 Registry 文件格式版本；Provider 始终协商协议 v1，`protocolVersions` 固定 `[1]`。`credentialParameters` 必须与 `debian/agenthub-provider.json` 保持一致：宿主的参数策略把 `apiKey` 视为凭据键，未在该 operation 下声明时 `settings.keys.add.v1` 会被宿主直接拒绝，Provider 收不到请求。CLI 不安装 probe。

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

CLI 包不依赖 APM 或 bi-bit；APM 缺失允许降级为 `unavailable` 而非阻止安装。maintainer script 不修改用户 home 下的 Registry，也不重启宿主。依赖链为：宿主 `bi-bit` 依赖 `bibit-agenthub-plugin`，`bibit-agenthub-plugin` 依赖 `bibit-agenthub-cli` 与 `agent-power-manager`（`apm` 的 deb 包），因此安装 `bi-bit` 会自动拉取前端插件、CLI Provider 与 `apm`。

## 7. 最小验收

1. `make -C provider test vet`；`make -C provider build GOARCH=riscv64` 后 `readelf -h` 确认 RISC-V。
2. `/usr/libexec/bibit/bibit-agenthub --self-test`（或本机二进制路径）exit 0。
3. `go run ./cmd/provider-probe --executable <binary> --scope market` 记录 snapshot，再用该 snapshot 复调确认 `not_modified`；`--scope custom` 走 `powers.custom.list.v1`，`--operation settings.get.v2` 检查 `keyCount` 与 `hasEnabledKey`（**不含**任何 Key 文本）。
4. 临时 home 下放一个只含 `name`/`description` 的 `~/.codex/skills/<name>/SKILL.md`，用 `--scope custom --agent codex` 确认被列出；删掉 `description` 后确认进入 `skipped` 且 `reason` 为 `invalid-authority-file`。
5. 板端安装两包后，宿主协商 `protocol=1`，页面 installed/market 真实数据、翻页/筛选每次 version 检查、缓存命中不下载全量，详情与安装/卸载走 `apm`（读 30s / 写 120s）；自定义资源在「我的 Power」中带 `Custom` 标记显示，弹窗可上传/删除。
