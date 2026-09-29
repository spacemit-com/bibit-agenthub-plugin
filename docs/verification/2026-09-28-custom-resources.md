# 自定义（手动安装）资源：展示、APC 上传与本地删除

日期：2026-09-28
范围：`bibit-agenthub-plugin` 0.3.4（前端 DTO/数据层/组件/设置页、Go Provider 三个新 operation 与 settings 持久化、dev Mock、打包与文档）
上游依据：APM Agent 目录布局与 Power 资源格式 V2（`../apm`、`../using-apm`）、APC 提交接口（`APC-API.md`）

## 用户需求

1. 「我的 Power」除了显示 APM 上下载的资源，还要显示用户手动安装到对应安装目录下的自定义资源；
2. 卡片上自定义资源必须与云（Hub）资源明显区分；
3. 卡片提供 APC 上传与本地删除（系统 rm）；
4. 上传所需的 APC Key 在 Agent Hub 插件设置中配置。

需求随后放宽为：

5. **显示**不要求满足 apm 资源 schema，只需满足对应资源的主流最低格式；不满足最低要求时给出 warning（而不是静默丢弃）；
6. **上传**仍必须满足格式要求（由 apm 判定）；
7. 上传/删除按钮与「安装」一样放进卡片弹窗，不再单独放在卡片上。

## 关键设计决策（已与用户确认）

| 问题 | 结论 |
| --- | --- |
| 「自定义资源」如何界定 | 不是名为 `custom` 的目录，而是**手动安装、且 `(type,name)` 不在 apm installed 清单里**的资源 |
| MCP | 本期跳过。apm 不为 MCP 维护目录，无法扫描 |
| scope | 合并进「我的 Power」，卡片打 `Custom` 标记（不新增 scope） |
| 显示校验强度 | B：Provider 轻量解析（v1/v2 都接受），只要求主流最低格式 |
| 上传路径 | A：Provider 执行 `apm submit`，Key 经环境变量注入 |
| Key 存储 | Provider 实现 `settings.get/update`，`settings.json` 持久化，新增 `apiKey` 字段（只回传 `hasApiKey`） |
| 冲突处理 | 同 `(type,name)` 已在 APM 清单时，以 APM 清单为准，丢弃自定义项 |

## 交付内容

### Provider（`provider/`）

| 文件 | 内容 |
| --- | --- |
| `internal/provider/custom.go`（新） | 扫描 + 轻量解析 + 路径解析 + 删除。权威文件、目录名身份、约束与上限见下表 |
| `internal/provider/upload.go`（新） | `apm validate` → `apm submit`；Key 经 `APC_API_KEY` 注入；失败原因清洗（Key→`***`、去 ANSI/控制字符、压单行、截断 300 字节） |
| `internal/provider/settings.go`（新） | `settings.json` 持久化：目录 0700、文件 0600、临时文件 + fsync + rename、拒绝符号链接写入、损坏 JSON 报错 |
| `internal/provider/config.go` | 新增 `--data-dir`、`--apc-root-url` 与 `BIBIT_PROVIDER_DATA_DIR` 回退；`NewInvoker` 分发 5 个新 operation |
| `internal/provider/contracts.go` / `operations.go` / `server.go` | 5 个新 operation 的 DTO、闭集解码与声明；`providerVersion` → `0.3.4` |
| `internal/provider/selftest.go` | 新增第 3 项子检查（custom.list / upload / delete / settings.get / settings.update 的形状与「结果不含 apiKey/路径/stderr」） |
| `cmd/provider-probe/main.go` | `--scope custom`、`--operation settings.get.v1` |

operation 与声明顺序（`bibit.initialize` 结果）：

```text
powers.list.v1 powers.inspect.v1 powers.install.v1 powers.uninstall.v1
powers.custom.list.v1 powers.upload.v1 powers.delete.v1
settings.get.v1 settings.update.v1
```

扫描范围与最低格式（`custom.go`）：

| Agent | 根目录 | 类型 |
| --- | --- | --- |
| `bibit` | `~/.bianbu-agent` | skill / plugin / agent |
| `codex` | `~/.codex` | skill |
| `claude-code` | `~/.claude` | skill |
| `hermes-agent` | `~/.hermes` | skill / plugin |

| 类型 | 权威文件 | 显示最低要求 |
| --- | --- | --- |
| skill | `SKILL.md` | frontmatter 映射 + `name`/`description` 非空 |
| plugin | `apc-plugin.json`、`plugin.yaml`、`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json` | 清单有非空 `name` |
| agent | `agent.yaml` | 有非空 `agent.name` |

约束：目录名必须是规范 kebab（身份取目录名）、`.` 开头忽略、非目录忽略（这三类不报 warning）；候选但缺权威文件 → `missing-authority-file`；低于门槛/非映射/非 UTF-8/超 64 KiB → `invalid-authority-file`；每类型目录 200 项、总 1000、`skipped` ≤ 20；`version` 只接受 `v<x>.<y>.<z>`，否则空串；类型目录与资源目录都允许符号链接（跟随读取）。

### 前端（`src/`）

| 文件 | 内容 |
| --- | --- |
| `api/contracts.ts` | `PowerSource`、`CustomResourceRecord/Skipped/List`、`UploadInput/Result`、`DeleteResult`、`AgentHubSettingsV1/UpdateV1` 与各自的闭集解析器；`PowerWarning.values`、新增两个 warning code；custom 系列规则（恰好 1 个版本、版本可为空、tags 为空） |
| `api/customResources.ts`（新） | `listCustomResources` / `uploadCustomResource` / `deleteCustomResource` + `submissionIdFrom` |
| `api/apm.ts` | 空版本参与排序（排最后）、`source` 进 snapshot、`buildMergedInstalledPowersResult`（合并 + 按 `(type,name)` 去重） |
| `api/powerCatalogClient.ts` | installed 分支并行取 APM 清单与自定义扫描；扫描失败降级为 1 条 warning；`skipped` 转 warning 模板 |
| `components/PowerCard.tsx` | `data-source="custom"`、`Custom` 徽章、版本槽变静态标签（无版本显示占位符） |
| `components/PowerDetailsDialog.tsx` | 自定义资源走目录事实 + `Upload`/`Delete` 内联表单（含删除确认），不显示 APM 安装状态；上传要求非空单行 message |
| `AgentHubPage.tsx` | 独立 `customControllerRef`、`customAction`/`customNotices` 状态、warning 带 `values` 渲染、上传/删除后刷新清单 |
| `AgentHubSettingsPage.tsx` | 根节点 `main` → `section`；新增 APC Key 密码框、`hasApiKey` 状态、清除按钮；`apiKeyDirty` 区分「保留」与「清除」；保存防重复提交 |
| `agentHub.css` | 自定义卡片虚线 + 琥珀色 + badge、静态版本标签、弹窗内联表单；settings 根改为可收缩（`width:100%/min-width:0/max-width:100%`） |
| `agentHubI18n.tsx` | 新增中文文案（含 warning 模板与 Key 相关） |
| `dev/custom.ts`（新）、`dev/store.ts`、`vite.config.ts`、`dev/main.tsx` | dev 侧同语义实现：扫描本机真实 home、`apm validate`+`submit`、真实删除、settings 内存 echo（含 `apiKey`/`hasApiKey`） |

### 打包与凭据声明

- `debian/agenthub-feature-grants.json`：store operations 追加 `powers.custom.list.v1`、`powers.upload.v1`、`powers.delete.v1`（capability 不变，仍只有 `service:store`）。
- `debian/agenthub-provider.json`：新增 `credentialParameters: { "settings.update.v1": ["apiKey"] }`。**这是必需项**：宿主的参数策略把 `apiKey` 当凭据键，未声明时该 operation 会被宿主直接拒绝，Provider 收不到请求。
- 版本：`package.json` / `package-lock.json` / `bibit.feature.json` / `providerVersion` → `0.3.4`。

## 安全与边界

- **参数不含路径**：上传/删除只发 `(agent,type,name[,message])`，Provider 用 `ResolveCustomTarget` 解析回绝对路径并重新校验（规范名、该 Agent 支持的类型、类型目录必须是目录、结果必须是类型目录的直接子项），任一步不满足即 `incompatible`。
- **Key 不外泄**：结果只有 `hasApiKey`；上传失败原因先替换 Key 再清洗；Key 只经 `APC_API_KEY` 环境变量进入 apm 子进程；落盘 0600 且拒绝符号链接；`APC_BASE_URL` 只在显式配置 `--apc-root-url`（host-only）时注入，避免与 apm 自身的路径拼接叠加。
- **删除范围**：`os.RemoveAll` 只作用于已校验的直接子项；资源目录本身是符号链接时只删链接，不跟随删除内容；目标不存在返回错误而非静默成功。
- **旧 CLI 兼容**：扫描失败（含 Provider 不支持该 operation）只降级为一条 `custom-resources-unavailable` warning，installed 列表照常显示，不进入错误页。
- **显示门槛 ≠ 上传门槛**：显示只看主流最低格式，上传仍由 `apm validate` 按 v2 判定；`validate` 非零退出时不会执行 `submit`，失败原因原样（清洗后）回传当作文案。

## 本地验证

| 命令 | 结果 |
| --- | --- |
| `npm test`（Node 24.16） | 448/448（25 个文件；0.3.3 基线 378） |
| `npm test`（系统 Node 18.19） | 445/448：新增 `src/testSetup.ts` 后，此前因 jsdom 丢掉 `crypto.subtle` 而失败的 23 项已恢复；剩余 3 项（`dev/sources.test.ts` 的 `readMarket`）与 0.3.2 基线逐条一致，与本次改动无关 |
| `npm run typecheck` | 通过（`tsc --noEmit`，无输出） |
| `npm run build:dev` | 通过（`dist/assets/index-CKy80ZUw.css` 14.68 kB / `index-D5L1rjc2.js` 254.36 kB） |
| `npm run build:plugin` | 通过，产物 `artifacts/agent-hub-0.3.4.bibit-plugin.tgz`，sha256 `6230cc5588186c1263ca53fda361a512663a06d3f20b02bd1f367ce5adff95d3` |
| `make -C provider test vet build` | 通过（`internal/provider` 115 个用例、`cmd/provider-probe` 10 个，`go vet` 无输出；本机 amd64 产物 sha256 `3f242e9d75831230b882a3aa4ad4a87b9e92c79296af95fd4efc9a46f9f49cdb`） |
| `bibit-agenthub --self-test` | exit 0（6 项子检查） |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 改动文件无空白错误 |

### 反向验证（证明测试确实覆盖实现）

每一项都先改动实现、确认对应用例失败，再还原实现并确认全部通过：

| 反向改动 | 失败用例数 |
| --- | --- |
| Provider：skill 最低要求去掉 `description` | Provider 套件失败 |
| Provider：`settings.json` 权限改 0644 | Provider 套件失败 |
| Provider：`sanitizeReason` 不再替换 Key | `TestUploadCustomResourceRedactsKeyFromOutput` |
| Provider：失败原因只读 stdout（丢掉 stderr 提取） | 4 项（stderr 原因 / submit 失败 / stderr 清洗 / 大 stderr 不阻塞） |
| 前端：上传失败不再优先显示 apm 原因 | `reports the validate failure reason from a rejected upload` |
| dev：失败原因只读 stdout | `reads the failure reason from apm stderr and redacts the key` |
| 前端：合并结果里去掉 `source: 'custom'` | 10 项（apm / powerCatalogClient / 页面） |
| 前端：扫描失败不再降级为 warning | 17 项（含页面） |
| 前端：删除前不再二次确认 | 2 项（弹窗 + 页面） |
| 前端：设置保存总是发送 `apiKey` | `sends apiKey only after a user edit…` |
| 前端：卡片去掉 `Custom` 徽章 | 2 项（卡片 + 页面） |
| 前端：warning 不翻译 `values` | `renders the scan warnings as translated text` |
| 前端：`skipped` 不再转 warning | 2 项（客户端 + 页面） |
| 前端：契约去掉 custom 单版本规则 | `rejects a custom series that breaks…` |

测试覆盖重点：

- Provider：`custom_test.go`（3 种类型的最低格式接受/拒绝、四条跳过原因、符号链接跟随、非规范目录名、排序、上限常量）、`upload_test.go`（argv 顺序、`APC_API_KEY` 注入、缺 Key 时不启动 apm、`validate` 失败不提交、Key 清洗、message 校验、`sanitizeReason`）、`settings_test.go`（往返、0600、省略保留/空串清除、非法载荷、符号链接与损坏文件、`--data-dir` 与 env 回退、凭据声明存在）、`server_test.go`（5 个新 operation 的分发与 22 条非法输入、未声明 operation 拒绝）。
- 前端：`customResources.test.ts`（新增 16 项）、`contracts.test.ts`（custom 系列与 warning 闭集）、`apm.test.ts`（合并/去重/snapshot）、`powerCatalogClient.test.ts`（合并、降级、取消传播）、`PowerCard` / `PowerDetailsDialog`（徽章、静态版本、上传表单、删除确认、阶段文案）、`AgentHubPage`（徽章、warning 文案、无 inspect、上传/删除闭环、unauthorized 提示）、`AgentHubSettingsPage`（Key 状态、dirty 语义、不回显、防重复提交）、`agentHubLayout.test.ts`（settings 根可收缩、custom 卡片视觉区隔）、`dev/custom.test.ts`（dev 扫描与删除边界）。

## 未验证项 / 已知限制

- **板端未执行**：本次只在本机（amd64；Vitest 在 Node 24 与 Node 18.19 上各跑一遍）完成构建与测试；riscv64 交叉构建、两包上板、真实 GUI 中的自定义资源展示/上传/删除与语言切换未执行。
- **测试环境补充**：jsdom 会把 `globalThis.crypto` 替换成没有 `subtle` 的实现，导致 Node 18 下的 SHA-256 相关用例失败。新增 `src/testSetup.ts` 在 `crypto.subtle` 缺失时装回 Node 的 WebCrypto（Node 20+ 上是 no-op），`vitest.config.ts` 通过 `setupFiles` 引入；这恢复了 23 项既有失败，但不属于本次功能范围。
- **`dev/sources.test.ts` 的 3 项 `readMarket` 失败**：只在系统 Node 18.19 上出现（`The "listener" argument must be of type function. Received an instance of Object`），Node 24 上全绿；0.3.2 基线在 Node 18 上同样失败同样这 3 项，与本次改动无关，未一并处理。
- **`apm submit` 只跑到真实鉴权失败为止**：本机用 `apm` HEAD 构建的真实二进制驱动了本 Provider 的完整上传链路（见下一节），因此 argv、环境变量注入、两段式 `validate`→`submit`、失败原因提取都已在真实 apm 上验证；但用一个假 Key 时 APC 返回 HTTP 401，未用有效 Key 完成过真实提交。
- **`apm validate --json` 的 JSON 未被解析**：成功路径只用 `submit` 的 stdout（`submission_id` 一次正则提取）与退出码，失败路径只用 stderr 的 `error` 属性。apm 调整 `validate --json` 的字段不会破坏插件，代价是插件不展示 `validate` 的 warnings。
- **扫描性能**：上限固定为每类型 200 项 / 总 1000 项 / 单文件 64 KiB，未对超大目录做流式或异步扫描；超过上限的目录会被截断而不是报错。
- **`git diff --check` 的既有告警**：工作区里 `APC-API.md` 有 `new blank line at EOF`，该文件的重排（pandoc 风格）不是本次改动引入的，未一并处理。

## 真实 apm 端到端验证（本机，已执行）

用 `../apm` HEAD（`go build ./cmd/apm`，Go 1.26.5）作为本 Provider 的 `--apm-path`，在临时 home + 临时 data-dir 下驱动真实二进制：

| 场景 | 命令/输入 | 观察到的结果 |
| --- | --- | --- |
| 初始化 | `bibit.initialize` | `providerVersion 0.3.4`，9 个 operation |
| 扫描 codex skill | `~/.codex/skills/hand-made/SKILL.md`（v1 格式，带 `version: "1.4.2"`） | 列出，`version` 归一化为 `v1.4.2`，`description`/`name_zh` 保留 |
| 扫描 bibit plugin | `apc-plugin.json` + 只有 `skills/` 的容器目录 | 前者列出；后者进入 `skipped`，`reason: missing-authority-file` |
| settings 往返 | `settings.update.v1` 写入 `apiKey` 后 `settings.get.v1` | `hasApiKey` 由 `false` 变 `true`；`settings.json` 落盘权限 `-rw-------`，结果中不含 Key |
| 上传 v1 资源 | `powers.upload.v1`（真实 apm `validate`） | `{exitCode:1, stage:"validate", reason:"required file \"skill-card.md\" is missing: invalid submission content"}`，未执行 `submit` |
| 上传 v2 资源 | 同上，改用一个满足 v2 的 skill + skill-card | `validate` 通过后进入 `submit`，APC 返回 `{exitCode:1, stage:"submit", reason:"remote submission returned HTTP 401 code=INVALID_API_KEY: cloud authentication failure"}` |
| 删除 | `powers.delete.v1` 两次，以及给 codex 传 `type=plugin` | 第一次 `{status:"deleted"}`，目录消失；第二次与不支持的类型组合都返回 `incompatible`；越界名 `../evil` 在解码层就被拒（`-32602`） |

这一轮同时暴露并修正了一个真实缺陷：**apm 把成功结果写 stdout、失败原因写 stderr**，最初的实现只捕获 stdout，导致失败的 `validate` 会返回空 `reason`，前端只能显示「不满足上传格式」。现在 Provider 有界收集两条流、从 stderr 的 slog `error` 属性取原因（见 `failureReason` / `logfmtAttribute`），并有 3 个新 Provider 用例 + 1 个 dev 用例锁定该行为；前端也改为**优先显示 apm 的原因**，只有拿不到原因时才退回 stage 固定文案。

## 板端验收步骤（待执行）

1. `make -C provider build GOARCH=riscv64`，`dpkg-buildpackage -us -uc -b -a riscv64 -d` 产出两个 deb；
2. 安装后 `--self-test` exit 0，宿主日志显示 `agent-hub@0.3.4` 已激活、无 `request_unauthorized`；
3. 在板上手动放一个只含 `name`/`description` 的 `~/.codex/skills/<name>/SKILL.md`，确认「我的 Power」出现带 `Custom` 标记的卡片且无版本下拉；
4. 删掉 `description`，确认出现 warning（`SKILL.md 不满足最低格式）`），列表其余内容不受影响；
5. 设置页填入 APC Key，确认状态变为「已配置」且 Key 不再回显；对资源点「上传」、填写发布说明，确认成功提示与 `submission_id`（或在未满足 v2 时显示格式提示）；
6. 点「删除」并确认，核对目录被删除、列表刷新；再点一次确认不会静默成功。
