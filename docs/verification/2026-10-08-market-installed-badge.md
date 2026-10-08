# 0.3.18 验证记录：市场卡片按安装清单显示 Installed 徽标

- 变更版本：0.3.18（上一版 0.3.17「非 bibit 的 Agent 隐藏 Expert 类型标签」）
- 验证环境：amd64 开发机；**Node 24.16.0**（`.nvmrc` 钉住的版本，`npm run build:plugin` 会先跑 `scripts/check-node.mjs`）
- 相关提交：见文末「提交状态」

## 1. 用户需求

> 市场页预载目标 Agent 的安装清单，使 market 卡片根据安装清单显示 installed 徽标

## 2. 现状

- `scope=market` 的 wire 输入是 `{scope:"market", knownSnapshot?}`——**不带 agent**（APC 目录与 Agent 无关）。
- 因此市场卡片当时无法回答「选中的 Agent 装了没有」，只能点开详情弹窗、走一次 `powers.inspect.v1` 才知道。
- 但安装 store 的快照里**已经有** `fullLists: Map<agent, readonly APMPowerRecord[]>`（按 Agent 存的完整清单），写入点是 `refreshAgent`，此前**没有任何消费方**——只在 store 内部用于 `markFullListExpired`。
- `refreshAgent` 只更新**已知 target**（曾 inspect 过的 target）的 item 状态，所以徽标必须读 `fullLists`，读 `items` 是错的。
- `invalidateAgent`（每次 mutation 开始时）会 `fullLists.delete(agent)`；`reconcile` 随后重新 `refreshAgent`，因此安装/卸载后徽标会跟着更新。

## 3. 已确认的两个决定

| 问题 | 选择 |
| --- | --- |
| 徽标语义（装了 v1 但选了 v2） | **装了任意版本就是 Installed**（版本无关；具体版本看详情弹窗） |
| 预载频率 | **每次进市场 / 切 Agent / 窗口聚焦都重读**（与 installed scope 一致，以新鲜度优先） |

## 4. 实现

1. **预载**（`src/AgentHubPage.tsx`）：

```tsx
useEffect(() => {
  if (tab !== 'market' || !installationStore) return
  const controller = new AbortController()
  void installationStore.refreshAgent(agent, controller.signal).catch(() => {})
  return () => controller.abort()
}, [tab, agent, installationStore, retry])
```

守卫用 `tab === 'market'` 而非 `scope === 'market'`：设置页下 `scope` 仍保留上一次的目录 scope，而那时不渲染任何卡片。`retry` 进依赖是为了让窗口聚焦与页头刷新也重读。

2. **集合**：`installedKeys = useMemo(() => new Set((fullLists.get(agent) ?? []).map(r => powerSeriesKey(r.type, r.name))), [installationSnapshot.fullLists, agent])`。

3. **只给市场卡片挂牌**：`installed={scope === 'market' && installedKeys.has(powerSeriesKey(series.type, series.name))}`。

4. **卡片**（`src/components/PowerCard.tsx`）：可选 `installed?: boolean` → `<span className="power-card__badge power-card__badge--installed">Installed</span>`。两个徽标不会共存：自定义资源只来自 installed 页的本机扫描，而 `installed` 只在市场为真。

5. **样式**（`src/agentHub.css`）：`.power-card__badge--installed` 复用安装按钮的成功色 `--hub-install-line/bg/text`（都是「已安装」语义，应当一起变）。不新增 token，因此 0.3.15 的「所有颜色 token 必须是 `light-dark()` 成对」契约自动继续覆盖它；布局用例另加一条断言：该修饰类只用 `--hub-install-*`、不得出现 `--hub-custom-*`。

6. **文案**：`'Installed': '已安装'`。

## 5. 门禁结果（Node 24.16.0）

| 检查 | 结果 |
| --- | --- |
| `npm test` | **558/558**，30 个文件，0 失败 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功 |
| `npm run build:plugin` | 成功，`check-node: Node 24.16.0 (zlib 1.3.1-e00f703) matches .nvmrc`；`artifacts/agent-hub-0.3.18.bibit-plugin.tgz`，sha256 `9f39ad056d6753049a0c308e6cb0cadb0737c4b22386957cffd192fe4751b18d`（100698 字节） |
| `make -C provider test vet build` | 通过（含 `TestProviderVersionMatchesPackageJSON`，`providerVersion` 已同步为 0.3.18） |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |

产物核对：`plugin.json` 的 `version: 0.3.18`；bundle CSS 里 0.3.15 的 58 个 `light-dark()`、0.3.16 的 `.power-filters__agent-switcher`、本次的 `.power-card__badge--installed` 都在（既有契约未被破坏）。

用例数：550 → 558（+3 `PowerCard`、+4 `AgentHubPage`、+1 `agentHubLayout`）。

## 6. 反向验证（变异测试）

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| A | 去掉市场预载 effect | 「预载清单」「切 Agent 重读清单」 | 2 failed ✓ |
| B | 让徽标无视 scope（installed 页也挂） | 「installed 页不挂牌」 | 1 failed ✓ |
| C | 徽标改读 `items` 而不是 `fullLists`（一个看似合理的错源） | 「预载清单」「切 Agent 重读清单」 | 2 failed ✓ |
| D | 让市场请求带上 `agent`（回退 0.3.16 的不变量） | 8 条市场用例 | 8 failed ✓ |

用例设计要点：市场用例让**首次** installed 读返回空清单、后续返回含目标 Power 的清单，因此徽标只能来自预载——若沿用「照常返回清单」的写法，初始 installed 访问就会填好 `fullLists`，去掉预载 effect 也照样通过，等于没测到预载。

## 7. 既有测试的影响

- 一处需要修：`retains the selected installed Agent after visiting the market` 原来取「最后一条 `powers.list.v1`」判断 scope，预载会在这之后插入一条 installed 读，所以改成**按 scope 取样**（并注明原因）。
- 市场用例的 mock 绝大多数本来就在 `params.scope === 'market' ? marketData() : installedData(...)` 上分支，能直接回答多出来的 installed 读；少数 `throw new Error('unexpected op')` 的 mock 会让预载 reject，被 `.catch` 吞掉，测试仍通过（只是没有徽标）。
- 已核对 `expect(calls).toHaveLength(1)` 那几处数的是 `conversation.compose` 的 action 调用，不是 store 请求，不受影响。

## 8. 限制与已知问题

- **徽标版本无关**：装了 v1、卡片选了 v2 时仍显示 `Installed`。「装了旧版」在卡片上看不出来，详情弹窗里的 `已安装 {version}` 是准确的那一处。
- **清单读取失败静默降级**：市场照常可用、只是没有徽标，不新增错误态也不提示原因。（安装动作会在真正尝试时给出自己的错误文案。）
- **成本**：每次进入市场 / 切 Agent / 窗口聚焦各多一次 `powers.list.v1`（`scope=installed`）。这是选定的「新鲜度优先」。
- **板端实机外观尚未验收**：市场卡片新增徽标后的实际排版（与版本选择器同排）只在 jsdom 断言了存在性与 token，未做离屏渲染或板端确认。若徽标过长（例如以后带上版本号）需要重新看头部布局。
- 不提供 `Update available` 之类的版本比对，也不改 market 的 wire 协议或详情弹窗的 `inspect` 流程。

## 9. 提交状态

改动提交在 `bianbu-26.04` 上。
