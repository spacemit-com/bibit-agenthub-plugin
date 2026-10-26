# 0.4.4 验证记录：「全部更新」批量升级（powers.upgrade.v1）

- 变更版本：插件 0.4.4（上一版 0.4.3）
- 范围：新增 Provider operation + grant + registry 超时 + 依赖下界；前端入口、弹窗、冻结与刷新
- 平台依据：apm `upgrade` 子命令（`agent-power-manager` 0.0.3/0.0.4）、Provider Protocol v1、Host `external_services.rs`

## 1. 用户需求

> 接受可能超时的风险，在我的能力页面 Agent 选择控件左边添加全部更新/Upgrade 按钮，弹窗可选更新范围（all/bibit/codex 等）二次确认。更新期间禁用市场和设置页，不需要进度显示。控件调用 apm upgrade，点击后显示加载中动画。

已确认的决定：按钮位于 Agent 控件左侧、只在「我的能力」页；弹窗选范围 + 二次确认；升级期间禁用市场与设置；不做进度显示；接受超时风险。

## 2. 交付的 wire 契约

```text
powers.upgrade.v1
  输入  {agent:"all"|"bibit"|"codex"|"claude-code"|"hermes-agent"}
  执行  apm upgrade --agent=<scope> --yes --json
  超时  300000ms（插件请求值 = registry requestTimeoutMs = Host 上界）
  结果  {status:"exited", exitCode:<0..255>, items:[...], reason?}
        item = {agent,type,name,currentVersion,targetVersion,outcome,skip?}
```

`outcome` / `skip` 是 apm 的稳定契约（`internal/cli/upgrade_contract.go`），原样透传；`reason` 仅在 stdout 无法解析时出现，内容为净化后的 stderr 摘要。

## 3. 三条关键事实（均已核对源码）

| 事实 | 位置 | 影响 |
| --- | --- | --- |
| apm 用 `isatty(stdin)` 判断能否提问；Provider 的子进程 stdin 是管道 | `internal/cli/upgrade_prompt.go`、`apm.go` 的 `runProcess` | 必须传 `--yes`，且确认只能由插件弹窗完成 |
| Host 取 `request.timeout_ms.min(connection.request_timeout_ms)` | `bibit/src-tauri/src/external_services.rs:1895` | 插件侧与 registry 必须同为 300000，否则改一处无效 |
| 非零退出仍带完整 stdout 结果 | `internal/cli/upgrade.go`（先 render 再返回 `runtimeFailure`） | `exitCode` 与 `items` 必须一起看，不能在非零时丢弃输出 |

## 4. 并发边界的真实原因（一处更正）

方案评审时我说「升级期间禁用市场是为了避免撞 apm 全局锁」，**这是错的**。核实后：

- 市场数据走 `ReadMarket`（APC HTTP），已安装读取走本机 manifest，**都不获取 apm 的全局锁**；
- 真正的问题是 **Provider 是 managed 单进程、v1 串行处理 invoke**（`server.go` 的读循环逐个 `dispatch`，无 goroutine；平台文档 `provider-framework.md` §「初始化一次后串行处理多个 invoke」）。

因此一次长升级会把它之后的**全部**请求堵在队列里——包括 `powers.list.v1` 与 `settings.get.v2`。这些请求各自还有 30 秒读超时，于是排队最终表现为**假错误**。结论：升级期间必须**不发任何 store 请求**，这正是禁用标签页、冻结筛选/卡片/创建入口，并让窗口 focus 刷新保持被抑制的原因。

副产物：同机其它 CLI 的 apm **写**操作才会拿到 `ErrLocked`（`internal/lock/flock.go` 的 `TryLock` 非阻塞）。这是 apm 既有语义，本插件不改，仅在文档写明。

## 5. 防冲突的四道闸

| 闸 | 位置 | 作用 |
| --- | --- | --- |
| 全局单飞 `internals.locked` | `installationStore` | 升级与单条写互斥；第二次调用返回 `busy` 且不发请求 |
| `internals.active.kind === 'upgrade'` | `installationStore` | 页面据此冻结（`upgrading`）；同时挡住 focus 触发的刷新 |
| `isBusyFor` 的 upgrade 分支 | `AgentHubPage` | 每张卡片 busy → 标题按钮 disabled、详情打不开 |
| `PowerFilters.upgrading` + `changeTab` 守卫 | `PowerFilters` / `AgentHubPage` | 三个标签 disabled，且函数层再挡一次（disabled 只是 UI 层） |

## 6. 测试

| 层 | 用例 |
| --- | --- |
| Provider (`operations_test.go`) | argv 精确等值（含 `--yes`/`--json`）、`all` 与四个 Agent 通过、未知/空/多余字段拒绝、JSON 解析、**批处理失败仍保留 items**、stdout 不可解析时给净化 reason（无 ANSI、单行）、未知 outcome 透传、超时、预算不足不启动子进程、请求不一致 |
| Provider (`server_test.go` / `selftest.go`) | initialize 的 operation 清单含新 ID；selftest 驱动一次 upgrade 并断言形状且不泄露 `stdout`/`stderr` |
| `src/api/upgrade.test.ts` | 闭集结果解析、缺省 `skip`、空版本、未知 outcome、exitCode 边界、未知字段拒绝、汇总计数（含未知计为变更、`planned` 计为未变更）、请求参数与 300000 超时、非零退出不抛、超时/取消 |
| `installationStore.test.ts` | 按范围执行并重读受影响 Agent、`all` 重读四个 Agent、active 标记与清理、写中拒绝升级、升级中拒绝第二次、**超时后仍重读**、异常也释放锁 |
| `AgentHubPage.test.tsx` | 入口位置与可见范围（不在 market/settings）、打开弹窗不发请求、确认后恰好一次且参数/超时正确、范围选项与 `all`、**升级期间零新增列表请求** + 标签/卡片/关闭按钮冻结、结束后刷新并恢复交互、无更新汇总、失败计数、超时提示并要求刷新、不重复提交、`reason` 展示 |
| `PowerFilters.test.tsx` | 入口在 Agent 控件左侧同组、未接线时不渲染、`upgrading` 时标签与入口冻结且 `aria-busy`/spinner 语义正确 |
| `agentHubLayout.test.ts` | `margin-left: auto` 归属右手组而非 Agent 控件、spinner 只用 token 且 reduced-motion 分支存在 |
| `manifestGrants.test.ts` | grant 的 operation 列表含 `powers.upgrade.v1` |

**反向验证**（均按预期失败）：

| 变异 | 失败用例 |
| --- | --- |
| argv 去掉 `--yes` | `TestUpgradeArgvCarriesYesAndJSON` |
| `isBusyFor` 去掉 upgrade 分支 | 5 条批量升级用例 |
| `changeTab` 去掉守卫 | 冻结用例（配合 disabled 断言） |

## 7. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | **631/631**（31 文件，0 失败；0.4.3 时为 584） |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 通过 |
| `make -C provider test vet build` | 通过 |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |
| `npm run build:plugin` | **在板端构建**（见 §11）：本机无法运行——`.nvmrc` 钉 Bianbu Node 22.22.1（nvm 装不到的上游版本），`scripts/check-node.mjs` 对版本是硬门禁；bundle 在 CI/板端构建并记录该环境哈希 |

注：本机 Go 构建缓存默认落在只读的 `~/.cache/go-build`，验证时以 `GOCACHE=/tmp/gocache` 运行。

## 8. 已知取舍与限制

- **全量升级可能超时**（用户已知并接受）：超时后子进程被杀；若正好落在一条事务中间会留下 journal。apm 在 install/uninstall/upgrade 开头都会 `Recover`，所以下次使用自愈，必要时 `apm fix`。插件在超时后**强制重读**清单，不把「不知道」渲染成「什么都没发生」。
- **离开页面会中断升级**：unmount 会 abort 请求并杀 apm 子进程（进程组语义），与上一条同源。
- **无取消、无进度**：v1 协议固有限制。因此运行期间弹窗不可关闭，避免让用户以为已停止。
- **升级期间市场数据不可浏览**：这是冻结的直接代价，属设计选择。

## 9. 验证限制（重要：本轮未做浏览器复核）

**本轮没有完成浏览器端到端验证。** 沙箱文件策略下 Firefox 的 snap 无法启动：

```text
WARNING: cannot create user data directory: cannot update the 'current' symlink of
"$HOME/snap/firefox/current": remove $HOME/snap/firefox/current: read-only file system
internal error: cannot create XDG_RUNTIME_DIR folder "/run/user/1000/snap.firefox":
mkdir /run/user/1000/snap.firefox: read-only file system
```

`~/snap/firefox/current` 与 `/run/user/1000` 都不可写，覆盖 `HOME` / `XDG_RUNTIME_DIR` 亦无法绕过（snap 的 launcher 在沙箱外仍写这两个路径）；本机也没有 chromium 等其它浏览器。

因此：

- 界面结论（按钮位置、弹窗、spinner、冻结、汇总文案）**来自组件级用例，未经真实浏览器渲染确认**；
- 为安全起见准备了 `/tmp/stub-apm/apm` 桩程序（`list` 返回假清单、`upgrade` 返回假结果、缺 `--yes` 时拒绝），因为 dev 预览的 mock 会执行**真实** `apm upgrade`，对着真实 apm 点确认会改动本机能力；dev 预览已用该桩启动过并返回 200，但未能进入浏览器断言；
- **建议在板端/开发机补一次真机验收**，重点：弹窗实际观感、升级期间冻结是否如预期、spinner 在 WebKitGTK 下的渲染（宿主用 WebKitGTK，与 Firefox 不同）。

## 10. 相关文件

- 契约与实现：`provider/internal/provider/contracts.go`、`operations.go`、`server.go`、`config.go`、`selftest.go`
- 打包：`debian/agenthub-feature-grants.json`、`debian/agenthub-provider.json`、`debian/control`、`debian/changelog`
- 前端：`src/api/upgrade.ts`、`src/api/installationStore.ts`、`src/AgentHubPage.tsx`、`src/components/UpgradeDialog.tsx`、`src/components/PowerFilters.tsx`、`src/agentHub.css`、`src/agentHubI18n.tsx`
- Dev：`dev/store.ts`、`dev/sources.ts`、`vite.config.ts`
- 文档：`docs/Changelog.md`、`docs/development-and-deployment-guide.md`（§10.5.1）、`README.md`

## 11. 板端构建与打包（Node 22.22.1 / zlib-ng —— 与 CI 相同）

用 `git archive HEAD` 的源码在板端（`bianbu@board-host`，riscv64）构建：

| 检查 | 结果 |
| --- | --- |
| `node scripts/check-node.mjs` | `Node 22.22.1 (zlib 1.3.1.zlib-ng) matches the pinned toolchain` |
| `npm ci` | 成功，**EBADENGINE 0 条** |
| `npm test` | **631/631**，31 个文件，0 失败 |
| `npm run typecheck` / `build:dev` / `build:plugin` | 通过 |
| `make -C provider test vet build` | 通过 |
| `--self-test` / `gofmt -l provider/` | exit 0 / 无输出 |
| `dpkg-buildpackage -us -uc -b -a riscv64 -d` | 成功 |
| deb 内 bundle 与 `artifacts/` | `5b3a557b…`，**逐字节相同** |
| `bibit.initialize` 实跑 | `providerVersion: "0.4.4"`，**12 项** operation（含 `powers.upgrade.v1`） |
| grants conffile | 含 `powers.upgrade.v1`，装包时由 dpkg 静默升级（在装副本未被改动，不弹提示） |

本版 bundle：`artifacts/agent-hub-0.4.4.bibit-plugin.tgz`，sha256 `5b3a557bffeafa8fd453e2e4fec61a5a89fa2da3a235037d689ef85c6689452d`（104855 字节）。
产物：`bibit-agenthub-plugin_0.4.4_all.deb`（`92b04606…`）、`bibit-agenthub-cli_0.4.4_riscv64.deb`（`c61c85d4…`）。

## 12. 板端依赖阻塞：`--yes` 需要 apm 0.3.2，板上是 0.3.1

`debian/control` 写的是 `agent-power-manager (>= 0.0.4)`，但这个下界**在板端不成立**，因为 apm 有两条版本线：

| 来源 | deb 版本 | 上游 changelog | `apm upgrade --yes` |
| --- | --- | --- | --- |
| 板上（archive `resolute-porting`） | **0.3.1** | 0.0.3 | **✗**，实测 `unknown flag: --yes` |
| apm 仓库 tag `bianbu/0.3.2` | 0.3.2 | 0.0.4 | ✓ |

dpkg 的版本比较是 `0.3.1 >= 0.0.4` → **判定满足**，于是插件能装、`Depends` 不报错；但真正执行 `apm upgrade --yes --json` 时会在**取锁之前**因未知 flag 失败。也就是说这条依赖约束在当前版本线上**起不到保护作用**，是「装了但新功能不可用」的静默错配，与 0.3.20 / 0.4.0 那次 `--type=expert` 的错配同类。

插件侧的处理是既定的：stdout 不是预期 JSON 时，把**净化后的 stderr 句子**呈现出来，而不是渲染成空的成功列表——所以点「全部更新」会看到明确报错，其余功能（列表、详情、安装、卸载、自定义扫描）不受影响（apm 0.3.1 已接受 `--type=expert`）。

**结论：0.4.4 上板后「全部更新」要等 apm 0.3.2 一起上板才可用。** apm 0.3.2 目前只在仓库里有 tag（`bianbu/0.3.2`），archive 上还没有；打包线是 `origin/packaging/bianbu-26.04`（changelog 仍停在 0.3.1），其版本号取自 tag 名（`Sync change from bianbu/0.3.x`），所以 0.3.2 需要按该流程出包，而不是直接用仓库 HEAD 的 `debian/changelog`（那是 0.0.4，会被 dpkg 当成降级）。

## 13. 提交状态

插件 `bianbu-26.04` 分支，本记录所在提交；尚未 push。
