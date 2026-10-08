# 0.3.17 验证记录：非 bibit 的 Agent 隐藏 Expert 类型标签

- 变更版本：0.3.17（上一版 0.3.16；该版本下还有一笔 `00eb0db` 的发布一致性修复）
- 验证环境：amd64 开发机；**Node 24.16.0**（`.nvmrc` 钉住的版本，`npm run build:plugin` 会先跑 `scripts/check-node.mjs`）
- 相关提交：见文末「提交状态」

## 1. 用户需求

> 由于 expert 只在 bibt 中可用，选择其他 agent 时隐藏 expert 类型标签

## 2. 现状

「`agent` 类型（界面上的 `Expert`）只能配 bibit」这条规则原先写在三个地方，筛选行如果照搬就是第四处：

| 位置 | 写法 |
| --- | --- |
| `src/api/contracts.ts:729` 目标校验 | `type === 'agent' && agent !== 'bibit'` → `fail(...)` |
| `src/api/powerOperations.ts:121` 目标校验 | 同上 |
| `src/components/PowerDetailsDialog.tsx:119` | `agentValidForInstall = series.type !== 'agent' \|\| agent === 'bibit'` |

而类型筛选行无条件渲染 `POWER_TYPES`（`['skill','plugin','mcp','agent']`），所以在 codex 下也会给出 `Expert`——点进去只能得到装不上的结果。

## 3. 实现

### 3.1 规则收口

`src/api/contracts.ts`：

```ts
export function supportsAgentType(agent: string): boolean {
  return agent === 'bibit'
}

export function powerTypesForAgent(agent: string): readonly PowerType[] {
  return supportsAgentType(agent) ? POWER_TYPES : POWER_TYPES.filter((type) => type !== 'agent')
}
```

四个调用点改为读同一处：两处 wire 目标校验用 `supportsAgentType`，详情弹窗的「能否安装」与类型筛选行用 `powerTypesForAgent`。wire 行为不变（`type=agent` + 非 bibit 目标仍然校验失败）。

### 3.2 筛选行

`PowerFilters.tsx` 由 `POWER_TYPES.map(...)` 改为 `powerTypesForAgent(agent).map(...)`：bibit 下仍是 skill / plugin / mcp / Expert，其它 Agent 下只剩前三个。

### 3.3 连带问题：不能停在被隐藏的类型上

如果当前选中的类型正好是被隐藏的那个（先在 bibit 下选了 `Expert`，再切到 codex），chip 消失后列表会停在一个**用户既看不见、也切不走**的类型上。`AgentHubPage.changeAgent` 因此多了一步：

```ts
const supported = powerTypesForAgent(next)
const typeFellAway = !supported.includes(type)
if (typeFellAway) setType(supported[0])   // → 'skill'
```

并且这种情况按**一次显式类型切换**处理：重置标签 / 页码 / snapshot（`changeType` 的同一套重置）。没有发生类型回退时，市场标签下依旧只更新安装目标、不重置也不重发（0.3.16 的行为）。

### 3.4 版本

`package.json` / `package-lock.json` / `bibit.feature.json` → 0.3.17，并且 Provider 的 `providerVersion` 一起改为 0.3.17：`00eb0db` 新增的 `TestProviderVersionMatchesPackageJSON` 会读 `package.json` 比对，即使本次没碰 Provider 代码也必须同步。

## 4. 门禁结果（Node 24.16.0）

| 检查 | 结果 |
| --- | --- |
| `npm test` | **550/550**，30 个文件，0 失败 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功 |
| `npm run build:plugin` | 成功，`check-node: Node 24.16.0 (zlib 1.3.1-e00f703) matches .nvmrc`；`artifacts/agent-hub-0.3.17.bibit-plugin.tgz`，sha256 `36718b794ca95d54c6d67cb47a492d8eb1afaa375857e872867dda30efc21a16`（100541 字节） |
| `make -C provider test vet build` | 通过（含 `TestProviderVersionMatchesPackageJSON`） |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |

产物核对：`plugin.json` 的 `version: 0.3.17`；bundle CSS 里 0.3.15 引入的 58 个 `light-dark()` 与 0.3.16 的 `.power-filters__agent-switcher` 都还在（两次既有契约未被破坏）。

### 4.1 顺带更正：那个「基线失败」不存在

0.3.15 / 0.3.16 的记录里把 `dev/sources.test.ts` 的 3 条 `readMarket` 失败写成「与本改动无关的基线问题」。本次在钉住的 Node 24.16.0 下重跑发现**那是 Node 18 的环境问题**：

```text
Node 18.19.1 → dev/sources.test.ts  3 failed | 13 passed (16)
Node 24.16.0 → dev/sources.test.ts 16 passed (16)
```

同一份代码，只换运行时。整套也从「541 通过 / 3 失败」变成 550 全通过。已在 `2026-09-30-agent-switcher.md` 顶部加了事后更正，并与 `2026-10-08-release-consistency.md` 的结论一致。

## 5. 反向验证（变异测试）

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| A | `powerTypesForAgent` 无视 Agent 直接返回 `POWER_TYPES` | 契约用例 + 筛选行用例 | 2 failed ✓ |
| B | 去掉 `changeAgent` 里的类型回退（`typeFellAway = false`） | 页面用例（`skill` 未被按下 / 列表仍是空） | 1 failed ✓ |

## 6. 限制与已知问题

- 只影响**类型筛选行**。市场目录里仍然存在 `agent` 类型的条目，只是非 bibit 时筛不到它们（类型是单选、没有「全部」选项）；卡片与弹窗上的类型标签仍是 `Expert`。
- 回退目标是 `powerTypesForAgent(agent)[0]`，当前即 `skill`（也是页面初始类型）。若之后再有类型变成「按 Agent 可选」，`powerTypesForAgent` 已经是那个扩展点。
- 在设置页切换 Agent 若触发类型回退，同样会重置被保留的查询状态；这是有意的（列表确实按类型读取），但在设置页无可见反馈。
- 消费者若把 `Expert` 当作「总是可选」写死（例如外部脚本点第 4 个 chip），在非 bibit 下会找不到该控件——这是本次刻意的行为变化。

## 7. 提交状态

改动提交在 `bianbu-26.04` 上。
