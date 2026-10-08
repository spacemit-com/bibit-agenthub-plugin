# Changelog

## 2026-10-08 — 资源类型 agent 更名为 expert（0.3.20，联动 apm 0.0.2）

分类：契约变更（Power 类型取值改为 `expert`；显示映射删除）

用户需求：

> 这是一个联动仓库任务，包括 bibit-agenthub-plugin 和 ../apm。
> 在设计中 agent 有歧义，一是指软件的目标智能体如 bibit、codex 等，二是指 bibit 中的特殊资源。
> 在最近的一次提交中将 agent hub 插件的类型标签更名成了 expert，从此消除歧义。
> 但需要同步两个仓库中的剩余的定义。包括但不限于：代码、文档、CLI 参数名（使两侧接口调整同步，不至于无法使用出错）

### 一、为什么之前只改了一半

0.3.12 起界面把这个类别显示为 `Expert`，但那只落在一层显示映射上：`resolvePowerTypeLabel` 把 `agent` 换成 `Expert`，而 `POWER_TYPES`、类型守卫、wire 请求、Provider 的类型表、磁盘目录全部还是 `agent`。于是同一个词在请求里出现两次（目标 Agent 与类型），在 apm 的一条命令里也是（`apm install <agent-power> --type agent --agent bibit`）。本次把剩余的定义同步到 `expert`，两个仓库一起改。

### 二、插件侧改动

- `POWER_TYPES` 改为 `['skill','plugin','mcp','expert']`；`supportsAgentType` → `supportsExpertType`（名字说的是类型，参数仍是目标 Agent——这正是要消除的那处歧义）；`parsePowerTarget` / 列表结果校验里的类型判定同步。
- **删除 `resolvePowerTypeLabel`**：它唯一的作用就是把 `agent` 显示成 `Expert`，类型改名后它就是恒等映射。筛选行、卡片徽标与弹窗徽标直接渲染类型本身（筛选行 `capitalize`、卡片/徽标 `uppercase` 沿用既有 CSS），四个类型的显示方式至此完全一致。连带删除它的 4 个调用点、导入与 3 条专门测试。
- Provider（Go）：`powerTypes` 集合与错误文案改为 `expert`；自定义扫描表的 key 与 `typeName` 改为 `expert`，而 `dirName: "agents"` 与权威文件 `agent.yaml` **保持不变**（APC 与 Bibit Runtime 的外部约定）。`parseCustomAuthorityFile` 的分支也必须跟着改——它按类型名分派，留在 `agent` 会让所有手装 Expert 被判成 `invalid-authority-file`（本地测试抓到过：`Skipped:[{Type:expert ... Reason:invalid-authority-file}]`）。
- `dev/custom.ts` 的类型表同步（`TYPE_SPECS` 的 key 与 `AGENT_TYPES` 的值），目录与权威文件同样不变。
- 兼容性：`apm.ts` 新增 `normalizePowerType`，把旧 apm 输出的 `type:"agent"` 归一成 `expert`，其余取值严格拒绝。插件 deb 精确锁自己的 CLI，但 `agent-power-manager` 不锁版本，所以「插件先升级、CLI 还没升」是真实可能的组合。市场目录仍读 APC 的 `agents` 分组（`apc.ts` 的 `agents: 'expert'`）——那是服务端的格式。
- 版本 0.3.20（含 `providerVersion`，`TestProviderVersionMatchesPackageJSON` 要求相等）。

### 三、apm 侧（另一仓库，同一批）

见 apm 的 `docs/Changelog.md` 与 **ADR-044**：`PowerTypeExpert = "expert"`、`--type=expert`（`--type=agent` 降为弃用别名并在非 `--json` 时提示）、APC 的 HTTP 边界翻译（提交 metadata、系列查询、内容路径、响应回读）集中在 `internal/cloud/remote/type_vocabulary.go`、目录分组仍叫 `agents`，磁盘 `agents/<name>` 与 `agent.yaml` 不动。

### 四、相关文件

- `src/api/contracts.ts`、`src/api/powerOperations.ts`、`src/api/apc.ts`、`src/api/apm.ts`、`src/displayFields.ts`、`src/components/{PowerCard,PowerDetailsDialog,PowerFilters}.tsx`、`src/AgentHubPage.tsx`、`src/api/powerCatalogClient.ts`
- `provider/internal/provider/{operations,custom,contracts}.go`、`dev/custom.ts`
- 文档：`docs/development-and-deployment-guide.md`、`docs/cli-provider-development-and-deployment.md`、`README.md`、`debian/changelog`
- `docs/verification/2026-10-08-agent-type-renamed-to-expert.md`（新增验证记录）

### 五、验证结果

在钉住的 Node 24.16.0 下：`npm test` 30 个文件 / **568 例全通过**、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`，以及 `make -C provider test vet build`、`gofmt -l provider/`、`git diff --check` 全通过。apm 侧 `go test ./...`（22 个包）、`go vet`、`gofmt`、`go build` 全通过。

新增用例：`apm.ts` 的「旧 CLI 的 `type:"agent"` 归一成 `expert`、未知类型仍被拒」、`apc.ts` 的「`agents` 组解成 `expert`」。改写用例：`POWER_TYPES` 常量、`powerTypesForAgent`、类型筛选行的四个控件与点击值、卡片类型 chip、弹窗徽标与确认句、`displayFields` 的 3 条映射用例（函数已删除，用例一并删除）。

### 六、发布顺序与限制

- **两个包必须同批升级**：新插件发 `--type=expert`，旧 apm 不认识；新 apm 输出 `type:"expert"`，旧插件解析不了。混合状态两个方向都会坏，只是坏在不同位置。插件的 deb 精确锁自己的 CLI，但 `agent-power-manager` 不锁，因此发布说明必须写明。
- 磁盘布局（`agents/<name>`、`cache/agents/…`）、作者的 `agent.yaml`、清单与目录的 `agents` 分组、APC 的 wire 取值 `agent` 全部**未改**；它们是 APC、Bibit Runtime 与已发布内容的契约。清单见 apm ADR-044。
- 插件对旧拼写的容忍是**过渡期**的：等板上 apm 全部升到 0.0.2 之后，`normalizePowerType` 里的 `agent` 分支应与 apm 的 `--type=agent` 别名一起删除。

## 2026-10-08 — 卡片固定显示最新版本，详情页按版本给出安装/更新/降级/卸载（0.3.19）

分类：交互重构

用户需求：

> 取消卡片上的版本选择，固定展示最新的版本信息。进入详情页默认展示最新版本。
> 详情页的版本选项在安装后不再固定，详情页控件根据版本号改为更新（高版本）/卸载（已安装版本）/降级（低版本）/安装（未安装）
> 详情页版本选项文本需标记已安装版本。
> 当存在新版本时，在卡片的已安装徽标左侧新增 new 徽标

### 一、卡片：不再选版本

版本槽从「原生 `<select>`」变成**静态标签**，显示该系列当前的最新版本（`series.versions[0]`，聚合层保证降序；自定义资源显示其声明版本，没有则 `No version`）。选择只在详情弹窗里发生。

顺带的收口：原来「管理态 select vs 自定义静态标签」是两套样式，靠 `--hub-version-height` 对齐高度；现在所有卡片共用同一个 `.power-card__version`，`--version--static` 修饰类删除，自定义资源的外观改由 `.power-card[data-source='custom'] .power-card__version` 承担。token 仍保留 31px，目的是卡片度量不因这次改动而变化。

### 二、详情弹窗：动作按「选中版本 vs 已安装版本」命名

| 情形 | 主控件 | 是否需要确认 |
| --- | --- | --- |
| 未安装 | `Install` | 否（与改动前一致） |
| 选中版本高于已安装 | `Update` | 是 |
| 选中版本等于已安装 | `Uninstall` | 是（沿用原确认） |
| 选中版本低于已安装 | `Downgrade` | 是 |
| 只读（我的能力页） | `Uninstall`（仅已安装时） | 是 |

- 版本选择器 `disabled={busy || readOnly}`——**去掉了 `isInstalled`**，这就是「安装后不再固定」。它只在写入进行中或只读视图里禁用。
- 选项文本标记已安装版本（`{version} (installed)`）。目录若已下架该版本，会把它**补回**选项列表（按降序排序插入）——否则「卸载」这个状态将无法到达。
- 确认状态与动作绑定：动作一变（换版本，或记录出现/消失）就清掉已按下的确认，避免确认框留在另一个动作上。
- 只读视图（`readOnly`）保持只读：选择器禁用、动作恒为卸载；未安装时不显示动作。这一条是确认过的——那个 scope 的系列版本来自安装清单，本来没有可选的更新/降级目标。

### 三、`New` 徽标

市场卡片在「该 Agent 已安装、且目录里的最新版本更高」时，于 `Installed` **左侧**再加一个 `New`。`New` 以已安装为前提（「比你手上的新」离开已安装版本就没有意义），因此不会单独出现。它用独立的靛蓝 token（`--hub-new` / `--hub-new-bg` / `--hub-new-line`，`light-dark()` 成对，文字对比度浅色 7.12 / 深色 8.41），与已安装的绿、自定义的玫红都区分开。

头部排布同时改了一处：原来 `.power-card__badge` 带 `margin-left: auto`（只有一个徽标时无妨），两个徽标会**平分空白**把 `New` 与 `Installed` 推开；现在改由 `.power-card__type { margin-right: auto }` 吃下剩余空间，徽标按 DOM 顺序从右往左紧排。布局用例锁住了这一点。

### 四、版本比较器收口

`contracts.ts` 与 `apm.ts` 各有一个私有比较器（一个升序、一个降序），本次又要在弹窗与徽标里比较版本。现在导出 `comparePowerVersions`（升序、`''` 视为最旧、非规范值退化为字符串比较而**不抛异常**——它跑在 UI 已持有的数据上），降序由它取反得到。

### 五、相关文件

- `src/components/PowerCard.tsx`（静态版本槽、`New` 徽标、去掉 `selectedVersion`/`onVersionChange`）、`src/components/PowerDetailsDialog.tsx`（版本选项合并与标记、动作与确认）、`src/AgentHubPage.tsx`（`dialogVersion` 取代 `selectedVersions`；`installedVersions` 取代 `installedKeys`）
- `src/api/contracts.ts`、`src/api/apm.ts`（比较器收口）、`src/agentHub.css`（版本槽合并、徽标排布、`New` token）、`src/agentHubI18n.tsx`（9 条新文案）
- 测试：`PowerCard`（+2 净增，改写 8 处）、`PowerDetailsDialog`（+4）、`AgentHubPage`（+3）、`agentHubLayout`（+2）、`contracts`（+1）
- 文档：开发指南 §1/§7.2/§7.2.4/§10.5/§18/§19，`README.md`，`debian/changelog`，版本 0.3.19
- `docs/verification/2026-10-08-version-aware-dialog.md`（新增验证记录）

### 六、验证结果

在钉住的 Node 24.16.0 下：`npm test` 30 个文件 / **568 例全通过**、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet build`、`gofmt -l`、`git diff --check` 全通过。

反向验证 4 处（均按预期失败）：把 `isInstalled` 加回选择器的 `disabled`；去掉已安装版本的选项合并；把 `New` 徽标放到 `Installed` 之后；让更新/降级跳过确认。

被删除的用例（功能已不存在，非遗漏）：卡片「受控版本切换」「选中版本失效时回退」两条；市场「卡片与弹窗共享选中版本」改写为「卡片恒显示最新版本，选择只发生在弹窗内」。

### 七、限制

- **更新/降级依赖 `apm install <name>=<version>` 能替换已安装的另一个版本**，这不在本仓库控制范围内，需板端实测；前端只把非零退出映射为固定失败文案。已记入开发指南 §19。
- 不提供 `Update available` 之外的版本比对（例如「已是最新」提示）；卡片上的 `New` 就是全部提示。
- 卡片固定显示**目录里的最新版本**：装了 v1、目录有 v2 时卡片写 v2 并同时挂 `New` + `Installed`，「装的是旧版」这个事实只能从徽标与弹窗读出。
- 只读视图仍渲染（禁用的）版本选择器，以便把已安装版本标记出来；此时动作恒为卸载。

## 2026-10-08 — 市场卡片按安装清单显示 Installed 徽标（0.3.18）

分类：体验优化

用户需求：

> 市场页预载目标 Agent 的安装清单，使 market 卡片根据安装清单显示 installed 徽标

### 一、问题

`scope=market` 的列表请求**不带 agent**（APC 目录与 Agent 无关），所以市场卡片当时无法说明「你选中的 Agent 是不是已经装了它」——只有点开详情弹窗、走一次 `powers.inspect.v1` 之后才知道。

### 二、修法

安装 store 的快照里**本来就有** `fullLists: Map<agent, readonly APMPowerRecord[]>`（按 Agent 存的完整清单），只是此前**没有任何消费方**。市场页现在：

1. **预载清单**：进入市场 / 切换 Agent / 窗口重新聚焦时调一次 `installationStore.refreshAgent(agent, signal)`（即 `powers.list.v1` + `scope=installed` + `agent`）。频率与「我的能力」一致——那个 scope 本来也在同样的时机重读自己的清单。守卫用 `tab === 'market'` 而不是 `scope === 'market'`：设置页下 `scope` 仍是上一次的目录 scope，但那时不渲染卡片。
2. **算好集合**：`installedKeys = new Set(fullLists.get(agent).map(r => powerSeriesKey(r.type, r.name)))`，`useMemo` 依赖 `fullLists` 与 `agent`。
3. **只给市场卡片挂牌**：`installed={scope === 'market' && installedKeys.has(powerSeriesKey(series.type, series.name))}`。installed 页的卡片按定义都已安装，逐个挂徽标是噪声。

### 三、两个刻意的取舍（已与你确认）

- **徽标版本无关**：装了任意版本就算 `Installed`。卡片上的版本选择器是「安装目标版本」，不是磁盘上那一个；具体装的哪一版看详情弹窗（它显示 `已安装 {version}`）。代价是「装了 v1、选了 v2」时卡片仍写 Installed。
- **每次进市场都重读清单**：与 installed scope 的行为一致，窗口聚焦也会刷新（外部工具装了东西能反映到徽标）。代价是每次进市场多一次 `apm list --installed`。

另外，清单读取失败时**静默降级**：市场照常可用、只是没有徽标，不新增错误态（安装动作会在真正尝试时给出自己的文案）。

### 四、实现

- `src/AgentHubPage.tsx`：新增预载 effect；新增 `installedKeys` memo；给 `PowerCard` 传 `installed`；`import { powerSeriesKey } from './api/apm'`。
- `src/components/PowerCard.tsx`：新增可选 `installed?: boolean`，渲染 `<span className="power-card__badge power-card__badge--installed">Installed</span>`。两个徽标不会共存（自定义资源只来自 installed 页的本机扫描，而 `installed` 只在市场为真）。
- `src/agentHub.css`：`.power-card__badge--installed` 复用安装按钮那套成功色（`--hub-install-line/bg/text`）——都是「已安装」语义，应当一起变；不新增颜色 token，因此 0.3.15 的明暗成对契约无需扩表。
- `src/agentHubI18n.tsx`：新增 `'Installed': '已安装'`。
- 测试：`PowerCard.test.tsx`（+3）、`AgentHubPage.test.tsx`（+4）、`agentHubLayout.test.ts`（+1）。其中市场用例特意让**首次** installed 读返回空清单、后续返回含目标 Power 的清单，这样徽标只能来自预载，去掉预载 effect 就会失败。

### 五、版本

0.3.18：`package.json`、`package-lock.json`、`bibit.feature.json` 与 Provider 的 `providerVersion`（`TestProviderVersionMatchesPackageJSON` 要求相等）。

### 六、验证结果

在钉住的 Node 24.16.0 下：`npm test` 30 个文件 / **558 例全通过**、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet build`、`gofmt -l`、`git diff --check` 全通过；产物 `artifacts/agent-hub-0.3.18.bibit-plugin.tgz`。

反向验证 4 处（均按预期失败）：去掉预载 effect（2 条市场用例失败）；让徽标无视 scope（installed 页用例失败）；让徽标改读 `items` 而不是 `fullLists`（2 条市场用例失败）；让市场请求带上 `agent`（8 条用例失败，0.3.16 的不变量确实被守住）。

### 七、限制

- 徽标是版本无关的，不做 `Update available`；「装了旧版」在卡片上看不出来（详情弹窗能看出来）。
- 清单读取失败静默降级，不提示原因。
- 每次进入市场 / 切 Agent / 窗口聚焦各多一次 installed 读。
- 市场卡片新增徽标后的板端实机外观尚未验收。

## 2026-10-08 — 非 bibit 的 Agent 隐藏 Expert 类型标签（0.3.17）

分类：缺陷修复 / 体验优化

用户需求：

> 由于 expert 只在 bibt 中可用，选择其他 agent 时隐藏 expert 类型标签

### 一、改动

`agent` 类型（界面上的 `Expert`）只能装进 bibit，所以选中 codex / claude-code / hermes-agent 时，类型筛选行不再渲染 `Expert`，只剩 skill / plugin / mcp。bibit 下依旧是四个。

一个必须一起处理的连带问题：如果当前选中的类型正好是这个被隐藏的类型，筛选chip 消失后列表会停在一个**用户既看不见、也切不走**的类型上。所以切换 Agent 时若发现当前类型已不被支持，类型会回退到该 Agent 支持的第一个类型（`skill`），并按一次显式类型切换重置标签/页码/snapshot。

### 二、顺手把这条规则收口

「`agent` 只能配 bibit」原先写在三个地方：`parseTargetFields`（`powers.inspect/install/uninstall` 的目标校验）、`parsePowersWireInput` 的另一处、以及详情弹窗的 `agentValidForInstall`。加上筛选行就是第四处。现在定义在 `src/api/contracts.ts`：

```ts
export function supportsAgentType(agent: string): boolean      // 原语
export function powerTypesForAgent(agent: string): readonly PowerType[]  // 筛选行的选项
```

两处 wire 校验改用 `supportsAgentType`，弹窗的「能否安装」与筛选行改用 `powerTypesForAgent`——四个调用点读同一处，wire 行为不变（仍然是 `type=agent` + 非 bibit 目标 → 校验失败）。

### 三、相关文件

- `src/api/contracts.ts`（新增 `supportsAgentType` / `powerTypesForAgent`，目标校验改用它）
- `src/api/powerOperations.ts`（同样改用 `supportsAgentType`）
- `src/components/PowerFilters.tsx`（类型行渲染 `powerTypesForAgent(agent)`）
- `src/components/PowerDetailsDialog.tsx`（`agentValidForInstall` 改用 `powerTypesForAgent`）
- `src/AgentHubPage.tsx`（`changeAgent` 在类型被隐藏时回退到受支持的类型）
- 测试：`src/api/contracts.test.ts`、`src/components/PowerFilters.test.tsx`、`src/AgentHubPage.test.tsx`
- 文档：开发指南 §7.2.4 / §10.4 / §11，`README.md`，`debian/changelog`，版本 0.3.17
- `docs/verification/2026-10-08-expert-type-per-agent.md`（新增验证记录）

### 四、版本与工具链

- 版本 0.3.17：`package.json`、`package-lock.json`、`bibit.feature.json`，**以及 Provider 的 `providerVersion`**。后者不再是自由常量——`00eb0db` 新增的 `TestProviderVersionMatchesPackageJSON` 会读 `package.json` 比对，所以即使本次没碰 Provider 代码也必须一起改。
- 本次构建按 `00eb0db` 引入的 Node pin 执行：`.nvmrc` = 24.16.0，`npm run build:plugin` 先跑 `scripts/check-node.mjs`，用其它 Node 会直接失败（bundle 是 gzip tar，sha256 依赖运行时的 zlib）。因此 §5 的门禁是在 **Node 24.16.0** 下跑的。

### 五、验证结果

在钉住的 Node 24.16.0 下：`npm test` 30 个文件 / **550 例全通过**、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`（`artifacts/agent-hub-0.3.17.bibit-plugin.tgz`，sha256 `36718b79…`，100541 字节）、`make -C provider test vet build`、`gofmt -l`、`git diff --check` 全部通过。

**顺带更正一条旧记录**：0.3.15 / 0.3.16 记录里写的「`dev/sources.test.ts` 3 条 `readMarket` 是基线失败」其实是 **Node 18 下的环境问题**——同一份代码在 Node 24 下 16/16 全通过。仓库现在把构建钉在 Node 24，这个「基线失败」不再存在。

反向验证 2 处（均按预期失败）：让 `powerTypesForAgent` 无视 Agent 直接返回 `POWER_TYPES`（筛选行与契约用例失败）；去掉 `changeAgent` 里的类型回退（页面用例失败）。

### 六、限制

- 只影响**类型筛选行**。市场目录里仍然有 `agent` 类型的条目，只是非 bibit 时筛不到它们（类型是单选、没有「全部」选项）；卡片与弹窗上的类型标签仍是 `Expert`。
- 回退到 `skill` 是刻意的：它是 `POWER_TYPES[0]`，也是页面的初始类型。若之后再有别的类型变成「按 Agent 可选」，`powerTypesForAgent` 已经是那个可扩展点。

## 2026-10-08 — providerVersion 追平 + 钉住构建用 Node（0.3.16 追加修复）

分类：发布工程 / 可复现性

两处都是发布一致性问题，不改变任何插件行为，因此仍归在 `0.3.16` 下，不单独发版。

### 一、`providerVersion` 落后三版

`provider/internal/provider/server.go` 的 `providerVersion` 是 Go 常量，deb 版本来自 `package.json`（经 `debian/rules`），此前**没有任何东西比较两者**。0.3.14 / 0.3.15 / 0.3.16 都是纯前端改动、都没碰 `provider/`，于是连续三版发出的 CLI 包里，Provider 在 `bibit.initialize` 里自报的还是 `0.3.13`。

- `providerVersion` → `0.3.16`；
- 新增 `TestProviderVersionMatchesPackageJSON`：读 `../../..` 的 `package.json` 并断言两者相等，下次再漂移会在 `go test` 阶段失败；
- `docs/cli-provider-development-and-deployment.md` 的 `bibit.initialize` 示例同步为 `0.3.16`；
- 开发指南版本表、构建示例里残留的 `0.3.10` 一并更新（11 处）。

### 二、bundle 字节随 Node 版本漂移

现象：同一次提交，deb 内的 bundle 是 `91692583…`（100635 字节），而门禁 `npm run build:plugin` 产出的是 `ab8695b4…`（100451 字节）。逐字节定位：

- 解压后的 **tar 流完全相同**（425984 字节、`cmp` 一致），四个成员（`plugin.json`/`plugin.sig`/`dist/plugin.js`/`dist/agent-hub.css`）哈希全部相同，gzip 头也相同；**只有 deflate 压缩流从第 13 字节起不同**。

根因是**运行时的 zlib 版本**：`dpkg-buildpackage` 走系统 Node **18.19.1**（zlib 1.3），门禁走 nvm Node **24.16.0**（zlib 1.3.1）。用系统 Node 重跑同一命令即精确复现 `91692583…`。为确认不是压缩参数问题，对同一个 tar 流遍历 **level 0–9 × 5 种 strategy = 20 种组合**，两个运行时**没有任何一种**得到相同字节，因此只能钉工具链。

修复：

| 文件 | 内容 |
| --- | --- |
| `.nvmrc`（新） | `24.16.0`，唯一真值来源 |
| `scripts/check-node.mjs`（新） | 读 `.nvmrc` 校验当前解释器；不符时打印实际 zlib 版本与修复命令并以 1 退出，**不会产出第二份 bundle** |
| `package.json` | 新增 `check:node` 脚本；`build:plugin` 先跑该检查；新增 `engines.node: 24.16.0` |
| `debian/rules` | 由 `.nvmrc` 解析出 `NODE`（nvm 安装路径 → `/usr/local/bin/node` → `node`），并把它的 `bin` 前置到 `PATH` 后再跑 `npm ci` / `npx bibit-plugin build`；构建前强制 `check-node.mjs` |
| `src/nodePin.test.ts`（新） | 3 条契约：`.nvmrc` 必须是精确版本、`engines.node` 必须与之相等、`build:plugin` 必须串上 `check:node` |

修完后 **deb 内 bundle 与 `npm run build:plugin` 产物逐字节相同**（都是 `ab8695b4…`）。注意：`91692583…` 是 Node 18 的压缩结果，旧验证文档里记的正是它；因为 deb 已用新 pin 重建，0.3.16 的 bundle 哈希随之变为 `ab8695b4…`。

### 三、门禁与反向验证

`npm test` **547/547**（30 个文件）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet build`、`--self-test` exit 0、`gofmt` 无输出。

反向验证 4 项，逐条撤掉对应机制后必须失败：

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| 1 | `providerVersion` 退回 `0.3.13` | 版本一致性用例 | 1 failed ✓ |
| 2 | 用系统 Node 18 跑 `npm run build:plugin` | `check-node` 拦截 | exit 1，且 `artifacts/` 未被覆盖（哈希仍为 `ab8695b4…`）✓ |
| 3 | `NODE=/usr/bin/node` 跑 `debian/rules` 的构建目标 | `check-node` 拦截 | `Error 1` ✓ |
| 4 | `.nvmrc` 改成 `24.15.0`（与 `engines` 不一致） | pin 一致性用例 | 1 failed ✓ |

详见 `docs/verification/2026-10-08-release-consistency.md`。

## 2026-09-30 — Agent 选择抽成标签栏最右侧的独立控件（0.3.16）

分类：体验优化 / 交互重构

用户需求：

> 将我的能力 hover 选择 agent 单独设为一个控件（放在标签栏最右侧，不提供点击能力，可以在浏览我的能力/能力市场时随时 hover 进行切换），我的能力不再提供 hover 选择目标 agent，能力卡片的详情页也不再提供 agent 的选项，全部由该控件独立控制。
> 控件文本和选择的 Agent 一致，并随选项改变，默认是 bibit。

### 一、控件本身

新增 `src/components/AgentSwitcher.tsx`，挂在标签栏（`.power-filters__scopes`）最右侧（`margin-left: auto`）：

- 触发器文本就是当前 Agent（默认 `bibit`），随选择改变；可访问名是 `Agent: bibit`（满足 WCAG 2.5.3：可访问名包含可见文本），带 `aria-haspopup="menu"` / `aria-expanded`，**不带** `aria-pressed`——它不是标签页。
- 菜单沿用原来的 `role="menu"` + `role="menuitemradio"` + 选中 `✓`。
- hover 移入展开、移出收起；点击触发器**只展开、不 toggle**（鼠标用户此时已由 hover 展开，toggle 会读成「点一下反而关掉」）。
- 键盘同样可达：焦点落在触发器即展开、方向键循环、`Escape` 关闭并把焦点还给触发器。焦点归还时会重入包装层导致菜单又被打开，代码用 `suppressFocusOpenRef` 标记这一次归还。
- 三个标签页都显示（含设置页）。设置页不发 `powers.list.v1`，那里切换只决定下次进入目录的读取目标与安装目标。

关于「不提供点击能力」：这一条在实现中**未采用**（按确认结果选择「触发区可点击展开」）。触发器可点击展开菜单，但不再兼作标签页跳转——原来的问题是标签按钮同时承担「切 scope + 开菜单」两件事。

### 二、我的能力标签与详情弹窗

- 「我的能力」退化为普通标签按钮：只切 scope，去掉了 `aria-haspopup` / `aria-expanded` / 下拉箭头与 hover 菜单。
- DOM 语义调整：三个标签移入 `.power-filters__tabs`（`role="group" aria-label="范围"`），Agent 控件是它的**兄弟节点**，不再落在「范围」分组内部。
- 详情弹窗的 Agent 行改为**只读显示**：删掉 Agent `<select>`，自定义资源与管理态统一走同一个只读展示。`agent` 类型遇到非 bibit 时保留「该类型仅支持 bibit Agent。」提示并隐藏安装按钮，但删掉了「切换到 bibit」按钮——弹窗是 `showModal()` 模态，用户本来也够不到标签栏上的控件，要换 Agent 就先关弹窗。
- `dialogAgent` 这第二份 state 删除：列表查询、弹窗、安装/卸载、自定义资源上传与删除全部读同一个 `agent`。

### 三、市场 scope 的行为

- 市场里打开卡片后的安装目标改为**控件所选 Agent**（原来是强制 `bibit`，只能在弹窗里改；现在弹窗没有该选项了）。
- 列表只在 `installed` 下按 Agent 读取，所以只有那里需要依赖它：市场切换 Agent **不重发请求、不清空已选标签/页码**，只改变安装目标。

### 四、相关文件

- `src/components/AgentSwitcher.tsx`（新增）+ `AgentSwitcher.test.tsx`（新增 9 条用例）
- `src/components/PowerFilters.tsx`、`src/components/PowerDetailsDialog.tsx`、`src/AgentHubPage.tsx`
- `src/agentHub.css`（`.power-filters__agent-switcher` / `__agent-trigger` 新增、`.power-filters__agent-menu` 改 `right: 0` 向左展开、`.power-filters__tabs` 新增、删除 `.power-filters__scope-agent`）
- `src/agentHubI18n.tsx`（新增 `'Agent: {agent}'`，删除已无引用的 `'Switch to bibit'`，否则 orphan-key 用例会失败）
- 测试更新：`PowerFilters.test.tsx`、`PowerDetailsDialog.test.tsx`、`AgentHubPage.test.tsx`、`agentHubLayout.test.ts`
- 文档：开发指南新增 §7.2.4 并更新 §10.4 / §11 / §19，`README.md`，`debian/changelog`，版本 0.3.16
- `docs/verification/2026-09-30-agent-switcher.md`（新增验证记录）

### 五、验证结果或限制

`npm test` 544 例（541 通过；唯一失败的 `dev/sources.test.ts` 3 条 `readMarket` 为基线问题，与本次无关）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet build`、`gofmt -l`、`git diff --check` 均通过。用例数核对：`AgentHubLayout` 19→20、`AgentHubPage` 67→69、`PowerFilters` 10→12、`PowerDetailsDialog` 37→37、新增 `AgentSwitcher` 9，合计 +14，与套件总数 530→544 一致（用 HEAD worktree 逐文件对数，确认没有测试被静默删除）。

反向验证 5 处（全部按预期失败）：把 hover/`aria-haspopup` 放回「我的能力」标签；让选中 Agent 时额外调 `onTabChange('installed')`；把市场安装目标钉回 `bibit`；让 Agent 变化时无条件重置查询并重发市场请求；把弹窗的 Agent `<select>` 加回去。

限制：本次没有新增 WebKit 离屏探针——改动全是 DOM 行为与选择器对齐，jsdom + 布局契约足以覆盖；深色主题那套 `light-dark()` 契约未受影响。

## 2026-09-30 — 跟随宿主明暗主题 + 自定义资源改用独立色相（0.3.15）

分类：缺陷修复 / 体验优化

用户需求：

> hub 页面不能跟随系统变成深色模式，请修复。
> 并且自定义资源的颜色应与 MCP 颜色区分，目前比较相近。

### 一、深色模式不生效

原因：`src/agentHub.css` 里的颜色**全是明色字面量**（`--hub-bg: #f5f6f8`、`--hub-surface: #ffffff`、按钮 `#fff`、状态块 `#eef3fb` 等 60 余处），也不读 `color-scheme`。宿主切主题时给 `<html>` 加 `class="dark"` 并在 `.dark` 上把 `color-scheme` 切成 `dark`，插件对此没有任何响应，所以整个页面停在明色。

修法：**每个颜色都改成 `light-dark(浅色, 深色)` 成对声明**，由继承来的 `color-scheme` 取值。

为什么不是 `.dark .agent-hub { ... }`——这是本次最值得记下的结论：

- 宿主用 `trustedPluginStyles.ts` 的 `isolatePluginStyles` 把插件选择器统一重写为 `:where(<插件根元素>) <原选择器>`；
- 于是 `.dark .agent-hub` 变成 `:where(bibit-agent-hub-page-home) .dark .agent-hub`，它要求 `.dark` 是插件根的**后代**；
- 而 `.dark` 在 `<html>` 上，是插件根的**祖先**——这条规则永远不可能匹配。用仓库里的真实算法跑过一遍验证。

`light-dark()` 与 `prefers-color-scheme` 的取舍：宿主的主题是权威值（Linux 走 XDG Desktop Portal，加上用户显式选择与 Tauri 广播），可与 `prefers-color-scheme` 不一致；插件自己去读 `matchMedia` 则是第二套真值来源。`color-scheme` 是可继承属性、`light-dark()` 直接读它、宿主隔离只给选择器加前缀不碰声明值，所以 `light-dark()` 既准确又不需要插件复制切换逻辑（`bibit-plugin build` 产出的 CSS 里 58 个 `light-dark()` 全部保留）。

深色取值不是另配一套，而是**从明色那一支推导**：保持色相、提高明度直到对深色表面达到 4.5:1。语义色（状态、错误、安装/卸载、品牌按钮、Agent 菜单、阴影、弹窗遮罩、自绘滚动条）也全部 token 化，规则体里不再有裸字面量。宿主不声明 `color-scheme` 时 `light-dark()` 按 `normal` 解析、取浅色分支，等于回到改动前的观感，因此对老宿主是安全降级。

### 二、自定义资源与 MCP 撞色

自定义资源原本用琥珀 `#d9a13b`，与 MCP 的橙 `#a95e16`：

| 对比 | 改动前 | 改动后 |
| --- | --- | --- |
| 强调色 OKLCH 色相距离 | 21° | 73°（最近邻居 skill 也有 57°） |
| 卡片填充色 ΔE | **0.7**（几乎同色） | 3.2 |
| 徽标/边框 vs MCP 卡边 | 8–12° | 40°+ |

改用**玫红家族（OKLCH H 345）**：`--hub-custom` / `--hub-custom-soft` / `--hub-custom-line` / `--hub-custom-badge-*` / `--hub-custom-chip-bg`，明暗各一对。识别手段仍是自定义卡片独有的**虚线边框 + `Custom` 徽标**，色相只负责不再撞车。

相关文件：

- `src/agentHub.css`：颜色 token 全面改为 `light-dark()` 成对声明；新增中性/语义 token（`--hub-control-*`、`--hub-label`、`--hub-caption`、`--hub-thumb`、`--hub-focus`、`--hub-backdrop`、`--hub-shadow*`、`--hub-version-chip`、`--hub-status-*`、`--hub-error-*`、`--hub-install-*`、`--hub-uninstall-*`、`--hub-scope*`、`--hub-option-*`、`--hub-custom*`）；四个 type 色系改为成对值
- `src/agentHubLayout.test.ts`：新增 3 条契约——(1) 所有颜色型 token 必须成对声明、任何规则体不得残留裸颜色字面量（剥掉 `light-dark(...)` 后检查），唯一豁免 `--hub-on-primary`；(2) 自定义色相与四个 type 色相均相距 40° 以上、明暗两支色相一致；(3) 禁止琥珀色字面量回归
- `docs/verification/probe-dark-mode.py`（新增）：离屏 WebKitGTK 在 `light` 与 `color-scheme: dark` 两态各渲染一次，读回 `getComputedStyle` 与 `::backdrop`，断言表面翻转、正文对比度 ≥ 4.5:1、自定义与 MCP 的徽标/卡边/卡填充色相差 ≥ 40°
- `docs/development-and-deployment-guide.md`：新增 §7.2.1（主题机制与三种写法的取舍表）、§7.2.2（自定义色相必须与 MCP 分开），原滚动条小节顺延为 §7.2.3；§19 记录「板端实机深色外观尚未验收」
- `docs/verification/2026-09-30-dark-mode-and-custom-accent.md`（新增验证记录）
- `README.md`、`package.json`、`package-lock.json`、`bibit.feature.json`、`debian/changelog`：版本 0.3.15

验证结果或限制：

`npm test` 530/533（28 个文件；新增 3 条用例，唯一失败的 `dev/sources.test.ts` 3 条 `readMarket` 为基线问题）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`（`artifacts/agent-hub-0.3.15.bibit-plugin.tgz`，sha256 `a4835e38…`）、`make -C provider test vet build`、`gofmt -l`、`git diff --check` 均通过。探针 `probe-dark-mode.py --only shipped` 在 1600/1200/1024 三个窗口上 PASS：深色下页面背景 `rgb(18,18,18)`、正文 `rgb(250,250,250)`（对比度 17.95）、状态块与分页按钮与设置输入框全部翻转、`::backdrop` 从 `rgba(17,24,39,.42)` 翻成 `rgba(0,0,0,.62)`。变异验证 4 处：把某个 token 改回明色字面量（布局用例失败）、把自定义色相改回琥珀（布局用例 + 探针同时失败）、把页面背景钉成明色（探针失败并报出对比度 1.04）。

限制：**板端实机深色外观尚未验收**，本次深色证据来自离屏 WebKitGTK（2.52.6）；宿主若不声明 `color-scheme`，页面仍是明色（这是刻意的降级，不是缺陷）。

## 2026-09-30 — 标签筛选由并集改为交集（0.3.14）

分类：行为调整

用户需求：

> hub 页面中的标签 tag 筛选逻辑从并集改成交集。

改动前：选中多个 tag 时取**并集**——只要版本带有其中任意一个 tag 就会被列出，因此选得越多结果越多。

改动后：取**交集**——版本必须同时带有全部已选 tag 才会被列出，选得越多结果越窄；不选任何 tag 仍然是「不过滤」。

解决方案或完成结果：

- 改动点只有一处：`src/api/apm.ts` 的 `buildPowersResult`，把 `record.tags.some(tag => query.tags.includes(tag))` 改成 `query.tags.every(tag => record.tags.includes(tag))`。installed 与 market 走的是同一个函数（`powerCatalogClient` 的 market 分支也调用它），所以两个数据范围自动一致，不存在只改一边的风险。
- 过滤仍然作用在**精确版本**上、在系列聚合之前：tag 是版本级字段，所以「v2 带全部已选 tag、v1 只带其中一个」的系列会保留，但只留下 v2 这一个版本；`versions` 里不会混进不匹配的版本。
- 协议不变：`powers.list.v1` 的入参仍是排序去重、最多 20 项的 `tags`，wire 信封与 Provider 都不动，因此这次改动不需要新的 operation、不需要动 `debian/` 里的 grant 与 Registry。
- facets 语义不变：`facets.tags` 仍取当前 type 的全量去重集合、不受已选 tag 影响。这一点在交集语义下更重要——如果 facets 也跟着收窄，用户就再也点不回其它 tag 了。
- 清空选择回到「不过滤」：新规则只有在选到第二个 tag 之后才会与旧行为产生差异。

相关文件：

- `src/api/apm.ts`：`buildPowersResult` 的 tag 谓词与文档注释
- `src/api/apm.test.ts`：新增 2 条用例（多 tag 只有全中才列出；同一系列按版本分别过滤）
- `src/api/powerCatalogClient.test.ts`：新增 1 条 market 侧的交集用例（两条 tag 的结果是并集的真子集）
- `src/AgentHubPage.test.tsx`：原「selects tags in sorted OR order」用例改写为「selects tags in sorted order and narrows the list」，断言第二个 tag 让只带一个 tag 的卡片消失
- `docs/development-and-deployment-guide.md`：DTO 注释、market 全量约束、冒烟清单三处 OR → AND（交集）
- `docs/superpowers/specs/2026-08-27-apc-power-catalog-design.md`、`docs/superpowers/plans/2026-08-27-apc-power-catalog-plan.md`、`docs/superpowers/specs/2026-09-07-go-provider-design.md`：加「tag 语义已由 OR 改为 AND」的修订说明，历史条目保持原样
- `package.json`、`package-lock.json`、`bibit.feature.json`、`debian/changelog`：版本 0.3.14
- `docs/verification/2026-09-30-tag-intersection.md`（新增验证记录）

验证结果或限制：

`npm test` 524/527（28 个文件；新增 3 条用例，唯一失败的 `dev/sources.test.ts` 3 条 `readMarket` 为基线问题）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`（`artifacts/agent-hub-0.3.14.bibit-plugin.tgz`，sha256 `8acc14f3…`）、`git diff --check` 均通过；Provider 未改动，`make -C provider test vet build` 与 `--self-test` 仍通过。变异验证：把谓词改回并集，`apm.test.ts` 2 条、`powerCatalogClient.test.ts` 1 条、`AgentHubPage.test.tsx` 1 条同时失败，说明新断言确实锁住了交集语义。

限制：交集语义下，如果两个 tag 从未同时出现在任何版本上，结果会是空列表（页面显示「没有可用的 Power」）。这是交集的定义，不是缺陷；facets 保持全量，所以用户可以取消其中一个 tag 回到非空结果。

## 2026-09-30 — 设置标签页改为 APC Key 列表，可增删与单独启用（0.3.13）

分类：新增功能 / 交互调整

用户需求：

设置标签页里去掉「Clear Saved key」和「Save settings」；文本框输入 Key 后可点保存，保存后列表里显示该 Key（Key 头 + 中间星号 + Key 尾）；每条保存的 Key 有独立的删除与启用按钮，删除无需二次确认；列表中只有一个 Key 可以启用，它就是提交资源的输入；列表为空时新建的 Key 默认启用。

解决方案或完成结果：

- **表单改为“输入 + 保存 Key”**：`Save settings` 与 `Clear saved key` 两个按钮都被移除，输入框右侧只有 `Save key`（中文「保存 Key」）。保存是独立动作，输入框在成功后清空；`settings.update.v1` 的“省略即保留 / 空串即清除”语义不再需要，因此仓库里也不再有 `apiKeyDirty`。
- **列表即遮蔽视图**：每行显示 `preview`，形如 `apc-****-one`（前 4 + `****` + 后 4；短 Key 只留前 2）。遮蔽在 Provider 侧生成（`MaskAPIKey`），前端 `parseSettingsView` 还会拒绝不含 `****` 的 `preview`、重复 `id` 与超过一条 `enabled`——后端一次 bug 不会变成屏幕上的凭据。
- **每行独立的启用 / 删除**：`Enable` 在已启用的行上禁用；`Delete` 单击即执行，**没有二次确认**（行内按钮的可访问名已经写出要删的是哪个 Key，与仍需确认的卸载/删除自定义资源不同）。写入过程中两行按钮都禁用，避免并发写。
- **只有一个启用**：启用标志由 Provider 决定，页面只回显。列表为空时新增的第一条自动 `enabled: true`；已有 Key 时新增的保持未启用（新建不会偷偷换掉正在用的凭据）；`enable` 把目标置为唯一启用项；删除当前启用项后**不**自动启用其它 Key，此后上传返回未配置，直到用户自己点启用。`SettingsAPIKey` 只返回启用项，也就是 `apm submit` 真正拿到的凭据。
- **协议升级为上列表**：`settings.get.v2` 返回 `{showExperimental, refreshMinutes, keys:[{id,preview,enabled}]}`；三个写入 `settings.keys.add.v1` / `settings.keys.delete.v1` / `settings.keys.enable.v1` 取代 `settings.update.v1`，入参分别是 `{apiKey}` 与 `{id}`（32 位 hex 句柄）。operation 从 9 个增加到 11 个；`apiKey` 的 Registry `credentialParameters` 声明随之移动到 `settings.keys.add.v1`，否则宿主的参数策略会直接拒绝。
- **存储迁移**：`settings.json` 升到 schemaVersion 2（`apiKeys: [{id,key,enabled}]`，`id` 为 128-bit 随机 hex）。读到 v1 文件（单个 `apiKey`）时在内存里迁移为「一条已启用记录」，下一次写入落成 v2，老用户不会丢凭据；v2 文件里再出现 `apiKey`、或出现两条 `enabled`，一律报错而不是静默修复。权限（0600）、原子写入、拒绝对符号链接写入、上限 50 条、重复 Key 拒绝都不变。
- 前端新增 `src/api/settingsClient.ts`（读取/新增/删除/启用四个客户端），`dev/store.ts` 的 Mock 复刻同一套遮蔽与「首个启用 / 至多一个启用」规则，`dev/main.tsx` 注释同步；CSS 新增可收缩的 Key 行规则，`agentHubLayout.test.ts` 增加「预览可收缩换行、动作不换行」的契约断言，`docs/verification/probe-settings-key-list.py` 在离屏 WebKitGTK 里量 10 个窗口确认长 Key 不撑宽面板、不产生横向滚动、行内两个动作不换行。

相关文件：

- `src/components/AgentHubSettingsPanel.tsx`、`src/components/AgentHubSettingsPanel.test.tsx`（17 条用例）
- `src/api/contracts.ts`、`src/api/settingsClient.ts`（新）、`src/api/settingsClient.test.ts`（新）
- `src/agentHubI18n.tsx`、`src/agentHub.css`、`src/agentHubLayout.test.ts`、`src/AgentHubPage.test.tsx`、`src/manifestGrants.test.ts`
- `provider/internal/provider/settings.go`、`operations.go`、`contracts.go`、`config.go`、`server.go`、`selftest.go`、`cmd/provider-probe/main.go` 及其测试
- `dev/store.ts`、`dev/store.test.ts`、`dev/main.tsx`
- `debian/agenthub-provider.json`、`debian/agenthub-feature-grants.json`、`debian/changelog`
- `README.md`、`docs/development-and-deployment-guide.md`、`docs/cli-provider-development-and-deployment.md`
- `package.json`、`package-lock.json`、`bibit.feature.json`（0.3.13）
- `docs/verification/2026-09-30-settings-key-list.md`（新增验证记录）、`docs/verification/probe-settings-key-list.py`（新增离屏 WebKit 探针）

验证结果或限制：

`npm test` 521/524（28 个文件；唯一失败的 `dev/sources.test.ts` 3 条 `readMarket` 用例为基线问题，`git stash` 后同样失败）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`（`artifacts/agent-hub-0.3.13.bibit-plugin.tgz`，sha256 `cab64173…`）、`make -C provider test vet build`、`bibit-agenthub --self-test`（exit 0）、`gofmt -l provider/`（无输出）与 `git diff --check` 均通过。产物核对：`plugin.json` 为 0.3.13、`fallbackTitle` 为 `Capabilities`（0.3.12 文案）、`settings: []`；bundle 里 `Clear saved key` / `Save settings` / `hasApiKey` / `settings.update.v1` / `settings.get.v1` 出现 0 次，四个新 operation 与 `Save key` / `No key saved` / `Saved API Keys` 均出现。真机流程用 provider 二进制直接驱动验证：空列表 → add 第一条（`enabled: true`）→ add 第二条（`enabled: false`，第一条仍启用）→ enable 第二条（唯一启用）→ delete 启用项（剩下的行 `enabled: false`，上传返回 `incompatible` 的未授权路径）；v1 文件读取迁移与“下一次写入落成 v2”也已核对。三处变异验证确认新断言不是空转：`Enable` 去掉「已启用则禁用」、`parseSettingsView` 去掉遮蔽校验、Provider 删除时自动启用幸存项，各有对应用例失败。

限制：删除当前启用 Key 后不会自动启用其它 Key，是本次确认过的产品选择（图片/字面需求只说「列表中没有 Key 时新建默认启用」）；如果之后希望「始终有一条启用」，需要改 Provider 的 `DeleteSettingsKey` 而不是前端。

## 2026-09-30 — 文案改为「能力中心 / 能力市场」并去掉页头眉标（0.3.12）

分类：体验优化（纯前端文案）

用户需求：

仅更改前端文本：创建资源 → 创建；AgentHub title → 能力中心/Capabilities；我的 Power → 我的能力；Power 市场 → 能力市场；Type 标签中的 Agent → Expert；另外删掉页面顶部的 INTERNAL CATALOG 字样。

解决方案或完成结果：

- **创建入口**：`src/AgentHubPage.tsx` 的按钮文案由 `t('Create a resource')` 改键为 `t('Create')`，词典 `'Create': '创建'`。入口的行为、能力降级与 `aria-describedby` 关联都没动。
- **标题三处一致**：页内 `h1` 由硬编码 `Agent Hub` 改为 `t('Capabilities')`（中文「能力中心」）；Bibit 侧边栏菜单名 `agentHubLocales.en.title` / `['zh-CN'].title` 由 `Agent Hub` 改为 `Capabilities` / `能力中心`；`bibit.feature.json` 的 `display.fallbackTitle` 同步改为 `Capabilities`，宿主解析不到 locale 时也不会回落到旧名。
- **一级页签**：`'My Powers'` → `'My Capabilities': '我的能力'`，`'Power market'` → `'Capability Market': '能力市场'`，只改字典键与组件里的 `t(...)` 实参，`PowerScope`（`installed` / `market`）等 wire 值与 `PowerTab` 联合类型不变。
- **Type 的 agent 显示为 Expert**：新增 `src/displayFields.ts` 的 `resolvePowerTypeLabel(type)`，把 `agent` 映射为 `Expert`、其余原样返回，并接到四处面向用户的渲染——Type 篩选按钮、卡片徽标（`PowerCard`）、详情弹窗徽标与卸载/删除确认句的 `{type}`（`PowerDetailsDialog`）、自定义资源跳过 warning 的 `{type}`（`powerCatalogClient`）、删除成功句的 `{type}`（`AgentHubPage`）。这是**展示层映射**：`POWER_TYPES`、`data-power-type`、`powers.list.v1` / `install` / `uninstall` / `delete` 的 `type` 参数、APM 解析与去重键全部保持规范的 `agent`。卡片与弹窗徽标带 `text-transform: uppercase`，渲染为 `EXPERT`，与同行的 `SKILL` / `PLUGIN` / `MCP` 一致；篩选按钮是 `capitalize`，渲染为 `Expert`。
- **眉标移除**：页头 `<p>{t('INTERNAL CATALOG')}</p>` 整段删除，词典条目与只服务于它的 `.agent-hub header p` 规则一并删除；`h1` 的 `margin` 由 `4px 0 0` 回到 `0`，`.agent-hub__create-note` 补 `margin: 0`（原先由那条 `header p` 规则提供），保证不可用说明段落没有浏览器默认外边距。
- **无协议 / DTO / Provider 改动**：不触碰 `src/api/contracts.ts`、`dev/main.tsx`、Provider；`bibit.feature.json` 只升版本号与改 `fallbackTitle`，capability 不变。

相关文件：

- `src/agentHubI18n.tsx`（词典改键与菜单名）、`src/AgentHubPage.tsx`（页头与删除句）、`src/components/PowerFilters.tsx`、`src/components/PowerCard.tsx`、`src/components/PowerDetailsDialog.tsx`、`src/api/powerCatalogClient.ts`、`src/displayFields.ts`（新增 `resolvePowerTypeLabel`）
- `src/agentHub.css`（删除眉标规则、`h1` 与说明段落 margin 收口）
- `src/displayFields.test.ts`、`src/components/PowerFilters.test.tsx`、`src/components/PowerCard.test.tsx`、`src/components/PowerDetailsDialog.test.tsx`、`src/AgentHubPage.test.tsx`（同步改键并新增 4 条 Expert 断言）
- `docs/verification/2026-09-30-capabilities-copy.md`（新增）
- `package.json`、`package-lock.json`、`bibit.feature.json`、`debian/changelog`

验证结果或限制：

`npm test` 506/509（27 个文件；`src` 下 23 个文件 463/463 全通过；**唯一失败文件是 `dev/sources.test.ts` 的 3 条 `readMarket` 用例，基线即失败**——jsdom 把全局 `URL` 换成不继承 `node:url` `URL` 的实现，`http.get(url, options, cb)` 把它当 options，`git stash` 后同样失败，与本次改动无关）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`（`artifacts/agent-hub-0.3.13.bibit-plugin.tgz`，sha256 `6796aa46…`）与 `git diff --check` 均通过。

限制：本次是纯文案与字典键改名，**未做真机截图与离屏探针验证**（没有布局或尺寸改动；删眉标后页头的左右分布与创建入口列不变，说明段落的 `margin: 0` 是补齐原先由 `header p` 提供的值）。`docs/`（`README.md`、开发指南、`docs/superpowers/**`）与历史 `debian/changelog` 条目里仍保留旧的「我的 Power / Power 市场 / 创建资源 / INTERNAL CATALOG」措辞，它们是历史规格与变更记录，本次有意未改。

## 2026-09-29 — Hub 页新增手动刷新按钮（0.3.11）

分类：新增功能

用户需求：

在 Hub 页面中添加一个刷新按钮，用来手动刷新当前页面的内容。不包括在设置标签页中出现。该按钮的位置要合理，不挤占现有元素。可以和目前的「创建资源」并排，刷新在左，创建在右，文本使用符号而非文字。

解决方案或完成结果：

- 位置：页头右侧的 `.agent-hub__create` 列里新增一行 `.agent-hub__actions`（`display: flex`），DOM 顺序为**刷新 → 创建**，因此刷新在左、创建在右；「创建资源」的不可用说明段落仍留在该列下方，`aria-describedby` 指向关系不变，标题与动作行仍由 `space-between` 分隔，没有挤占既有元素。
- 符号而非文字：按钮可见内容只有 `<span aria-hidden="true">↻</span>`，可访问名称与悬停提示由 `aria-label` / `title` 提供，文案键 `Refresh`（中文「刷新」）进 `src/agentHubI18n.tsx`。这是仓库既有的符号用法（分页 `‹`/`›`、筛选 `⌄`/`✓`），不引入图片或 SVG。
- 不在设置标签页出现：按钮以 `tab !== 'settings'` 条件渲染。设置标签页读的是 `settings.get.v1`，页面在该标签页既不发起 `powers.list.v1` 也不保留 `view`，刷新目录对它没有意义；该标签页因此完全不渲染这个入口。
- 刷新语义：复用页面既有的 `retryLoad`（`setRetry(v => v + 1)`），**保持当前 scope / agent / type / tags / 页码 / snapshot**，只重取当前页；不调用 `resetPageScroll()`，所以不跳页、不重置滚动位置。market 第 1 页本身是全量重读；目录变化仍走既有 `reset_required` 分支回落第 1 页。
- 不打断在途读取：`disabled={view.status === 'loading'}`。bump `retry` 会 abort 在途的 `powers.list.v1` 再重发，这正是「窗口获焦不得打断 market 读取」那条约束规避的自取消（见 0.3.2）；禁用而非「点了再取消」把这条规则固化在按钮上。错误态下按钮可用，与错误提示里的 `Retry` 等价、可共存。
- 尺寸对齐：`.agent-hub__actions` 的**两个入口共用一个高度令牌** `--hub-action-height: 41px`（`.agent-hub .agent-hub__actions > button { min-height }` + `.agent-hub .agent-hub__refresh { width/height }`）。这不是凭计算拍的：WebKitGTK 2.52 用离屏探针实测，原生按钮的高度由平台控件字体决定（本机回退字体下 39px，而非 `14px/1.5 + 9px padding + 1px 边框` 预测的 41px），只让图标 `align-self: stretch` 也无效（grid 项的 `aspect-ratio` 在那里按内容宽度解，图标反而被压成 21.34×39）。钉住同一个令牌后两个入口在任何窗口都是 41×41 / 145.53×41 且顶边对齐，且「创建资源」在不加刷新按钮时尺寸完全不变。底色/边框/圆角沿用页面基础按钮规则，`:disabled` 与悬停态对齐既有分页按钮；CSS 全部收口在 `.agent-hub*` 命名空间内。
- 无 DTO / operation / Provider 改动：不触碰 `src/api/contracts.ts` 与 `dev/main.tsx`，`bibit.feature.json` 只升版本号，capability 不变。

相关文件：

- `src/AgentHubPage.tsx`：页头新增 `.agent-hub__actions` 行与纯图标刷新按钮，复用 `retryLoad`
- `src/agentHubI18n.tsx`：中文词典新增 `'Refresh': '刷新'`
- `src/agentHub.css`：`--hub-action-height` 令牌、`.agent-hub__actions` / `.agent-hub__refresh` 与共用的 `min-height` 规则
- `src/agentHubLayout.test.ts`：新增「刷新图标与创建入口同高」的文本级 CSS 契约
- `src/AgentHubPage.test.tsx`：新增 3 条用例（重取当前查询、设置标签页不出现、在途读取时禁用）
- `docs/verification/2026-09-29-refresh-button.md`（新增）、`docs/verification/probe-refresh-button.py`（新增离屏 WebKit 探针）
- `package.json`、`package-lock.json`、`bibit.feature.json`、`debian/changelog`、`docs/development-and-deployment-guide.md`

验证结果或限制：

`npm test` 505/505（27 个文件；0.3.10 基线 501，本次 +4：3 条页面用例 + 1 条 CSS 契约；唯一失败的 `dev/sources.test.ts` 3 条 `readMarket` 用例为基线问题，`git stash` 后同样失败）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`（`artifacts/agent-hub-0.3.11.bibit-plugin.tgz`，sha256 `99d33605…`）与 `git diff --check` 均通过。离屏 WebKitGTK 探针 `probe-refresh-button.py --only shipped` 在 1920→400px 十个窗口上全部通过（两个入口同高、图标在左且为正方形、无刷新按钮时创建入口尺寸不变、页头不溢出、页面不横向滚动）。六处变异验证确认新断言不是空转：去掉 `disabled` / 去掉 `tab !== 'settings'` / `onClick` 置空 / 图标换成文字标签 / 刷新选择器退回裸类名 / 去掉共用的 `min-height`，各有 1 项用例失败。

限制：`dev/sources.test.ts` 的 3 条 `readMarket` 用例在本机（Node 18.19.1 / vitest 3.2.4）**基线即失败**，与本次改动无关：jsdom 环境把全局 `URL` 换成不继承 `node:url` `URL` 的实现，传给 `http.get(url, options, cb)` 后 Node 不认它是 URL，于是把 options 对象当 listener，详见 verification 文档。实机 GUI 未验证：`↻`（U+21BB）属 Arrows 区，本机 `fc-match ':charset=21bb'` 命中 DejaVu Sans，探针也量到 19.3px 的字形宽度；板端若缺字，退路是替换为内联 SVG，不影响其余改动。

## 2026-09-29 — Hub 页新增「创建资源」入口，借 using-apm 新建 Power（0.3.10）

分类：新增功能

用户需求：

在 Agent Hub 页面新建一个「创建资源」按钮，点击后跳到 bibit 的新建会话，使用默认 agent，并在文本框中预填好提到 `using-apm` 的提示词；用户补充完需求后自己发送，由 bibit 内置的 `using-apm` skill 完成资源创建。

上游依据与现状（本次实测确认）：

- 宿主动作 `conversation.compose` 定义在 bibit 主线 `0e3d7b4f820f3a75c1ac549f4488c6f2fd45c91d`（`packages/feature-contracts/src/host-actions.ts`、`docs/feature-sdk/host-capabilities.md`），语义保证「一定新建会话、一定不发送」，输入上限 `skills ≤ 100`、`prompt ≤ 16 000`。
- 该动作在任何已发布的 bi-bit 里都不存在：板端 K3 装的 `bi-bit 0.1.18`、仓库最新 tag `bianbu/0.1.22`、`archive.bianbu.xyz` 上可下载的 0.1.22 实测 `grep -c conversation.compose /usr/bin/bibit-gui` 均为 0。0.1.18 已登记 `host:actions` 能力与 `host:actions` grant 白名单，但动作表只有 `conversation.create`，因此点击后返回 `UNSUPPORTED`。

解决方案或完成结果：

- `src/api/conversationCompose.ts`（新增）：预置草稿按「一句一行」拆成 `CREATE_RESOURCE_PROMPT_LINES`，由页面用插件翻译器逐行渲染后拼成多行文本，中英文各一份；`composeResource` 只做一次 `invoke('conversation.compose', { prompt })`，并把三种结果映射成 `ComposeOutcome`。`UNSUPPORTED` 用插件文案（宿主此时给的是 `Unknown host action: …` 开发者串，不上屏）；`INVALID_INPUT` / `FAILED` 用宿主已经本地化好的 `message`；`cancelled` 是用户自己放弃，不报错。
- `src/AgentHubPage.tsx`：页头新增「创建资源」按钮。`keep disabled` 而非「点了再报错」：`useFeatureCapability('host:actions')` 为 `undefined` 时按钮 `disabled`，并用 `aria-describedby` 指向一行说明。capability 经 `useRef` 取最新值（宿主每次 render 重建 capability 对象）；`composing` 期间禁用，保证一次点击一次调用；组件卸载后结果丢弃。`retryable` 的拒绝只加一句「请先清空输入框，再重试」，**不自动重试**。
- 只把 `using-apm` 写进提示词，不挂临时技能 chip：板端 `using-apm` 在 `presets.skills` 里对所有专家固定启用，再挂 chip 是重复；而设备未装该技能时带 `skills` 会让整次调用以 `INVALID_INPUT` 整体失败。
- `bibit.feature.json`：`requiredHostCapabilities` 增加 `host:actions`，版本升 0.3.10；`debian/agenthub-feature-grants.json`（`debian/rules` 装到 `/etc/bibit/feature-capability-grants.d/agenthub.json`）同步加上 `host:actions`。新增 `src/manifestGrants.test.ts` 双向比对声明与 grant：多声明或少授权都会让入口静默变灰，这条测试是发布前唯一能拦住它的地方。
- `vendor/` 的四个 `@bibit/feature-*` 从 0.3.0 升到 0.4.0，来源提交 `0e3d7b4`，`package.json` / `package-lock.json` 同步；升级后 `conversation.compose` 的类型与 `FeatureHostActionApiV1` 才存在。对既有 store 路径零行为差异（升级前后均为 337/337）。

相关文件：

- `src/api/conversationCompose.ts`（新增）、`src/api/conversationCompose.test.ts`（新增）、`src/manifestGrants.test.ts`（新增）
- `src/AgentHubPage.tsx`、`src/AgentHubPage.test.tsx`、`src/agentHubI18n.tsx`、`src/agentHub.css`
- `bibit.feature.json`、`debian/agenthub-feature-grants.json`、`debian/changelog`、`package.json`、`package-lock.json`、`vendor/*-0.4.0.tgz`
- `docs/verification/2026-09-28-create-resource-entry.md`（新增）

验证结果或限制：

`npm test` 501/501（27 个文件；功能分支合入前是 357/357，并入主线既有的 custom resources / 设置标签页 / 固定卡片宽度用例后为 501）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 与 `git diff --check` 均通过。五处回滚验证确认新断言不是空转：去掉调用入参里的 `prompt` → 2 项失败；去掉「无能力即禁用」→ 1 项失败；`UNSUPPORTED` 复用宿主串 → 2 项失败；去掉「清空输入框」提示 → 1 项失败；grant 少 `host:actions` → 2 项失败。

限制：**实机 happy path 未验证**。板端 `bi-bit 0.1.18`（及任何已发布版本）未登记 `conversation.compose`，点击只会得到 `UNSUPPORTED`；「新会话打开、技能以 chip 附上、提示词预填、消息列表为空、补字后可发送」以及「首页已有未发送草稿时返回 `FAILED` 且原草稿不被覆盖」需要等平台发布含该动作的 bi-bit（主线 `0e3d7b4` 之后）后执行。本次板端可验证的两条降级路径见 verification 文档。

## 2026-09-29 — Power 卡片固定宽度，窗口只改列数（0.3.9）

分类：问题修复

用户反馈（原文）：

> hub资源卡片会在bibit全凭时比窗口时更宽，窗口时卡片变窄，custom标记和描述会错位。我希望卡片大小固定（按照目前全屏大小），窗口大小变化时仅居中调整每行卡片个数。

第二轮反馈（原文）：

> 根据../bibit的默认窗口大小调整卡片大小，稍微减小卡片宽度，使默认窗口能够一行3个，现在启动是一行2个，两边留了很大的空隙

定位（本机 WebKitGTK 2.52.6 离屏 `WebKit2.WebView` 直接加载 `src/agentHub.css` 与真实卡片标记，并把页面放进真实宿主盒子「窗口 − 15rem 侧栏 − 2px 窗口边框」实测。窗口 → 列数 × 卡片宽度）：1920 → 5 × 276px、1600 → 5 × **232.8px**、1440 → 5 × **200.8px**、1276 → 5 × **170px**、1200（默认窗口）→ 4 × **200px**、1024（最小窗口）→ 4 × **159.5px**、640 → 2 × **282.4px**、400 → 1 × **368px**；同一行里管理态与自定义卡片的 `h2` 顶距是 65px / 60px（窄列时还有 78px）、描述顶距 101px / 96px（窄列时还有 114px）。

- **卡片宽度漂移**：`.agent-hub__grid` 原为 `repeat(5, minmax(0, 1fr))` + 1240/980/720/480px 四个断点改列数。列数固定而轨道是 `1fr`，等于让列宽吸收窗口宽度：窗口化后每张卡片都比全屏窄，断点越密越窄。
- **custom 标记与描述错位**：管理态卡片的版本槽是原生 `<select>`，继承 14px/1.5，实测盒高 **31px**；自定义态换成静态标签（12px + `3px 8px` 内边距），盒高只有 **26px**。同一行里两种卡片 header 相差 5px，自定义卡片的标题与描述整体上移（实测 `h2` 顶距 65px / 60px、描述顶距 101px / 96px）。
- 溢出还发生在窄列上：卡片变窄到 219–232px 时，`Custom` 徽标 + 版本槽超出卡片内容盒（实测最多 36px），视觉上叠进描述区。
- **固定后的第一版卡片（276px）在默认窗口只剩 2 列**：276px 是 1460px 内容列除 5 列的结果，而 BiBit 默认窗口 1200×800 的页面盒只有 958px（1200 − 15rem 侧栏 240px − 2px 窗口边框），扣掉 `clamp(20px, 4vw, 56px)` = 48px 内边距后内容列 862px；3 张 276px 卡片 + 2 个 20px 间距要 868px，差 6px，于是掉到 2 列、两侧各留 144px 空隙。

改动：

- `src/agentHub.css`：`.agent-hub` 新增默认窗口尺寸令牌 `--hub-default-window: 1200px`、`--hub-host-sidebar: 15rem`、`--hub-host-frame: 2px`、`--hub-page-padding: 48px` 与 `--hub-card-gap: 20px`，卡片宽度由它们推导：`--hub-card-width: calc((1200px − 15rem − 2px − 2 × 48px − 3 × 20px) / 3)` = **267.33px**（862px 内容列里 3 张卡片 + 3 个间距刚好占满，实际只用 2 个间距，多出的 20px 作为余量，默认窗口每侧空 10px）；内容列上限仍是 `--hub-content-max: 1460px`，`1460 ≥ 5 × 267.33 + 4 × 20 = 1417`，全屏仍是 5 列。内容列宽规则改用 `var(--hub-content-max)`。`.agent-hub__grid` 改为 `repeat(auto-fill, minmax(min(var(--hub-card-width), 100%), var(--hub-card-width)))` + `justify-content: center` + `gap: var(--hub-card-gap)`；删除 1240/980/720px 三条列数断点与 480px 断点里的列数覆盖，480px 只保留页面内边距与筛选行调整。`.power-card` 补 `grid-template-columns: minmax(0, 1fr)`（隐式列是 `auto`，超长版本号会把卡片顶宽）。`.power-card__version--static` 改为 `display: inline-flex` + `align-items: center` + `justify-content: flex-end` + `min-height: var(--hub-version-height)` + `max-width: 112px` + `overflow: hidden`，与 `<select>` 占同一个盒子。
- `src/agentHubLayout.test.ts`：新增 4 条 CSS 契约——网格只有一条 `grid-template-columns`（含 `auto-fill` 与 `var(--hub-card-width)`）且 `justify-content: center`；任何 `@media` 块都不得再声明 `.agent-hub__grid` 的列数；`--hub-version-height` 令牌存在且静态版本槽声明 `inline-flex` / `center` / `min-height: var(--hub-version-height)` / `overflow: hidden`；**卡片宽度令牌按算术展开后必须在默认窗口正好排 3 列**（把 `calc()` 里的 `var()` 代入并求值，同时校验内容列的上下界），宽度数字改错会直接失败（14/14 通过）。
- 文档：`docs/development-and-deployment-guide.md` §7.2 补「卡片宽度由 BiBit 默认窗口推导、窗口只改列数」与「版本槽两种卡片同高」两条规则，标题实测改为固定 229px 盒宽下的结论；§16.4 第 9 步验收改为按 1200×800（3 列）核对卡片恒为 267px、拖动窗口列数变化而宽度不变、Custom 与管理态卡片对齐。新增 `docs/verification/probe-fixed-card-grid.py`（离屏 WebKit2 探针，直接读 `src/agentHub.css`，把页面放进「窗口 − 15rem 侧栏 − 2px 边框」的真实宿主盒子里，`--only shipped` 会做断言：卡片宽度、默认窗口 3 列、标题/描述同一行、header 不溢出、页面不横向滚动；对照列把两处改动就地还原）。
- 版本：`package.json`、`package-lock.json`、`bibit.feature.json`、`providerVersion`、`debian/changelog`、README 与开发指南统一提升到 `0.3.9`。

验证：探针实测（本机 WebKitGTK 2.52.6，宿主盒子 15rem 侧栏）1920/1600/1512/1440/1360/1300/1276/1200/1150/1100/1024/640/400 全部 `cardW=[267.33]`，列数 5/4/4/3/3/3/3/**3**/2/2/2/2/1，`h2Top=[65]`、`descTop=[101]`、`cardH=[265]`，header 溢出与子元素重叠均为 0，`document.scrollWidth == window.innerWidth`；默认窗口 1200×800 下 3 列、两侧各空 10px（改前 2 列、两侧各空 144px）。`min()` 兜底从 299px 窗口开始生效（300→267.33px、296→264px、260→228px 且页面不横向滚动），远低于目标最小窗口 1024×740。同一探针的对照列复现了上表的宽度漂移、65/60px 行分裂与 36/34/23/5px 溢出。反向验证 4 项：还原网格（`repeat(5, minmax(0, 1fr))` + 断点）→ 2 条契约失败；还原静态版本槽（`display: inline-block`，无 `min-height`）→ 1 条失败；把 `--hub-card-width` 改回全屏的 276px → 新增的「默认窗口必须 3 列」算术契约失败，且探针在 1200×800 报 2 列、两侧各空 144px；恢复后 14/14 通过、探针 exit 0。详见 `docs/verification/2026-09-29-fixed-card-grid.md`。


## 2026-09-29 — 支持块标量 frontmatter，并停止对 APM 已管理资源报跳过（0.3.8）

分类：问题修复

用户反馈（原文）：

> 板上的bibit agent root的skill k3-media-pipeline vpu-benchmark为什么不符合hub的skill最低格式要求

定位：这两个 Skill 本身合规（`apm list --installed --agent=bibit --json` 有完整记录，真实 YAML 解析器也能读出完整 `description`），是扫描器的 YAML 子集解析器不认块标量。`description: >-` 的值在后续缩进行上，旧实现只记 `blockScalarIndent` 就跳过，键从未写入 `fields`，于是 `fields["description"]` 为空、被最低格式门槛判为 `invalid-authority-file`。板端 `powers.custom.list.v1` 已复现（两条 `invalid-authority-file`），受控 fixture 也确认只有 `>-`/`|` 写法被拒。第二个问题：这两个 Skill 由 APM 清单管理、卡片本来就正常显示，但跳过警告是无条件拼接的，于是用户看到的是「已列出的 Power 说不满足最低格式」的误报。

改动：

- `provider/internal/provider/custom.go`：`parseYAMLSubset` 改为按行索引推进，遇到块标量头（`|`/`>`，含 `+`/`-`/数字修饰符）时消费后续缩进块；`>` 折叠为空格分隔、空行分段，`|` 保留换行，块后同级键不受影响；空块不投影（仍走最低门槛拒绝）。新增 `countLeadingSpaces` / `blockScalarIndicator` / `readBlockScalar` / `blockScalarValue`，删除只记缩进的旧逻辑。
- `dev/custom.ts`：同一套算法的 TS 镜像（`readBlockScalar` / `renderBlockScalar`），保证 Dev Host 与真实 CLI 对「哪些目录被列出」的判断一致。
- `src/api/apm.ts`：导出 `powerSeriesKey(type,name)`，作为系列身份的唯一构造点。
- `src/api/powerCatalogClient.ts`：installed 分支用 `refreshAgent` 得到的记录构造 managed 集合，`customSkippedWarnings` 过滤掉已被 APM 清单管理的 `(type,name)`——与合并时丢弃同键自定义项用的是同一身份。
- 测试：`provider/internal/provider/custom_test.go`（新增 `TestParseYAMLSubsetReadsBlockScalars`、`TestScanCustomSkillAcceptsBlockScalarDescription`）、`dev/custom.test.ts`、`src/api/powerCatalogClient.test.ts` 各新增 1 例。
- 文档：`docs/development-and-deployment-guide.md` §10.6.1/10.6.2 与 `docs/cli-provider-development-and-deployment.md` §3.5 补充块标量与 managed 过滤规则。
- 版本：`package.json`、`package-lock.json`、`bibit.feature.json`、`providerVersion`、`debian/changelog` 统一提升到 `0.3.8`。

验证：`npm test` 474/477（3 项 `dev/sources.test.ts` 的 `readMarket` 失败为本机 Node 18.19 既有问题，stash 后同样失败）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet build` 与 `--self-test` 全部通过；riscv64 交叉构建的 Provider 在板上跑真实 home：`skipped` 为空、两条 Skill 的 `description` 与 APM 清单逐字一致。4 项反向验证（分别还原 `custom.go`、`dev/custom.ts`、`powerCatalogClient.ts`+`apm.ts`）确认新用例会失败。详见 `docs/verification/2026-09-29-block-scalar-scan.md`。

## 2026-09-29 — 卸载二次确认，确认后回到 Hub 列表（0.3.7）

分类：需求改进

用户需求（原文）：

> 我的power中卡片点击卸载后像自定义卡片删除一样有二次确认，确认卸载后也直接返回hub页面，而不是停留在卡片。

改动：

- `src/api/operationMessages.ts`：把结论文案的证据抽成共享的内部判定 `mutationOutcome`，新增导出 `isRemovalConfirmed(intent, execution, actual)`，与 `operationMessage` 共用同一套事实（避免文案与关闭决策漂移）。
- `src/api/installationStore.ts`：`InstallationSnapshot` 新增 `confirmedRemovals`；每次 `reconcile` 时按 `isRemovalConfirmed` 记录，`execute` 开始与 `invalidateAgent` 时清除该键的旧结论。
- `src/components/PowerDetailsDialog.tsx`：`confirmingUninstall` 本地状态；卸载改为两段式（展开确认 → `Confirm uninstall`），复用自定义删除确认的 `role="alertdialog"` 与类名；`series`/`agent` 变化时复位弹窗内的临时状态。
- `src/AgentHubPage.tsx`：写操作结束的 effect 在 `confirmedRemovals` 命中当前弹窗目标时 `closeDetails()`；`closeDetails` 提前声明并进入依赖。
- `src/agentHubI18n.tsx`：新增 `Uninstall this Power?` / `Removes {type} "{name}" for {agent}.` / `Confirm uninstall` 三个键。
- 测试：`operationMessages.test.ts`（新增 6 例，含「与结论文案一致」的锁定）、`installationStore.test.ts`（新增 4 例）、`PowerDetailsDialog.test.tsx`（新增 4 例并改写 1 例）、`AgentHubPage.test.tsx`（改写 1 例、新增 3 例）。
- 版本：`package.json`、`package-lock.json`、`bibit.feature.json`、`providerVersion` 统一提升到 `0.3.7`。

门禁：`npm test` 475/475（25 个文件）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet build`、`--self-test` exit 0。反向验证 7 项，其中 1 项首次未生效（"切换 Power 不复位确认态"用例原本因为 footer 整体消失而通过，断言不到复位逻辑），已把该用例改为新目标**仍有 footer** 的场景后确认失败。详见 `docs/verification/2026-09-29-uninstall-confirm.md`。

## 2026-09-29 — 删除后回到 Hub 列表；APC 凭据并入页面「设置」标签页（0.3.6）

分类：问题修复 + 需求改进

用户反馈与需求（原文）：

> 能正常显示自定义资源并执行上传和删除。但删除后仍停留在已被删除资源的弹窗，应该回到 Hub 页面。
> 另外删除 Agenthub 设置页面。APC API KEY 的配置改到 Agenthub 页面和我的 Power、Power 市场一级，添加设置/Setting 标签页。

已确认的边界：

- 「设置」标签页**只放 APC API Key**；`showExperimental` / `refreshMinutes` 不再有任何 UI（它们已确认无消费方），DTO 与 Provider 保持原样，页面读取后原样回填。
- 删除成功后**只关闭弹窗、不显示提示**；列表刷新与卡片消失本身就是反馈。
- 删除**失败**时弹窗保持打开并显示原因。

改动：

- 修复：自定义卡片的标题不再显示目录名。扫描器只把权威文件的 `name` 用于最低格式校验后即丢弃，于是缺 `name_zh`/`name_en` 的资源退回到身份名（目录名）。现在扫描器在资源未声明 `name_en` 时把声明的 `name` 投影到 `name_en`（skill/plugin 用 `name`，agent 用 `agent.name`），`name_zh` 仍优先、已声明的 `name_en` 不被覆盖；目录名保持为身份，继续用于去重与上传/删除目标解析。板端真实数据（`vi-coder` → `vibe-coder`、`space-power` → `spacemit-power`）已在两端复现并验证修复。
- 前端：`src/AgentHubPage.tsx`（`runCustomAction` 新增 `closeOnSuccess`；`tab` 状态与 `changeTab`；载入 effect 在设置标签下提前返回；`closeDetails` 改为 `useCallback`）、`src/components/PowerFilters.tsx`（导出 `PowerTab = PowerScope | 'settings'`，props 由 `scope/onScopeChange` 改为 `tab/onTabChange`，设置标签下不渲染 Type/Tags 面板）、`src/components/AgentHubSettingsPanel.tsx`（新，由 `AgentHubSettingsPage.tsx` 迁移并只保留 APC API Key）、`src/feature.tsx` 与 `bibit.feature.json`（移除 settings contribution）、`src/agentHubI18n.tsx`（新增 `Settings`；改写 unauthorized 文案；删除只服务于已删字段的 6 个键；`agentHubLocales` 去掉 `settings`）、`src/agentHub.css`（`.agent-hub-settings` → `.agent-hub-settings-panel`，改为页内卡片面板）。
- 删除：`src/AgentHubSettingsPage.tsx`、`src/AgentHubSettingsPage.test.tsx`。
- 测试：新增 `src/components/AgentHubSettingsPanel.test.tsx`（12 例）；`AgentHubPage.test.tsx` 新增设置标签 2 例与删除失败 1 例、改写删除成功用例（弹窗关闭 + 无提示）与 unauthorized 文案；`PowerFilters.test.tsx` 新增设置标签 2 例；`feature.test.ts` / `agentHubI18n.test.tsx` / `agentHubLayout.test.ts` 同步。
- 版本：`package.json`、`package-lock.json`、`bibit.feature.json`、`providerVersion` 统一提升到 `0.3.6`。

门禁：`npm test` 459/459（25 个文件）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet build`（Provider 117 例）、`--self-test` exit 0。反向验证 10 项（含标题兜底 2 项），其中 2 项首次未生效（CSS 变异打到了 `.power-filters__panel`；`savingRef` 在同 tick 内不可从 DOM 触达，实际生效的是按钮的 `disabled={saving …}` 绑定），已分别纠正为打中目标规则与绑定后确认失败。详见 `docs/verification/2026-09-29-settings-tab-and-delete-return.md`。

## 2026-09-28 — 自定义（手动安装）资源：展示、APC 上传与本地删除（0.3.4）

分类：需求改进

用户需求：

「我的 Power」除了显示在 APC 上下载的资源外，还要扫描并显示手动安装到安装目录下的自定义资源，卡片上必须与云资源明显区分；卡片提供 APC 上传与本地删除（系统 rm）功能；上传所需的 Key 在 Agent Hub 插件设置中配置。随后需求放宽为：**显示**不要求满足 apm 资源 schema，只要求对应资源的主流最低格式，不满足时给出 warning；**上传**仍必须满足格式要求；上传/删除按钮参考「安装」一并放进卡片弹窗。

已确认的边界（与用户逐条确认）：

- 「自定义」不是名为 `custom` 的目录，而是**手动安装、且 `(type,name)` 不在 apm installed 清单里**的资源；
- 本期跳过 MCP（apm 不为 MCP 维护目录，无法扫描）；codex 与 claude-code 的 Plugin 由各自 CLI 管理，也不扫描；
- 不新增 scope，合并进「我的 Power」，卡片打 `Custom` 标记；
- 显示校验取「Provider 轻量解析 + v1/v2 都接受」；上传仍走 `apm validate` + `apm submit`，Key 经环境变量注入；
- Provider 实现 `settings.get/update` 持久化，新增 `apiKey` 字段，结果只回传 `hasApiKey`。

解决方案或完成结果：

- Provider 新增三个自定义资源 operation 与两个 settings operation：`powers.custom.list.v1`（只做文件系统扫描，不调用 apm）、`powers.upload.v1`（`apm validate` → `apm submit`）、`powers.delete.v1`（`os.RemoveAll`）、`settings.get.v1` / `settings.update.v1`。`providerVersion` 与 `bibit.initialize` 的 operation 列表同步到 9 项。
- `internal/provider/custom.go`（新）：目录名即身份（须为规范 kebab）、权威文件按类型固定、只要求主流最低格式（skill 的 `name`+`description`、plugin 的 `name`、agent 的 `agent.name`），低于门槛的目录进入 `skipped` 并给出 `missing-authority-file` / `invalid-authority-file`；版本只接受规范 `v<x>.<y>.<z>`，否则留空；类型目录与资源目录都允许符号链接（跟随读取）。
- `internal/provider/upload.go`（新）：参数只带 `(agent,type,name,message)`，路径由 Provider 解析并重新校验；Key 从 `settings.json` 读出后经 `APC_API_KEY` 注入子进程，未配置时直接 `unauthorized` 且不启动 apm；失败原因先替换 Key 为 `***`、再去除 ANSI 与控制字符、压成单行并截断 300 字节。apm 的约定是「成功写 stdout、失败只写 stderr（slog logfmt 一行 + Cobra usage）」，因此 Provider 有界收集两条流并只取 stderr 那行的 `error` 属性作为原因，usage 块与日志前缀不进结果；前端优先显示该原因，拿不到时才退回 stage 固定文案。
- `internal/provider/settings.go`（新）：`settings.json` 目录 0700、文件 0600，写入走临时文件 + fsync + rename，拒绝向符号链接写入，损坏 JSON 报错而不覆盖；`apiKey` 省略表示保留、空串表示清除。
- 前端新增 `src/api/customResources.ts` 与一批闭集 DTO（`CustomResourceRecord/Skipped/List`、`UploadInput/Result`、`DeleteResult`、`AgentHubSettingsV1/UpdateV1`），`PowerWarning` 增加 `values` 与两个新 code；`buildMergedInstalledPowersResult` 把自定义记录并进 installed 结果、按 `(type,name)` 与 APM 清单去重、`source` 进 snapshot。
- 卡片：`data-source="custom"` + `Custom` 徽章 + 虚线琥珀配色；自定义资源只有一个版本，版本下拉换成静态标签（无版本时显示占位符）。弹窗：自定义资源不显示 APM 安装状态与安装/卸载，改为 `Upload`（内联发布说明表单）与 `Delete`（二次确认，文案写明 agent/type/name）。
- 扫描失败（含旧 Provider 不支持该 operation）只降级为一条 warning，installed 列表照常显示；`skipped` 逐条转为可翻译的 warning。
- 设置页根节点从 `main` 改为 `section` 并按设置内容契约改成可收缩；新增 APC Key 密码框与「已配置/未配置」状态、清除按钮；用 `apiKeyDirty` 区分「保留」与「清除」，保存防重复提交；Key 永不在页面回显。
- 打包：`debian/agenthub-feature-grants.json` 追加三个 operation；`debian/agenthub-provider.json` 新增 `credentialParameters: { "settings.update.v1": ["apiKey"] }`（宿主参数策略必需）；版本统一提升到 `0.3.4`。
- dev Mock：新增 `dev/custom.ts`（与 Provider 同语义的扫描/上传/删除，扫本机真实 home），`dev/store.ts` 与 `vite.config.ts` 接入 5 个新 operation，settings 改为带 `apiKey`/`hasApiKey` 的内存 echo。

相关文件：

- Provider：`provider/internal/provider/custom.go`（新）、`upload.go`（新）、`settings.go`（新）、`config.go`、`contracts.go`、`operations.go`、`server.go`、`selftest.go`、`apm.go`、`cmd/provider-probe/main.go`
- 前端：`src/api/contracts.ts`、`src/api/customResources.ts`（新）、`src/api/apm.ts`、`src/api/powerCatalogClient.ts`、`src/components/PowerCard.tsx`、`src/components/PowerDetailsDialog.tsx`、`src/AgentHubPage.tsx`、`src/AgentHubSettingsPage.tsx`、`src/agentHub.css`、`src/agentHubI18n.tsx`
- dev/打包/文档：`dev/custom.ts`（新）、`dev/store.ts`、`vite.config.ts`、`dev/main.tsx`、`debian/agenthub-feature-grants.json`、`debian/agenthub-provider.json`、`package.json`、`package-lock.json`、`bibit.feature.json`、`README.md`、`docs/development-and-deployment-guide.md`、`docs/cli-provider-development-and-deployment.md`
- 测试基础设施：`src/testSetup.ts`（新）在 jsdom 丢失 `crypto.subtle` 时装回 Node 的 WebCrypto（Node 20+ 为 no-op），`vitest.config.ts` 通过 `setupFiles` 引入；这恢复了 Node 18 下 23 项既有失败，不属于功能范围
- 测试：Provider 新增 `custom_test.go` / `upload_test.go` / `settings_test.go` 并扩展 `server_test.go`、`config_test.go`；前端新增 `src/api/customResources.test.ts`、`dev/custom.test.ts`，扩展 `contracts` / `apm` / `powerCatalogClient` / `PowerCard` / `PowerDetailsDialog` / `AgentHubPage` / `AgentHubSettingsPage` / `agentHubLayout` 测试
- 验证记录：`docs/verification/2026-09-28-custom-resources.md`（新增）

验证结果或限制：

`npm test` 448/448（Node 24.16，25 个文件，较 0.3.3 的 378 增 70；系统 Node 18.19 上 445/448，剩余 3 项为 0.3.2 基线逐条一致的 `dev/sources.test.ts` 既有失败）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`（产物 `artifacts/agent-hub-0.3.4.bibit-plugin.tgz`，sha256 `6230cc55…`）、`make -C provider test vet build`（`internal/provider` 115 例、`cmd/provider-probe` 10 例）、`--self-test` exit 0、`gofmt -l` 无输出、`git diff --check` 无新增空白错误。反向验证共 14 项（Provider 5 项、前端/dev 9 项），每一处改动分别导致 1–17 个用例失败，详见验证记录。

限制：本机只完成构建与单测；riscv64 交叉构建、两包上板与真实 GUI 中的展示/上传/删除未执行，真实 `apm submit` 需要有效 Key 与通过 v2 校验的资源，也未在本机打通。扫描有固定上限（每类型 200 项 / 总 1000 项 / 单文件 64 KiB），超限截断而非报错。

## 2026-09-28 — Power 展示信息跟随应用语言（0.3.3）

分类：需求改进

用户需求：

Power 格式已升级到 V2（`../using-apm`、APM ADR-038/ADR-039），四类资源的权威文件新增仅用于展示的 `name_zh`、`name_en` 与 `description_zh`，`name` 仍是唯一调用名。前端插件需要按应用语言把 Power 信息改为 `name_zh` / `name_en` / `description` / `description_zh`，原本的 `name` 不再显示，同时必须兼容只有 `name`/`description` 的 V1 资源。

上游字段现状（本次已实测确认）：

- APM `docs/Changelog.md` 2026-09-28 条目与 ADR-038 明确「不改 `list --json`/`show` 输出」，`internal/cli/list_render.go` 的 `listPowerJSON` 仍是 `agent/type/name/version/description/tags`；
- 实测两套 APC 目录（`developer.bianbu.xyz`、`www.spacemit.com` 的 `/resources`）全部 item 仍为 `schema_version: 1`，无任何展示键。

因此本轮只能先把**接收侧做对**：前端按契约容忍这三个字段、字段出现时按语言渲染、缺失时逐级回退。APM/APC 开始输出展示字段后前端无需再改。

解决方案或完成结果：

- `src/api/contracts.ts`：`PowerSeries` 新增可选 `name_zh`/`name_en`，`PowerVersion` 新增可选 `description_zh`；键集加入新字段，存在时必须是 trim 后非空的字符串，缺失则不写该键（区分「没有展示信息」与「作者填了空串」）。
- `src/api/apm.ts` / `src/api/apc.ts`：新增共享 `normalizeDisplayField`，非字符串报错点名字段、空白串按缺失丢弃；`buildPowersResult` 把 `name_zh`/`name_en` 提升到系列级（标题不随版本切换闪烁）、`description_zh` 留在版本级；`snapshotForRecords` 纳入展示字段，使「只改了展示名」的刷新也能触发换页失效与重渲染。
- `src/agentHubI18n.tsx`：新增 `AgentHubLanguageContext` 与 `useAgentHubLanguage()`，与翻译器共享同一份规范化语言；未新增任何文案键。
- 新 `src/displayFields.ts`：`resolvePowerTitle` / `resolvePowerDescription` 纯函数实现回退链 —— 中文宿主 `name_zh` → `name_en` → `name`、`description_zh` → `description`；英文宿主 `name_en` → `name`、始终用 `description`（英文界面绝不显示中文）。
- `PowerCard.tsx` / `PowerDetailsDialog.tsx`：标题与描述改走解析函数，卡片单行自适应字号也用解析后的标题；弹窗 `aria-label` 与标题一致。身份、请求、缓存键与 React key 一律继续使用 canonical `series.name`。

相关文件：

- `src/api/contracts.ts`、`src/api/apm.ts`、`src/api/apc.ts`、`src/displayFields.ts`、`src/agentHubI18n.tsx`、`src/components/PowerCard.tsx`、`src/components/PowerDetailsDialog.tsx`
- `src/displayFields.test.ts`（新增）、`src/api/contracts.test.ts`、`src/api/apm.test.ts`、`src/api/apc.test.ts`、`src/components/PowerCard.test.tsx`、`src/components/PowerDetailsDialog.test.tsx`、`src/AgentHubPage.test.tsx`、`src/agentHubI18n.test.tsx`

验证结果或限制：

`npm test` 378/378（23 个文件，较 0.3.2 的 337 增 41）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`（产物 `artifacts/agent-hub-0.3.3.bibit-plugin.tgz`）与 `git diff --check` 均通过。新用例在回滚实现后确实失败：去掉 `displayFields.ts` 的回退分支后 13 项失败，去掉 `contracts.ts` 新键白名单后 2 项失败。i18n 死键扫描仍为 0 孤儿键。Go Provider 未涉及，`provider/` 未改动。

限制：APM `list --json` 与 APC 目录尚未输出展示字段，因此板端当前渲染结果仍是 V1 回退（canonical name + description）；字段契约与语言回退已由单测锁定，上游就绪后即生效。板端真实 GUI 的语言切换复核未执行。

## 2026-09-24 — 修复 Power 市场误报「请求已取消」（0.3.2）

分类：缺陷修复

用户反馈：

Power 市场出现「Power 目录请求已取消。」。

问题与根因：

- **`cancelled` 被当成终止态错误**：`cancelled` 不在 `RETRYABLE_CODES` 内，错误渲染时没有 Retry 按钮，用户除切 scope 或离开页面外没有出口。但该码在架构里表达的是「被更新的请求取代」或「provider 会话被拆掉」，并非用户主动取消，也不是数据错误。
- **自取消**：页面 effect 依赖含 `retry`，而窗口 `focus` 事件会无条件 `setRetry(+1)`；每次 bump 触发 cleanup 的 `listController.abort()`，把正在飞的 market 请求掐掉再重发。market 是唯一走网络且耗时可观的 scope（板上实测 APC 全量目录约 0.95s），所以最容易被命中。
- **缓存代次竞争**：`commitCache` 在 `slot.generation !== generation` 时抛 `cancelled`，此时 `signal.aborted` 为 false，页面 catch 的 abort 护栏拦不住，于是渲染成用户可见错误。

相关文件：

- `src/AgentHubPage.tsx`：`RETRYABLE_CODES` 加入 `cancelled`；`focus` 监听在 `view.status === 'loading'` 时不再 bump `retry`（改用 `viewStatusRef` 读取，监听器保持稳定）
- `src/api/powerCatalogClient.ts`：`commitCache` 返回 `'committed' | 'superseded'`，代次落后时不再抛错，改为从更新的缓存作答；被中止的请求仍然拒绝提交
- `src/AgentHubPage.test.tsx`：`cancelled` 纳入错误映射的参数化用例（期望可重试）；新增「market 飞行中窗口获焦不得重发请求、不得渲染 cancelled」
- `src/api/powerCatalogClient.test.ts`：原「过期请求以 cancelled 结束」用例改为「过期请求从更新的缓存作答」

解决方案或完成结果：

被取代（superseded）不再是错误：慢请求发现自己落后时，直接用新提交的缓存产出结果，不再抛 `cancelled`；窗口获焦只在空闲态触发刷新，不会中断进行中的 market 读取；即便 `cancelled` 仍从宿主或 provider 冒出来（会话拆除等），页面也会给出 Retry 而不是死路。

验证结果或限制：

`npm test` 337/337（22 个文件，较 0.3.1 的 335 增 2 条）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 与改动文件的 `git diff --check` 均通过；Go Provider 未涉及，`go test ./...` 复跑通过。三条新断言在回滚源码后均失败（重发请求计数 3≠1、cancelled 无 Retry、过期请求抛 Unknown Error），确认测试确实覆盖修复点。

限制：板端真实 GUI 复核未执行。注意宿主 `install_bundle` 对同版本 bundle 走 `AlreadyInstalled` 幂等跳过，因此本修复要上板生效必须先提升版本号（如 0.3.2），否则宿主不会替换 0.3.1 的已安装内容。

## 2026-09-18 — Power 市场卡片布局、滚动条与标题定版（0.3.1）

分类：需求改进 + 缺陷修复

说明：本条记录一次连续迭代的最终落地结果，过程中的中间版本号（0.3.2–0.3.5）已合并进 0.3.1 这一个版本，中间版本的产物移到 `artifacts/superseded-0.3.1-pre-unify/`；文档与代码只保留这一版。

用户需求与反馈：

1. 默认窗口化（BiBit 主窗口 1200×800）进入 Power 市场时，卡片被描述撑得又高又窄、页面没有上下滚动，第 5 张卡片和翻页按钮都被裁掉；需要卡片布局适应不同窗口，描述允许只显示一部分、用无边框滚动区浏览。
2. 卡片里的滚动条要隐藏（像 tags 那样），不要描述区的横向滚动条，描述框提高到 5 行。随后澄清：不是完全隐藏，而是**静止时不显示、滚动时显示当前位置**，并且要覆盖插件页面里**所有**滚动条，包括页面那根大滚动条。
3. 上述滚动条改法在真实 GUI 里没有生效——卡片滚动条与页面大滚动条一样“常显示”。
4. Power 名字不要换行，字号调整到能在一行里显示完，使卡片排版可以对齐。

问题与根因：

- **页面不能滚动**：宿主给页面 contribution 的盒子是 `min-h-svh`（`SidebarProvider` / `SidebarInset` 只有 `min-height`，没有确定高度），`div.size-full` 与 `FeatureContributionHost` 的 `h-full` 在这条链上解析不出确定值——页面高度退回 `auto`、随内容变高，`overflow-y: auto` 永不触发，超出窗口的内容直接不可达。宿主自己的全高页面用的是视口单位（`h-svh`）。Local Preview 的 Dev Host 画布是自适应高度，掩盖了这个问题，所以本地看不出来。
- **滚动条 CSS 是死代码**（两次改法无效的原因）：宿主全局样式 `* { scrollbar-width: thin; scrollbar-color: oklch(...) }`（`web-app/src/index.css`）覆盖所有元素；按规范 `scrollbar-width` 非 `auto` 时所有 `::-webkit-scrollbar` 规则失效，WebKitGTK 又完全忽略 `scrollbar-color`、且对运行时样式变更永不重绘（开发板实测数据见开发指南 7.2.1）。结论：平台滚动条无法做到“静止隐藏、滚动时出现”，插件写任何滚动条伪元素都是死代码。
- **标题换行导致卡片不齐**：`.power-card h2` 原为 `-webkit-line-clamp: 2`，名字长的卡片标题占两行、短的占一行，网格行（`grid-template-rows: auto …`）高度不一致，描述区起始位置参差不齐。

相关提交（同一版本内的连续修正）：

- `fix: bound the Power card grid and let the page scroll`
- `fix: size the page against the viewport so it really scrolls`
- `fix: make every plugin scrollbar auto-hide instead of disappearing`（方案本身无效，见上）
- `fix: draw the scrollbar indicator instead of styling the platform bar`
- `feat: fit Power names on a single line`

相关文件（最终状态）：

- `src/agentHub.css`：`.agent-hub` 用 `height: 100vh; height: 100svh` + `overflow-y: auto` 自持滚动；`.power-card` 删掉 `min-height`、`align-content: start`；`.power-card__description` 固定 5 行（`7.5em`）无边框滚动区、`overflow-x: hidden`；`.power-card h2` 固定 `height/line-height: 26px` + `nowrap` + `ellipsis`；`.power-pagination` 吸底；五个滚动容器（页面、描述、两处标签行、弹窗内容区）`scrollbar-width: none` + `position: relative`，`.agent-hub__scroll-thumb` 自绘指示条
- `src/AgentHubPage.tsx`：`useLayoutEffect` 量出 `window.innerHeight - rect.top` 写成内联高度并在 resize 时重算；换页/换范围/换 Agent/换类型/换 tags 时回顶
- 新 `src/ScrollThumb.tsx`：自绘 overlay 指示条（按 `client/scroll` 比例算长度与位置，滚动时显示、停 1s 淡出，`pointer-events: none`）
- 新 `src/useFittedFontSize.ts`：在 19px 上限下量一次文本自然宽度（`Range.getBoundingClientRect()`），按 `max × 盒子宽 ÷ 自然宽` 反解字号并夹在 `[13, 19]`，`ResizeObserver` / `window.resize` 触发重算
- `src/components/PowerCard.tsx`、`PowerFilters.tsx`、`PowerDetailsDialog.tsx`：给描述区、卡片标签行、筛选标签行、弹窗内容区挂 `ScrollThumb`；标题挂 `useFittedFontSize`
- 测试：新 `src/ScrollThumb.test.tsx`、新 `src/useFittedFontSize.test.tsx`，`src/agentHubLayout.test.ts` 扩到 8 条 CSS 契约，`src/AgentHubPage.test.tsx` / `src/components/PowerCard.test.tsx` 补齐量与接线回归
- 新 `dev/devHostViewport.css` 与 `dev/main.tsx` 改动：把 Local Preview 画布压成固定一个视口高，复现宿主给插件的盒子（仅预览，不进 bundle）
- `package.json`、`package-lock.json`、`bibit.feature.json`、`debian/changelog`：0.3.0 → 0.3.1（中间版本号合并）
- 文档：开发指南 7.2 重写 + 新增 7.2.1（WebKitGTK 实测表）与本文

解决方案或完成结果：

- 页面自己承担滚动：高度用视口单位兜底、再由 `useLayoutEffect` 按宿主盒子校准，一页最多 20 张卡片都能滚到，分页控件 `position: sticky; bottom: 0` 常驻底部；
- 描述区固定 5 行、无横向滚动条，完整描述仍在详情弹窗内；
- 所有插件滚动条“静止不可见、滚动时显示位置、停约 1 秒淡出”：插件关掉原生条（`scrollbar-width: none`，这是插件能设的属性），由 `ScrollThumb` 自绘指示条，鼠标停在区域上也不会一直挂着；
- 标题永远一行：盒子固定 26px（所有卡片标题行等高），字号按名字长度在 13–19px 之间自适应，`text-overflow: ellipsis` 只作极端长名字的兜底——卡片网格的标题行、描述区、标签行因此全部对齐。

验证结果或限制：

`npm test`（22 个文件、335 项测试）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 全绿；CSS 契约测试会拦住“再写死 `::-webkit-scrollbar`”“把滚动条彻底藏掉”“重新引入 `-webkit-line-clamp`”等回退。开发板（`bianbu@10.0.91.51`，riscv64，WebKitGTK 2.52）实测：

- 滚动条：`scrollbar-color` 被忽略、`::-webkit-scrollbar` 仅在规则一开始就匹配时生效且运行时永不重绘、`scrollbar-width: none/thin` 生效（表见 7.2.1）——据此选定自绘方案；
- 标题：用真实字体与真实卡片内容宽（182 / 223 / 238px）量真实目录名，最长 `foo-before-summary`（19px 下 193px）在最窄 182px 列里缩到 17.5px 正好放下，`markdown-maker`（165px）及其余全部名字任何断点都是满号 19px，所有用例单行、盒高 26px；构造出的 368px 超长名字落到 13px 下限并被省略号截断。

板端只保留 `bibit-agenthub-plugin 0.3.1` + `bibit-agenthub-cli 0.3.1`（从 0.3.5 降级到统一版本），bundle sha256 与本地产物一致，provider `--self-test` 退出 0；真实观感与布局最终仍需重启 Bibit 后按开发指南 16.4 步骤 9 复核。

## 2026-09-10 — 插件中英文跟随 Bibit 系统语言

分类：功能变更

用户需求：

给 Agent Hub 插件增加随 Bibit 系统切换中英文的能力，参考 `../bibit-runtime-plugin` 的实现方式。

相关提交：

- `feat: follow the host language for all plugin copy`（本条记录所在提交）。

相关文件：

- 新 `src/agentHubI18n.tsx` 及 `src/agentHubI18n.test.tsx`：英文源串词典、`en` / `zh-CN` 菜单资源、Provider、稳定 `t`、`withAgentHubI18n`
- `src/api/operationMessages.ts`、`src/api/installationStore.ts`：文案改为 `TranslatableText { text, values? }`，语言不在数据层持有
- `src/AgentHubPage.tsx`、`src/AgentHubSettingsPage.tsx`、`src/components/*`：所有标签、状态、错误与 aria 文案经 `t(...)` 渲染
- `src/feature.tsx`、`src/plugin.tsx`、`bibit.feature.json`：`locales`、`pluginLocales` 导出、设置导航 `titleKey`、版本 0.3.0
- `dev/main.tsx`：语言下拉框与 `?lang=zh-CN`
- `vendor/bibit-feature-*.tgz`、`package-lock.json`：按目标 Bibit `b538783`（`bianbu/0.1.8`）重新打包并同步 integrity
- 文档：`docs/verification/2026-09-10-plugin-i18n.md`、本指南 1 / 3 / 6.1 / 6.2 / 7.1 / 11.2 / 16.4 / 18 / 19 与 `README.md`
- `src/components/PowerFilters.test.tsx`：修掉 2026-09-09 记录过的键盘焦点时序失败（等待触发键的 `requestAnimationFrame` 落定后再继续按键）

解决方案或完成结果：

页面、设置页与全部组件的自有文案以英文为源语言，按宿主传入的 `language`（`en` 或 `zh-CN`）翻译成中文；菜单、导航与描述键通过插件入口的 `pluginLocales` 导出交给宿主注册。`withAgentHubI18n` 只注入 Provider，不加 `key`，列表 effect 依赖不含 `language`，因此切换语言时已加载列表、筛选、分页与已打开的详情弹窗保持不变且不重新请求。安装状态与操作文案以 `{ text, values }` 形式在渲染边界翻译，状态机不持有语言。Dev Host 支持 `?lang=zh-CN` 与右上角语言下拉框。

验证结果或限制：

`npm test`（19 个文件、313 项测试，连续 5 次全量运行与 8 次 `PowerFilters` 单独运行全绿）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 与 `git diff --check` 均通过；产物 `artifacts/agent-hub-0.3.0.bibit-plugin.tgz` 内 `plugin.json` 声明 `["en","zh-CN"]`，`dist/plugin.js` 确认导出 `pluginLocales` 并含中文词条。宿主契约由发布版 `bi-bit 0.1.4` 二进制与 `../bibit` 提交 `b0bcc45` 确认。板端真实 GUI 下的系统语言切换尚未执行，需按开发指南 16.4 步骤 7–8 复核；0.1.4 之前的宿主不传 `language`，页面固定英文。

## 2026-09-09 — 接入 APM Hermes Agent

分类：新增功能

用户需求：

为 Agent Hub 插件增加 `../apm` 已适配的 `hermes-agent`，与 Bibit、Codex、Claude Code 并列管理 Power。

相关提交：

- `feat: add Hermes Agent support via APM`（本条记录所在提交）。

解决方案或完成结果：

扩展前端 Agent 列表及 Go Provider 操作白名单；“我的 Power”筛选与详情安装目标支持 `hermes-agent`，列表、详情、安装和卸载复用 `service:store` 及现有版本化 operation，以 `--agent=hermes-agent` 调用 APM。Hermes 支持 Skill、MCP、Plugin，`agent` 类型仍仅支持 Bibit。开发入口与组件说明、README 和开发指南同步更新，增加菜单选择、契约校验、Provider argv 和安装/卸载后刷新回归覆盖。

验证结果或限制：

`npm test`（17 个文件、284 项测试）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet`、`make -C provider build`、本机 Provider `--self-test` 和 `git diff --check` 均通过。独立代码审查未发现正确性问题。并行构建期间现有 PowerFilters 键盘焦点测试出现一次时序失败，单独重跑完整测试通过。APM 命令验证使用隔离替身；未进行真实 Hermes 安装/卸载或设备部署，运行环境需提供支持 Hermes 的 APM 及对应 Agent 依赖。

## 2026-09-08 — Power 详情与安装/卸载，双 deb 上板部署，真实 GUI 闭环在 Bibit 0.1.4 通过

分类：功能变更

设计 `e218a13`；计划 `docs/superpowers/plans/2026-09-08-power-details-install.md`。实现/文档提交：`3cca5f5`（operation 契约）、`5a85718`（Go v1 Provider 执行 APM）、`9ace521`（共享安装状态与写互斥）、`bbf690e`（详情弹窗与卸载接线）、`6511356`（dev 与正式 Provider 同契约）、`1aebdf3`（grant、超时、双 deb）、`06adfe1` `b963adc` `88ddcde` `2b9f1a7` `50af82c` `3634357`（验证与文档）。

用户需求：

为 Agent Hub 增加 Power 详情（inspect）与安装/卸载（install/uninstall），经 Go v1 Provider 的 `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` 走 `service:store` 执行 APM 命令；前端用可订阅的安装状态仓库管理写互斥、串行写入与事后确认；dev 传输层与正式 Provider 保持同一 wire 契约；追加 operation grant、写请求 120000ms 超时与双 deb，并在真实 Bibit 中验证完整操作闭环。

相关文件：

- 新 `src/api/powerOperations.ts`/`installationStore.ts`/`operationMessages.ts` 及测试：闭集 parser、可订阅状态、写互斥与安全文案
- 新 `src/components/PowerDetailsDialog.tsx` 及测试；`PowerCard.tsx`、`AgentHubPage.tsx`、`agentHub.css` 受控化接线
- `provider/internal/provider/{contracts,server,config,operations,apm,process_linux,selftest}.go` 及测试：operation 联合分派与 APM 子进程执行
- `dev/store.ts`/`sources.ts`/`vite.config.ts`/`dev/main.tsx`：dev 与 Go 同 argv/env/返回规则
- `debian/agenthub-feature-grants.json`/`agenthub-provider.json`：追加 inspect/install/uninstall、120000ms 上限
- 文档：`docs/verification/2026-09-08-power-management.md`、`docs/verification/2026-09-08-bibit-host-token-rotation.md`

解决方案或完成结果：

Provider 声明 list/inspect/install/uninstall 四枚 operation（协议 v1、`providerVersion:0.2.3`）；installed 每次 `apm list --installed --agent=<agent> --json`，inspect 执行 `apm list <name> --installed --json --agent --type` 并按目标 agent/type/name 校验记录归属，install/uninstall 执行明确 argv、非零退出码作为 `{status:"exited",exitCode}` 正常结果回传（不读 stderr、不猜失败原因），版本号强制 `vMAJOR.MINOR.PATCH`。前端 `installationStore` 用 epoch 丢弃迟到查询、写前检查、串行执行、事后独立预算刷新；详情弹窗共享版本选择，installed 仅卸载、market 打开详情。grant 追加三枚 operation 但 capability 仍只有 `service:store`；Registry 写请求上限 120000ms。

验证结果或限制：

前端 `npm test` 161→272 全绿，`typecheck`/`build:dev`/`build:plugin`/`git diff --check` 通过；Go `go test ./...`/`go vet ./...`/`go build`/`--self-test` 退出 0。双 deb 构建并上板：`bibit-agenthub-plugin_0.2.3_all.deb`（sha256 `f3f77aef…9fba`）、`bibit-agenthub-cli_0.2.3_riscv64.deb`（sha256 `7db10b43…ba37`），`apm` 装入 `/usr/bin/apm`，Provider 装入 `/usr/libexec/bibit/bibit-agenthub`。板端部署后的正式产物经 NDJSON 全链路通过：initialize → list（空/含 `foo-before-summary v0.0.1`/空）→ install/uninstall `exitCode:0` → inspect 单条。开发阶段按指示使用开发签名。

限制（已解决）：真实 Bibit GUI 内 UI 闭环最初被板端 bi-bit 0.1.3 的宿主缺陷阻塞——`voice-overlay` 与 `main` 两个 surface 都执行 `loadTrustedPluginEntries`→`trusted_plugin_prepare_active`，后者 `force_rotate=true` 轮换 feature-instance token，使主窗口插件 token 失效，任何 `service:*` 请求均 `request_unauthorized`。根因与修复建议见 `docs/verification/2026-09-08-bibit-host-token-rotation.md`。

随后用 `~/Downloads/bi-bit_0.1.4_riscv64.deb`（sha256 `4b2e81b4…3125`）升级板端宿主到 0.1.4 后，阻塞消除：启动日志仅一条 `Loaded trusted plugins: agent-hub@0.2.3`（0.1.3 为两条）、无 `restricted to the main window` 报错、无 `request_unauthorized`，`external_service.provider_ready service=store provider=0.2.3 protocol=1 operations=4` 正常出现。真实 GUI 全闭环验证通过：market 详情→安装（`apm list --installed --agent=bibit` 含 `foo-before-summary v0.0.1`）→「我的 Power」卡片→卸载（installed 清空）→market 详情恢复「未安装 + 安装」且显示「卸载完成」。详见 `docs/verification/2026-09-08-power-management.md` 的「板端真实 GUI 闭环验证（Bibit 0.1.4）」。板端 0.1.3 二进制已备份至 `/home/bianbu/bibit-backup-0.1.3/`。

## 2026-09-07 — 实现 v1 Go Provider、前端目录缓存与双 deb 上板验收

分类：功能变更

提交（设计 `473fdab`，计划 `45abcf2`，实现/文档见下）：

- `473fdab` 设计、`45abcf2` 计划
- `e9a544b` raw wire 契约、`d390e5e` 有界 v1 协议、`6ab97c4` APM/APC、`d5805ee` 自检与 stdio 驱动
- `e2ebdba` 前端缓存迁移、`e2e9b56` 双 deb、`7f717c3` 文档
- `01d4bd1` vendor SDK 同步 0.3.0、`f3a5163` 交叉编译 strip 修复、`409a05e` Provider 接受宿主 client 字段

用户需求：

用独立 Go 标准库 stdio Provider 通过宿主 `service:store` 接通 APM installed 清单与 APC 公开全量目录，Provider 只做纯中间件（不解析业务字段、只比较 `catalog_sha256`），业务解析/过滤/聚合/去重/分页/facets/snapshot 判断全部留在前端数据层，dev 与生产共用同一实现。系统部署拆分为前端 bundle（`bibit-agenthub-plugin`，Architecture: all）与 CLI Provider（`bibit-agenthub-cli`，Architecture: any）两个 deb。

相关文件：

- 新增 `provider/` Go module：`internal/provider/{server,contracts,errors,config,apm,apc,process_linux,process_other,selftest}.go`、`cmd/bibit-agenthub`、`cmd/provider-probe`、`Makefile`
- `src/api/{contracts,catalogIntegrity,powerCatalogClient,apc,apm}.ts`：wire 信封闭集、Web Crypto SHA-256 校验、`WeakMap` 缓存客户端
- `dev/{sources,store}.ts`：与 Go 同语义的 transport 与 wire 校验 store；`vite.config.ts`、`dev/main.tsx`
- `debian/{control,rules,changelog,agenthub-provider.json}`：双 deb + Registry v2 drop-in
- `vendor/`：`@bibit/feature-*` 同步 0.3.0（`service:store` 规范名称）
- 文档：`README.md`、两份部署指南、`AGENTS.md`、`debian/vendor/README.md`

解决方案或完成结果：

Provider 只声明 `powers.list.v1`、协商协议 v1；installed 每次执行 `apm list --installed --agent=<agent> --json`（退出码非 0 映射可重试 `unavailable`，绝不伪造空清单），market 每次查 `resources/version`、`catalog_sha256` 相同返回 `not_modified`、变化才下载 `resources`。前端 `WeakMap` 按 service + 缓存键隔离，generation 提交前复查、过期/取消的慢请求以 `cancelled` 结束不覆盖缓存。Registry 写入 `version:2`、`transport:stdio`、`lifecycle:managed`、`protocolVersions:[1]`、`requestTimeoutMs:30000`，CLI 包拥有 `/usr/libexec/bibit/bibit-agenthub` 与 `/etc/bibit/external-services.d/agenthub.json`。

验证结果或限制：

前端 `npm test` 161/161、`typecheck`、`build:dev`、`build:plugin` 全过；Go `go test ./...` + `go vet` 过；`--self-test` exit 0；provider-probe 对真实 APC 得到 market data（snapshot `152e5780…`、5738 字节）与 not_modified。两个 deb 实际构建（amd64 + riscv64），`readelf -h` 确认 RISC-V，`dpkg-deb --contents` 核对归属（CLI 无 probe/grant/bundle）。开发板 `bianbu@10.0.91.51`（riscv64）安装两包并激活插件 0.2.2，宿主 spawn provider 并协商 `protocol=1`（`provider_ready service=store provider=0.2.2 protocol=1 operations=1`），market 可浏览/筛选；installed 因板上无 `/usr/bin/apm` 正确降级为可重试 `unavailable`（页面显示 "Power catalog is unavailable"，非空清单伪造）。

限制：正式发布仍需公司签名 bundle + 平台公钥登记（目标 Bibit `plugin-trusted-keys.json` 为空）；构建套件无 `golang-go ≥1.26.5`（本地 `/usr/local/bin/go` 1.26.5 交叉构建）；板上无 apm，installed 真实数据未验收；settings 持久化、v2 jobs/文件传输不在本期。

## 2026-09-07（后续）— list --json 恒带 description/tags，恢复 installed 描述与标签显示

分类：功能变更

用户需求：

`../apm` 合入 ADR-029 后，`apm list --json` 成为完整机器接口：每条记录恒带 `description`（空为 `""`）与 `tags`（空为 `[]`、非 `null`），installed 记录多 `agent`，使前端通过 `list --installed` 批量获取本地资源时能拿到描述与标签；`show` 是 Cloud-only、单 name，覆盖不了本地清单与批量场景。上一轮"身份记录"对齐需要据此反转，恢复 installed 范围 description/tags 与 tag 过滤的展示。

相关文件：

- `src/api/apm.ts`：`APMPowerRecord`/`parseApmInstalledList` 注释改为"list --json 恒带 description/tags"，解析与聚合逻辑不变
- `vite.config.ts`：注释同步（argv 保持 `apm list --installed --agent=<agent> --json`，不带 `--all`）
- `src/api/contracts.ts`：`INSTALLED_AGENTS` 注释同步
- `src/api/apm.test.ts`、`dev/store.test.ts`：installed 样例改回带元数据，补充 description/tags 传递与 `facets.tags` 派生断言
- `docs/development-and-deployment-guide.md`：§10.4 / §11.2 恢复元数据契约与"切版本同步变化"冒烟说明

解决方案或完成结果：

installed 范围继续按所选 Agent 执行 `apm list --installed --agent=<agent> --json` 并解析记录；`APMPowerRecord.description?/tags?` 保持可选容忍字段，聚合时归一化 `""`/`[]`，正常元数据随 list --json 传入并展示。未安装（exit 1、空 stdout）与空清单（exit 0、`[]`）仍渲染空内容，spawn 失败仍映射可重试 unavailable；market（APC）与 settings 行为不变。

验证结果或限制：

`npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 均通过（exit 0）。协议边界为 `../apm` HEAD `73785da`（ADR-029 生效）；旧版 apm 若在 `--json` 下缺元数据，解析器仍容忍并归一化为空。

## 2026-09-07 — 对齐 apm list 身份记录契约

分类：功能变更

用户需求：

`../apm` 合入 feature-029（list 全版本查询 + show 详情）后，`apm list` 的 `-a/--all` 语义改为「对已命名 Cloud Power 展开全部版本」且缺少 name 时直接报错；list 的文本与 JSON 输出统一为身份记录（installed 每条仅含 agent、type、name、version），description/tags 不再出现在 list 输出中，详情由 Cloud-only 的 `apm show` 提供。旧版 `apm list --installed --agent=<agent> --json --all` 已对最新 apm 恒失败（`--all requires name`），需要对齐 dev-only 调用与解析契约。

相关文件：

- `src/api/apm.ts`：更新 `APMPowerRecord`/`parseApmInstalledList` 注释，明确身份记录输入与可选元数据容忍语义
- `vite.config.ts`：installed 请求 argv 去掉 `--all`，改为 `apm list --installed --agent=<agent> --json`
- `src/api/contracts.ts`：更新 `INSTALLED_AGENTS` 注释中的命令引用
- `src/api/apm.test.ts`、`dev/store.test.ts`：installed 样例改为身份记录，补充身份记录归一化断言
- `docs/development-and-deployment-guide.md`：§10.4 / §11.2 命令与冒烟说明同步

解决方案或完成结果：

installed 范围按所选 Agent 执行 `apm list --installed --agent=<agent> --json` 并解析身份记录数组；具体 Agent 未安装（exit 1、空 stdout）与已安装空清单（exit 0、`[]`）都渲染为空内容，spawn 失败仍映射为可重试的 unavailable。`APMPowerRecord.description?/tags?` 保留为可选容忍字段，聚合时归一化为 `""` / `[]`；由于最新 apm 不再输出已安装元数据，installed 卡片不展示 description/tags、`facets.tags` 恒为空。market（APC）与 settings 行为不变。

验证结果或限制：

`npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 均通过（exit 0）。已安装范围的 description/tags 展示受上游 CLI 契约限制（元数据仅 Cloud `show` 提供）；如需恢复，需等 apm 提供 installed 范围元数据通道或未来 Store 桥接，本次不改变数据流架构。

## 2026-09-02 — Power 市场接入 APC

分类：功能变更

用户需求：

将 Power 市场（`scope=market`）从本地 fixture 改为真实 APC 公开目录，彻底放弃仿真数据；市场行为与「我的 Power」对齐，每次点击类型/标签、翻页都重新拉取并解析最新列表，不保留跨请求缓存。

相关文件：

- 新增 `src/api/apc.ts`（APC 公开目录解析：分组到类型映射、字段规范化、tag 排序去重、`(type,name,version)` 去重）与 `src/api/apc.test.ts`
- `dev/store.ts` 移除 `marketFixtures`，新增 `runApcCatalog` 注入，market 复用 `buildPowersResult` 聚合
- `vite.config.ts` 新增 dev-only `runApcCatalog`（`GET /resources/version` 取快照 + `GET /resources` 跟随重定向取全量目录，测试环境关闭 TLS 校验）
- `src/AgentHubPage.tsx` 增加 APC 不可用 → 可重试 unavailable 文案
- `APC-API.md` 补齐目录条目 `tags` 字段；`docs/development-and-deployment-guide.md` 更新 Local Preview 说明

解决方案或完成结果：

market 每次 `powers.list.v1` 请求都由 dev 传输层新鲜拉取 APC 全量目录，`parseApcCatalog` 解析后用既有 `buildPowersResult` 按 `type` 过滤、聚合、分页，快照采用 `/resources/version` 的 `catalog_sha256`，目录变化时走 `reset_required` 回第 1 页。APC 公开接口无按类型列表端点，故采用「全量列表 + 客户端按类型过滤」。测试环境证书不受信，仅 dev-only 传输层关闭 TLS 校验，不进插件 bundle。

验证结果或限制：

`npm test`（10 个文件 122 个测试）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 均通过（exit 0）。APC 每个 `name` 只保留最新版本，市场卡片版本下拉恒为单版本；生产 CLI Provider（`bibit-agenthub-cli`，独立包）仍用 fixture 种子，需另行接入同一 APC 映射。

## 2026-09-02

分类：功能变更

用户需求：

将 tmp-dev 的「我的 Power」改为真实数据源：用户每次点击 Agent 选项时，从 PATH 调用 `apm`，解析 `apm list --installed --agent=<selected> --json --all` 的结果并渲染已安装 Power 页面，不再展示 mock 示例；Power 市场保持不变。前端 Agent 固定为 bibit / codex / claude-code 三个选项（`claude-code` 即 apm 中 Claude 的 id），不做 `--agent=all` 发现；list 返回「未安装」时前端显示空内容。

相关文件：
- 新增 `src/api/apm.ts`（APM JSON 解析、记录规范化、系列聚合、快照与分页）与 `src/api/apm.test.ts`
- 新增 `dev/store.ts`（纯 Store 核心，注入 `runApm`；market fixture 与 settings 不变）与 `dev/store.test.ts`
- 新增 `vite.config.ts`（dev-only Node 中间件，用固定 argv、无 shell 方式 spawn `apm`）
- `dev/main.tsx` 改用 `serviceConnections`；删除 `dev/powerCatalogMock.ts` 与 `dev/powerCatalogMock.test.ts`
- `src/AgentHubPage.tsx` Agent 菜单固定为 `INSTALLED_AGENTS`，移除基于 `facets.agents` 的发现与自动选择
- 标准化 `service:store`：`bibit.feature.json`、页面/客户端及测试统一改用 `FeatureService*` 类型

解决方案或完成结果：

installed 由 Vite 中间件按所选 Agent 逐次 spawn `apm list --installed --agent=<selected> --json --all` 并解析；`src/` 不直接执行 CLI，spawn 只存在于 dev-only 的 `vite.config.ts`。apm 缺失时映射为可重试的 `unavailable`，未安装或空列表时渲染空内容；`facets.agents` 恒为空，前端菜单由常量提供。market 与 settings 行为不变。Local Preview 中 apm 不可达时，页面区分显示「Power catalog is unavailable: the apm CLI could not be started.」并给出 Retry，而不是误报 incompatible。

验证结果或限制：

`npm test`（9 个文件 104 个测试）、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin` 均通过（exit 0）。Remote Store、Bibit Host adapter 与正式 CLI Provider 仍未接入；installed 数据依赖本机 `apm` 位于 PATH 中。

## 2026-08-28

分类：功能变更

用户需求：

将 Agent Hub 前端重构为统一 Marketplace 风格：Agent 选择收进“我的 Power”菜单，类型与 Tags 提供选中边框和类型配色，卡片支持固定区域滚动与最多五列布局，分页改为箭头和页码输入。

相关提交：
- `27b31e7 docs: design Agent Hub marketplace layout`
- `b4ef4a1 feat: unify Agent Hub filters`
- `5deb887 feat: restyle Power card content`
- `a4be83c feat: add direct Power pagination`
- `042fa69 feat: integrate Agent Hub navigation`
- `7aa5f17 feat: apply Agent Hub marketplace layout`

解决方案或完成结果：

采用一级范围页签与独立筛选面板，保留已选 Agent；统一四种 Power 类型的筛选与卡片配色；重排版本、描述和 Tags；增加响应式五列网格以及支持 Enter/失焦提交的快速翻页。

验证结果或限制：

`npm test` 全部通过（8 个文件 84 个测试）；`npm run typecheck`、`npm run build:dev`、`git diff --check` 均通过（exit 0）。浏览器端五/四/三/二/一列布局、类型配色、固定区域滚动与悬停效果的可视化检查因本环境无浏览器工具未能执行，留待人工复核。Store DTO、每页 20 项和安装/市场数据语义未改变。

## [新增功能] 2026-08-27 — APC Power 展示原型与系列级资源接口

- 原始需求：构建 Agent Hub Power 展示原型，用统一的 Store DTO 承载 installed 与 market 数据，并将 APC 公共资源发现改为系列级分页并支持 tag 过滤。
- 类别：新增功能
- APC 文档提交：4fe396a（定义系列级资源发现契约）、b575574（修正列表示例分页）
- 插件行为提交：3bc65b5、4eee2b4、245fbb2、ceb345b、ff73768、cb81d45、18ebba1、a00ec1c
- 变更摘要：统一 Store DTO（powers.list.v1，installed 与 market 共用闭集校验）；APC 公共资源列表改为系列级分页并支持 tag 过滤与 type 级 tag 清单。
- 验证：npm test（7 个文件 73 个测试全部通过）、npm run typecheck（exit 0）、npm run build:dev（exit 0）、git diff --check（exit 0）、git diff -- src/agentHub.css（无输出）。
- 发布前置项：Remote Store、APC 服务端、Bibit Host adapter 仍未实现。
- 样式：未新增或修改任何 CSS。
