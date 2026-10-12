# 「创建资源」入口：用 using-apm 预置新会话（0.3.10）

> **后续变更（2026-10-12，0.4.3）**：本文记录的是 0.3.10 当时的 5 行草稿，其内容**已不再是最新文案**；下方「指令与文案」一节保留为当时的历史证据，未改写。0.4.3 把草稿简化为 3 行（`Expert` 取代 `Agent`，去掉「开始前请先和我确认」与「目标 Agent 与版本」），最新文案与断言见 `docs/Changelog.md` 的 0.4.3 条目与 `src/api/conversationCompose.ts` 的 `CREATE_RESOURCE_PROMPT_LINES`。入口的行为、能力降级与失败处理均未变。

日期：2026-09-28，2026-09-29 合入 `bianbu-26.04`
范围：`bibit-agenthub-plugin` 0.3.10。功能分支 `hub-compose-create-resource` 从 `bianbu-26.04` / `091836c`（0.3.2）切出，随后合入已推进到 0.3.9 的主线，版本统一为 0.3.10
上游依据：宿主动作 `conversation.compose`，bibit 主线 `0e3d7b4f820f3a75c1ac549f4488c6f2fd45c91d`
（`packages/feature-contracts/src/host-actions.ts`、`docs/feature-sdk/host-capabilities.md` §宿主动作、`docs/development/agent-delivery.md` §插件预置新会话）

## 结论

Hub 页头新增「创建资源」按钮：点击经 `host:actions` 调用 `conversation.compose`，打开新会话并预填一段点名 `using-apm` 的草稿，**不发送**；用户补充需求后自己发送，由 bibit 内置的 `using-apm` skill 完成资源创建。入口按能力分级降级：拿不到 `host:actions` 就禁用并说明原因；宿主不认识该动作就提示「当前宿主不支持发起会话」；可重试的拒绝只提示用户先清空输入框，插件**从不**自动重试。

**实机 happy path 未验证**，原因见文末「实机阻塞」。

## 关键决策与依据

| 决策 | 依据 |
| --- | --- |
| 用 `conversation.compose`，不用 `conversation.create` | `create` 的输入形状已冻结（只有 `target`），塞不进提示词；`compose` 的语义就是「预置草稿且从不发送」 |
| 只给 `prompt`，不给 `target` | 需求是「使用默认 agent」；不给 `target` 时宿主沿用用户当前选中的专家 |
| 不把 `using-apm` 作为临时技能挂 chip | 板端 `/usr/share/bianbu-agent-runtime/default-profile/config.yaml` 的 `presets.skills` 为 `[using-apm]`，即对所有专家固定启用，再挂 chip 是重复；而设备未装该技能时带 `skills` 会让整次调用以 `INVALID_INPUT` 整体失败（`hostActions.ts` 的 `resolveTargetSkills` 会逐项在目录里查找并要求 `assignable`） |
| 入口禁用而非「点了再报错」 | 契约「能力缺失即降级」：`getCapability('host:actions')` 为 `undefined` 时只禁用对应入口并说明原因 |
| `UNSUPPORTED` 用插件文案 | 宿主此时的 `message` 是 `Unknown host action: conversation.compose` 开发者串，不该上屏 |
| `FAILED` + `retryable` 只提示、不重试 | 契约明确「不要自动重试」；可重试的成因（首页未发送草稿、校验期间换靶）都需要用户先处理 |
| vendor SDK 升 0.4.0 | `conversation.compose` 的类型、`FeatureHostActionApiV1`、`host:actions` capability 都只存在于 0.4.0 |

## SDK vendor 快照

来源：bibit 主线 `0e3d7b4f820f3a75c1ac549f4488c6f2fd45c91d`（与「相关文档」给出的主线一致）。
打包方式（可复现，用仓库自带的 yarn release，不装依赖、不编译宿主）：

```bash
rm -rf /tmp/bibit-sdk-0e3d7b4 && mkdir -p /tmp/bibit-sdk-0e3d7b4/{src,out}
cd ../bibit && git archive 0e3d7b4f820f3a75c1ac549f4488c6f2fd45c91d | tar x -C /tmp/bibit-sdk-0e3d7b4/src
cd /tmp/bibit-sdk-0e3d7b4/src
for p in contracts sdk plugin-sdk dev-host; do
  ( cd packages/feature-$p && node /tmp/bibit-sdk-0e3d7b4/src/.yarn/releases/yarn-4.5.3.cjs \
      pack --out /tmp/bibit-sdk-0e3d7b4/out/bibit-feature-$p-0.4.0.tgz )
done
```

本分支的依赖集是 contracts / sdk / plugin-sdk / dev-host 四个，**没有** `@bibit/feature-ui`（那是 hub-dev/main 血统的依赖；本分支的页面用自己的 `.agent-hub*` CSS），因此只替换这四个，不引入未使用的 vendored 包。

| 包 | sha256 |
| --- | --- |
| `bibit-feature-contracts-0.4.0.tgz` | `b2a93d05583bbfa0da0f516a08929c0dbebf64e8c82ea8df454aca2d7834386b` |
| `bibit-feature-dev-host-0.4.0.tgz` | `7663afa41a0dfb6027742fcd21def66444ea2accb7470dfcf726ad65e59ddebe` |
| `bibit-feature-plugin-sdk-0.4.0.tgz` | `ac3500197d2c55d1cb91cd2dcd5c5bc6a13338771ada9854ecb54ddcb80e21cd` |
| `bibit-feature-sdk-0.4.0.tgz` | `b4f74dfa6bdaa76ea70b4f3c7de38390c16a8f4d15bcd38cabd5f05378ec4003` |

换靶验证（`npm install` 可能按 lock 里旧 integrity 命中缓存而什么都不换，所以必须查实物）：

```bash
grep -c "conversation.compose" node_modules/@bibit/feature-contracts/src/host-actions.ts   # 1
for p in contracts sdk plugin-sdk dev-host; do node -p "require('./node_modules/@bibit/feature-$p/package.json').version"; done  # 全为 0.4.0
```

升级前后对本分支既有代码零行为差异：0.3.0 上 337/337 通过，0.4.0 上同样 337/337；`tsc --noEmit` 均干净。**未报出需要改语义的差异**，因此没有顺手改任何既有实现。

## 契约与实现对照

```ts
const actions = host.getCapability('host:actions')
if (!actions) return showUnavailable(...)          // 禁用入口并说明原因
const result = await actions.invoke('conversation.compose', { prompt })
// completed | cancelled | rejected(error.code) —— 按 code 分支，不抹平
```

| 契约点 | 实现位置 | 验证 |
| --- | --- | --- |
| 能力缺失即降级、不伪造 | `AgentHubPage.tsx` 的 `actions` 判空 + 按钮 `disabled` | 页面用例「keeps the entry disabled without the capability and sends nothing」 |
| 一定不发送 | 只调用 `compose`，不碰 `conversation.create`，不做任何 follow-up | `conversationCompose.test.ts`「invokes conversation.compose once with only the draft」（断言 `calls.length === 1`） |
| 预置文本 ≤ 16 000、空白按未提供 | 草稿 5 行，长度 < 2 000，且不含 `{`/`}`（避免被 i18n 的 `format()` 当占位符） | `conversationCompose.test.ts`「stays well inside the host prompt limit…」 |
| 技能 id 形态 | 本轮不发 `skills`，规避「展示名 vs Runtime id」的坑 | — |
| `UNSUPPORTED` 不上屏宿主开发者串 | `noticeFor()` 换成 `COMPOSE_UNSUPPORTED_TEXT` | 单测 + 页面用例各一条 |
| `INVALID_INPUT` 上屏 `message`、不重试 | `noticeFor()` 透传宿主 message | 单测一条 |
| `FAILED` + retryable 只提示 | 提示行追加「请先清空输入框，再重试」，无 Retry 按钮、无自动重试 | 页面用例「shows a retryable host failure and leaves retrying to the user」 |
| `cancelled` 不是错误 | `status === 'cancelled'` 不产生 alert | 单测 + 页面用例各一条 |
| 不重复提交 | `composing` 期间按钮 `disabled`，回调里再判一次 | 页面用例「does not start a second compose while the first one is in flight」 |
| 卸载后不 setState | `mountedRef` | 代码路径；成功路径由宿主导航带走组件 |
| 不 import 宿主私有模块 / 不调 Tauri | 只 import `@bibit/feature-*` 公开类型 | `grep -rn "from '@/" src` 无命中 |

## 指令与文案

页面按插件翻译器逐行渲染下面 5 句再拼成多行草稿（中文词典在 `src/agentHubI18n.tsx`；`agentHubI18n.test.tsx` 的死键扫描保证中英词典与代码字面量一致）：

```text
Use the using-apm skill to create a new Power resource.
Confirm these details with me before you start:
Resource type (Skill / Plugin / MCP / Agent):
What the resource should do:
Target Agent and version:
```

## 本地验证

命令（node 必须用 24；本机默认 `/usr/bin/node` 是 v18，jsdom 下 `crypto.subtle` 缺失会造成 6 个既有用例假失败）：

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npm test && npm run typecheck && npm run build:dev && npm run build:plugin
grep -c "conversation.compose" node_modules/@bibit/feature-contracts/src/host-actions.ts   # 1
git diff --check
```

结果（2026-09-28）：

| 检查 | 结果 |
| --- | --- |
| `npm test` | 501/501 通过（27 个文件）—— 合并前的功能分支是 357/357，合并后并入主线既有的 custom resources / 设置标签页 / 固定卡片宽度用例；SDK 从 0.3.0 升到 0.4.0 前后主线既有用例均无变化 |
| `npm run typecheck` | exit 0 |
| `npm run build:dev` | exit 0 |
| `npm run build:plugin` | 产物 `artifacts/agent-hub-0.3.10.bibit-plugin.tgz` |
| `git diff --check` | 无输出 |
| `conversation.compose` 命中数 | 1（真的换上了 0.4.0） |

合并后（2026-09-29）在 `bianbu-26.04` 上复测：

| 检查 | 结果 |
| --- | --- |
| `npm test`（Node 24.16） | 501/501 通过（27 个文件） |
| `npm test`（系统 Node 18.19） | 498/501；3 项失败全部是 `dev/sources.test.ts` 的 `readMarket` 用例，与 0.3.2 起记录的既有失败逐条一致，与本次改动无关 |
| `npm run typecheck` / `npm run build:dev` / `npm run build:plugin` | exit 0；产物 `artifacts/agent-hub-0.3.10.bibit-plugin.tgz`，sha256 `22eaeebab991cae842999629ddbd0b5775cd5a5910a085c8d5e5bd4fc17e2ebb` |
| 产物内容核对 | `featureManifest.version = 0.3.10`、`requiredHostCapabilities = ["service:store","host:actions"]`、`contributions.settings = []`、`locales = ["en","zh-CN"]`；`dist/plugin.js` 含 1 处 `conversation.compose`、0 处 `@tauri-apps`；`plugin.sig.keyId = agent-hub-development` |
| `make -C provider test` | `ok`（`internal/provider`、`cmd/provider-probe`） |
| `git diff --check` | 无输出 |

### 回滚验证（新增断言不是空转）

逐条临时撤掉实现，对应用例必须失败：

| 回滚动作 | 失败用例数 |
| --- | --- |
| `composeResource` 不再传 `prompt` | 2（`conversationCompose.test.ts` 1 + `AgentHubPage.test.tsx` 1） |
| 按钮不再因缺少 capability 而禁用 | 1 |
| `UNSUPPORTED` 复用宿主 message | 2 |
| 去掉「请先清空输入框」提示 | 1 |
| grant 里删掉 `host:actions` | 2（`manifestGrants.test.ts`） |

回滚后已全部还原，`npm test` 回到全绿。

## 板端验证（K3，`ssh K3`／`10.0.91.51`，bi-bit 0.1.18）

板端现状（实测）：

| 事实 | 证据 |
| --- | --- |
| 板上插件是 0.3.3 之前的构建，声明里没有 `host:actions` | `/usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz` 的 `plugin.json` → `requiredHostCapabilities: ["service:store"]`；bundle sha256 与本仓库 `artifacts/agent-hub-0.3.3.bibit-plugin.tgz`（合并前功能分支的构建）一致 |
| 板上 grant 只批了 `service:store` | `/etc/bibit/feature-capability-grants.d/agenthub.json` |
| 板端宿主不登记 `conversation.compose` | `grep -c conversation.compose /usr/bin/bibit-gui` → 0；`grep -c host:actions` → 2（能力与 grant 白名单都在，只是动作表只有 `conversation.create`） |
| 已发布的 bi-bit 都没有该动作 | 仓库 tag `bianbu/0.1.18`…`bianbu/0.1.22` 的 `hostActions.ts` 都只有 `conversation.create`；`archive.bianbu.xyz` 上可下载的最新版是 0.1.22 |
| `using-apm` 确实是板端预置技能 | `/usr/share/bianbu-agent-runtime/default-profile/config.yaml` → `presets.skills: [using-apm]`；该技能 `SKILL.md` 的 `name: using-apm` |

因此板端本次可以验证的两条降级路径。它们还没执行，原因见文末「实机阻塞」；执行方式已脚本化：

```bash
# 在 .worktrees/hub-compose 下（先 npm run build:plugin）
docs/verification/deploy-create-resource-entry.sh <board-host> 1        # 只换 bundle，grant 仍是旧的
docs/verification/deploy-create-resource-entry.sh <board-host> 2        # 再装上含 host:actions 的 grant
docs/verification/deploy-create-resource-entry.sh <board-host> restore  # 还原备份
```

1. **能力缺失即禁用**（step 1）：只装 bundle、不改 drop-in grant → 重启 GUI → Agent Hub 页头按钮 `disabled` 且旁边显示「当前宿主未提供发起会话的能力」，点击不发请求。
2. **宿主不认识该动作**（step 2）：把 `debian/agenthub-feature-grants.json` 装到 `/etc/bibit/feature-capability-grants.d/agenthub.json` 后重启 GUI → 按钮可点，点击后显示「当前宿主不支持发起会话」（对应 `UNSUPPORTED`）。

这两条与单测覆盖的是同一套分支，但它们是**实机**证据，用于证明 capability 判定与动作结果映射在真实宿主上成立。

## 实机状态

**已做的板端只读侦察**（未改动板上任何文件）：板上 `bi-bit 0.1.18`、`bibit-agenthub-plugin 0.3.3`（合并前的构建）、`/etc/bibit/feature-capability-grants.d/agenthub.json` 只批 `service:store`；`grep -c` 证明宿主实现里没有 `conversation.compose`。板上可用 `grim` / `wtype` / `ffmpeg`，GUI 以 `bianbu` 跑在 `:0`。

**未执行的写入类验证**（step 1 / step 2）卡在两个环境前提上，都不是代码问题：

1. 目标路径归 root，`bianbu` 无权写入（`test -w` 均为 false），且板上 `sudo` 需要交互式密码、`root` 不接受公钥、没有 `bibit-dev`；
2. 开发签名与板上信任库不匹配：`/usr/lib/BiBit/resources/plugin-trusted-keys.json` 里 `agent-hub-development` 的公钥是 `LAZehiB6ST/pKRAF6wqrKpTNJdIAo/L9o3LUeTbiIqM=`，而工作区里能找到的 `agent-hub-development` 私钥（含主工作树那把）公钥为 `NpF8QLmbHyj1ofAT7ImYqBUqYhO+qz7Ym+wKWo6ijTI=`，本 worktree 新生成的是 `KSR2rh7REBzK0dag+P1Cb4iGFSsIsRVuQqDF6emFO90=`。也就是说，即使装上 bundle，宿主也会因验签失败而拒绝激活。

要推进这一步，需要其中之一（都属于环境/权限决定，故未擅自执行）：

- 授权我在板上执行 `sudo`（或在 `ssh K3` 用 root），或由你手工跑 `docs/verification/deploy-create-resource-entry.sh <host> 1|2`；
- 提供与板上信任库匹配的那把 `agent-hub-development` 私钥（或允许把本 worktree 生成的开发公钥写进板上的 `plugin-trusted-keys.json`）。

## happy path 未验证

以下判据**尚未执行**，需要「由 bibit 主线 ≥ `0e3d7b4` 构建的 bi-bit」，否则不可能观察到：

- 点入口 → 新会话首页打开（不是复用当前会话）；
- 技能以临时 chip 附上、提示词预填在输入框、**消息列表仍为空**（没有自动发送）；
- 用户补充文字后能正常发送，`using-apm` 接住任务；
- 首页先打半截字不发送，再触发入口 → 返回可重试的 `FAILED`、`message` 为「输入框仍有未发送内容」、原草稿**不被覆盖**。

已排除的路径：板端 `bi-bit 0.1.18`、仓库 tag `bianbu/0.1.21`/`0.1.22`、`archive.bianbu.xyz` 上可下载的 0.1.22（`apt-get download bi-bit=0.1.21` 已 404，0.1.22 存在但同样不含该动作）。板端 `apt-cache policy bi-bit` 的候选是 0.1.21，也不含该动作。

拿到该构建后按上表逐条执行；在此之前不得把「插件装上了／按钮能点了」当作验收通过。

## 与既有交付的关系（合并记录）

功能分支从 0.3.2 切出后，主线往前走到了 0.3.9（自定义资源、APC 凭据设置标签页、卸载二次确认、固定卡片宽度）。合并时把这批改动与本次入口并到一起，版本统一为 **0.3.10**，冲突按以下原则解决：

| 冲突文件 | 解决方式 |
| --- | --- |
| `bibit.feature.json` / `package.json` / `package-lock.json` | 版本取 0.3.10；`requiredHostCapabilities` 取并集（`service:store` + `host:actions`）；manifest 保留主线的 `contributions.settings: []` 与 `locales` |
| `debian/agenthub-feature-grants.json` | 自动合并：capability 加上 `host:actions`，operation 列表保留主线新增的 custom/upload/delete |
| `debian/changelog` / `docs/Changelog.md` | 0.3.10 条目置顶，其下保留主线 0.3.3–0.3.9 的完整历史（主线 0.3.3 是「Power 展示信息跟随应用语言」，与本次入口无关，未改动） |
| `docs/development-and-deployment-guide.md` | 取主线事实（settings 面板、自定义资源、0.3.10 产物名），并入本次新增的宿主动作小节、决策表一行、Local Preview 降级说明与排查表 |
| `src/AgentHubPage.test.tsx` | 两边 describe 全部保留（主线 custom resources / 设置标签页 + 本次入口），`makeStoreHost` 保留新增的可选 `compose` 参数 |
| `src/AgentHubPage.tsx` / `agentHub.css` / `agentHubI18n.tsx` | 自动合并；页头入口与主线的一级标签页、固定卡片网格、设置面板共存 |
