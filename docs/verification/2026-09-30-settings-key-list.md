# 0.3.13 验证记录：设置标签页改为 APC Key 列表（增删 / 单独启用）

- 变更版本：0.3.13（上一版 0.3.12「能力中心」文案重命名；本改动在其之上重放到 `bianbu-26.04` / `25a65e8`）
- 验证环境：amd64 开发机；Node 18.19（`npm test` / `npm run build:*`）、Go 1.26.5、WebKitGTK 2.52 + GTK 3.24（离屏探针）
- 工作树：`.worktrees/hub-settings-keys`（分支 `hub-settings-keys`，从 0.3.11 `6cba443` 切出，重放到 `bianbu-26.04` 的 `25a65e8` 之上）
- 相关提交：见文末「提交状态」

## 1. 用户需求

> 新建 worktree，修改 hub settings 标签页中的逻辑：
> 去掉 Clear Saved key 和 save settings；文本框中输入 key 后可点击保存；列表中即显示 key（key 头 中间星号隐藏 key 尾）；每条保存的 key 有单独的删除和启用按钮，删除无需二次确认；列表中只有一个 key 可以启用，作为提交资源的输入；当列表中没有 key 时，新建 key 默认启用。

需求里两处没有写死的分支，实现前与需求方确认过：

| 决策点 | 选择 |
| --- | --- |
| 已有启用 Key 时再新建 | **新建的不自动启用**，保持原 Key 启用（新增不会偷偷换掉正在用的凭据） |
| 删除当前启用的 Key 且还有其他 Key | **不自动启用**剩下的任何一条，等用户自己点启用 |
| 交付范围 | 按仓库惯例做成完整版本：0.3.13 + changelog + 验证文档 + 全部门禁 |

## 2. 实现要点

| 层 | 改动 |
| --- | --- |
| `src/components/AgentHubSettingsPanel.tsx` | 重写：去掉 `Save settings` / `Clear saved key`，改为输入框 + `Save key`；列表每行 `preview` + 状态 + 独立的 `Enable` / `Delete`；启用中的行 `Enable` 禁用；写入进行中两个按钮都禁用 |
| `src/api/contracts.ts` | `AgentHubSettingsV1` 改为 `{showExperimental, refreshMinutes, keys[]}`；`settings.keys.add.v1` / `settings.keys.delete.v1` / `settings.keys.enable.v1` 的闭集 DTO 与解析器；`isSettingsKeyId`（`^[0-9a-f]{32}$`）；`SETTINGS_MAX_KEYS`；`parseSettingsView` 拒绝无 `****` 的 `preview`、重复 id、两条 `enabled` |
| `src/api/settingsClient.ts`（新） | `readSettings` / `addSettingsKey` / `deleteSettingsKey` / `enableSettingsKey` 四个客户端，均为闭集入参 + 结果再校验，超时 30s |
| `src/agentHubI18n.tsx` | 删掉 `Save settings` / `Configured` / `Not configured` / `Clear saved key` / `The API Key is never shown again once saved.`；新增 `Save key` / `No key saved` / `{count} saved` / `Saved API Keys` / `Enabled` / `Not enabled` / `Enable` / `Enabling…` / `Enable key {preview}` / `Delete key {preview}` 与四条新状态文案 |
| `src/agentHub.css` | `.agent-hub-settings-panel__credential-add`（输入 + 保存同一行）、`__keys` / `__key` / `__key-preview` / `__key-state` / `__key-actions`；预览可收缩换行、动作 `flex: 0 0 auto`，保证长 Key 不撑宽面板、不产生横向滚动 |
| `provider/internal/provider/settings.go` | schemaVersion 2 + `apiKeys: [{id,key,enabled}]`；`MaskAPIKey`；`MigrateSettings`（v1 → 一条已启用记录）；`Add` / `Delete` / `Enable`；`SettingsAPIKey` 只返回启用项 |
| `provider/internal/provider/{operations,contracts,config,server,selftest}.go`、`cmd/provider-probe/main.go` | 新操作与闭集解码、`OperationRequest` 增加 `SettingsKey` / `SettingsKeyID`、selftest 覆盖四个 settings 操作、probe 改为 `settings.get.v2` 报告 `keyCount` / `hasEnabledKey` |
| `dev/store.ts` | Mock 复刻遮蔽与「首个启用 / 至多一个启用 / 删除不提升」规则，导出 `resetDevSettings` / `maskAPIKey`；上传源拿到的是启用项 |
| `debian/agenthub-provider.json` | `credentialParameters` 从 `settings.update.v1` 移到 `settings.keys.add.v1` |
| `debian/agenthub-feature-grants.json` | operation 列表换成四个 settings operation（共 11 个） |
| `src/manifestGrants.test.ts` | 同步断言新的 operation 列表 |

语义要点：

- **只有一个启用**：启用标志由 Provider 决定，页面只回显。列表为空时第一条自动 `enabled: true`；已有 Key 时新增的 `enabled: false`；`enable` 置为唯一启用；`delete` 删除启用项后其余保持未启用（此时 `SettingsAPIKey` 返回 `unauthorized`，上传提示未配置）。
- **遮蔽在 Provider 侧**：`MaskAPIKey` 生成 `apc-****-one`；前端 `parseSettingsView` 再拒绝不含 `****` 的 `preview`、非 32 位 hex 的 `id`、重复 id 与两条 `enabled`，后端一次 bug 不会变成屏幕上的凭据。
- **删除无二次确认**：行内按钮的可访问名是 `Delete key {preview}`，已经写清删的是哪一条；卸载 Power 与删除自定义资源仍然确认。
- **迁移**：v1 文件（单个 `apiKey`）读取时迁移为「一条已启用记录」，下一次写入落成 v2；v2 文件里再出现 `apiKey`、或两条 `enabled`，一律报错不静默修复。权限 0600、原子写入、拒绝对符号链接写入、上限 50 条、重复 Key 拒绝都不变。

## 3. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 521/524（28 个文件；0.3.12 基线 505，本改动净 +15：新增 `settingsClient.test.ts` 10 条、面板 +5、布局 +1、dev store +1，`customResources.test.ts` 的 settings 契约用例移入新文件 −2；另 +4 来自同分支的 0.3.12 文案重命名）。**`dev/sources.test.ts` 的 3 条 `readMarket` 用例基线即失败**，与本次改动无关，见 §6 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功（`dist/assets/index-r7WtHby3.js` 262.20 kB / gzip 82.43 kB；`index-tZD7Sm78.css` 16.55 kB / gzip 4.06 kB） |
| `npm run build:plugin` | 成功，`artifacts/agent-hub-0.3.13.bibit-plugin.tgz`，sha256 `cab64173ece2ba9cf87838295d95415d446dde1bf49ebc3584bda16e4be36ac2`（100014 字节） |
| `make -C provider test vet build` | 通过（`internal/provider`、`cmd/provider-probe`；`go vet` 无输出） |
| `bibit-agenthub --self-test` | exit 0 |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |
| `python3 docs/verification/probe-settings-key-list.py --only shipped` | PASS（10 个窗口，见 §5） |

### 产物内容核对（解包 0.3.13 bundle）

```text
version:  0.3.13
pages:    [{ id: home, path: "", surfaces: [main], navigation: {group: library, order: 100} }]
settings: []
locales:  [en, zh-CN]
```

在 `dist/plugin.js` 中按字符串计数：

| 字符串 | 次数 |
| --- | --- |
| `Clear saved key` | 0 |
| `Save settings` | 0 |
| `hasApiKey` | 0 |
| `settings.update.v1` | 0 |
| `settings.get.v1` | 0 |
| `The API Key is never shown again once saved.` | 0 |
| `settings.get.v2` | 2 |
| `settings.keys.add.v1` | 3 |
| `settings.keys.delete.v1` | 2 |
| `settings.keys.enable.v1` | 2 |
| `Save key` / `No key saved` / `Saved API Keys` | 2 / 2 / 2 |

### Provider 真机流程（直接驱动二进制，非 Mock）

用 `bibit-agenthub provider --data-dir <tmp>` 走 NDJSON：

| # | 调用 | 结果 |
| --- | --- | --- |
| 1 | `settings.get.v2`（空目录） | `{showExperimental:false, refreshMinutes:15, keys:[]}` |
| 2 | `settings.keys.add.v1 {apiKey:"apc-key-one"}` | `keys:[{id:"a102…", preview:"apc-****-one", enabled:true}]` |
| 3 | `settings.keys.add.v1 {apiKey:"apc-key-two"}` | 第一条仍 `enabled:true`，第二条 `enabled:false` |
| 4 | `settings.keys.enable.v1 {id:<第二条>}` | 只有第二条 `enabled:true` |
| 5 | `settings.keys.delete.v1 {id:<启用项>}` | 剩下的行 `enabled:false` |
| 6 | `powers.upload.v1`（无启用项） | `incompatible`（未授权路径，`apm` 不启动） |
| 7 | `settings.keys.add.v1 {apiKey:<重复>}` | `incompatible` |
| 8 | `settings.get.v2`（重启进程后） | 列表与启用状态持久化 |

文件与迁移核对：

- 落盘内容为 `{"schemaVersion":2, …, "apiKeys":[{"id","key"[,"enabled"]}]}`，权限 `0600`，只写 v2 字段。
- 手工写一个 0.3.11 形状的 v1 文件（`{"schemaVersion":1,…,"apiKey":"apc-legacy-key"}`）后：`settings.get.v2` 返回一条 `enabled:true` 的记录，`preview` 为 `apc-****-key`；再 add 一条后文件变成 schemaVersion 2 且不再含 `apiKey` 字段，旧 Key 保留。

## 4. 反向验证

每一项单独变异后，对应用例必须失败；随后恢复并重跑确认通过。

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| 1 | `Enable` 按钮去掉 `entry.enabled` 禁用条件 | 面板「已启用行不可再启用」用例 | 1 failed / 16 passed ✓ |
| 2 | `parseSettingsView` 去掉 `preview` 必须含 `****` 的校验 | `settingsClient.test.ts` 遮蔽用例 | 1 failed / 9 passed ✓ |
| 3 | Provider `DeleteSettingsKey` 删除后自动启用幸存项 | `TestSettingsDeleteLeavesNoEnabledKey` | FAIL（幸存项 `Enabled:true`）✓ |

## 5. 布局验证（离屏 WebKitGTK 探针）

`docs/verification/probe-settings-key-list.py` 加载**仓库里真实的** `src/agentHub.css`，用模型化的宿主盒子（窗口 − 240px 侧栏 − 2px 外壳边框）渲染两条 Key 行（第二条的 `preview` 人为拉长到 124 字符）：

```text
   window     panel                  row[long]              rowActions   addRow
   1920x1080 350,38 1460x344        373,263 1414x59        1619,273 155x39 373,114 1414x41
   1600x900  298,38 1244x368        321,263 1198x83        1351,285 155x39 321,114 1198x41
   1440x900  298,38 1084x368        321,263 1038x83        1191,285 155x39 321,114 1038x41
   1300x850  294,38 952x368         317,263 906x83         1055,285 155x39 317,114 906x41
   1200x800  290,38 860x368         313,263 814x83         959,285 155x39 313,114 814x41
   1150x800  288,38 814x389         311,263 768x104        911,295.5 155x39 311,114 768x41
   1024x740  282.95,38 698.09x389   305.95,263 652.09x104  790.05,295.5 155x39 305.95,114 652.09x41
   900x700   278,38 584x431         301,263 538x146        671,316.5 155x39 301,114 538x41
   640x700   27.59,38 584.81x431    50.59,263 538.81x146   421.41,316.5 155x39 50.59,114 538.81x41
   400x700   16,38 368x854          39,266 322x566         193,529.5 155x39 39,114 322x41
PASS (10 windows)
```

断言：页面不横向滚动、面板不越过页面列、每一条 Key 行不越过面板、预览不越过面板、两个行内动作顶边一致（不换行）且不落到面板内边距之外、`Save key` 始终在输入框右侧。窄窗口下行高随预览换行增加（1200px 时 83px，400px 时 566px），这正是「预览让位、动作不换行」的表现。

## 6. 限制与已知问题

- `dev/sources.test.ts` 的 3 条 `readMarket` 用例在本机（Node 18.19.1 / vitest 3.2.4）**基线即失败**，与本次改动无关：jsdom 环境把全局 `URL` 换成不继承 `node:url` `URL` 的实现，传给 `http.get(url, options, cb)` 后 Node 不认它是 URL，于是把 options 对象当 listener。0.3.11 的验证文档已记录同一现象。
- 删除当前启用的 Key 后不会自动启用其它 Key，这是本次确认过的产品选择。字面需求只说「列表中没有 Key 时新建 Key 默认启用」；如果之后希望「始终有一条启用」，要改的是 Provider 的 `DeleteSettingsKey`，而不是前端。
- 面板的 `showExperimental` / `refreshMinutes` 仍在协议结果里（Provider 仍读写这两个字段、闭集校验不变），但页面既不读也不写：0.3.13 起没有 `settings.update.v1`，也就没有它们的写入入口。
- 实机 GUI 未验证：本次结论来自 Vitest + 离屏 WebKitGTK 探针 + 直接驱动 Provider 二进制。板端验收步骤已写进 `docs/development-and-deployment-guide.md` §16。

## 7. 提交状态

改动已提交在 `.worktrees/hub-settings-keys` 的 `hub-settings-keys` 分支上（`feat: keep a list of APC API keys in the Settings tab (0.3.13)`），并已 rebase 到 `bianbu-26.04` 的 `25a65e8` 之上；尚未 push，也尚未快进合入 `bianbu-26.04`。`artifacts/`、`dist/`、`.bibit-keys/` 均被 `.gitignore` 覆盖，不在提交内容里。

本改动与同分支的 0.3.12 文案改动在 5 处相遇（`package.json`、`package-lock.json`、`bibit.feature.json`、`debian/changelog`、`docs/Changelog.md`），处理方式是：版本统一取 0.3.13，两条 changelog 条目都保留、按新→旧排列。文案层与设置层没有共享文件冲突，`agentHubI18n.tsx` / `agentHub.css` / `AgentHubPage.test.tsx` 都是自动合并，合并后两边的键与断言都还在（bundle 核对里 `Capabilities` / `My Capabilities` / `Capability Market` / `Expert` 与四个 settings operation 同时出现）。
