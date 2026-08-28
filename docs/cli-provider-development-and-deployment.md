# AgentHub CLI Provider 开发与部署指南

本文面向 AgentHub CLI 开发者。CLI 不由插件直接执行，而是作为 Bibit `store` Service 的 Provider，由 Bibit Provider Broker 启动和管理。CLI 可以使用 Python、C++、Rust 或其他实现语言，但必须遵守本文协议。

## 1. 固定调用链

```text
AgentHub Plugin
  -> service:store
  -> Bibit Provider Broker
  -> /usr/libexec/bibit/bibit-agenthub provider
  -> AgentHub 本地数据
```

插件只能传 `operationId + params`，不得传命令、argv、环境变量、工作目录、URL、凭据或任意文件路径。CLI 不能要求插件导入 Tauri API。

## 2. CLI 命令约定

系统包必须提供固定入口：

```bash
/usr/libexec/bibit/bibit-agenthub provider
```

`provider` 模式必须：

- 非交互运行，不读取终端 TTY；
- 从 stdin 读取 UTF-8 NDJSON；
- stdout 只输出 JSON-RPC 2.0 消息；
- 日志只写 stderr，且不得包含 token、凭据和完整敏感 DTO；
- 收到 EOF 后完成当前请求并退出；
- `managed` 模式收到 `bibit.cancel` 时停止对应工作并尽快结束；收到 `bibit.shutdown` 时刷新持久数据并退出；
- 使用 `BIBIT_PROVIDER_DATA_DIR` 保存当前用户的持久数据；
- 不依赖调用进程的 `HOME`、`PATH` 或当前工作目录。

## 3. 初始化协商

Bibit 首先发送：

```json
{"jsonrpc":"2.0","id":"req-1:initialize","method":"bibit.initialize","params":{"protocolName":"bibit-provider","supportedProtocolVersions":[1],"serviceId":"store","client":{"name":"Bibit"}}}
```

CLI 返回：

```json
{"jsonrpc":"2.0","id":"req-1:initialize","result":{"protocolVersion":1,"providerVersion":"1.0.0","capabilities":{"invoke":true},"operations":["agents.list.v1","settings.get.v1","settings.update.v1"]}}
```

要求：

- `id` 原样回显；
- `protocolVersion` 必须从 Host 提供的版本集合中选择；
- `providerVersion` 使用 CLI 包版本；
- `operations` 必须列出本次进程实际可处理的 operation；
- 未完成初始化前不得处理 invoke。

## 4. Operation 调用

请求：

```json
{"jsonrpc":"2.0","id":"req-1","method":"bibit.invoke","params":{"serviceId":"store","operationId":"agents.list.v1","params":{},"timeoutMs":30000}}
```

成功：

```json
{"jsonrpc":"2.0","id":"req-1","result":[{"id":"release-notes","name":"Release Notes","description":"Creates release notes."}]}
```

失败：

```json
{"jsonrpc":"2.0","id":"req-1","error":{"code":-32000,"message":"Catalog unavailable","data":{"code":"unavailable"}}}
```

平台错误码只允许 `cancelled`、`offline`、`timeout`、`unauthorized`、`incompatible`、`unavailable`、`provider_crashed`、`resource_exhausted` 和 `unknown`。Agent 不存在、版本冲突等领域错误应由 operation DTO 定义，不能冒充平台故障。

当前 AgentHub 前端要求：

| operation | params | result |
| --- | --- | --- |
| `agents.list.v1` | `{}` | `AgentSummaryV1[]` |
| `settings.get.v1` | `{}` | `AgentHubSettingsV1` |
| `settings.update.v1` | `AgentHubSettingsV1` | `AgentHubSettingsV1` |

破坏性 DTO 变更必须发布新的 operation 版本。

## 5. Registry

CLI 包安装 `/etc/bibit/external-services.d/agenthub.json`，参考仓库中的 [`deploy/agenthub-provider.example.json`](../deploy/agenthub-provider.example.json)：

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

安装脚本不得写用户 home。Registry 和 executable 由 CLI deb 拥有；插件 deb 不覆盖它们。

默认推荐 `managed`：Bibit 为 `store` 保持单个 CLI 会话、只初始化一次，并在崩溃或配置变化后重建。v1 同一 Service 内按请求串行执行；CLI 不得假设并发 invoke。若 CLI 启动几乎无成本且所有操作都完全无状态，可以改为 `oneShot`。

## 6. 独立调试

开发时构造两行输入：第一行为 initialize，第二行为 invoke。验收至少覆盖：

- 初始化成功和不支持的协议版本；
- 三个 v1 operation 的合法响应；
- 未知 operation；
- 非法 DTO；
- stdout 混入日志；
- 超时、非零退出和进程崩溃；
- `bibit.cancel` 能停止长任务，`bibit.shutdown` 能正常退出；
- managed 模式连续两个 invoke 只启动一个进程，崩溃后下一次请求可重建；
- 请求并发时持久化不会损坏；
- 重启 CLI 后设置仍可读取。

Dev Host 的 Mock 只验证前端。CLI 的真实集成必须通过 Debug Bibit 验证，不能把 Mock 成功作为 Provider 接通证据。

## 7. Debian 部署边界

建议独立包：

```text
bibit-agenthub-plugin  -> /usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz
                       -> /etc/bibit/feature-capability-grants.d/agenthub.json
bibit-agenthub-cli     -> /usr/libexec/bibit/bibit-agenthub
                       -> /etc/bibit/external-services.d/agenthub.json
```

插件包同时安装经平台批准的 capability/operation grant，内容参考 [`deploy/agenthub-feature-grants.example.json`](../deploy/agenthub-feature-grants.example.json)。插件和 CLI 可以独立升级，但发布前必须核对 Provider Protocol、operation 和 DTO 兼容范围。CLI 更新不需要重新编译 Bibit 或插件；插件更新也不应覆盖 CLI 数据或 Provider Registry。

## 8. 后续扩展

managed session 与真实取消已经由平台提供。长时间安装、下载进度和文件上传应等待/使用平台 Job/Event 与 FileGrant 公共能力；在这些公共契约交付前，相应功能应明确标记为“平台能力未就绪”，不得通过后台化 CLI、轮询临时日志文件或在 DTO 中传绝对路径绕开 Broker。
