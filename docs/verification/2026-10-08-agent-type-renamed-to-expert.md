# 0.3.20 验证记录：资源类型 agent 更名为 expert（联动 apm 0.0.2）

- 变更版本：插件 0.3.20（上一版 0.3.19）；apm 0.0.2（上一版 0.0.1）
- 验证环境：amd64 开发机；**Node 24.16.0**（`.nvmrc` 钉住的版本，`npm run build:plugin` 会先跑 `scripts/check-node.mjs`）；**Go 1.26.5**
- 相关设计：apm `ivory-tower/adr/ADR-044-rename-agent-power-type-to-expert.md`

## 1. 用户需求

> 这是一个联动仓库任务，包括 bibit-agenthub-plugin 和 ../apm：
> 在设计中 agent 有歧义，一是指软件的目标智能体如 bibit、codex 等，二是指 bibit 中的特殊资源。
> 在最近的一次提交中将 agent hub 插件的类型标签更名成了 expert，从此消除歧义。
> 但需要同步两个仓库中的剩余的定义。包括但不限于：代码、文档、CLI 参数名（使两侧接口调整同步，不至于无法使用出错）

两个已确认的范围决定：

| 问题 | 选择 |
| --- | --- |
| 两侧类型 token 是否真的改成 `expert` | **改**，且 apm 同时接受旧值 `agent` 兼容 |
| APC 的 API 与仓库 | **不再维护 apc 仓库**，一切以 `APC-API.md` 为准，并清理指向该仓库的关联 |

## 2. 现状（改名前）

| 事实 | 位置 |
| --- | --- |
| 界面把该类别显示为 `Expert`，但类型取值仍是 `agent` | `src/displayFields.ts` 的 `resolvePowerTypeLabel` |
| 前端类型集合 `['skill','plugin','mcp','agent']` | `src/api/contracts.ts` |
| 插件把类型原样透传给 `apm --type=` | `provider/internal/provider/operations.go` |
| apm 域常量 `PowerTypeAgent = "agent"`（212 处引用、31 个 `*agent*.go`） | `apm/internal/domain/power.go` |
| APC 的 wire 取值与目录分组都是 `agent` / `agents` | `APC-API.md` |
| 磁盘 `agents/<name>` 由 Bibit Runtime 按 `agent.id` 定位；`agent.yaml` 是作者面文件 | `apm/ivory-tower/adr/ADR-033`、ADR-023 |
| 插件 deb 精确锁自己的 CLI，`agent-power-manager`（apm）**不锁版本** | `debian/control` |

## 3. 实现

### 3.1 apm（0.0.2）

- `domain.PowerTypeExpert = "expert"`；31 个 `*agent*.go` 按「这个名字指 Power 类别，还是目标 Agent」逐个甄别，不整体改名。改的是 `cache.PrepareExpert`、`lifecycle.installExpertPower`/`uninstallExpertPower`（文件同名）、`submission.expertSourceLoader`（`agent.go` → `expert.go`）、`cli.validateExpertTypeFlags`、`cli.resolvePowerType`；保留的是 `--agent`、`AgentID`、`AgentAdapter`、`transaction.InstallAgent`/`AgentInstallRequest`（其 `Agent` 是目标 Agent）、`agents/` 路径、`agent.yaml`、`AgentConfig`/`internal/agentartifact`、清单 `agents` 键。
- CLI：`--type=expert` 规范；`--type=agent` 在解析处就地改写成 `expert` 并在非 `--json` 时提示弃用。**规范化必须发生在命令读取 `flags.Type` 之前**，因为原始字符串会流进 `internal/lifecycle` 参与类型比较与过滤。
- APC 边界：唯一翻译层 `internal/cloud/remote/type_vocabulary.go`。出站翻译提交 metadata 的 `type`、系列查询的 `type`、内容路径 `resources/<type>/...`；入站把响应里的 `agent` 翻回 `expert`（`nil` 原样透传）。目录分组仍叫 `agents`。

### 3.2 插件（0.3.20）

- `POWER_TYPES` 改为含 `expert`；`supportsAgentType` → `supportsExpertType`；`parsePowerTarget` 与列表校验的类型判定同步。
- 删除 `resolvePowerTypeLabel` 及其 4 个调用点（类型改名后它是恒等映射），类型本身即显示词。
- Provider：`powerTypes` 与错误文案改为 `expert`；`typeName` 改 `expert` 而 `dirName: "agents"` 与 `agent.yaml` 不变；**`parseCustomAuthorityFile` 的分派分支必须同步**，否则手装 Expert 会被判成 `invalid-authority-file`。
- `dev/custom.ts` 的类型表同步。
- 兼容：`apm.ts` 的 `normalizePowerType` 把旧 apm 的 `type:"agent"` 归一成 `expert`；`apc.ts` 的 `agents: 'expert'` 读 APC 的分组。

## 4. 门禁结果

### 插件（Node 24.16.0）

| 检查 | 结果 |
| --- | --- |
| `npm test` | **568/568**，30 个文件，0 失败 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功 |
| `npm run build:plugin` | 成功，`check-node` 通过；`artifacts/agent-hub-0.3.20.bibit-plugin.tgz`，sha256 `b54a506d2a6e6430f3a87cd88296b14877eee5e1881bfc1dbcaddf2a005e7e81`（101158 字节） |
| `make -C provider test vet build` | 通过（含 `TestProviderVersionMatchesPackageJSON`，`providerVersion` 已同步 0.3.20） |
| `gofmt -l provider/` | 无输出 |
| `git diff --check` | 无输出 |

### apm

| 检查 | 结果 |
| --- | --- |
| `go test ./...` | 22 个包全部 ok，0 失败 |
| `gofmt -l .` | 仅 `internal/cloud/remote/submission_test.go`，**改动前即未格式化**（已核对 `git show HEAD:` 的基线），本次未触碰该文件 |
| `go vet ./...` / `go build -o ./apm ./cmd/apm` | 无输出 |

## 5. 新增测试与反向验证（变异测试）

新增：

- apm `TestAPCWireTypeVocabulary`：两个翻译方向 + `nil` 透传。
- apm `TestExpertCatalogGroupKeepsAPCName`：编码出 `agents` 组、不出现 `experts` 组，且能解回 Expert 条目。
- apm `TestResolvePowerTypeNormalizesLegacyAgentSpelling` / `TestResolvePowerTypeWarnsOnlyOutsideJSON`：别名改写与提示时机（`--json` 静默）。
- apm `TestValidateNormalizesLegacyAgentTypeSpelling`：旧拼写端到端跑通且进 lifecycle 前已规范化。
- 插件 `apm list --json contract > maps the pre-rename agent type onto expert`：旧拼写归一、未知类型仍被拒。
- 插件 `parseApcCatalog > reads the APC agents group as the expert type`。

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| A | apm：提交 metadata 不做翻译（写本地 `expert`） | `TestRemoteSubmissionAndMCPContract/submit_expert` | 1 failed ✓ |
| B | apm：目录 wire 键改成 `experts` | 目录 codec 大量用例 | 大量 failed ✓ |
| C | 插件：去掉旧拼写容忍 | `maps the pre-rename agent type onto expert` | 1 failed ✓ |
| D | 插件：APC 分组键改成 `experts` | 2 个 apc 用例 | 2 failed ✓ |
| E | 插件：Provider 分派分支回退到 `agent` | `TestScanCustomPluginAndAgent*` | 2 failed ✓ |

E 是这次真正抓到的一个 bug：只改 `typeName` 而漏掉 `parseCustomAuthorityFile` 的分派分支时，扫描结果里 Expert 全部变成 `Skipped: invalid-authority-file`（该组合在实现过程中确实出现过，由本地测试当场暴露）。

## 6. 兼容矩阵与发布顺序

| apm | 插件 | 结果 |
| --- | --- | --- |
| 旧 | 旧 | 正常 |
| 新 | 旧 | 旧插件解析不了 `type:"expert"` |
| 新 | 新 | 正常 |
| 旧 | 新 | 旧 apm 不认识 `--type=expert` |

**混合状态两个方向都会坏**，因此两个包必须同批升级。插件的 deb 精确依赖 `bibit-agenthub-cli`（同包内自洽），但 `agent-power-manager` 未锁版本，所以这是真实风险，已写入两侧 changelog 与 `README.md`。回滚需两侧一起回滚。

## 7. 未改的部分（外部契约，勿动）

| 保留项 | 理由 |
| --- | --- |
| APC 的 wire 取值 `agent`、目录分组 `agents`、`APC-API.md` 的契约内容 | APC 已实现且不再维护；客户端只在边界翻译 |
| `agents/<name>`、`cache/agents/...`、`staging/agents/...` | Bibit Runtime 按 `agent.id` 定位已安装子代理 |
| `agent.yaml` 及其 `agent:` 块 | 作者可见、已发布内容携带；`AGENT_TYPES`/权威文件表因此不变 |
| 清单文件的 `agents` 键 | 既有本地文件格式 |
| `--agent`、`AgentID`、`AgentAdapter`、`agentProfile` | 目标 Agent，正是要保留的那个含义 |

## 8. 已知限制

- 插件对 `type:"agent"` 的容忍与 apm 对 `--type=agent` 的别名都是**过渡期**的；等板上 apm 全部升到 0.0.2 后，`normalizePowerType` 的 `agent` 分支应与 apm 的别名一起删除，并在 apm ADR-044 标记 Superseded。
- 插件发的 `--type=expert` 与 apm 0.0.2 绑定，**板端实机未验收**；本仓库只覆盖单元/集成测试与本地构建。
- apm 的 deb 版本从 0.0.1 升到 0.0.2 仅用于本次发布标识，不涉及 apm 的版本号策略。
- 未做 CLI 版本探测：插件不会主动判断板上 apm 的版本，只能靠「`--type=expert` 被拒」时的错误文案。

## 9. 提交状态

两个仓库分别提交在各自 `bianbu-26.04` 分支：apm `0b31f96`（0.0.2）、插件 0.3.20（本记录所在提交）。两者都尚未 push。
