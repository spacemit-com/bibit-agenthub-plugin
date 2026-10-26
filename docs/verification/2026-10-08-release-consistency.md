# 0.3.16 追加修复验证记录：providerVersion 追平 + 钉住构建用 Node

> **更正（`32ffb75`，0.4.1）**：本记录把 pin 定为 `24.16.0`，这一半是错的，§5 提的疑虑也应验了。CI 打包就跑在本文说的"板端参照"环境中，其 Node 是 **v22.22.1**（npm 9.2.0，zlib **1.3.1.zlib-ng**），于是 `24.16.0` 让打包两处失败：`npm ci` 打 `EBADENGINE`，`scripts/check-node.mjs` exit 1。pin 已降到 **22.22.1**。
>
> 另外，本文"只钉工具链，不调压缩参数"的结论仍然成立，但**只钉版本号不够**：同一个版本号覆盖两种压缩行为不同的构建 —— 上游 Node（nodejs.org / nvm）带 plain zlib，Bianbu/Debian 打包的同一版本带 zlib-ng，两者都自报 `22.22.1`，压同一份 tar 分别是 **101289** 与 **102084** 字节。因此 `check-node` 现在把**版本 + zlib 串**成对校验（版本不符是硬失败，zlib 不符给警告），CI/板端为权威运行时。详见 `docs/Changelog.md` 的 0.4.1 条目。

- 变更版本：`0.3.16`（追加修复，不单独发版；插件行为未变）
- 验证环境：amd64 开发机；系统 Node **18.19.1**（zlib 1.3）与 nvm Node **24.16.0**（zlib 1.3.1）；Go 1.26.5
- 板端参照：`bianbu@board-host`（riscv64，已装 0.3.16）
- **工具链 pin 已于 `32ffb75` 变更为 Node 22.22.1 / zlib-ng，本文的产物哈希只对 Node 24 成立**

本次修两个发布一致性问题，都不改变插件运行时行为。

## 1. 问题一：`providerVersion` 落后三个版本

`bibit.initialize` 返回的 `providerVersion` 是 `provider/internal/provider/server.go` 里的 Go 常量；deb 版本来自 `package.json`（`debian/rules` 取 `PLUGIN_VERSION`）。**此前没有任何测试或检查比较这两者。**

0.3.14 / 0.3.15 / 0.3.16 都是纯前端改动（`git diff --stat 183269f HEAD -- provider/` 为空），没人动过那一行，于是连续三版发出的 CLI 包里 Provider 自报的都是 `0.3.13`。板端 0.3.16 实测：

```json
{"jsonrpc":"2.0","id":"i","result":{"protocolVersion":1,"providerVersion":"0.3.13", ...}}
```

功能上无害（宿主只校验该字段非空，见 `external_services.rs:1007`、`actor.rs:396`），但让"CLI 包 0.3.16 / Provider 自报 0.3.13"这种组合出现在排查现场。

### 修复

| 文件 | 改动 |
| --- | --- |
| `provider/internal/provider/server.go` | `providerVersion` `0.3.13` → `0.3.16` |
| `provider/internal/provider/server_test.go` | 新增 `TestProviderVersionMatchesPackageJSON`：读 `package.json` 并断言与 `providerVersion` 相等 |
| `docs/cli-provider-development-and-deployment.md` | `bibit.initialize` 示例 `providerVersion` → `0.3.16` |

验证（amd64 产物实跑）：

```json
{"jsonrpc":"2.0","id":"i","result":{"protocolVersion":1,"providerVersion":"0.3.16","capabilities":{"invoke":true},"operations":[ ... 11 项 ... ]}}
```

riscv64 二进制内也确认含 `0.3.16`（`strings | grep -c 0.3.16` = 1）。

## 2. 问题二：bundle 字节随 Node 版本漂移

### 现象

同一次提交、同一份源码：

| 来源 | sha256 | 字节 |
| --- | --- | --- |
| deb 内 `usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz` | `916925830802c5d8d677583a542bf6d5168f5fb75388e667d4e2e8cc041a9c97` | 100635 |
| `npm run build:plugin` 产物 `artifacts/agent-hub-0.3.16.bibit-plugin.tgz` | `ab8695b4d51ba3a75d5f44fb91c3da6240c4aa12a961314e1121a9a411a90ec8` | 100451 |

### 定位

| 检查 | 结果 |
| --- | --- |
| 解压后的 tar 流 | **完全相同**（各 425984 字节，`cmp` 无差异） |
| 4 个成员文件（`plugin.json` / `plugin.sig` / `dist/plugin.js` / `dist/agent-hub.css`） | 哈希**全部相同** |
| gzip 头（前 10 字节） | 相同（`1f8b 0800 0000 0000 00ff`） |
| 压缩流差异起点 | **第 13 字节**（即 deflate 数据开头） |
| 归档条目 mtime | 两边都被 `noMtime` 归零到 1970 |

即：**相同的输入、不同的 deflate 输出**。根因是运行时的 zlib 版本——`dpkg-buildpackage` 走系统 Node **18.19.1（zlib 1.3）**，门禁 `npm run build:plugin` 走 nvm Node **24.16.0（zlib 1.3.1）**。用系统 Node 重跑同一命令，哈希精确复现 `91692583…`，确认无疑。

为排除"调压缩参数就能一致"的可能，对同一个 tar 流遍历 **level 0–9 × 5 种 strategy = 20 种组合**：

| level | strategy 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| 0 | ✗ | ✗ | ✗ | ✗ | ✗ |
| 1 | ✗ | ✗ | ✓ | ✓ | ✗ |
| 6 | ✗ | ✗ | ✓ | ✓ | ✗ |
| 9 | ✗ | ✗ | ✓ | ✓ | ✗ |

（✓ 表示跨 Node 18/24 逐字节一致）只有 `Z_HUFFMAN_ONLY`(2) 与 `Z_RLE`(3) 稳定，但代价是体积从 ~100.6KB 涨到 **235–242KB**（不提压缩），且需要改 vendored bundler 的 `tar.c({gzip:true})` 参数。因此**选择钉工具链而不是调压缩**。

### 修复

| 文件 | 内容 |
| --- | --- |
| `.nvmrc`（新） | `24.16.0`，唯一真值来源 |
| `scripts/check-node.mjs`（新） | 读 `.nvmrc` 校验 `process.versions.node`；不符时打印实际版本与 zlib 版本、给出 `nvm use` / `PATH=...` 两种修复方式，exit 1 |
| `package.json` | `check:node` 脚本；`build:plugin` 前置该检查；`engines.node: "24.16.0"` |
| `debian/rules` | `NODE` 由 `.nvmrc` 解析（nvm 路径 → `/usr/local/bin/node` → `node`）；把其 `bin` 前置到 `PATH` 后执行 `npm ci` 与 `npx bibit-plugin build`；构建前强制跑 `check-node.mjs` |
| `src/nodePin.test.ts`（新） | 3 条契约：`.nvmrc` 是精确版本、`engines.node` 与之一致、`build:plugin` 串了 `check:node` |

`debian/rules` 的关键点：仅校验解释器是不够的——`npx` 仍会用 `PATH` 里的 node。所以先算 `NODE_BIN_DIR` 再 `env PATH="$(NODE_BIN_DIR):$(PATH)"`，否则"检查通过、压缩仍用别的运行时"这个洞还在。

### 修复后核对

| 检查 | 结果 |
| --- | --- |
| deb 内 bundle | `ab8695b4d51ba3a75d5f44fb91c3da6240c4aa12a961314e1121a9a411a90ec8` |
| `npm run build:plugin` 产物 | `ab8695b4d51ba3a75d5f44fb91c3da6240c4aa12a961314e1121a9a411a90ec8` |
| 两者 `cmp` | **逐字节相同**（Node 24 / zlib 1.3.1） |
| 构建日志 | `check-node: Node 24.16.0 (zlib 1.3.1-e00f703) matches .nvmrc` |

**注意哈希变化**：`91692583…` 是 Node 18 的压缩结果，先前验证文档记的是它。deb 已用新 pin 重建，因此 0.3.16 的 bundle 哈希现为 `ab8695b4…`。旧哈希只对"用 Node 18 构建"成立，这正是本次要消除的歧义。

## 3. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test`（Node 24.16） | **547/547**（30 个文件；0.3.16 基线 544，本次 +3） |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功 |
| `npm run build:plugin` | 成功，输出 `check-node: Node 24.16.0 ... matches .nvmrc` |
| `make -C provider test vet build` | 通过（`internal/provider`、`cmd/provider-probe`） |
| `--self-test` | exit 0 |
| `gofmt -l provider/` | 无输出 |

## 4. 反向验证

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| 1 | `providerVersion` 退回 `0.3.13` | `TestProviderVersionMatchesPackageJSON` | `providerVersion "0.3.13" must equal package.json version "0.3.16"` → FAIL ✓ |
| 2 | `PATH=/usr/bin:/bin npm run build:plugin`（系统 Node 18） | `check-node` 拦截 | exit 1；并确认 `artifacts/` **未被覆盖**（仍为 `ab8695b4…`，因为检查在 bundler 之前）✓ |
| 3 | `NODE=/usr/bin/node make -f debian/rules override_dh_auto_build` | `check-node` 拦截 | `make: *** [debian/rules:49: override_dh_auto_build] Error 1` ✓ |
| 4 | `.nvmrc` 改为 `24.15.0`（与 `engines.node` 不一致） | `src/nodePin.test.ts` | `declares the same version in package.json engines` FAIL ✓ |

四项恢复后全部回到通过。

## 5. 未验证 / 限制

- **CI 未在本机复现**：`.bianbu-ci.yml` 只 include 了 `bianbu/gitlab-ci-templates` 的打包模板（本机没有该模板文件），所以"CI 打包机是否装了 Node 24"没有验证。若 CI 镜像只有 Node 18，`check-node` 会**让打包失败**并打印修复指引——这是有意为之（宁可停也不产出第二份字节），但需要在 CI 镜像里补上 Node 24，或显式传 `NODE=`。这一条需要平台侧确认。
- 板端只做了只读核对（sha256、`--self-test`、`initialize` 探针），未重装本次重建的 deb。
- `--self-test` 与 `ProviderVersion` 不校验版本串本身，一致性由新增的 Go 用例保证。
