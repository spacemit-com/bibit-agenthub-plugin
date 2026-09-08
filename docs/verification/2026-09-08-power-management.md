# Power Details & Installation — 验证记录（2026-09-08）

设计 commit `e218a13`；计划 `docs/superpowers/plans/2026-09-08-power-details-install.md`。

本文件只记录已执行的事实；真实 Bibit 闭环验收尚未完成，见文末阻塞项。

## 实施与门禁

| 任务 | commit | 内容 |
| --- | --- | --- |
| 1 | `3cca5f5` | `powerOperations` 契约：inspect / install / uninstall + 解析器与超时 |
| 2 | `5a85718` | Go v1 Provider：`InvokeFunc(ctx, OperationRequest)`、`runMutation`/`classifyExit`、写超时预算 |
| 3 | `9ace521` | 共享安装状态 `installationStore`、`operationMessage`、catalog client installed 分支 |
| 4 | `bbf690e` | `PowerCard` 受控化 + `PowerDetailsDialog`（原生 `<dialog>`）+ 页面接线 |
| 5 | `6511356` | dev transport：`handleStoreRequest(sources)` 路由 inspect/install/uninstall，Node sources 与 Go 同 argv |
| 6 | `1aebdf3` | grant 追加 inspect/install/uninstall，Registry 超时 120000，版本 0.2.2→0.2.3 |

每个 commit 均通过前端门禁（`npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`git diff --check`）与 Go 门禁（`go test ./...`、`go vet ./...`、`go build`、`--self-test` 退出 0）。

前端测试 161 → 272，全绿；`build:plugin` 产出开发签名 `artifacts/agent-hub-0.2.3.bibit-plugin.tgz`。

> 已知间歇性抖动：`src/components/PowerFilters.test.tsx` 的「opens the Agent menu with ArrowDown and restores focus with Escape」在并行全量下偶发一次失败（rAF/focus 时序），单独运行与重跑均通过，非本改动引入（该组件与测试未在本计划中修改）。

## 板端只读基线（bianbu@10.0.91.51，riscv64）

- 已安装 `bibit-agenthub-plugin 0.2.2 (all)`、`bibit-agenthub-cli 0.2.2 (riscv64)`。
- 运行中：`/usr/bin/bibit-gui`、`/usr/libexec/bibit/bibit-agenthub provider`。
- Registry override：`/etc/bibit/external-services.d/agenthub.json`（`requestTimeoutMs: 30000`）。
- `apm` 不在 PATH（`command -v apm` 无结果）。

## 阻塞项（真实闭环未执行）

1. **正式签名 bundle 缺失**：`debian/vendor/` 仅有 README；`artifacts/` 只有开发签名 0.2.3 与上一版正式签名 0.2.2。公司签名服务的命令/API/审批由签名服务维护者提供，不在本仓库契约内；开发私钥不能替代 Release 信任链。缺少「0.2.3 正式签名 bundle + SHA-256 + key ID + 目标 Bibit 公钥登记」时，`dpkg-buildpackage` 与板端安装均阻塞。
2. **板端无 `apm`**：inspect / install / uninstall 依赖 Agent 自身 CLI；当前板无 `apm`，即便部署 0.2.3，写操作也会降级为 `unavailable`，无法完成 UI 闭环 A/B 与「已卸载/已安装」状态确认。

## 结论

Tasks 1–6 实现与门禁全部通过；Task 7（真实 Bibit 验收）因上述两项外部依赖阻塞，UI 闭环未验收，不宣称 Bibit 中可用。待获得正式签名 bundle 并在目标 Agent 提供 `apm` 后，方可继续板端安装、UI 闭环与文档/Changelog 交付。
