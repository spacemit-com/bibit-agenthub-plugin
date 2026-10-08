# 0.3.16 验证记录：Agent 选择抽成标签栏最右侧的独立控件

- 变更版本：0.3.16（上一版 0.3.15「跟随宿主明暗主题 + 自定义资源改用独立色相」）
- 验证环境：amd64 开发机；Node 18.19（`npm test` / `npm run build:*`）
- 相关提交：见文末「提交状态」

## 1. 用户需求

> 将我的能力 hover 选择 agent 单独设为一个控件（放在标签栏最右侧，不提供点击能力，可以在浏览我的能力/能力市场时随时 hover 进行切换），我的能力不再提供 hover 选择目标 agent，能力卡片的详情页也不再提供 agent 的选项，全部由该控件独立控制。
> 控件文本和选择的 Agent 一致，并随选项改变，默认是 bibit。

## 2. 改动前的行为

- Agent 菜单挂在「我的能力」标签按钮上：hover 展开，点击同时切 scope 又开菜单（`PowerFilters.tsx:90-143`）。
- 弹窗有第二份 state `dialogAgent` 与一个 Agent `<select>`；`agent` 类型遇到非 bibit 时另有「切换到 bibit」按钮（`AgentHubPage.tsx:253`、`PowerDetailsDialog.tsx:174-199`）。
- 市场 scope 把弹窗 Agent 强制成 `bibit`，与标签栏的 `agent` 无关（`AgentHubPage.tsx:468`）。
- Agent 列表只在 installed 标签下传入（`agents = tab === 'installed' ? INSTALLED_AGENTS : []`）。
- 弹窗是 `showModal()` 模态，打开时标签栏不可达。
- 设置标签下列表 effect 直接 return，不发 `powers.list.v1`。

## 3. 确认过的三个决定

| 问题 | 选择 |
| --- | --- |
| 触发方式 | **触发区可点击展开**（即放弃原始需求里「不提供点击能力」那一条）；点击只展开、不切标签页 |
| 详情弹窗 | **只读显示当前 Agent**，删掉「切换到 bibit」按钮，保留「该类型仅支持 bibit Agent。」提示 |
| 设置标签页 | **显示**该控件 |

## 4. 实现要点

- 新增 `src/components/AgentSwitcher.tsx`：右对齐（`margin-left: auto`），触发器文本 = 当前 Agent，可访问名 `Agent: bibit`，`aria-haspopup="menu"` + `aria-expanded` 且**无** `aria-pressed`。hover/点击展开，键盘焦点展开、方向键循环、`Escape` 关闭并归还焦点（用 `suppressFocusOpenRef` 防止归还焦点时重开）。
- `PowerFilters.tsx`：三个标签移入 `.power-filters__tabs`（`role="group" aria-label="范围"`），控件成为它的兄弟节点；「我的能力」退化为普通标签按钮。
- `PowerDetailsDialog.tsx`：Agent 行恒为 `data-testid="dialog-agent-static"` 只读文本；删除 `<select>`、「切换到 bibit」按钮、`onAgentChange` prop 与 `agentOptions`；保留 `agentValidForInstall`（`agent` 类型 + 非 bibit 时隐藏安装）。
- `AgentHubPage.tsx`：删除 `dialogAgent` / `changeDialogAgent`，14 处引用统一为 `agent`；`openDetails` 两个 scope 都用 `agent`；`agents` 恒为 `INSTALLED_AGENTS`；新增 `listAgent = scope === 'installed' ? agent : undefined` 并用于请求体与 effect 依赖；`changeAgent` 只在 `installed` 下重置标签/页码/snapshot。
- `agentHub.css`：`.power-filters__agent-switcher`（`position: relative; margin-left: auto`）、`.power-filters__agent-trigger`、`.power-filters__tabs`；`.power-filters__agent-menu` 由 `left: 0` 改 `right: 0`（贴右边缘时向左展开，避免溢出页面）；删除 `.power-filters__scope-agent`。颜色沿用 `--hub-*` token。
- `agentHubI18n.tsx`：新增 `'Agent: {agent}'` → `'Agent：{agent}'`；删除已无引用的 `'Switch to bibit'`（否则 orphan-key 用例失败）。

## 5. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 544 例，541 通过（29 个文件）。**唯一失败文件 `dev/sources.test.ts` 的 3 条 `readMarket` 是基线问题**（见 §7） |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功 |
| `npm run build:plugin` | 成功，`artifacts/agent-hub-0.3.16.bibit-plugin.tgz`，sha256 `916925830802c5d8d677583a542bf6d5168f5fb75388e667d4e2e8cc041a9c97`（100635 字节） |
| `make -C provider test vet build` | 通过（Provider 未改动，回归确认） |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |

产物核对：`plugin.json` 的 `version: 0.3.16`；bundle CSS 含 `.power-filters__agent-switcher` / `__agent-trigger` / `.power-filters__tabs`，已无 `.power-filters__scope-agent`；菜单 `right:0`；bundle JS 里 `Switch to bibit` 已消失、`Agent: {agent}` 存在；深色主题的 58 个 `light-dark()` 仍在（0.3.15 的契约未被破坏）。

## 6. 用例数核对（确认没有测试被静默删除）

在 HEAD（0.3.15）建了一个临时 worktree 逐文件对数：

| 文件 | HEAD | 现在 | 差 |
| --- | --- | --- | --- |
| `src/components/AgentSwitcher.test.tsx` | — | 9 | +9 |
| `src/AgentHubPage.test.tsx` | 67 | 69 | +2 |
| `src/components/PowerFilters.test.tsx` | 10 | 12 | +2 |
| `src/agentHubLayout.test.ts` | 19 | 20 | +1 |
| `src/components/PowerDetailsDialog.test.tsx` | 37 | 37 | 0 |
| 其余 24 个文件 | — | — | 0 |
| **合计** | **530**（527 通过 + 3 基线失败） | **544**（541 通过 + 3 基线失败） | **+14** |

注：`PowerDetailsDialog.test.tsx` 的两组 `it.each` 是 1 条声明展开为 3 / 2 个用例，声明数与用例数不同，因此上表以 vitest 的**运行时用例数**为准。

## 7. 反向验证（变异测试）

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| A | 把 `aria-haspopup` 与下拉箭头放回「我的能力」标签 | 「Agent 菜单不挂在 My Capabilities 上」 | 1 failed ✓ |
| B | 让选中 Agent 时额外调 `onTabChange('installed')` | 「选 Agent 不切标签页」 | 1 failed ✓ |
| C | 市场打开详情时把 Agent 钉回 `bibit`（复现旧行为） | 「市场安装目标 = 控件所选 Agent」 | 1 failed ✓ |
| D | Agent 变化时无条件重置查询，并让 effect 依赖 `agent` | 「市场切换 Agent 不动查询与标签」 | 1 failed ✓ |
| E | 把弹窗的 Agent `<select>` 加回去 | 弹窗只读用例 5 条 | 5 failed ✓ |

## 8. 限制与已知问题

- **未新增 WebKit 离屏探针**：本次改动全是 DOM 行为与选择器对齐，jsdom + 布局契约（`.power-filters__agent-switcher` 的 `margin-left: auto` / `position: relative`、菜单 `right: 0`）足以覆盖；离屏探针只用于引擎/主题类问题（见 0.3.15 的 `probe-dark-mode.py`）。
- **「不提供点击能力」这条需求未实现**：按确认结果采用了「触发区可点击展开」。若之后要严格回归 hover-only，需重做触发器语义并接受键盘不可达（或另配一个键盘入口）。
- **市场里切换 Agent 后没有即时反馈**：市场目录与 Agent 无关，切换只改变安装目标，列表不动。这是刻意的（避免无谓重发与清空用户筛选），但用户可能觉得「点了没反应」——目前没有 toast 之类的提示。
- **设置页切换 Agent 无可见效果**：设置页不发列表请求，控件在那里只是为下一次进入目录预设目标。
- `dev/sources.test.ts` 的 3 条 `readMarket` 用例基线即失败（jsdom 的 `URL` 与 Node `http.get` 不兼容），与本次无关。
- `agent` 类型的 Power 在非 bibit 目标下不再有弹窗内的纠正入口，需要关掉弹窗、用控件切换后再打开 —— 这是模态弹窗够不到标签栏控件的直接后果。

## 9. 提交状态

改动提交在 `bianbu-26.04` 上。
