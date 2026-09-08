# Power Details & Installation — 验证记录（2026-09-08）

设计 commit `e218a13`；计划 `docs/superpowers/plans/2026-09-08-power-details-install.md`。

本文件只记录已执行的事实。开发阶段按用户指示使用开发签名。真实 Bibit GUI 内的 UI 闭环最初被 bi-bit 0.1.3 宿主缺陷阻塞，用 bi-bit 0.1.4 升级宿主后已完整通过，见文末。

## 实施与门禁

| 任务 | commit | 内容 |
| --- | --- | --- |
| 1 | `3cca5f5` | `powerOperations` 契约：inspect / install / uninstall + 解析器与超时 |
| 2 | `5a85718` | Go v1 Provider：`InvokeFunc(ctx, OperationRequest)`、`runMutation`/`classifyExit`、写超时预算 |
| 3 | `9ace521` | 共享安装状态 `installationStore`、`operationMessage`、catalog client installed 分支 |
| 4 | `bbf690e` | `PowerCard` 受控化 + `PowerDetailsDialog`（原生 `<dialog>`）+ 页面接线 |
| 5 | `6511356` | dev transport：`handleStoreRequest(sources)` 路由 inspect/install/uninstall，Node sources 与 Go 同 argv |
| 6 | `1aebdf3` | grant 追加 inspect/install/uninstall，Registry 超时 120000，版本 0.2.2→0.2.3 |

每个 commit 均通过前端门禁（`npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`git diff --check`）与 Go 门禁（`go test ./...`、`go vet ./...`、`go build`、`--self-test` 退出 0）。前端测试 161 → 272 全绿。

## 板端后端链路验证（bianbu@10.0.91.51，riscv64，开发签名）

- `apm` 由 `../apm` 源码交叉编译为 riscv64（`CGO_ENABLED=0 GOOS=linux GOARCH=riscv64`），部署到 `/home/bianbu/apm`。
- 伪造目标 Agent 安装状态：创建 `/home/bianbu/.bianbu-agent/`（apm 以此目录存在判定 bibit 已安装）。
- 修复缓存目录权限：`/home/bianbu/.cache` 原为 0775，apm 的安全检查拒绝 group-writable 缓存目录；`chmod 700` 后写路径可用。
- `apm` 命令循环直接验证通过（`foo-before-summary` v0.0.1，type=skill，agent=bibit）：
  - `list --installed --agent=bibit --json` 空 → 安装后含该 skill → 卸载后空；
  - `inspect`（`list foo-before-summary --installed --json --agent=bibit --type=skill`）返回单条 JSON；
  - `install foo-before-summary=v0.0.1 --agent=bibit --type=skill` 与 `uninstall foo-before-summary --agent=bibit --type=skill` 均 exit 0；
  - 输出字段 `{agent,type,name,version,description,tags}` 与前端 `parseApmInstalledList` 契约一致。
- 本计划 Go Provider 交叉编译为 riscv64（`/home/bianbu/bibit-agenthub`），以 `provider --apm-path=/home/bianbu/apm --user-home=/home/bianbu` 经 NDJSON 驱动完整链路，输出全部正确：
  - `bibit.initialize` → `protocolVersion:1`、`providerVersion:0.2.3`、operations 四枚；
  - `powers.list.v1`（installed）→ 空/含 skill/空；
  - `powers.inspect.v1` → `{listJson:"[]"}`；
  - `powers.install.v1` / `powers.uninstall.v1` → `{status:"exited", exitCode:0}`。

## 双 deb 构建与校验（开发签名）

`dpkg-buildpackage -us -uc -b -a riscv64 -d`（`-d` 跳过目标机 golang-go 版本检查，本机 Go 1.26.5 满足）：

```text
bibit-agenthub-plugin_0.2.3_all.deb     sha256 f3f77aef62f5d5cc347e71e7a164c2146e74de87310a7a8432adbc304a5a9fba
bibit-agenthub-cli_0.2.3_riscv64.deb    sha256 7db10b43e5e254e4627323df84c7c958be9d5f21036d3b44d0d4f0a73e8dba37
```

- 前端包（all）：grant `store` operations 含四枚 powers + settings，capability 仍只有 `service:store`；bundle 为开发签名 `agent-hub.bibit-plugin.tgz`。
- CLI 包（riscv64）：`/usr/libexec/bibit/bibit-agenthub`（ELF riscv64、statically linked、stripped、0755）+ Registry `requestTimeoutMs:120000`。

## 板端部署（bianbu@10.0.91.51，已取得 sudo）

- 双 deb 经 `sudo dpkg -i` 安装成功：`bibit-agenthub-plugin 0.2.3`（0.2.2→0.2.3）、`bibit-agenthub-cli 0.2.3`；`/etc/bibit/feature-capability-grants.d/agenthub.json` 与 `/etc/bibit/external-services.d/agenthub.json` 落盘。
- `apm` 安装到 `/usr/bin/apm`（0755）；`~/.cache` 已 `chmod 700`；Provider `--self-test` 退出 0。
- 重启正式 GUI `/usr/bin/bibit-gui`，`apm list --installed --agent=bibit --json` 返回 `[]`。
- 系统插件升级不会自动 bump desired：编辑 `/home/bianbu/.local/share/BiBit/data/plugins/registry.json` 将 `desired["agent-hub"]="0.2.3"` 后重启，registry 收敛为 `active/current/desired=0.2.3`、`previous=0.2.2`，GUI 日志显示 `Loaded trusted plugins: agent-hub@0.2.3`。
- 部署产物复验：`/usr/libexec/bibit/bibit-agenthub provider`（无 flags，默认 `/usr/bin/apm`、UID 解析 `/home/bianbu`）经 NDJSON 全链路通过 —— `bibit.initialize` 返回 `protocolVersion:1/providerVersion:0.2.3` 与四枚 operation；`powers.list.v1`(installed) 空→含 `foo-before-summary v0.0.1`→空；`powers.install.v1`/`powers.uninstall.v1` 均 `{status:"exited", exitCode:0}`；`powers.inspect.v1` 返回单条 `{agent,type,name,version,description,tags}`。版本字段按契约须带 `v` 前缀（`v0.0.1`），无前缀被正确拒绝为 `Invalid params`。

## 剩余阻塞（bi-bit 0.1.3）：Bibit 宿主多 surface 轮换 feature instance token

market 页面仍显示 `Power catalog authorization is required`（原生日志 `external_service.request_unauthorized feature=agent-hub version=0.2.3 service=store operation=powers.list.v1`）。根因不在插件，而在板端 Bibit 宿主（bi-bit 0.1.3）：

- 板端进程启动两个 webview surface：`surface-diag` 日志为 `window=main surface=main` 与 `window=voice-overlay surface=voice-overlay`。
- `web-app/src/main.tsx` 的 `boot()` 仅对 `voice-ball` 提前返回，`voice-overlay` 与 `main` 一样执行 `loadTrustedPluginEntries()` → `trusted_plugin_prepare_active`。
- 原生 `trusted_plugin_prepare_active`（`src-tauri/src/trusted_plugins.rs`）末尾对每个插件 `attach_feature_instance(plugin, true)`（`force_rotate=true`），每次调用都生成新 token 覆盖旧 binding；`trusted_plugin_bootstrap` 才带 `ensure_main_surface`（`voice-overlay` 报 `plugin access is restricted to the main window`）。
- 时序：main 先 `prepare_active`（token T1）并 bootstrap 成功取得 T1 → voice-overlay 再 `prepare_active` 轮换为 T2 → main 插件持 T1 失效，后续 `validate_feature_instance_version_capability` 的 `binding.token != token` 判定 false，从而 `request_unauthorized`。
- drop-in grant 本身已正确合并：前端 grant 检查放行（请求到达原生），原生 `feature_capability_grants_list` 与授权用同一 `runtime_grants()`，`powers.list.v1` 在合并集合内；失败点在 token 校验而非 grant。
- 决定性证据：设置页（Integrations → Agent Hub settings）加载 `settings.get.v1` —— 该 operation 同时存在于编译期 grant 与 drop-in grant，仍报 `external_service.request_unauthorized feature=agent-hub version=0.2.3 service=store operation=settings.get.v1`，设置页显示 `Could not load`。证明任何 operation（含编译期内置）都因 token 校验失败而被拒，与 grant 无关。
- Settings → Extensions 页确认插件已激活（`Agent Hub v0.2.3`），仅有 `Roll back` / `Deactivate` 动作，无重投 token 的入口；bootstrap 只在 webview 启动时消费一次 token，重启必然再次被 voice-overlay 的 `prepare_active` 轮换。

宿主修复建议（Bibit 侧，非本插件）：`main.tsx` 仅在 `surface === 'main'` 时 `loadTrustedPluginEntries()`；或原生 `trusted_plugin_prepare_active` 增加 `ensure_main_surface` 门禁。详细根因与修复建议见 `docs/verification/2026-09-08-bibit-host-token-rotation.md`。

## 阻塞解决与真实 GUI 闭环验证（bi-bit 0.1.4）

用户提供新版宿主 `~/Downloads/bi-bit_0.1.4_riscv64.deb`（riscv64，sha256 `4b2e81b4f89c1e326f04f68ca099a4f3862701d8cd64d4f72f32a4e0142f3125`）。部署步骤与证据：

1. `scp` 到板端 `/tmp/`，sha256 校验一致；`sudo dpkg -i` 升级 `bi-bit` 0.1.3→0.1.4（`/usr/bin/bibit-gui` 由 111182384 → 113676848 字节）。升级前已备份 0.1.3 的 `/usr/bin/bibit-gui` 与 `/usr/bin/bibit` 到 `/home/bianbu/bibit-backup-0.1.3/`。
2. 重启 GUI，日志证据表明 token 轮换缺陷消除：
   - 0.1.3 为两条 `Loaded trusted plugins: agent-hub@0.2.3` + 一条 `Failed to bootstrap … restricted to the main window`；
   - 0.1.4 仅一条 `Loaded trusted plugins: agent-hub@0.2.3`，无 `restricted to the main window`，无任何 `request_unauthorized`；
   - `external_service.provider_ready service=store provider=0.2.3 protocol=1 jobs=false cancellation=false operations=4` 正常出现（说明 `voice-overlay` 不再轮换主窗口 token，或原生 `prepare_active` 已加门禁）。
3. market 页加载成功（不再是 authorization 报错），展示 APC 目录（code-helper / code-review-helper / code-test-helper / foo-before-summary 等，类型筛选与 tags 面板正常）。
4. UI 闭环 A/B（market 详情→安装→installed→卸载→恢复）全流程在真实 GUI 内通过，每步用 `apm list --installed --agent=bibit --json` 交叉核对：
   - 打开 `foo-before-summary` 详情弹窗 → 显示「未安装」+「安装」按钮；
   - 点击「安装」→ 弹窗显示「已安装 v0.0.1 / 安装完成」+「卸载」按钮；`apm list --installed --agent=bibit` 返回该 skill（`{agent:bibit,type:skill,name:foo-before-summary,version:v0.0.1,description:…,tags:["lff"]}`）；
   - 切到「我的 Power」→ 卡片出现，含「卸载」按钮；
   - 点击「卸载」→ installed 清空（`[]`），列表显示「No Powers are available」；
   - 切回「Power 市场」→ 详情弹窗恢复「未安装」+「安装」按钮，并显示「卸载完成」提示。

因此真实 Bibit GUI 内的完整安装/卸载 UI 闭环已在 bi-bit 0.1.4 上验收通过，插件无需改动。
