# 自定义（手动安装）资源：展示、上传与删除设计

日期：2026-09-28

状态：对话设计已逐条确认，本文与实现同步提交。

## 1. 交付目标与边界

在已实现的列表、缓存、Go Provider、详情与安装/卸载之上，让「我的 Power」同时显示用户**手动安装**到各 Agent 目录下的资源，并在卡片弹窗内提供 APC 上传与本地删除；上传所需的 Key 由插件设置页维护。

Provider Protocol 保持 v1，Registry 保持 version 2 / managed / protocolVersions [1]。不开发 v2、Job、下载或文件传输，不修改相邻仓库，不新增 capability（仍只有 `service:store`），沿用当前依赖矩阵（vendor 0.3.0）。

用户确认的产品规则：

| 议题 | 结论 |
| --- | --- |
| `layout` | 「自定义资源」不是名为 `custom` 的目录，而是**手动安装、且 `(type,name)` 不在 apm installed 清单里**的资源 |
| `mcp` | 本期跳过。apm 不为 MCP 维护目录，无法扫描 |
| `scope` | 不新增 scope，合并进「我的 Power」，卡片打 `Custom` 标记 |
| `validation` | 显示取「Provider 轻量解析（v1/v2 都接受）+ 主流最低格式」；不满足最低要求时给出 warning，而不是静默丢弃 |
| `title` | 卡片标题取展示名（`name_zh` → `name_en` → 资源声明的 `name`），目录名只作身份；扫描器在资源未声明 `name_en` 时把权威文件的 `name` 投影到 `name_en` |
| `upload` | 上传仍走 apm：`apm validate` → `apm submit`，Key 经环境变量注入；因此上传要求资源满足 Power 格式 v2 |
| `settings` | Provider 自己实现 `settings.get.v1` / `settings.update.v1` 持久化，新增 `apiKey`，结果只回传 `hasApiKey` |
| 交互 | 上传/删除按钮与「安装」一致放进卡片弹窗；卡片上只做来源区分，不放写按钮 |

## 2. 扫描范围与识别规则

| Agent | 根目录（用户 home 下） | 类型 |
| --- | --- | --- |
| `bibit` | `.bianbu-agent` | skill `skills/`、plugin `plugins/`、agent `agents/` |
| `codex` | `.codex` | skill `skills/` |
| `claude-code` | `.claude` | skill `skills/` |
| `hermes-agent` | `.hermes` | skill `skills/`、plugin `plugins/` |

| 类型 | 权威文件（优先级） | 显示最低要求 |
| --- | --- | --- |
| skill | `SKILL.md` | frontmatter 是 YAML 映射，且 `name`、`description` 非空 |
| plugin | `apc-plugin.json`、`plugin.yaml`、`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json` | 清单至少有非空 `name` |
| agent | `agent.yaml` | 至少有非空 `agent.name` |

- **身份取目录名**，必须满足 APM 规范命名（1–64 字节小写 kebab，不以 `-` 开头/结尾，不含 `--`）；以 `.` 开头的目录、非目录（含指向目录的符号链接以外的项）直接忽略，**不产生 warning**（它们是布局噪声，不是「用户以为能用的资源」）。
- 看起来是候选但缺权威文件（例如 plugin 目录只有 `skills/`）→ `skipped`，`reason: "missing-authority-file"`，`expected` 为该类型主权威文件名。
- 权威文件存在但低于门槛、前半段不是 YAML 映射、非法 UTF-8 或超过 64 KiB → `skipped`，`reason: "invalid-authority-file"`。
- **不检查** `schema_version`、展示字段长度、`tags` 等 schema 要求：显示门槛必须低于上传门槛，否则用户放进去的 v1 资源会「看得见却用不了」。
- `version` 只接受规范 `v<x>.<y>.<z>`（缺 `v` 前缀时补齐），其它写法或缺失一律置 `""`，卡片显示占位符；绝不猜测版本。
- 约束上限：每类型目录 200 项、总条目 1000、单文件 64 KiB、`skipped` 最多 20 条，超出即截断而不是失败。
- 类型目录与资源目录都允许符号链接并跟随读取（开发时把 skill 目录软链进 Agent 目录是常见做法）。

## 3. 合并规则

`powers.list.v1` 的 installed 分支并行取两份数据：APM 清单（既有 `refreshAgent`）与自定义扫描（`powers.custom.list.v1`）。合并发生在前端数据层：

- 同 `(type,name)` 已存在于 APM 清单 → 丢弃自定义项，以 APM 清单为准。清单是 Hub 管理的权威，两个同键系列会同时打满页面并让版本聚合失去意义。
- 自定义资源是单个目录，因此它的系列**恰好一个版本**；契约层强制执行（`source: 'custom'` 时要求 `versions.length === 1`、版本可为空串、`tags` 必须为空）。
- `source` 进入 snapshot 哈希：安装/卸载导致来源变化时，第 2 页得到 `reset_required`，不会显示过期内容。
- 扫描失败（Provider 报错，含旧版 CLI 不认识该 operation 时的 `incompatible`）→ 降级为一条 `custom-resources-unavailable` warning，installed 列表照常显示，**不进入错误页**。
- `skipped` 逐条转为 `custom-resource-skipped` warning，message 是带占位符的英文模板，`values` 携带 `type`/`name`/`expected`，在渲染边界翻译。

## 4. 显示契约

```ts
type PowerSource = 'custom'

interface PowerVersion { version: string; description: string; tags: string[]; description_zh?: string }
interface PowerSeries {
  type: PowerType
  name: string
  versions: PowerVersion[]
  name_zh?: string
  name_en?: string
  source?: PowerSource
}

interface PowerWarning {
  code: 'installed-agent-unavailable' | 'custom-resources-unavailable' | 'custom-resource-skipped'
  agent: string
  message: string
  values?: Record<string, string>
}
```

- 卡片：`data-source="custom"`（虚线 + 琥珀配色）、`Custom` 徽章；版本槽从 `<select>` 换成静态标签，无版本时显示占位符文案——只有一个版本时给下拉框是虚假的选择。
- 弹窗：自定义资源不显示 APM 安装状态、不显示安装/卸载，改为显示「在 Agent Hub 之外手动安装，不受 APM 管理」、静态 Agent/版本，以及 `Upload` / `Delete` 两个入口。
- 打开自定义资源的弹窗**不调用 `powers.inspect.v1`**：apm 不管理这个资源，查询只会得到误导性的「未安装」。

## 5. 写入契约

```text
powers.custom.list.v1  {agent}                  -> {scope:"custom", status:"data", itemsJson}
powers.upload.v1       {agent,type,name,message} -> {status:"exited", exitCode, stage, reason?, stdout?}
powers.delete.v1       {agent,type,name}         -> {status:"deleted"}
settings.get.v1        {}                        -> {showExperimental, refreshMinutes, hasApiKey}
settings.update.v1     {showExperimental, refreshMinutes, apiKey?} -> 同上
```

- **参数不含路径**：Provider 用 `(agent,type,name)` 解析回绝对路径并重新校验（规范名、该 Agent 支持的类型、类型目录必须是目录、结果必须是类型目录的直接子项），任一步不满足即 `incompatible`。前端发送前用同一套规则校验一次。
- 上传固定 argv（无 shell，先校验后提交）：`apm validate <path> --type=<t> --json` → `apm submit <path> --type=<t> --message=<m>`。`message` 必填（apm 要求）、单行、≤200 字符。
- 非零退出是**正常结果**而不是 RPC 错误：`stage` 说明是 `validate` 还是 `submit` 失败，`reason` 是清洗后的 apm 文本。`validate` 失败时不会执行 `submit`。
- `reason` 的来源由 apm 自己的约定决定（**成功写 stdout、失败只写 stderr**）：Provider 有界收集两条流，失败时取 stderr 那行 slog logfmt 的 `error` 属性值，usage 块与日志前缀不进结果；前端优先显示它，拿不到时才按 `stage` 退回固定文案。
- 删除执行系统删除语义（`os.RemoveAll`），只作用于已校验的直接子项；资源目录本身是符号链接时只删链接、不跟随；目标不存在返回错误而非静默成功。
- 弹窗内删除必须先确认，确认文案明确写出 `agent`/`type`/`name`，让用户看清删的是哪一个目录。

## 6. 凭据处理

- Key 存在 Provider 数据目录的 `settings.json`：目录 0700、文件 0600、临时文件 + fsync + rename、拒绝对符号链接写入、损坏 JSON 报错而不覆盖。
- 数据目录优先级：`--data-dir` → `BIBIT_PROVIDER_DATA_DIR`（宿主注入）→ `$HOME/.local/state/bibit-agenthub`。
- `settings.get.v1` 只返回 `hasApiKey`；Key 本身永不出现在任何结果里。
- 更新语义：省略 `apiKey` 保留、空串清除。设置页用 `apiKeyDirty` 区分两者，未编辑过的输入框不发送该字段。
- Key 只经环境变量 `APC_API_KEY` 进入 apm 子进程；`APC_BASE_URL` 仅在显式配置 `--apc-root-url`（host-only URL）时注入，避免与 apm 自身的 `/api-server/apc/api/v1` 拼接叠加。
- 未配置 Key 时上传直接返回 `unauthorized` 且**不启动 apm**；失败原因先替换 Key 为 `***`，再去除 ANSI 与控制字符、压成单行、截断 300 字节。
- 宿主参数策略把 `apiKey` 当凭据键，因此 Registry drop-in 必须声明 `credentialParameters: { "settings.update.v1": ["apiKey"] }`，否则宿主会直接拒绝该请求。

## 7. 交付物与门禁

- Provider：`custom.go` / `upload.go` / `settings.go`（新）+ `config.go` / `contracts.go` / `operations.go` / `server.go` / `selftest.go` / `apm.go` 扩展，`providerVersion` → `0.3.4`，operation 声明扩到 9 项。
- 前端：`api/customResources.ts`（新）+ `api/contracts.ts` / `api/apm.ts` / `api/powerCatalogClient.ts` / `PowerCard` / `PowerDetailsDialog` / `AgentHubPage` / `AgentHubSettingsPage` / `agentHub.css` / `agentHubI18n.tsx`。
- dev Mock：`dev/custom.ts`（新，扫本机真实 home）、`dev/store.ts`、`vite.config.ts`、`dev/main.tsx`。
- 打包：`debian/agenthub-feature-grants.json`（+3 operation）、`debian/agenthub-provider.json`（+`credentialParameters`）、版本 0.3.4。
- 门禁：`npm test`、`npm run typecheck`、`npm run build:dev`、`npm run build:plugin`、`make -C provider test vet build`、`bibit-agenthub --self-test`。

设计与验收证据见 `docs/verification/2026-09-28-custom-resources.md`。
