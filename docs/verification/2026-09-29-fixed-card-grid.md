# 0.3.9 验证记录：Power 卡片固定宽度，窗口只改列数

- 变更版本：0.3.9（上一版 0.3.8）
- 验证环境：amd64 开发机（Node 18.19.1 / npm 9.2.0 / Go 1.26.5 / GTK 3.24 + WebKitGTK **2.52.6**）；板端参照 WebKitGTK 2.52.0（Bianbu 4.0.6，board-host）
- 相关提交：见文末「提交状态」

## 1. 用户问题

> hub资源卡片会在bibit全凭时比窗口时更宽，窗口时卡片变窄，custom标记和描述会错位。我希望卡片大小固定（按照目前全屏大小），窗口大小变化时仅居中调整每行卡片个数。

用户补充确认：网格中**不满的最后一行保持左对齐**（沿用 `docs/superpowers/specs/2026-08-28-agent-hub-marketplace-layout-design.md` §7 的既有约定），不要整行居中。

第二轮反馈（把卡片固定成「全屏尺寸」276px 之后）：

> 根据../bibit的默认窗口大小调整卡片宽度，稍微减小卡片宽度，使默认窗口能够一行3个，现在启动是一行2个，两边留了很大的空隙。

## 2. 定位证据

jsdom 没有排版引擎，`src/agentHubLayout.test.ts` 只能做文本级契约，所以这次用一个离屏 `WebKit2.WebView` 直接加载**发布用的 `src/agentHub.css`** 与 `PowerCard.tsx` 产出的真实卡片标记（管理态 `<select>` 版本槽与自定义态 `Custom` 徽标 + 静态版本槽交错，共 21 张）实测。命令：

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
  python3 docs/verification/probe-fixed-card-grid.py
```

探针把页面放进**真实宿主盒子里**：外壳 = 窗口宽度 + 未最大化时 1px 边框 × 2（`web-app/src/components/WindowSurfaceShell.tsx`），其中留出 `SIDEBAR_WIDTH = 15rem` 的占位（`web-app/src/components/ui/sidebar.tsx`，侧栏本体是 `fixed`，但这个占位 div 在文档流里且 `SidebarInset` 是 `flex-1`），`md`（768px）以下占位隐藏（侧栏变浮层）。`vw` 仍按窗口解析，所以页面内边距保持真实的 `clamp(20px, 4vw, 56px)`。

脚本的「before」列就是把改动就地还原（网格改回 `repeat(5, minmax(0, 1fr))` + 1240/980/720/480px 断点，静态版本槽改回 `display: inline-block`）后的同一份样式表。

### 2.1 第一轮的三个症状（宿主盒子下的 before 列）

| 窗口 | 列数 | 卡片宽度 | header 溢出内容盒 | h2 顶距（管理/自定义） | 描述顶距（管理/自定义） |
| --- | --- | --- | --- | --- | --- |
| 1920×1080 | 5 | 276px | 0 | 65 / 60 | 101 / 96 |
| 1600×900 | 5 | **232.8px** | 0 | 65 / 60 / 78 | 101 / 96 / 114 |
| 1512×982 | 5 | **215.2px** | 0 | 65 / 60 / 78 | 101 / 96 / 114 |
| 1440×900 | 5 | **200.8px** | 0 | 65 / 60 / 78 | 101 / 96 / 114 |
| 1276×800 | 5 | **170px** | 0 | 65 / 60 / 78 | 101 / 96 / 114 |
| 1200×800 | 4 | **200px** | 0 | 65 / 60 / 78 | 101 / 96 / 114 |
| 1024×740 | 4 | **159.5px** | 0 | 65 / 60 / 78 | 101 / 96 / 114 |
| 640×700 | 2 | **282.4px** | 0 | 65 / 60 | 101 / 96 |
| 400×700 | 1 | **368px** | 0 | 65 / 60 | 101 / 96 |

三条结论：

1. **卡片宽度在 159–368px 之间漂移，全屏（≥1920）才是 276px**：`.agent-hub__grid` 是 `repeat(5, minmax(0, 1fr))`，列数固定、轨道弹性，窗口宽度被列宽吸收；1240/980/720/480px 四个断点只是切换列数，切完仍旧伸缩。
2. **custom 卡片整体上移 5px**：管理态版本槽是原生 `<select>`，继承 14px/1.5，实测盒高 31px；自定义态静态标签 12px 字号 + `3px 8px` 内边距，盒高 26px。同一行两种卡片 header 行高不同，自定义卡片的 `h2` 与描述都高 5px（`h2Top` 65/60、`descTop` 101/96）。
3. 卡片极窄（160–230px）时 `Custom` 徽标 + 版本槽超出卡片内容盒（离屏页里最多 36px，见第一版记录），h2 也被挤到第三行。

### 2.2 第二轮：固定宽度取「全屏尺寸」时默认窗口只剩 2 列

| 窗口 | 页面盒 | 内容列（扣 2×48px 内边距） | 276px 卡片列数 | 两侧空隙 |
| --- | --- | --- | --- | --- |
| 1200×800（**BiBit 默认**） | 958px | 862px | **2** | 各 144px |
| 1024×740（BiBit 最小） | 782px | 686px | 2 | 各 72px |

3 张 276px 卡片 + 2 个 20px 间距要 868px > 862px，差 6px 就掉到 2 列。默认窗口宽度与侧栏宽度来自宿主源码：`src-tauri/tauri.linux.conf.json` 的 `"width": 1200, "height": 800, "minWidth": 1024, "minHeight": 740`，`SIDEBAR_WIDTH = "15rem"`，宿主根字号是浏览器默认 16px（Bibit 只自定义 `--font-size-base`，没有 `html { font-size }` 覆盖），所以侧栏占位是 240px。

对应的 `useFittedFontSize` 也受影响：`docs` 里记录的「最窄 182px 列」与「238px 盒宽」都锚在旧卡片宽度上，本次按最终卡片重算（内容盒 229px）。

## 3. 实现要点

| 文件 | 改动 |
| --- | --- |
| `src/agentHub.css` | `.agent-hub` 新增宿主几何令牌 `--hub-default-window: 1200px`、`--hub-host-sidebar: 15rem`、`--hub-host-frame: 2px`、`--hub-page-padding: 48px`、`--hub-card-gap: 20px`，并由此推导 `--hub-card-width: calc((var(--hub-default-window) - var(--hub-host-sidebar) - var(--hub-host-frame) - 2 * var(--hub-page-padding) - 3 * var(--hub-card-gap)) / 3)` = **267.33px**；`--hub-content-max: 1460px` 保留为页面列上限 |
| 同上 | `.agent-hub__grid`：`repeat(auto-fill, minmax(min(var(--hub-card-width), 100%), var(--hub-card-width)))` + `justify-content: center` + `gap: var(--hub-card-gap)` |
| 同上 | 删除 1240/980/720px 三条列数断点与 480px 断点里的列数覆盖；480px 断点只保留页面内边距与筛选行调整 |
| 同上 | `.power-card` 补 `grid-template-columns: minmax(0, 1fr)`（隐式列是 `auto`，超长版本号/标签会把卡片顶宽，恰好破坏这次要固定的宽度） |
| 同上 | `.power-card__version--static`：`display: inline-flex` + `align-items: center` + `justify-content: flex-end` + `min-height: var(--hub-version-height)` + `max-width: 112px` + `overflow: hidden`；`.power-card__version` 补 `box-sizing: border-box` |
| `src/agentHubLayout.test.ts` | 新增 4 条契约（见 §5） |
| `docs/verification/probe-fixed-card-grid.py` | 新增离屏实测探针，把页面放进「窗口 − 15rem 侧栏 − 2px 边框」的宿主盒子；`--only shipped` 为断言模式 |
| 版本文件 | `package.json` / `package-lock.json` / `bibit.feature.json` / `providerVersion` / `debian/changelog` / `README.md` / 开发指南 → `0.3.9` |

语义要点：

- **卡片宽度由宿主默认窗口推导，不是由页面列上限推导**：862px 内容列里放 3 张卡片 + 3 个间距刚好占满（826.33 × …），实际一行只用 2 个间距，多出的 20px 是余量 —— 这样宿主侧栏、边框或内边距有 1px 级差异时，默认窗口也不会退回 2 列（实测两侧各空 10px）。同时 `1460 ≥ 5 × 267.33 + 4 × 20 = 1417`，全屏仍保持 5 列。
- 卡片宽度只由 `--hub-card-width` 决定，与窗口无关；`auto-fill` 保留空轨道，所以 `justify-content: center` 居中的是**轨道块**，每一行（含不满的最后一行）都从轨道块左缘开始排 —— 正是用户确认的「最后一行靠左」。
- `min(var(--hub-card-width), 100%)` 是唯一允许卡片变窄的分支：内容列窄于一张卡片时（窗口约 <300px；本机实测 300px 窗口仍是 267.33px、299px 起降为 267px、260px 降为 228px）降为可用宽度，而不是被页面 `overflow-x: hidden` 裁掉。目标最小窗口 1024×740 远高于此。
- `auto-fit` 在这里不可用：它会把空轨道折叠掉，于是轨道块收缩后重新居中，最后一行就不再靠左（1920×1080 窗口下放 3 张卡片时，`auto-fit` 的首卡左缘是 526px，`auto-fill` 是 230px）。
- 静态版本槽用 `min-height` 而不是给 `<select>` 加样式：原生下拉控件在 WebKitGTK 上的盒模型不可靠，把两侧对齐到同一个 `--hub-version-height` 更稳。`text-overflow` 对 inline-flex 盒无效，所以极长版本只做裁切（真实数据最长约 99px，`max-width: 112px` 之内）。

## 4. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 478/481（25 个文件）。3 项失败全部在 `dev/sources.test.ts` 的 `readMarket`（Node 18.19 下 `ERR_INVALID_ARG_TYPE`），`git stash` 后在 0.3.8 基线上同样失败同样 3 项，与本次改动无关；`src/agentHubLayout.test.ts` 14/14 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功（`dist/assets/index-mdhd-vdZ.css` 15.11 kB / gzip 3.81 kB，`dist/assets/index-Bpl7A5q4.js` 255.44 kB / gzip 80.24 kB） |
| `npm run build:plugin` | 成功，`artifacts/agent-hub-0.3.9.bibit-plugin.tgz`，sha256 `d77f25357509286073682387c8e805a0a4e45088ed196a246626db055ac04276`（97008 字节）；归档含 `plugin.json`（`version: 0.3.9`）/ `plugin.sig` / `dist/plugin.js` / `dist/agent-hub-plugin.css`；打包后的 CSS 里 `--hub-card-width` 是展开后的 `calc((var(--hub-default-window) - var(--hub-host-sidebar) - var(--hub-host-frame) - 2 * var(--hub-page-padding) - 3 * var(--hub-card-gap)) / 3)` |
| `make -C provider test vet build` | 通过（`internal/provider`、`cmd/provider-probe` 全部 ok，`go vet` 无输出；amd64 产物 sha256 `46cb3fcf88b025a594d9e7bfb2a96b7cbd150bbf6a63b8ec804ce8b154c0b3d5`，与上一版一致——本次只改前端） |
| `--self-test` | exit 0 |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |
| 探针 `--only shipped` | exit 0（13 个窗口全部通过断言，含「默认窗口必须 3 列」） |

## 5. 探针结果（修复后）

| 窗口 | 列数 | 卡片宽度 | header 溢出 | 子元素重叠 | h2 顶距 | 描述顶距 | 卡片高 | 两侧空隙 | `document.scrollWidth` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 5 | 267.33px | 0 | 0 | 65 | 101 | 265 | 22 | 1920 |
| 1600×900 | 4 | 267.33px | 0 | 0 | 65 | 101 | 265 | 57 | 1600 |
| 1512×982 | 4 | 267.33px | 0 | 0 | 65 | 101 | 265 | 13 | 1512 |
| 1440×900 | 3 | 267.33px | 0 | 0 | 65 | 101 | 265 | 121 | 1440 |
| 1360×850 | 3 | 267.33px | 0 | 0 | 65 | 101 | 265 | 83 | 1360 |
| 1300×850 | 3 | 267.33px | 0 | 0 | 65 | 101 | 265 | 55 | 1300 |
| 1276×800 | 3 | 267.33px | 0 | 0 | 65 | 101 | 265 | 44 | 1276 |
| **1200×800（宿主默认）** | **3** | 267.33px | 0 | 0 | 65 | 101 | 265 | **9** | 1200 |
| 1150×800 | 2 | 267.33px | 0 | 0 | 65 | 101 | 265 | 130 | 1150 |
| 1100×800 | 2 | 267.33px | 0 | 0 | 65 | 101 | 265 | 107 | 1100 |
| 1024×740（宿主最小） | 2 | 267.33px | 0 | 0 | 65 | 101 | 265 | 72 | 1024 |
| 640×700 | 2 | 267.33px | 0 | 0 | 65 | 101 | 265 | 15 | 640 |
| 400×700 | 1 | 267.33px | 0 | 0 | 65 | 101 | 265 | 50 | 400 |

- 卡片宽度在 400–1920px 的全部窗口恒为 **267.33px**，列数 5/4/4/3/3/3/3/**3**/2/2/2/2/1；
- **BiBit 默认窗口 1200×800 正好 3 列**，两侧各空 9–10px（改前 2 列、两侧各空 144px），这正是第二轮反馈要的效果；
- `h2` 与描述顶距各自唯一（65 / 101），管理态与自定义卡片完全对齐，`Custom` 徽标不再越界；标题盒内宽恒为 229px；
- 页面 `document.scrollWidth` 恒等于窗口宽度，没有横向滚动；
- 只有窗口窄于一张卡片时（本机 299px 起）卡片才降到可用宽度：296→264px、260→228px，均不横向滚动。

## 6. 反向验证

每一项单独还原后，对应的用例必须失败；随后恢复并重跑确认通过。

| 还原内容 | 结果 |
| --- | --- |
| `.agent-hub__grid` 改回 `repeat(5, minmax(0, 1fr))` + `justify-content: start`，并加回 1240/980/720px 列数断点 | `gives every card the same fixed width at every window size` 与 `never changes the column count from a breakpoint again` 两条失败（2 failed / 12 passed）；只还原网格、不加断点则仅第一条失败（1 failed / 13 passed） |
| `--hub-card-width` 改回上一版的 `calc((var(--hub-content-max) - 4 * var(--hub-card-gap)) / 5)`（= 276px） | `sizes the fixed card so the host default window shows three columns` 失败（1 failed / 13 passed）；同时探针在 1200×800 报 `2` 列、`cardW=[276]`、两侧各空 144px，`--only shipped` exit 1 |
| `.power-card__version--static` 改回 `display: inline-block` 且去掉 `min-height` | `keeps the version slot one height across managed and custom cards` 失败（1 failed / 13 passed） |
| 三处全部恢复 | 14/14 通过，探针 `--only shipped` exit 0 |

探针的对照列（`before`）同时复现了第一轮的全部症状：宽度 159–368px 漂移、`h2Top=[65, 60, 78]`、`descTop=[101, 96, 114]`、默认窗口 4 列。

## 7. 遗留与限制

- 本机 WebKitGTK 为 **2.52.6**，板端为 **2.52.0**：`repeat(auto-fill, minmax(min(...), ...))`、`justify-content: center` 与 `min-height` 对齐都是 CSS Grid 2/Box Alignment 的基础能力，两版差异不影响结论，但**板端真实 GUI 的观感仍需按开发指南 §16.4 第 9 步复核**（探针只在离屏 WebView 里量化了几何）。
- 探针用的是「窗口 − 15rem − 2px」的宿主盒子模型，数字取自宿主源码；宿主改了默认窗口、侧栏宽度或窗口外框，就需要同步改 `--hub-default-window` / `--hub-host-sidebar` / `--hub-host-frame`，`src/agentHubLayout.test.ts` 的算术契约会在默认窗口不再正好 3 列时失败。
- 用户若把左侧栏拖到 20rem，1200px 窗口下页面内容列只剩 780px，此时是 2 列（267.33px 卡片）：这是「卡片宽度固定、只改列数」的预期行为，不是缺陷。
- `--hub-version-height: 31px` 来自本机 WebKitGTK 对 `<select>` 的实测盒高，换平台字体/主题后该值可能变化；`src/agentHubLayout.test.ts` 锁的是「静态标签声明了这个令牌」，不是渲染值本身，所以换平台时需要重新量一次。
- 契约允许的极端版本号（如 `v1000000.1000000.1000000`）会被 `max-width: 112px` 裁切；`text-overflow` 对 inline-flex 无效，因此该极端值显示为截断而非省略号。
- 本次只改 CSS、契约测试与文档，未触碰 DTO、operation、数据流与组件结构；`useFittedFontSize` 仍需在列数变化时重算（卡片尺寸不再变化后触发频率只减不增）。

## 8. 提交状态

工作区改动（未提交）：`src/agentHub.css`、`src/agentHubLayout.test.ts`、`docs/Changelog.md`、`docs/development-and-deployment-guide.md`、`docs/verification/probe-fixed-card-grid.py`（新增）、`docs/verification/2026-09-29-fixed-card-grid.md`（本文件）、`debian/changelog`、`package.json`、`package-lock.json`、`bibit.feature.json`、`README.md`、`docs/cli-provider-development-and-deployment.md`、`provider/internal/provider/server.go`。
