# 0.3.12 验证记录：文案改为「能力中心 / 能力市场」并去掉页头眉标

- 变更版本：0.3.12（上一版 0.3.11）
- 验证环境：amd64 开发机；Node 18.19.1（`npm test` / `npm run build:*`）
- 相关提交：见文末「提交状态」

## 1. 用户需求

> 仅更改前端文本：
> 1. 创建资源/Create a resource 改为 创建/Create
> 2. AgentHub title 改为 能力中心/Capabilities
> 3. 我的Power/My Powers 改为 我的能力/My Capabilities
> 4. Power市场 改为 能力市场/Capability Market
> 5. Type标签中的Agent 改为 Expert
> 另外删掉页面顶部的 INTERNAL CATALOG 字样

范围限定为**前端文本**：不改协议、DTO、operation 与 Provider。

## 2. 实现要点

| 层 | 改动 |
| --- | --- |
| `src/agentHubI18n.tsx` | 词典改键：`'Create a resource'` → `'Create': '创建'`；`'My Powers'` → `'My Capabilities': '我的能力'`；`'Power market'` → `'Capability Market': '能力市场'`；新增 `'Capabilities': '能力中心'`；删除 `'INTERNAL CATALOG': '内部目录'`。`agentHubLocales.en.title` / `['zh-CN'].title` 改为 `Capabilities` / `能力中心` |
| `src/AgentHubPage.tsx` | 页头由 `<p>{t('INTERNAL CATALOG')}</p><h1>Agent Hub</h1>` 改为 `<h1>{t('Capabilities')}</h1>`；创建入口文案改为 `t('Create')`；删除确认句的 `values.type` 走 `resolvePowerTypeLabel` |
| `src/components/PowerFilters.tsx` | 一级页签文案改键；Type 按钮渲染 `resolvePowerTypeLabel(value)` |
| `src/components/PowerCard.tsx` | 卡片类型徽标渲染 `resolvePowerTypeLabel(series.type)` |
| `src/components/PowerDetailsDialog.tsx` | 弹窗类型徽标与卸载/删除确认句的 `{type}` 走 `resolvePowerTypeLabel` |
| `src/api/powerCatalogClient.ts` | `custom-resource-skipped` warning 的 `values.type` 走 `resolvePowerTypeLabel` |
| `src/displayFields.ts` | 新增 `resolvePowerTypeLabel(type)`：`agent` → `Expert`，其余原样返回 |
| `src/agentHub.css` | 删除只服务于眉标的 `.agent-hub header p` 规则；`.agent-hub h1` 的 `margin: 4px 0 0` 改回 `margin: 0`；`.agent-hub__create-note` 补 `margin: 0`（原先由 `header p` 规则提供） |
| `bibit.feature.json` | `display.fallbackTitle` 改为 `Capabilities`；版本升到 0.3.12 |

语义：

- **Expert 只是展示层映射**：`POWER_TYPES` 仍是 `['skill','plugin','mcp','agent']`，`data-power-type`、wire params、`powers.list.v1` 请求、安装/卸载/删除的 `type` 字段与 `apm` 解析全部保持规范的 `agent`。只有四处面向用户的渲染改为 `Expert`：Type 篩选按钮、卡片徽标、详情弹窗徽标、卸载/删除确认句里的 `{type}`。
- **大小写与既有样式一致**：`.power-card__type` 与 `.agent-hub-dialog__type` 带 `text-transform: uppercase`，因此卡片与弹窗徽标渲染为 `EXPERT`，与同行的 `SKILL` / `PLUGIN` / `MCP` 一致；Type 篩选按钮是 `text-transform: capitalize`，渲染为 `Expert`。
- **标题三处一致**：页内 `h1` 走词典键 `Capabilities`，Bibit 侧边栏菜单名走 `agentHubLocales[lang].title`，宿主解析不到 locale 时回落 manifest 的 `fallbackTitle`，三处都已是 `Capabilities` / `能力中心`。
- **眉标彻底移除**：词典条目、DOM 与其专属 CSS 规则一并删除，并新增断言 `queryByText('INTERNAL CATALOG') === null`，避免留下不可达的字典条目（`agentHubI18n.test.tsx` 的「孤儿键」用例同时会兜住这类残留）。

## 3. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 506/509（27 个文件；唯一失败文件仍是 `dev/sources.test.ts` 的 3 条 `readMarket` 用例，基线即失败，见 §4）。`src` 下 23 个文件 463/463 全通过 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功（`dist/assets/index-BHAevhed.js` 258.94 kB / gzip 81.41 kB，`index-Bzpjrnz4.css` 15.71 kB） |
| `npm run build:plugin` | 成功，`artifacts/agent-hub-0.3.12.bibit-plugin.tgz`，sha256 `6796aa460281e06e25cf2cf66a27b02f1c060340b78f628d16d27c0eff3341a7` |
| `git diff --check` | 无输出 |
| Go Provider | 本次未涉及，未跑 `go test` |

用例变更：

- `src/displayFields.test.ts`：新增 `resolvePowerTypeLabel` 两组断言（`agent` → `Expert`；`skill` / `plugin` / `mcp` 原样）。
- `src/components/PowerFilters.test.tsx`：类型按钮文案断言改为 `['skill','plugin','mcp','Expert']`，并新增「点 Expert 仍回报 `agent`」的断言，锁住「展示与 wire 值分离」。
- `src/components/PowerCard.test.tsx`：新增用例断言 agent 卡片徽标为 `Expert`、`data-power-type` 仍为 `agent`。
- `src/components/PowerDetailsDialog.test.tsx`：新增用例断言 agent 弹窗徽标为 `Expert`，卸载确认句渲染 `Removes Expert "reviewer" for bibit.`。
- `src/AgentHubPage.test.tsx`：语言切换用例改为断言 `h1` 为 `Capabilities` / `能力中心` 且不再出现 `INTERNAL CATALOG`；页签、创建入口、刷新行文案断言同步改键。

## 4. 限制与未验证

- `dev/sources.test.ts` 的 3 条 `readMarket` 用例在本机（Node 18.19.1 / vitest 3.2.4）**基线即失败**，与本次改动无关：jsdom 把全局 `URL` 换成不继承 `node:url` `URL` 的实现，`http.get(url, options, cb)` 不再识别它，把 options 当成 listener（0.3.11 的验证记录已记录同一现象）；本次以 `git stash` 复现确认。
- **未做真机/截图验证**：本次是纯文案与一处字典键改名，没有布局或尺寸改动。删掉眉标后页头 `h1` 的 `margin` 从 `4px 0 0` 回到 `0`，`space-between` 的左右分布与创建入口列不变；`.agent-hub__create-note` 的 `margin: 0` 是补齐原先由 `header p` 提供的值，避免不可用说明段落出现浏览器默认外边距。这两点属于「读 CSS 可得」，但没有像 0.3.11 那样用离屏 WebKitGTK 探针实测。
- `docs/`（`README.md`、`docs/development-and-deployment-guide.md`、`docs/superpowers/**`）与历史 `debian/changelog` 条目里仍保留旧的「我的 Power / Power 市场 / 创建资源 / INTERNAL CATALOG」措辞，它们是历史规格与变更记录，本次**有意未改**；只有 `debian/changelog` 顶部新增了 0.3.12 条目。若需要文档与界面用词对齐，应另开一次改动。

## 5. 提交状态

待提交（本记录与改动同批提交）。
