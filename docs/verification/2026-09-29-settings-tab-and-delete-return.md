# 0.3.6 验证记录：删除后回到 Hub 列表 + APC 凭据并入页面「设置」标签页

- 变更版本：0.3.6（上一版 0.3.4）
- 验证环境：amd64 开发机；Node 24.16（Vitest）、Node 18.19（系统 node，附注）、Go 1.26.5
- 相关提交：待提交（工作区未提交，见文末「提交状态」）

## 1. 用户反馈与需求

> 能正常显示自定义资源并执行上传和删除。但删除后仍停留在已被删除资源的弹窗，应该回到 Hub 页面。
> 另外删除 Agenthub 设置页面。APC API KEY 的配置改到 Agenthub 页面和我的 Power、Power 市场一级，添加设置/Setting 标签页。

确认过的边界：

| 决策点 | 选择 |
| --- | --- |
| 设置标签页显示哪些字段 | **只放 APC API Key**。`showExperimental` / `refreshMinutes` 无消费方，DTO 与 Provider 不变，面板读取后原样回填、不再渲染控件 |
| 删除成功后的反馈 | **只关弹窗、不加提示**（列表刷新与卡片消失本身即反馈） |
| 删除失败 | 弹窗保持打开并显示原因 |
| Provider | 不改：9 个 operation、Registry `credentialParameters`、capability grant 全部保持 |

## 2. 实现要点

- **删除成功回到列表**：`AgentHubPage.runCustomAction` 新增 `options.closeOnSuccess`。成功且带该选项时：清掉该资源的 custom notice、`setPage(1)`、`closeDetails()`，不写 notice；失败路径不变。`closeDetails` 改为 `useCallback(…, [])` 并进入依赖。
- **删除独立设置页**：`bibit.feature.json` 的 `contributions.settings` 置为 `[]`（宿主 Schema 要求该键存在），`feature.tsx` 去掉 `settings` 键与 import，删除 `src/AgentHubSettingsPage.tsx` 及其测试，`agentHubLocales` 去掉只服务于该导航的 `settings` 键。
- **页面「设置」标签页**：`PowerFilters` 导出 `PowerTab = PowerScope | 'settings'`，props 由 `scope/onScopeChange` 改为 `tab/onTabChange`，设置标签下不渲染 Type/Tags 面板；`AgentHubPage` 新增 `tab` 状态与 `changeTab`，载入 effect 在设置标签下提前返回（不发 `powers.list.v1`）；新增 `src/components/AgentHubSettingsPanel.tsx` 承载 APC 凭据表单。
- 随带的文案调整：`APC API Key is not configured; set it in the Settings tab.`（原指向已删除的设置页）。

## 3. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test`（Node 24.16） | 456/456（25 个文件；0.3.4 基线 448） |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功（`dist/assets/index-BgUsIkd8.js`，253.81 kB / gzip 80.04 kB） |
| `npm run build:plugin` | 成功，产物 `artifacts/agent-hub-0.3.6.bibit-plugin.tgz`，sha256 `93b8fd5b8437ae1e81725c706230e7ada776eb7bb53609270f1da78ad526f91c`（96373 字节） |
| `make -C provider test vet build` | 通过（`internal/provider`、`cmd/provider-probe`；`go vet` 无输出） |
| `--self-test` | exit 0 |
| `gofmt -l provider/` | 无输出 |
| Node 18.19（系统 node） | 453/456：3 项失败为 0.3.2 基线同样存在的 `dev/sources.test.ts` `readMarket`（与本次改动无关） |

### 产物内容核对（解包 0.3.6 bundle）

```text
version: 0.3.6
pages:    [{ id: home, path: "", surfaces: [main], navigation: {group: library, order: 100} }]
settings: []
locales:  [en, zh-CN]
```

- `agent-hub-settings-panel` 出现在 `dist/plugin.js`；旧的裸类名 `.agent-hub-settings` 不再单独出现。
- 已删除字段的文案（`Experimental Agents`、`Catalog refresh`、`CATALOG PREFERENCES`）在 bundle 中出现 0 次。
- 仍保留的 `Agent Hub settings` 只出现在两条状态文案里：`Could not load Agent Hub settings.` / `Could not save Agent Hub settings.`。

## 4. 反向验证

每一项单独还原/变异后，对应用例必须失败；随后恢复并重跑确认通过。

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| 1 | 删除成功不再关弹窗（`succeeded && closeOnSuccess` → `false && …`） | `AgentHubPage` 删除用例 | 1 failed / 52 passed ✓ |
| 2 | 设置标签也发 `powers.list.v1`（去掉 effect 的提前 return） | 设置标签用例 | 1 failed / 52 passed ✓ |
| 3 | 设置标签仍渲染 Type/Tags 面板 | `PowerFilters` 设置标签用例 | 1 failed / 9 passed ✓ |
| 4 | Manifest 重新声明 settings contribution | `feature.test.ts` | 套件在导入期失败：`Feature plugin renderer is missing: settings.settings`（`registerFeaturePlugin` 抛错），0 个用例执行 ✓ |
| 5 | 未编辑输入框也发送 `apiKey`（`apiKeyDirty` 语义失效） | 面板 `apiKeyDirty` 用例 | 1 failed / 11 passed ✓ |
| 6 | 面板 CSS 加 `overflow-y: auto; height: 60vh` | `agentHubLayout` 滚动容器用例 | 1 failed / 9 passed ✓ |
| 7 | 删除失败也关弹窗 | `AgentHubPage` 删除失败用例 | 1 failed / 52 passed ✓ |
| 8 | 保存按钮去掉 `saving` 禁用绑定 | 面板防重复提交用例 | 1 failed / 11 passed ✓ |

### 反向验证中修正的两处

- **第 6 项第一次没生效**：变异脚本按 `background + box-shadow` 两行匹配，而这两行同样出现在更早的 `.power-filters__panel`（109 行）里，`replace(..., 1)` 打到了那条规则。改为匹配 `background + box-shadow + color` 三行（只存在于 `.agent-hub-settings-panel`，382 行）后如期失败。
- **第 8 项暴露了一处测试错位**：先尝试去掉 `save()` 里的 `savingRef.current` 守卫，用例仍全绿。实测（同一 tick 内两次 `fireEvent.click`）确认只有 1 次 `settings.update.v1`——React 18 对离散事件同步 flush，第二次点击时按钮已 `disabled`。也就是说，**从 DOM 层面真正生效的是按钮的 `disabled={saving || …}` 绑定**，`savingRef` 是同 tick 派发的纵深防御、当前无法从 DOM 触达。因此把该项反向验证改为验证「按钮的 `saving` 禁用绑定」（第 8 行），确认失败；`savingRef` 保留但不再声称被该用例覆盖。

## 5. 打包与产物核对（riscv64 deb）

```bash
make -C provider build GOARCH=riscv64
dpkg-buildpackage -us -uc -b -a riscv64 -d
```

| 产物 | sha256 | 说明 |
| --- | --- | --- |
| `bibit-agenthub-plugin_0.3.6_all.deb` | `af4da9478066ef006e86eeaad115d75a973fe7e704830f521919b884bdcb1396` | `Depends: bibit-agenthub-cli (= 0.3.6), agent-power-manager` |
| `bibit-agenthub-cli_0.3.6_riscv64.deb` | `d0a053f52d63c8a709febe1abe7c105cc19b44770845f035ab31f75346f52a6a` | `Architecture: riscv64` |

解包核对：

- Provider 二进制（deb 内）sha256 `8bdf9e16fd61ee2c834213c2fd9967316ba6de57ba4f610feb78917318150963`，`strings` 含 `powers.custom.list.v1`，且内嵌版本串为 `0.3.6`。
- 插件 deb 内的 bundle sha256 `26f04878d683b02e2cce0de79544301e15da8549d50a321281a03dc828849f7f`（96470 字节）；其 manifest 为 `version 0.3.6`、`settings: []`、`pages: [home]`。
- bundle 内出现 `agent-hub-settings-panel`；`Experimental Agents` / `Catalog refresh` / `CATALOG PREFERENCES` 均为 0 次。
- Registry drop-in 保留 `credentialParameters.settings.update.v1 = [apiKey]`；capability grant 仍声明 9 个 operation（未改动）。

注意：`dpkg-buildpackage` 会重新执行 `bibit-plugin build`，因此 deb 内 bundle 的字节与 `artifacts/agent-hub-0.3.6.bibit-plugin.tgz`（sha256 `93b8fd5b…`）不同（gzip 产物非逐字节可复现），以 deb 内为准。

## 6. 未执行 / 未验证

- **板端未安装验证**：本记录只覆盖本机门禁与真实 bundle 产物核对；riscv64 交叉构建、两个 deb 上板、真实 GUI 中的三标签、设置标签保存/清除、删除后回到列表、Bibit 设置子菜单条目消失均未执行（安装命令见交付说明）。
- **真实 APC 提交**：仍需有效 Key；此前 0.3.4 只跑到用假 Key 被 APC 拒绝 401。
- **宿主缓存旧 manifest 的收敛**：源码层面已核对空 settings 数组在 `registry.ts`、`trustedPluginLoader`、SDK `registerGroup` 上均为 no-op；板端仍以「重启 GUI 后设置子菜单条目消失」作为验收项。

## 7. 提交状态

本次改动在验证时仍未提交（`git status` 显示 12 个修改 + 2 个新增 + 2 个删除）。`APC-API.md` 的改动是 2026-09-09 遗留的无关重排，未纳入本次工作。
