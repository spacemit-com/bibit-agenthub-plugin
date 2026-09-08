# Power Details & Installation — 验证记录（2026-09-08）

设计 commit `e218a13`；计划 `docs/superpowers/plans/2026-09-08-power-details-install.md`。

本文件只记录已执行的事实。开发阶段按用户指示使用开发签名，真实 Bibit GUI 内的 UI 闭环尚未完成，见文末剩余项。

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

## 剩余项（阻塞 GUI 内 UI 闭环）

后端链路已在本机/板端验证，但以下板端部署步骤需要 root（`sudo -n` 提示需交互密码，`ssh root` 被拒）：

1. `dpkg -i` 安装两个 0.2.3 deb（写入 `/usr/lib/bibit/plugins`、`/usr/libexec/bibit`、`/etc/bibit/…`）；
2. 将 `apm` 放到 Provider 默认路径 `/usr/bin/apm`（或在 Registry args 追加 `--apm-path`）；
3. 重启唯一正式 Bibit GUI（`/usr/bin/bibit-gui`，非 systemd 单元，PPID 为 init）。

因此 UI 闭环 A/B（market 详情→安装→installed→卸载→恢复）尚未在 Bibit GUI 内执行，不宣称 Bibit 中可用。待获得板端 root/sudo 后即可完成上述部署与 UI 闭环，并补 `docs/Changelog.md` 完成记录。
