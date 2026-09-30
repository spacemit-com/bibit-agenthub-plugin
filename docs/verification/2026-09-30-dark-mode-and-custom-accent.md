# 0.3.15 验证记录：跟随宿主明暗主题 + 自定义资源改用独立色相

- 变更版本：0.3.15（上一版 0.3.14「标签筛选改交集」）
- 验证环境：amd64 开发机；Node 18.19（`npm test` / `npm run build:*`）、WebKitGTK **2.52.6** + GTK 3.24（离屏探针，与开发板文档里的 2.52.x 同系）
- 相关提交：见文末「提交状态」

## 1. 用户需求

> hub 页面不能跟随系统变成深色模式，请修复。
> 并且自定义资源的颜色应与 MCP 颜色区分，目前比较相近。

## 2. 问题定位

### 2.1 深色模式

`src/agentHub.css` 里 **60 余处颜色全是明色字面量**（`--hub-bg: #f5f6f8`、`--hub-surface: #ffffff`、按钮 `#fff`、状态块 `#eef3fb`、分页按钮 `#fff`……），且没有任何地方读 `color-scheme`。宿主的切换动作是 `ThemeProvider` 给 `<html>` 加 `class="dark"`、并在 `.dark` 上把 `color-scheme` 设为 `dark`（`web-app/src/index.css`），插件对此毫无响应，所以整页停在明色。

### 2.2 自定义资源撞色

自定义资源用琥珀 `#d9a13b`，MCP 用橙 `#a95e16`。实测（OKLCH）：

| 对比 | 数值 |
| --- | --- |
| 强调色色相距离 | **21°** |
| 卡片填充色（custom `#fdf6e6` vs mcp `#fff6eb`） | **ΔE 0.7**（并排几乎同色） |
| 徽标底色 vs MCP 标签底色 | ΔE 2.5 |

## 3. 修法选择：为什么是 `light-dark()` 而不是 `.dark`

这是本次最关键的结论，已用仓库里的**真实算法**复现（`web-app/src/features/host/trustedPluginStyles.ts` 的 `isolatePluginStyles` 会把每条选择器重写成 `:where(<插件根>) <原选择器>`）：

| 写法 | 结果 |
| --- | --- |
| `--x: light-dark(a, b)`，靠继承来的 `color-scheme` | ✅ 正确。`color-scheme` 可继承、`light-dark()` 读它；宿主隔离只给选择器加前缀、不碰声明值，也不做值重写，所以 `light-dark()` 原样穿过隔离与打包 |
| `.dark .agent-hub { ... }` | ❌ **永不生效**。重写后是 `:where(bibit-agent-hub-page-home) .dark .agent-hub`——要求 `.dark` 是插件根的**后代**，而它在 `<html>` 上、是祖先 |
| `@media (prefers-color-scheme: dark)` | ⚠️ 只在宿主自己跟随系统时凑巧正确；宿主主题是权威值（XDG Portal / 用户选择 / Tauri 广播），可以与 `prefers-color-scheme` 不一致 |
| 插件自己 `matchMedia` + 加 class | ❌ 第二套真值来源，必然不同步 |

产物核对：`bibit-plugin build` 产出的 `dist/agent-hub-plugin.css` 里 **58 个 `light-dark()` 全部保留**，剥掉它们后剩下的裸颜色字面量只有 `--hub-on-primary: #ffffff`（品牌蓝上的白字，两种主题下 5.81:1 / 6.61:1，刻意豁免）。

## 4. 深色取值怎么来的

不是另配一套手挑颜色，而是**从明色那一支推导**：保持色相，提高明度直到对深色表面达到 4.5:1 以上。关键结果：

| 用途 | 明色 | 深色 | 深色下对比度 |
| --- | --- | --- | --- |
| 页面 / 表面 | `#f5f6f8` / `#ffffff` | `#121212` / `#171717` | 与宿主 `.dark` 的 `oklch(0.18 0 0)` / `oklch(0.205 0 0)` 换算值一致 |
| 正文 / 次要 | `#172033` / `#687386` | `#fafafa` / `#a1a1a1` | 17.18 / 6.94 |
| skill / plugin / mcp / agent 强调 | 原值 | `#b3abff` / `#4ed2a9` / `#f5a15e` / `#89b9ff` | 8.70 / 9.49 / 8.66 / 8.92（对卡片） |
| 安装 / 卸载 | 原值 | `#90e9a3` on `#14361d` / `#ffb9b3` on `#4f1a18` | 12.27 / 10.96 |

所有语义面（状态块、错误块、安装/卸载按钮、品牌按钮、Agent 菜单选中项、阴影、弹窗 `::backdrop`、自绘滚动条 thumb、版本槽底）都 token 化，规则体里不再有裸字面量。

## 5. 自定义资源的新色相

玫红家族，OKLCH 色相 **345°**：

| 对比对象 | 改动前（琥珀 79°） | 改动后（玫红 345°） |
| --- | --- | --- |
| vs MCP（57.7°） | 21° | **73°** |
| vs skill（287.8°） | 150.9° | 57.2° |
| vs plugin / agent | 90° / 178.9° | 176.2° / 87.3° |
| 卡片填充 vs MCP 填充 | ΔE 0.7 | **ΔE 3.2** |
| 强调色 vs MCP 强调 | ΔE 19.2（但同色相族） | ΔE 20.6 |

明暗各一对：`--hub-custom: light-dark(#b12083, #f691cc)`、`--hub-custom-soft`、`--hub-custom-line`、`--hub-custom-badge-bg/text`、`--hub-custom-chip-bg`。识别手段仍是自定义卡片独有的**虚线边框 + `Custom` 徽标**。

## 6. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 530/533（28 个文件；0.3.14 基线 527，本次 +3 条 CSS 契约）。**唯一失败文件 `dev/sources.test.ts` 的 3 条 `readMarket` 是基线问题**，见 §8 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功（`dist/assets/index-BpqRBYDC.css` 20.13 kB / gzip 4.77 kB；`index-Dk2ee36P.js` 262.20 kB） |
| `npm run build:plugin` | 成功，`artifacts/agent-hub-0.3.15.bibit-plugin.tgz`，sha256 `a4835e3827126d11fb6d0474dc5870a977ab2dea3951a69425012f16e0a0161e`（100723 字节） |
| `make -C provider test vet build` | 通过（Provider 未改动，回归确认） |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |
| `python3 docs/verification/probe-dark-mode.py --only shipped` | PASS（3 个窗口，见 §7） |

产物核对：`plugin.json` 的 `version: 0.3.15`；bundle CSS 里 `light-dark()` 58 处；琥珀色 `#d9a13b` / `#fdf6e6` / `#fdf1d8` / `#fffaf0` / `#8a5a06` 全部为 0；玫红 `#b12083` / `#f691cc` 存在。

## 7. 布局/主题验证（离屏 WebKitGTK 探针）

`docs/verification/probe-dark-mode.py` 加载仓库里真实的 `src/agentHub.css`，在 `color-scheme: light` 与 `color-scheme: dark` 两种状态下各渲染一次同一份页面（卡片、筛选、分页、设置面板、`::backdrop`）：

```text
   window     theme  scheme  pageBg              pageText            statusBg            prevBg              customBadge         mcpChip
   1600x900   light  light   rgb(245, 246, 248)  rgb(23, 32, 51)     rgb(238, 243, 251)  rgb(255, 255, 255)  rgb(255, 233, 244)  rgb(255, 246, 235)
   1600x900   dark   dark    rgb(18, 18, 18)     rgb(250, 250, 250)  rgb(30, 36, 46)     rgb(32, 32, 32)     rgb(60, 29, 47)     rgb(55, 32, 15)
              custom badge vs text 9.42 | page text vs bg (dark) 17.95
   （1200x800 与 1024x740 同值）
PASS (3 windows)
```

断言项：`color-scheme` 确实跟随；深色下页面背景亮度 < 0.2 且与明色不同；两种主题下正文对比度 ≥ 4.5；状态块、分页按钮、设置输入框、密钥行表面都翻转；深色下保存按钮/状态文字/自定义徽标对比度 ≥ 4.5；`::backdrop` 翻转；自定义与 MCP 的**徽标底色、卡片边框、卡片填充**色相差 ≥ 40°（填充为渐变末端色）。

## 8. 反向验证

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| 1 | 把 `--hub-muted` 改回明色字面量 `#687386` | 布局契约「每个颜色型 token 都是成对声明」 | 1 failed / 18 passed ✓ |
| 2 | 把自定义色相改回琥珀 | 布局契约两条（色相距离、禁琥珀字面量）**与探针三处** | 布局 2 failed；探针报 `only 8–12 degrees apart` ✓ |
| 3 | 把 `--hub-bg` 钉成 `#f5f6f8`（复现原缺陷） | 探针：背景未翻转 + 正文对比度崩到 1.04 | 探针 9 处失败 ✓ |

## 9. 限制与已知问题

- **板端实机深色外观尚未验收**：本次深色证据来自离屏 WebKitGTK 2.52.6（与开发板 2.52.x 同系）。板端需要实机确认字形、原生 `<select>`/`<input>` 的控件外观（`color-scheme: dark` 会影响 UA 绘制的控件）与 GTK overlay 滚动条颜色（后者由 Rust 侧 `gtk-theme-name` 绑定，不在插件控制范围）。
- 宿主若不声明 `color-scheme`（更旧的 `bi-bit`），`light-dark()` 按 `normal` 解析、取浅色分支，页面就是 0.3.14 的观感——这是刻意降级，不是缺陷。已用探针的「no color-scheme」一态确认过。
- 深色取值是按对比度推导的，只经过算法与离屏渲染核对，没有设计师逐项过审；若后续要调，改 `.agent-hub` 里成对的第二个值即可，契约测试会保证不遗漏、探针会保证对比度不退化。
- `dev/sources.test.ts` 的 3 条 `readMarket` 用例基线即失败（jsdom 的 `URL` 与 Node `http.get` 不兼容），与本次无关。
- Dev Host（Local Preview）不切换主题：`@bibit/feature-dev-host` 的 `styles.css` 里没有 `.dark` 与 `color-scheme`，因此本地预览看不到深色效果。要预览需要给预览页面手工加 `class="dark"` 或直接跑上面的探针。

## 10. 提交状态

改动提交在 `bianbu-26.04` 上，尚未 push。
