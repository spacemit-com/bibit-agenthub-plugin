<div align="center">

# Bibit Agent Hub

**Browse, install and manage AI Agent capabilities inside Bibit**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

[English](README.md) | [简体中文](README_zh.md)

</div>

## Overview

Agent Hub is the capability center of Bibit. It consists of two parts:

- **Frontend plugin** (TypeScript / React): the "Capabilities" page in Bibit's main sidebar;
- **CLI Provider** (Go, standard library only): reaches the host through `service:store` and performs install, uninstall and upload.

## Features

| Tab | Content |
| --- | --- |
| My Capabilities | Installed list: APM-managed resources plus hand-installed custom ones (marked `Custom`) |
| Capability Market | Browses the full APC catalog; cards are marked `Installed`, with `New` when a higher version exists |
| Settings | APC API key list: masked (`head****tail`), each key enabled / deleted individually |

- **Update all**: reconciles every installed capability on the machine with a single `apm upgrade`;
- **Details dialog**: pick a version, then `Install` / `Update` / `Downgrade` / `Uninstall`; writes ask for confirmation;
- **Custom resources**: scans each Agent's directories and lists them, with APC upload and local delete;
- **Light and dark themes** follow the host.

Supports the `bibit`, `codex`, `claude-code` and `hermes-agent` Agents, and the `skill`, `plugin`, `mcp` and `expert` Power types; `expert` is available for `bibit` only.

## Build

Requires Node **22.22.1** (see [.nvmrc](.nvmrc)) and Go **1.26.0**.

```bash
npm ci
npm test                # unit tests
npm run dev             # local dev preview

npm run keygen          # first time only: generate the development signing key
npm run build:plugin    # plugin bundle

make -C provider build GOARCH=riscv64
./artifacts/provider/riscv64/bibit-agenthub --self-test
```

Before committing, `npm test`, `npm run typecheck`, `npm run build:dev` and `npm run build:plugin` must all pass. Never commit the private key under `.bibit-keys/`; a development signature is not a substitute for the Release trust chain.

## Deploy

| Package | Architecture | Contents |
| --- | --- | --- |
| `bibit-agenthub-plugin` | all | plugin bundle + capability grant |
| `bibit-agenthub-cli` | any | `/usr/libexec/bibit/bibit-agenthub` + Provider Registry |

```bash
dpkg-buildpackage -us -uc -b -a riscv64 -d
```

The CLI package reaches the host through `/etc/bibit/external-services.d/agenthub.json`. The Provider speaks **Provider Protocol v1** and exposes 12 versioned operations: `powers.list.v1`, `powers.inspect.v1`, `powers.install.v1`, `powers.uninstall.v1`, `powers.upgrade.v1`, `powers.custom.list.v1`, `powers.upload.v1`, `powers.delete.v1`, `settings.get.v2`, `settings.keys.add.v1`, `settings.keys.delete.v1`, `settings.keys.enable.v1`.

The runtime requires `agent-power-manager >= 0.3.2` (the deb version line, upstream 0.0.4), which provides `apm upgrade` and `--yes`.

## Documentation

The guides are maintained in Chinese.

| Document | Contents |
| --- | --- |
| [Development and deployment guide](docs/development-and-deployment-guide.md) | Code boundaries, standalone development, signing, deployment, acceptance |
| [CLI Provider guide](docs/cli-provider-development-and-deployment.md) | Provider Protocol, Registry, self-test |
| [Changelog](docs/Changelog.md) | Release history |
| [APC-API.md](APC-API.md) | APC service contract |
| [AGENTS.md](AGENTS.md) | Development conventions |

## License

[Apache License 2.0](LICENSE)

Copyright 2026 SpacemiT (Beijing) Intelligent Technology Co., Ltd.
