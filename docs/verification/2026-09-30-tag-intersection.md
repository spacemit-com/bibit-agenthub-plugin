# 0.3.14 验证记录：标签筛选由并集改为交集

- 变更版本：0.3.14（上一版 0.3.13「APC Key 列表」）
- 验证环境：amd64 开发机；Node 18.19（`npm test` / `npm run build:*`）、Go 1.26.5
- 相关提交：见文末「提交状态」

## 1. 用户需求

> hub 页面中的标签 tag 筛选逻辑从并集改成交集。

改动前：`record.tags.some((tag) => query.tags.includes(tag))`——选中多个 tag 时取并集，带任意一个 tag 的版本都会被列出，**选得越多结果越多**。

改动后：`query.tags.every((tag) => record.tags.includes(tag))`——取交集，版本必须同时带有全部已选 tag，**选得越多结果越窄**。不选任何 tag 仍是「不过滤」。

## 2. 实现要点

改动只有一处，但需要确认三条边界都成立。

| 点 | 说明 |
| --- | --- |
| 单一改动点 | `src/api/apm.ts` 的 `buildPowersResult`。installed 与 market 走同一个函数（`powerCatalogClient` 的 market 分支也调用它），因此两个数据范围自动一致，不存在只改一边的可能 |
| 过滤时机不变 | tag 是**版本级**字段，过滤仍在系列聚合之前作用于精确版本。所以「v2 带全部已选 tag、v1 只带其中一个」的系列会保留，但 `versions` 里只剩 v2——不会混进不匹配的版本 |
| 空选择 | `query.tags.length === 0` 的提前返回不变；`every` 对空数组也返回 true，与旧代码同义，新规则只在选到第二个 tag 后与旧行为分叉 |
| facets 不变 | `facets.tags` 仍取当前 type 的全量去重集合、与已选 tag 无关。交集语义下这一点是必需的：若 facets 跟着收窄，用户将无法再点回能恢复非空结果的 tag |
| 协议不变 | `powers.list.v1` 入参仍是排序去重、≤20 项的 `tags`；wire 信封、`debian/` 的 grant 与 Registry、Provider 全部不动，因此本次没有新 operation |

## 3. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 524/527（28 个文件；0.3.13 基线 521，本次 +3 条用例）。**唯一失败文件 `dev/sources.test.ts` 的 3 条 `readMarket` 用例是基线问题**，`git stash` 后同样失败，见 §6 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功（`dist/assets/index-8pt-OJKQ.js` 262.20 kB / gzip 82.44 kB；`index-tZD7Sm78.css` 16.55 kB） |
| `npm run build:plugin` | 成功，`artifacts/agent-hub-0.3.14.bibit-plugin.tgz`，sha256 `8acc14f37d29377e3bea965ad546394e44f743e6e1dd8107e615563c454260a5`（100022 字节） |
| `make -C provider test vet build` | 通过（Provider 本次未改动，回归确认） |
| `bibit-agenthub --self-test` | exit 0 |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |

产物核对（解包 0.3.14 bundle）：`plugin.json` 的 `version: 0.3.14`、`fallbackTitle: Capabilities`、`settings: []`，即 0.3.12 的文案与 0.3.13 的设置改动都在。

## 4. 语义验证

三条断言覆盖两个数据范围与「版本 vs 系列」两层，全部由测试锁定：

| # | 场景 | 输入 | 期望 | 用例 |
| --- | --- | --- | --- | --- |
| 1 | installed，多 tag 全中才列出 | `both=['alpha','beta']`、`alpha-only=['alpha']`、`beta-only=['beta']`、`neither=['gamma']` | `['alpha']` → `alpha-only, both`；`['alpha','beta']` → 仅 `both`；`['alpha','beta','gamma']` → 空 | `apm.test.ts`「matches a version only when it carries every selected tag」 |
| 2 | installed，同一系列按版本分别过滤 | 同名 `demo` 的 `v2=['alpha','beta']`、`v1=['alpha']` | 系列保留，`versions` 只剩 `v2.0.0` | `apm.test.ts`「filters versions of one series independently…」 |
| 3 | market，同一谓词生效 | 目录里 `both` / `alpha-only` / `beta-only` | `['alpha']` → `alpha-only, both`；`['alpha','beta']` → 仅 `both` | `powerCatalogClient.test.ts`「applies tag intersection to the market catalog」 |
| 4 | 页面交互 | 卡片 `both=['alpha','beta']`、`alpha-only=['alpha']` | 选 `beta` 后 `alpha-only` 消失；再选 `alpha` 后它仍消失、`both` 保留 | `AgentHubPage.test.tsx`「selects tags in sorted order and narrows the list」 |

第 4 条是原「selects tags in sorted **OR** order」用例的改写。原用例的夹具只有一个系列且带三个 tag，在两种语义下都通过，因此**它锁不住这次改动**；改写后的夹具引入了一个「只带部分已选 tag」的第二张卡片，并断言它消失。

## 5. 反向验证

把谓词改回并集（`query.tags.every(...)` → `record.tags.some(...)`），四处断言必须同时失败：

```text
× buildInstalledPowersResult > matches a version only when it carries every selected tag
× buildInstalledPowersResult > filters versions of one series independently, then keeps the matching ones
× listPowers > applies tag intersection to the market catalog
× AgentHubPage > selects tags in sorted order and narrows the list
Tests  4 failed | 123 passed (127)
```

恢复后重跑全绿。这说明新断言确实锁住了交集语义，而不是依赖某个恰好也满足并集的夹具。

## 6. 限制与已知问题

- `dev/sources.test.ts` 的 3 条 `readMarket` 用例在本机（Node 18.19.1 / vitest 3.2.4）**基线即失败**，与本次改动无关：jsdom 环境把全局 `URL` 换成不继承 `node:url` `URL` 的实现，传给 `http.get(url, options, cb)` 后 Node 不认它是 URL。0.3.11 起每份验证文档都记录了同一现象。
- 交集语义下，若两个 tag 从未同时出现在任何版本上，结果是空列表（页面显示「No Powers are available. / 没有可用的 Power。」）。这是交集的定义而非缺陷；facets 保持全量，因此用户可以取消其中一个 tag 回到非空结果。
- tag 是**版本级**字段：一个系列的多个版本可以带不同 tag，交集过滤会把不匹配的版本从 `versions` 里去掉，而不只是隐藏整个系列。若未来希望「系列级」交集（只要系列里任一版本同时带全部 tag 就保留整个系列），需要先改这里的版本级语义，属于新的产品决定。
- 实机 GUI 未验证：本次结论来自 Vitest。板端验收步骤已更新到 `docs/development-and-deployment-guide.md` §16 的冒烟清单。

## 7. 提交状态

改动提交在 `bianbu-26.04` 上，尚未 push。
