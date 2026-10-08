# 0.3.19 验证记录：卡片固定显示最新版本，详情页按版本给出安装/更新/降级/卸载

- 变更版本：0.3.19（上一版 0.3.18「市场卡片按安装清单显示 Installed 徽标」）
- 验证环境：amd64 开发机；**Node 24.16.0**（`.nvmrc` 钉住的版本，`npm run build:plugin` 会先跑 `scripts/check-node.mjs`）
- 相关提交：见文末「提交状态」

## 1. 用户需求

> 取消卡片上的版本选择，固定展示最新的版本信息。进入详情页默认展示最新版本。
> 详情页的版本选项在安装后不再固定，详情页控件根据版本号改为更新（高版本）/卸载（已安装版本）/降级（低版本）/安装（未安装）
> 详情页版本选项文本需标记已安装版本。
> 当存在新版本时，在卡片的已安装徽标左侧新增 new 徽标

## 2. 现状

- 卡片渲染原生 `<select>`（`PowerCard.tsx:57-76`），页面用 `selectedVersions: Map<(type,name)→version>` 同时喂卡片与弹窗。
- 弹窗的选择器 `disabled={targetLocked}`，`targetLocked = busy || isInstalled || readOnly`——**一装上就锁死**，于是已安装的 Power 只剩「卸载」一个动作（`PowerDetailsDialog.tsx:120-123`、`346-394`）。
- `contracts.ts` 与 `apm.ts` 各有一个私有版本比较器（一个升序、一个降序）。
- `installationStore.execute` 的 install 预检用 `isInstalledAtVersion`（比版本），所以换版本本来就会被放行——挡住它的是 UI 的 `isInstalled`。

## 3. 已确认的两个决定

| 问题 | 选择 |
| --- | --- |
| 「我的能力」页的弹窗 | **保持只读**（选择器禁用、只能卸载）——那个 scope 的系列版本来自安装清单，本来没有可选的更新/降级目标 |
| 更新/降级的确认 | **要二次确认**（复用卸载那套内联确认） |

## 4. 实现

1. **比较器收口**：导出 `comparePowerVersions`（升序、`''` 最旧、非规范值退化为字符串比较而不抛异常），`apm.ts` 的降序由它取反，`contracts.ts` 里原来那个升序私有函数改为它的别名。
2. **卡片**：去掉 `selectedVersion` / `onVersionChange` 与 `<select>`，版本槽恒为 `series.versions[0]` 的静态标签；新增 `hasNewer`，在 `Installed` **之前**渲染 `New`（且以 `installed` 为前提）。
3. **弹窗**：选项 = 系列版本 ∪ 已安装版本（降序、标记已安装那项）；`disabled={busy || readOnly}`；`action` 由 `comparePowerVersions(selectedVersion, installedVersion)` 决定；`install` 直连，`update`/`downgrade`/`uninstall` 走内联确认；`useEffect(..., [action])` 在动作变化时清掉确认。
4. **页面**：`dialogVersion` 取代 `selectedVersions`（`openDetails` 设为最新版本）；`installedVersions: Map<key, 最新已安装版本>` 取代 `installedKeys`，据此同时算 `installed` 与 `hasNewer`。
5. **CSS**：`.power-card__version` 合并原 `--static` 的布局（删除该修饰类），自定义外观移到 `.power-card[data-source='custom'] .power-card__version`；`margin-left: auto` 从徽标移到 `.power-card__type`；新增 `.power-card__badge--new` 与 `--hub-new*` token。

## 5. 门禁结果（Node 24.16.0）

| 检查 | 结果 |
| --- | --- |
| `npm test` | **568/568**，30 个文件，0 失败 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功 |
| `npm run build:plugin` | 成功，`check-node: Node 24.16.0 (zlib 1.3.1-e00f703) matches .nvmrc`；`artifacts/agent-hub-0.3.19.bibit-plugin.tgz`，sha256 `f46666943d5b85b4ad3fe9470a9ab2d3c7ab693d0c9891deb271936cd06c55a8`（101128 字节） |
| `make -C provider test vet build` | 通过（含 `TestProviderVersionMatchesPackageJSON`，`providerVersion` 已同步为 0.3.19） |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |

用例数：558 → 568（+1 `contracts`、+4 `PowerDetailsDialog`、+3 `AgentHubPage`、+2 `agentHubLayout`、`PowerCard` 净 +0：删 2 加 2）。

## 6. 反向验证（变异测试）

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| A | 把 `isInstalled` 加回选择器的 `disabled`（复现「装上就锁」） | 「offers Uninstall …」 | 1 failed ✓ |
| B | 不再把已安装版本并进选项 | 「keeps the installed version selectable …」 | 1 failed ✓ |
| C | 把 `New` 徽标放到 `Installed` 之后 | 卡片 DOM 顺序用例 + 页面 New 用例 | 2 failed ✓ |
| D | 让更新/降级跳过确认直接执行 | 弹窗确认流程用例 + 页面更新用例 | 2 failed ✓ |

## 7. 既有测试的影响

- `PowerCard`：8 处涉及 `<select>` 的断言改写或删除。**删除的两条**是「受控版本切换」与「选中版本失效时回退」——卡片已无选择功能；原「V1 版本无 `description_zh` 时回退」改为用「最新版本即那个 V1」的系列来保住这条覆盖。`does not open details when the version select is clicked` 反转为「版本槽是纯文本，点它等同点卡片」。
- `PowerDetailsDialog`：原本以 `selectedVersion: 'v2.0.0'`（默认）+ 已安装 v1 触发「卸载」的用例，语义已经变成「更新」，因此这些**卸载流程**用例补上 `selectedVersion: 'v1.0.0'`；`shows the installed version with uninstall only and disables the version select` 重写为一组版本感知用例。两处 rerender 块原先漏传 `selectedVersion` 会退回默认值，导致动作变成「更新」、确认被清掉——这正好也验证了「动作变化即清确认」。
- 页面：`shares the selected version between the card and the details dialog` 改写为「卡片恒显示最新版本，选择只发生在弹窗内」；自定义资源「页面上只有一个版本选择器」改为「没有任何卡片有版本选择器（包括自定义）」。
- `agentHubLayout`：版本槽契约从 `.power-card__version--static` 移到 `.power-card__version`，并断言该修饰类不会再出现；新增徽标排布与 `New` token 两条契约。

## 8. 限制与已知问题

- **更新/降级依赖 `apm install <name>=<version>` 能替换已安装的另一个版本**。前端侧能力门槛已放开（预检只在「同一版本已安装」时短路），但 apm 的实际行为不在本仓库控制范围内——非零退出会被映射为固定失败文案。**板端必须实测**，已记入开发指南 §19。
- 卡片固定显示**目录里的最新版本**：装了 v1、目录有 v2 时卡片写 v2 并同时挂 `New` + `Installed`，「装的是旧版」只能从徽标与弹窗读出。
- 只读视图仍渲染（禁用的）版本选择器，以便把已安装版本标记出来；此时动作恒为卸载。若清单里有多条同系列记录且最新那条与 `installedVersion` 不一致，显示值与动作名义上可能不一致（罕见，且选择器禁用）。
- 卡片版本槽的视觉随之改变：管理态卡片原来继承 14px 的 select，现在是 12px/700 的标签（与自定义卡片一致）。板端外观尚未验收。
- 不提供「已是最新」之类的提示；`New` 徽标是唯一的版本更新提示。

## 9. 提交状态

改动提交在 `bianbu-26.04` 上。
