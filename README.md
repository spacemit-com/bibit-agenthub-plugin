<div align="center">

# Bibit Agent Hub

**在 Bibit 中浏览、安装与管理 AI Agent 的能力扩展**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

</div>

## 简介

Agent Hub 是 Bibit 的能力中心，由两部分组成：

- **前端插件**（TypeScript / React）：Bibit 主侧边栏中的「能力中心」页面；
- **CLI Provider**（Go，纯标准库）：以 `service:store` 接入宿主，执行安装、卸载与上传。

## 功能

| 页面 | 内容 |
| --- | --- |
| 我的能力 | 已安装清单：APM 管理的资源 + 手动安装的自定义资源（`Custom` 标记），标签首项显示 `Installed` |
| 能力市场 | 浏览 APC 全量目录；已安装资源标注 `Installed`，有更高版本时加 `New` |
| 设置 | APC API Key 列表：遮蔽显示（`头****尾`），逐条启用 / 删除 |

- **全部更新**：一次 `apm upgrade` 收敛本机全部已安装能力；
- **筛选与搜索**：类型下拉、标签多选下拉与搜索框同排；标签按交集筛选，搜索在分页前匹配名称、描述与标签；
- **能力卡片**：点击卡片打开详情；版本放在详情中，标签集中在底部，`Installed` 使用宿主 primary 色；仅确认未安装的市场卡片在 hover 或键盘聚焦时显示「添加能力」；
- **详情弹窗**：选择版本后 `Install` / `Update` / `Downgrade` / `Uninstall`；首次安装直接执行，更新、降级与卸载需要二次确认；
- **自定义资源**：扫描各 Agent 目录并展示，支持 APC 上传与本地删除；
- **明暗主题**跟随宿主。

支持 `bibit`、`codex`、`claude-code`、`hermes-agent` 四个 Agent，以及 `skill`、`plugin`、`mcp`、`expert` 四类 Power；`expert` 仅支持 `bibit`。

## 构建

需要 Node **22.22.1**（见 [.nvmrc](.nvmrc)）与 Go **1.26.0**。

```bash
npm ci
npm test                # 单元测试
npm run dev             # 本地开发预览

npm run keygen          # 首次：生成开发签名 key
npm run build:plugin    # 插件 bundle

make -C provider build GOARCH=riscv64
./artifacts/provider/riscv64/bibit-agenthub --self-test
```

提交前须通过 `npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`。`.bibit-keys/` 中的私钥禁止提交；开发签名不能代替 Release 信任链。

## 部署

本仓库是正式能力中心的独立插件源码。UI 修改需从本仓库构建、签名并更新 `bibit-agenthub-plugin` 包或对应 bundle；仅同步 Bibit 宿主的 `demo-ui-v3` 分支不会更新已安装的插件。开发预览用于本地验证，不是交付给宿主的页面实现。

| 包 | 架构 | 内容 |
| --- | --- | --- |
| `bibit-agenthub-plugin` | all | 插件 bundle + capability grant |
| `bibit-agenthub-cli` | any | `/usr/libexec/bibit/bibit-agenthub` + Provider Registry |

```bash
dpkg-buildpackage -us -uc -b -a riscv64 -d
```

CLI 包通过 `/etc/bibit/external-services.d/agenthub.json` 接入宿主。Provider 协商 **Provider Protocol v1**，提供 12 个带版本号的 operation：`powers.list.v1`、`powers.inspect.v1`、`powers.install.v1`、`powers.uninstall.v1`、`powers.upgrade.v1`、`powers.custom.list.v1`、`powers.upload.v1`、`powers.delete.v1`、`settings.get.v2`、`settings.keys.add.v1`、`settings.keys.delete.v1`、`settings.keys.enable.v1`。

运行环境需要 `agent-power-manager >= 0.3.2`（deb 版本线；对应上游 0.0.4，提供 `apm upgrade` 与 `--yes`）。

## 文档

| 文档 | 内容 |
| --- | --- |
| [开发与部署指南](docs/development-and-deployment-guide.md) | 代码边界、独立开发、签名、部署与验收 |
| [CLI Provider 指南](docs/cli-provider-development-and-deployment.md) | Provider Protocol、Registry、自检 |
| [变更记录](docs/Changelog.md) | 版本变更 |
| [APC-API.md](APC-API.md) | APC 接口契约 |
| [AGENTS.md](AGENTS.md) | 开发约定 |

## 许可证

[Apache License 2.0](LICENSE)

Copyright 2026 SpacemiT (Beijing) Intelligent Technology Co., Ltd.
