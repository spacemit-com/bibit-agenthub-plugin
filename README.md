# Bibit Agent Hub Plugin

Bibit Agent Hub 的独立前端插件 + 独立 Go CLI Provider，当前包含：

- Bibit 主侧边栏中的 Agent Hub 页面（一级标签：我的 Power / Power 市场 / 设置）；
- Power 详情弹窗（描述、tags、Agent 归属、版本选择）与安装/卸载闭环；
- 「我的 Power」里除 APM 清单外，还展示手动安装到各 Agent 目录下的自定义资源（卡片带 `Custom` 标记），并在弹窗内提供 APC 上传与本地删除；
- 页面「设置」标签页（APC API Key 的配置状态、写入与清除；不再有独立的设置子页面）；
- `service:store` Host API 接入（`powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` / `powers.custom.list.v1` / `powers.upload.v1` / `powers.delete.v1` + `settings.get.v1`/`settings.update.v1`）；
- 独立 Feature Dev Host 与共享的前端数据层（解析、过滤、聚合、分页、facets、snapshot 判断、共享安装状态）；
- 纯 Go 标准库 CLI Provider（仅 Provider Protocol v1，`bibit-agenthub`）。

Agent 选择支持 `bibit`、`codex`、`claude-code`、`hermes-agent`。Hermes 支持 Skill、MCP 和 Plugin 的列表、详情、安装与卸载，`agent` 类型仅支持 Bibit；运行环境中的 APM 需要支持 `--agent=hermes-agent`。

自定义资源扫描范围与各 Agent 的能力一致：目录 `~/.bianbu-agent/{skills,plugins,agents}`（Bibit）、`~/.codex/skills`、`~/.claude/skills`、`~/.hermes/{skills,plugins}`。本期不含 MCP（APM 不为其维护目录，无法扫描），codex / claude-code 的 Plugin 由各自 CLI 管理，也不在扫描范围内。展示只需满足主流最低格式（Skill 的 `SKILL.md` frontmatter 至少有 `name`/`description`；Plugin 清单至少有 `name`；Agent 的 `agent.yaml` 至少有 `agent.name`），不满足的被跳过并在页面上给出 warning；上传仍交给 `apm validate` + `apm submit`，因此上传要求资源满足 Power 格式 v2。

本期范围是 v1：installed（APM + 自定义资源）与 market（APC 全量目录）浏览、单版本安装/卸载，以及自定义资源的 APC 上传 / 本地删除（读 30s、写 120s 超时）。下载、job 与文件传输不在本期。

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

当前产物：`artifacts/agent-hub-0.3.6.bibit-plugin.tgz`。`.bibit-keys/` 中的私钥禁止提交，开发签名不能代替目标 Release 的信任链。开发预览地址追加 `?lang=zh-CN` 可查看中文界面；页面语言跟随 Bibit 系统语言，插件本身不提供语言设置。Local Preview 的 Store 中间件会扫描本机 home（`dev/custom.ts`），因此自定义资源在开发环境也可见。

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

CLI 包通过 `/etc/bibit/external-services.d/agenthub.json`（Registry `version: 2`，`protocolVersions: [1]`，managed stdio）接入宿主；Provider 始终协商协议 v1。`settings.update.v1` 的 `apiKey` 走 Registry 的 `credentialParameters` 声明，密钥只经环境变量 `APC_API_KEY` 传给 `apm submit`，落盘在 `settings.json`（0600，原子写入，拒绝对符号链接写入），接口只返回 `hasApiKey`。

## cache-on-check

market 每次请求先取 `resources/version`，`catalog_sha256` 与前端缓存一致时返回 `not_modified`（不下载全量）；变化时才下载 `resources` 并重新校验。installed 每次重新执行 APM，不缓存 wire snapshot。安装/卸载写入后由共享安装状态 `installationStore` 重新读取 installed 并刷新整页清单；前端数据层以 `WeakMap` 按 service + 缓存键隔离，过期/取消的慢请求不会覆盖新缓存。
