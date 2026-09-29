# 0.3.7 验证记录：卸载二次确认 + 确认后回到 Hub 列表

- 变更版本：0.3.7（上一版 0.3.6）
- 验证环境：amd64 开发机；Node 24.16（Vitest）；Go 1.26.5
- 相关提交：见文末「提交状态」

## 1. 用户需求

> 我的power中卡片点击卸载后像自定义卡片删除一样有二次确认，确认卸载后也直接返回hub页面，而不是停留在卡片。

## 2. 实现要点

| 层 | 改动 |
| --- | --- |
| `src/api/operationMessages.ts` | 抽出共享内部判定 `mutationOutcome`，新增导出 `isRemovalConfirmed(intent, execution, actual)`；结论文案与关闭决策共用同一份证据（意图、退出码、对账后的清单），杜绝两处规则漂移 |
| `src/api/installationStore.ts` | `InstallationSnapshot.confirmedRemovals`；`reconcile` 按 `isRemovalConfirmed` 记录，`execute` 开始与 `invalidateAgent` 清除该键旧结论 |
| `src/components/PowerDetailsDialog.tsx` | `confirmingUninstall` 本地状态；卸载两段式（展开确认 → `Confirm uninstall`），复用自定义删除确认的 `role="alertdialog"` 与类名；`series`/`agent` 变化时复位弹窗临时状态 |
| `src/AgentHubPage.tsx` | 写操作结束的 effect 在 `confirmedRemovals` 命中当前弹窗目标时 `closeDetails()` |
| `src/agentHubI18n.tsx` | `Uninstall this Power?` / `Removes {type} "{name}" for {agent}.` / `Confirm uninstall` |

判定语义：

- `isRemovalConfirmed` 为真 = `kind:'uninstall'` 且对账后清单里**没有**该目标（退出码 0 或非零皆可）。非零退出但对账已无该资源时按成功处理：apm 报错但用户要的事实已达成，停留弹窗只会挡住重装入口。
- 为假的情形：仍安装着某个版本、平台错误（对账未执行）、对账返回 `undefined`。这些情况弹窗保留并显示原因。
- 安装永不满足该判定（资源仍在磁盘上），弹窗保留。

## 3. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test`（Node 24.16） | 475/475（25 个文件；0.3.6 基线 459，本次 +16） |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功（`dist/assets/index-ugGN8ieT.js`，255.34 kB / gzip 80.35 kB） |
| `npm run build:plugin` | 成功，`artifacts/agent-hub-0.3.7.bibit-plugin.tgz` |
| `make -C provider test vet build` | 通过（`go vet` 无输出；Provider 用例数与 0.3.6 相同，本次未改 Go） |
| `--self-test` | exit 0 |
| `gofmt -l provider/` | 无输出 |

## 4. 反向验证

每一项单独变异后，对应用例必须失败；随后恢复并重跑确认通过。

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| 1 | 卸载按钮直接调 `onUninstall`（取消两段式） | 弹窗确认用例 | 5 failed ✓ |
| 2 | 「取消」也调用 `onUninstall` | 取消用例 | 1 failed ✓ |
| 3 | 切换 Power 时不复位确认态（`useEffect` 依赖改空） | 复位用例 | 1 failed ✓（见下方修正） |
| 4 | 页面「卸载一结束就关弹窗」（不看 `confirmedRemovals`） | 卸载失败保留弹窗用例 | 2 failed ✓ |
| 5 | `isRemovalConfirmed` 对"非零退出但已移除"返回 false | `operationMessages` 一致性用例 | 2 failed ✓ |
| 6 | 安装也走关闭分支 | 安装保留弹窗用例 | 2 failed ✓ |
| 7 | store 不再记录 `confirmedRemovals` | store 用例 | 2 failed ✓ |

### 反向验证中修正的一处

第 3 项首次变异后**用例仍然全绿**：原用例把新资源设成「未安装」，于是 footer 整体消失，`Uninstall this Power?` 自然查不到——断言的是 footer 消失，不是确认态复位。改为让新 Power **仍有 footer**（已安装且带记录），显式断言 `Uninstall this Power?` 与 `Confirm uninstall` 均不存在、而新的 `Uninstall` 按钮存在且未武装；再变异后如期失败。

## 5. 未执行 / 未验证

- **板端未安装验证**：riscv64 交叉构建、两个 deb 上板、真实 GUI 中的卸载确认与自动返回、安装不确认且保留弹窗，均未执行。
- **真实 `apm uninstall`**：需要板上存在一条可卸载的真实 Power；失败分支用非零退出 + 清单仍含目标的夹具覆盖，未在生产 apm 上制造失败。
- 卸载成功后不再显示 `Uninstall complete.`（弹窗已关闭）；列表刷新、卡片消失即反馈，与自定义资源删除的处理一致。

## 6. 打包与产物核对（riscv64 deb）

```bash
make -C provider build GOARCH=riscv64
dpkg-buildpackage -us -uc -b -a riscv64 -d
```

| 产物 | sha256 | 说明 |
| --- | --- | --- |
| `bibit-agenthub-plugin_0.3.7_all.deb` | `5ca78164091ca06f35955cac246f9ed177bad5e4bf1fab33e15a8fb59cd169e6` | `Depends: bibit-agenthub-cli (= 0.3.7), agent-power-manager`，101882 字节 |
| `bibit-agenthub-cli_0.3.7_riscv64.deb` | `a859b96349bab6c6706f88c4d05ae72308ec3020036dce2375b42fb734e713f8` | `Architecture: riscv64`，2266166 字节 |

deb 内 payload 核对：

- 插件 deb 内 bundle sha256 `47e370e481f357ae9060020c13a855ca31e406b7bd81e2b259716ee3f8a4dc31`；manifest `version 0.3.7`、`contributions.settings` 仍为空数组。
- bundle 内含新增文案 `Uninstall this Power?`（3 处源串 + 词典）与 `Confirm uninstall`（2 处）。
- Provider 二进制（deb 内）sha256 `4406e7409a3ede1bd60eb54318897532c3c6f8709806fde7af57bca1396b242d`，内嵌版本串 `0.3.7`；本次未改 Go 代码，只有版本号变化。

## 7. 提交状态

待提交；`APC-API.md` 的工作区改动与本功能无关，不纳入。
