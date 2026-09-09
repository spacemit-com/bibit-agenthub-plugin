# Bibit Agent Hub Plugin

Bibit Agent Hub 的独立前端插件 + 独立 Go CLI Provider，当前包含：

- Bibit 主侧边栏中的 Agent Hub 页面（installed / market 两个 scope）；
- Power 详情弹窗（描述、tags、Agent 归属、版本选择）与安装/卸载闭环；
- Agent Hub 设置子页面；
- `service:store` Host API 接入（`powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` + `settings.get.v1`/`settings.update.v1`）；
- 独立 Feature Dev Host 与共享的前端数据层（解析、过滤、聚合、分页、facets、snapshot 判断、共享安装状态）；
- 纯 Go 标准库 CLI Provider（仅 Provider Protocol v1，`bibit-agenthub`）。

Agent 选择支持 `bibit`、`codex`、`claude-code`、`hermes-agent`。Hermes 支持 Skill、MCP 和 Plugin 的列表、详情、安装与卸载，`agent` 类型仅支持 Bibit；运行环境中的 APM 需要支持 `--agent=hermes-agent`。

本期范围是 v1：installed（APM）与 market（APC 全量目录）浏览，以及单版本安装/卸载（读 30s、写 120s 超时）。上传/下载、job、文件传输与 settings 持久化不在本期 CLI 内。

完整的代码边界、独立开发、服务协议、签名、部署、升级和验收步骤见：

- [Agent Hub 插件开发与部署指南](./docs/development-and-deployment-guide.md)
- [AgentHub CLI Provider 开发与部署指南](./docs/cli-provider-development-and-deployment.md)

## 快速启动

```bash
npm ci
npm run test
npm run dev
```

## 前端构建与签名

首次本地构建先生成开发签名 key，后续只需执行构建命令：

```bash
npm run keygen
npm run build:plugin
```

当前产物：`artifacts/agent-hub-0.2.3.bibit-plugin.tgz`。`.bibit-keys/` 中的私钥禁止提交，开发签名不能代替目标 Release 的信任链。

## CLI Provider 构建与自检

```bash
make -C provider build                 # 本机 GOARCH
make -C provider build GOARCH=riscv64  # 目标架构（开发板为 riscv64）
make -C provider test vet
./artifacts/provider/<arch>/bibit-agenthub --self-test
go run ./provider/cmd/provider-probe --executable <binary> --scope market
```

## 系统部署（两个 deb）

```text
bibit-agenthub-plugin (all)  -> plugin bundle + capability grant
bibit-agenthub-cli    (any)  -> /usr/libexec/bibit/bibit-agenthub + Provider Registry
```

CLI 包通过 `/etc/bibit/external-services.d/agenthub.json`（Registry `version: 2`，`protocolVersions: [1]`，managed stdio）接入宿主；Provider 始终协商协议 v1。

## cache-on-check

market 每次请求先取 `resources/version`，`catalog_sha256` 与前端缓存一致时返回 `not_modified`（不下载全量）；变化时才下载 `resources` 并重新校验。installed 每次重新执行 APM，不缓存 wire snapshot。安装/卸载写入后由共享安装状态 `installationStore` 重新读取 installed 并刷新整页清单；前端数据层以 `WeakMap` 按 service + 缓存键隔离，过期/取消的慢请求不会覆盖新缓存。
