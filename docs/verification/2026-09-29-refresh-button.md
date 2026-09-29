# 0.3.11 验证记录：Hub 页手动刷新按钮

- 变更版本：0.3.11（上一版 0.3.10）
- 验证环境：amd64 开发机；Node 18.19.1（`npm test` / `npm run build:*`）；WebKitGTK 2.52 + GTK 3.24（离屏探针）
- 相关提交：见文末「提交状态」

## 1. 用户需求

> 在 hub 页面中添加一个刷新按钮，用来手动刷新当前页面的内容。不包括在设置标签页中出现。该按钮的位置要合理，不挤占现有元素。可以和目前的创建资源并派，刷新在左，创建在右，文本使用符号而非文字。

## 2. 实现要点

| 层 | 改动 |
| --- | --- |
| `src/AgentHubPage.tsx` | 页头 `.agent-hub__create` 列内新增 `.agent-hub__actions` 行，DOM 顺序为刷新 → 创建；刷新按钮为纯图标（`<span aria-hidden="true">↻</span>`），`aria-label` / `title` 用 `t('Refresh')`；`disabled={view.status === 'loading'}`；`onClick={retryLoad}`；以 `tab !== 'settings'` 条件渲染 |
| `src/agentHubI18n.tsx` | 中文词典新增 `'Refresh': '刷新'` |
| `src/agentHub.css` | `.agent-hub` 新增 `--hub-action-height: 41px`；`.agent-hub__actions`（flex 行）；`.agent-hub .agent-hub__actions > button { min-height: var(--hub-action-height) }` 与 `.agent-hub .agent-hub__refresh { width/height: var(--hub-action-height) }` |
| `src/agentHubLayout.test.ts` | 新增文本级 CSS 契约：令牌唯一、创建入口 `min-height` 与刷新按钮 `width/height` 都绑定该令牌、`.agent-hub__actions` 是 flex 行 |
| `src/AgentHubPage.test.tsx` | 新增 3 条用例（见 §3） |

语义：

- **刷新=重取当前查询**：复用既有 `retryLoad`（`setRetry(v => v + 1)`），不动 `scope` / `agent` / `type` / `tags` / `page` / `snapshot`，也不调用 `resetPageScroll()`。用例断言刷新前后 `powers.list.v1` 的 wire params 完全一致、页码仍为 1。
- **设置标签页不渲染**：该标签页读 `settings.get.v1`，页面在其上既不发起 `powers.list.v1` 也不渲染列表，刷新入口对它没有意义，因此整块条件渲染掉。
- **不打断在途读取**：`disabled={view.status === 'loading'}`。`retry` 一 bump，effect cleanup 会 abort 在途的 `listController` 再重发，这正是 0.3.2 修掉的「窗口获焦把 market 读取掐掉」同类问题，因此用禁用而非「点了再取消」。
- **高度对齐不靠推算**：两处 CSS 选择器都必须带 `.agent-hub` 前缀。最初写成裸 `.agent-hub__refresh`，被基础按钮规则 `.agent-hub button:where(:not(.power-filters__scope))`（`0,2,0`）盖过，`display: grid` 不生效、图标被压成文字宽；校正为（`0,2,0`，后出现）后仍然只解决了 `display`，`align-self: stretch` + `aspect-ratio` 在 WebKit 里按内容宽度解出 `21.34×39`。最终把**两个入口钉在同一个高度令牌**上，实测 `41×41` / `145.53×41`、顶边对齐，且不加刷新按钮时创建入口尺寸一字不变。

## 3. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 505/505（27 个文件；0.3.10 基线 501，本次 +4）。**唯一失败文件是 `dev/sources.test.ts` 的 3 条 `readMarket` 用例，基线即失败**，见 §5 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功（`dist/assets/index-l6vqUCxS.js` 258.89 kB / gzip 81.41 kB，`index-Cn8LFfO8.css` 15.80 kB） |
| `npm run build:plugin` | 成功，`artifacts/agent-hub-0.3.11.bibit-plugin.tgz`，sha256 `99d336055e1bdd8597b3333256cf52766b83768e0392d3d9454bf9af14584146` |
| `git diff --check` | 无输出 |
| `python3 docs/verification/probe-refresh-button.py --only shipped` | OK（10 个窗口，见 §4） |
| Go Provider | 本次未涉及，未跑 `go test` |

## 4. 布局验证（离屏 WebKitGTK 探针）

`docs/verification/probe-refresh-button.py` 加载**真实的** `src/agentHub.css` 与 `AgentHubPage.tsx` 生成的页头标记（标题块 + `.agent-hub__create` 列 + 说明段落），放在宿主机型盒子里（窗口 − 15rem 侧栏 − 2px 外框），对 1920×1080 … 400×700 十个窗口测量。`--only shipped` 会断言契约，回归即非零退出：

```
== with the refresh entry
   window     refresh            create             sameRow  glyph  hdrOver  docScrollW
   1920x1080 1615.47,38 41x41   1664.47,38 145.53x41 True      19.3      -52        1920
   1200x800   955.47,38 41x41   1004.47,38 145.53x41 True      19.3        0        1200
   1024x740   786.52,38 41x41    835.52,38 145.53x41 True      19.3        0        1024
    400x700   189.47,87 41x41    238.47,87 145.53x41 True      19.3        0         400
...
OK: one same-height action row at every window, refresh icon square and on the left,
the create entry unmoved, no header overflow and no sideways scroll.
```

探针同时跑「渲染同一页头但不含刷新入口」的基线，逐窗口断言创建入口的 `w/h/y` 不变（`1920x1080: 1664.47,38 145.53x41 → 1664.47,38 145.53x41`），即用户说的「不挤占现有元素」。

`↻` 字形检查：本机 `fc-match -s ':charset=21bb'` 首先命中 `DejaVu Sans`；探针用 canvas 在渲染字号（20px）下量到 advance `19.3px`，说明有真实字形而不是 tofu 方块。板端（较小字体集）尚未验证，见 §6。

## 5. 反向验证

每一项单独变异后，对应用例必须失败；随后恢复并重跑确认通过。

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| 1 | 去掉刷新按钮的 `disabled={view.status === 'loading'}` | 「在途读取时禁用」用例 | 1 failed ✓ |
| 2 | 去掉 `tab !== 'settings'` 条件（按钮常驻） | 「设置标签页不出现」用例 | 1 failed ✓ |
| 3 | `onClick` 换成空函数 | 「重取当前查询」用例 | 1 failed ✓ |
| 4 | 图标 `<span>` 内容从 `↻` 换成 `Refresh` 文字 | 「重取当前查询」用例（断言 `textContent === '↻'`） | 1 failed ✓ |
| 5 | `.agent-hub .agent-hub__refresh` 退回裸 `.agent-hub__refresh` | 布局契约用例 | 1 failed ✓ |
| 6 | 去掉 `.agent-hub .agent-hub__actions > button { min-height }` | 布局契约用例 | 1 failed ✓ |

布局探针在开发过程中真实撞到的两次失败（不是回滚跑出来的，但正是最终方案的由来）：`align-self: stretch` + `aspect-ratio: 1` 时测得 `refresh 49.34x40 / create 145.53x39`（两高度不同且图标不方），裸选择器时测得 `21.34x39`（`display: grid` 被基础按钮规则覆盖）。最终改为高度令牌后两个入口在十个窗口上都是 `41×41` / `145.53×41`。探针本身的断言**不需要**跑第二遍才算数：`--only shipped` 的失败分支已由上面第 5、6 项在单测层覆盖，探针负责的是 WebKit 真实排版这一层。

## 6. 未执行 / 未验证

- **板端与真实 GUI 未验证**：riscv64 交叉构建、两个 deb 上板、Bibit 中实际点击刷新按钮、设置标签页不出现该按钮，均未执行。
- **`↻` 在板端字体下的渲染**未验证，只有开发机 fontconfig 结论。
- **`dev/sources.test.ts` 的 3 条 `readMarket` 失败是基线问题**，与本次改动无关，且**未在本次修复**（超出需求范围）：`jsdom` 环境把全局 `URL` 换成不继承 `node:url` `URL` 的实现（实测 `globalThis.URL === (await import('node:url')).URL` 为 `false`、`new URL(...) instanceof NodeURL` 为 `false`），于是 `dev/sources.ts:203` 的 `httpGet(parsed, { headers }, cb)` 里 Node 不把 `parsed` 认作 URL，改写选项对象后把它当成 listener，抛 `ERR_INVALID_ARG_TYPE: The "listener" argument must be of type function`。`git stash -u` 后同样 3 failed（498/501），可复现。

## 7. 提交状态

待提交。
