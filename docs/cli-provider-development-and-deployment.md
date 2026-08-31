# AgentHub CLI Provider 开发与部署指南

AgentHub 前端不能执行命令、传 executable/argv 或接触本机路径。所有按钮固定走：

```text
AgentHub UI -> Feature SDK -> Bibit FileGrant / Job Registry
            -> Provider Protocol v2 -> AgentHub CLI
```

CLI 可以使用 Python、C++、Rust 等任意实现语言；Bibit 只约束协议、固定入口和资源边界。

## 1. 系统入口与进程约束

正式 CLI 包提供固定入口：

```bash
/usr/libexec/bibit/bibit-agenthub provider
```

Provider 必须从 stdin 读取 UTF-8 NDJSON，stdout 只能输出 JSON-RPC 2.0，日志只写 stderr。不得依赖继承的 `HOME`、`PATH` 或工作目录。持久数据根由 `BIBIT_PROVIDER_DATA_DIR` 指定；Host 传来的 `resourcePath` 只能相对此根解析，并拒绝绝对路径、`..`、反斜杠和符号链接跳转。

插件包和 CLI 包可独立升级：插件不拥有 CLI executable、Provider Registry 或 Provider 数据；CLI 不拥有插件 bundle 和 capability grant。

## 2. 协议协商与兼容

Host 初始化示例：

```json
{"jsonrpc":"2.0","id":"session:initialize","method":"bibit.initialize","params":{"protocolName":"bibit-provider","supportedProtocolVersions":[2,1],"serviceId":"store","client":{"name":"Bibit"}}}
```

支持传输的 Provider 返回：

```json
{"jsonrpc":"2.0","id":"session:initialize","result":{"protocolVersion":2,"providerVersion":"1.0.0","capabilities":{"invoke":true,"jobs":true,"cancellation":true,"maxConcurrentJobs":1},"operations":["agents.list.v1","settings.get.v1","settings.update.v1","agents.upload.v1","agents.download.v1"]}}
```

- v1 只处理 `bibit.invoke`，列表和设置继续可用；Bibit 会禁用上传/下载并显示“Provider 不支持异步传输”。
- v2 必须同时声明 `jobs`、`cancellation` 和 `maxConcurrentJobs: 1`。
- `id` 原样回显；未初始化前不处理请求。
- v1 不得因为 v2 的加入改变请求、取消和生命周期语义。

## 3. 普通 operation

`bibit.invoke` 继续承载短请求：

```json
{"jsonrpc":"2.0","id":"req-1","method":"bibit.invoke","params":{"serviceId":"store","operationId":"agents.list.v1","params":{},"timeoutMs":30000}}
```

当前 DTO：

| operation | params | result |
| --- | --- | --- |
| `agents.list.v1` | `{}` | `{id,name,description}[]` |
| `settings.get.v1` | `{}` | `{showExperimental,refreshMinutes}` |
| `settings.update.v1` | 同上 | 同上 |

破坏性变更必须发布新的 operation 版本。Provider 错误的 `data.code` 仅使用平台闭集：`cancelled`、`offline`、`timeout`、`unauthorized`、`incompatible`、`unavailable`、`provider_crashed`、`resource_exhausted`、`unknown`。

## 4. 上传/下载 Job

Host 先创建并消费不透明 FileGrant，再发送：

```json
{"jsonrpc":"2.0","id":"job:start:<jobId>","method":"bibit.job.start","params":{"serviceId":"store","jobId":"<jobId>","operationId":"agents.upload.v1","input":{"displayName":"sample.demo-agent"},"resources":[{"resourcePath":"transfers/agent-hub/<random>/input.bin","byteLength":128,"sha256":"<sha256>"}]}}
```

Provider 必须立即确认，然后在 worker 中处理，主读循环继续响应 list/settings/cancel：

```json
{"jsonrpc":"2.0","id":"job:start:<jobId>","result":{"jobId":"<jobId>","accepted":true}}
```

进度事件的 `providerSequence` 从 1 开始严格递增：

```json
{"jsonrpc":"2.0","method":"bibit.jobEvent","params":{"serviceId":"store","jobId":"<jobId>","providerSequence":1,"kind":"progress","progress":{"completedBytes":65536,"totalBytes":1048576}}}
```

上传成功只返回业务结果。下载必须把字节写入 Host 预建的 output resource，并回传完全相同的相对 locator、字节数和 SHA-256：

```json
{"jsonrpc":"2.0","method":"bibit.jobEvent","params":{"serviceId":"store","jobId":"<jobId>","providerSequence":2,"kind":"result_ready","result":{"output":{"agentId":"demo","bytes":128,"sha256":"<sha256>"},"resource":{"resourcePath":"transfers/agent-hub/<random>/output.bin","byteLength":128,"sha256":"<sha256>"}}}}
```

`result_ready` 只是完成提议。只有 Bibit 完成校验和原子发布后，UI 才会看到 `succeeded`。CLI 不得返回绝对路径。

失败事件：

```json
{"jsonrpc":"2.0","method":"bibit.jobEvent","params":{"serviceId":"store","jobId":"<jobId>","providerSequence":2,"kind":"failed","error":{"code":"resource_exhausted","message":"Package store limit reached","retryable":true}}}
```

## 5. 取消与竞争

```json
{"jsonrpc":"2.0","id":"job:cancel:<jobId>:<nonce>","method":"bibit.job.cancel","params":{"serviceId":"store","jobId":"<jobId>"}}
```

Provider 立即返回 accepted，worker 停止后发送唯一 `cancelled` 事件。若 Host 已先记录终态，取消会返回 too-late；若 Host 已记录 `cancel_requested`，后续 `result_ready` 不能覆盖它。取消超时会只隔离当前 managed Provider，并在下一次请求重建。

页面卸载不会发送取消；只有用户点击“Cancel transfer”才取消 Job。

## 6. 模拟 CLI

仓库内 [`demo/cli/bibit-agenthub-mock-provider.py`](../demo/cli/bibit-agenthub-mock-provider.py) 是可运行参考：

```bash
python3 demo/cli/bibit-agenthub-mock-provider.py --self-test
```

自检真实复制上传字节、再下载并比较 SHA-256，还覆盖一次取消。它只用 Python 标准库，限制 package store 为 512 MiB，主 NDJSON 循环与 worker 分离。它是协议示例，不定义正式 Agent 包格式。

## 7. Registry 与 Grant

- Provider Registry：[`deploy/agenthub-provider.example.json`](../deploy/agenthub-provider.example.json)，必须为 managed stdio 且 `protocolVersions` 包含 `[1,2]`。
- capability grant：[`deploy/agenthub-feature-grants.example.json`](../deploy/agenthub-feature-grants.example.json)，同时授权 `service:store`、`file:transfer`、`job:manage` 和五个 operation。
- 插件 Manifest 必须声明同一组 Host capability；三处不一致时 Host 拒绝调用。

正式建议拆包：

```text
bibit-agenthub-plugin -> plugin bundle + capability grant
bibit-agenthub-cli    -> /usr/libexec/bibit/bibit-agenthub + Provider Registry
```

## 8. Debug 部署

先构建插件，再准备隔离目录：

```bash
npm run build:plugin
./demo/deploy-debug.sh /home/bianbu/bibit-agenthub-demo
```

脚本不写 `/usr`、`/etc`、systemd 或 DEB 状态；它输出启动开发版 Bibit 所需的 `XDG_DATA_HOME`、`JAN_DATA_FOLDER`、Provider config、grant、plugin 和 trust-store 环境变量。`XDG_DATA_HOME` 必须指向隔离目录，防止调试插件、Provider 数据和用户配置落入正式用户目录。调试结束必须停止开发进程并恢复唯一的 `/usr/bin/bibit-gui` 正式进程。

## 9. 最小验收

1. `npm test && npm run typecheck && npm run build:dev && npm run build:plugin`。
2. `python3 demo/cli/bibit-agenthub-mock-provider.py --self-test`。
3. 页面上传 fixture，记录 source、Provider package 的 SHA-256。
4. 页面下载同一 Agent，目标 SHA-256 必须相同，staging 已清理。
5. 延迟传输中取消，无目标半成品；随后 list/settings 仍响应。
6. 多次离开/返回页面不重复 Job，不阻塞其他会话。
