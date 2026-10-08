# 0.4.1 验证记录：资源类型 agent 更名为 expert（联动 apm 0.0.2）

- 变更版本：插件 **0.4.1**（记录含两部分：改名本体准备为 0.3.20、随版本号提升发为 0.4.0；类型调色板修复发为 0.4.1。上一版 0.3.19）；apm 0.0.2（上一版 0.0.1）
- 验证环境：**板端 `bianbu@10.0.91.51`（riscv64）**，Node **22.22.1** / npm **9.2.0** / zlib **1.3.1.zlib-ng**（`32ffb75` 起 `.nvmrc` 钉住的工具链，等同 CI）；Go **1.26.0**。此前 §4 在 amd64 + Node 24.16.0 下跑过，结论未变，但产物哈希随工具链变更作废，见 §4 注
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

### 3.2 插件（0.4.0 / 0.4.1）

- `POWER_TYPES` 改为含 `expert`；`supportsAgentType` → `supportsExpertType`；`parsePowerTarget` 与列表校验的类型判定同步。
- 删除 `resolvePowerTypeLabel` 及其 4 个调用点（类型改名后它是恒等映射），类型本身即显示词。
- Provider：`powerTypes` 与错误文案改为 `expert`；`typeName` 改 `expert` 而 `dirName: "agents"` 与 `agent.yaml` 不变；**`parseCustomAuthorityFile` 的分派分支必须同步**，否则手装 Expert 会被判成 `invalid-authority-file`。
- `dev/custom.ts` 的类型表同步。
- 兼容：`apm.ts` 的 `normalizePowerType` 把旧 apm 的 `type:"agent"` 归一成 `expert`；`apc.ts` 的 `agents: 'expert'` 读 APC 的分组。

## 4. 门禁结果

### 插件（板端，Node 22.22.1 / zlib 1.3.1.zlib-ng —— 与 CI 相同）

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 成功，无 EBADENGINE（`engines.node` = `22.22.1`） |
| `node scripts/check-node.mjs` | `Node 22.22.1 (zlib 1.3.1.zlib-ng) matches the pinned toolchain` |
| `npm test` | **569/569**，30 个文件，0 失败 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功 |
| `npm run build:plugin` | 成功；`artifacts/agent-hub-0.4.1.bibit-plugin.tgz`，sha256 `ec15c016d8c29a972d270ebedc63a371d457e5e4a23e6ec95bf3bd06e63da4f2`（101944 字节） |
| `make -C provider test vet build` | 通过（含 `TestProviderVersionMatchesPackageJSON`，`providerVersion` 已同步 `0.4.1`） |
| `--self-test` | exit 0 |
| `gofmt -l provider/` | 无输出 |
| `dpkg-buildpackage -us -uc -b -a riscv64 -d` | 成功；deb 内 bundle 与 `artifacts/` **逐字节相同**（均为 `ec15c016…`） |
| `git diff --check` | 无输出 |

**哈希变更说明**：本表此前记的是 `2284e1a4…`（101158 字节），那是 amd64 + Node **24.16.0** / upstream zlib 的产物。`32ffb75` 把 pin 降到 CI 实际使用的 **22.22.1 / zlib-ng** 后，同一份源码压出的字节不同（同一份 tar：upstream 101289 → zlib-ng 102084 字节），故旧哈希作废、以板端产出为准。这也是 `check-node` 现在连 zlib 串一起校验的原因。

### apm

| 检查 | 结果 |
| --- | --- |
| `go test ./...` | 22 个包全部 ok，0 失败 |
| `gofmt -l .` | 仅 `internal/cloud/remote/submission_test.go`，**改动前即未格式化**（已核对 `git show HEAD:` 的基线），本次未触碰该文件 |
| `go vet ./...` / `go build -o ./apm ./cmd/apm` | 无输出 |

## 5. 回归：Expert 类型调色板（0.4.1 修复）

改名后 Expert 的类型标签退化成「黑边框黑字」。原因不在逻辑里，而在 CSS 的键：

```css
[data-power-type='agent'] { --type: ...; --type-soft: ...; --type-line: ... }   /* 改名前的键 */
```

`data-power-type` 的值来自 `series.type`，改名后是 `expert`，于是这条规则**匹配不到任何元素**。它不会报错：元素继承不到 `--type`/`--type-soft`/`--type-line`，`color` 与 `border-color` 各自回退，渲染成默认的黑边黑字。四类里只有 Expert 受影响，其余三个键本来就是类型名、没动过。

修复只改键名（颜色值原样保留——蓝 `#356dbd`/`#89b9ff` 本来就是该类型的设计色），并补上缺失的契约测试：

- `src/agentHubLayout.test.ts` 新增 `gives every Power type its own palette rule`：以 `POWER_TYPES` 为源，断言**每个类型恰好有一条** `[data-power-type='<type>']` 规则、三条 token 都在、且都是 `light-dark()` 成对；再收集源码里所有 `[data-power-type='…']` 键，断言集合与 `POWER_TYPES` **完全相等**。后半条专门抓「改名后留下的孤儿键」——那种键在运行时不匹配任何东西，只有源码级检查才看得见。

反向验证：把 CSS 的键改回 `agent` → 该用例失败（`no palette rule for type expert`）。

漏掉的原因值得记下来：`--type*` 的取值本身有测试（色相距离、`light-dark()` 成对、禁止琥珀字面量），但**「每个类型都有一条规则」这层从来没有断言过**，所以键名漂移是静默的。

## 6. 新增测试与反向验证（变异测试）

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

## 7. 兼容矩阵与发布顺序

| apm | 插件 | 结果 |
| --- | --- | --- |
| 旧 | 旧 | 正常 |
| 新 | 旧 | 旧插件解析不了 `type:"expert"` |
| 新 | 新 | 正常 |
| 旧 | 新 | 旧 apm 不认识 `--type=expert` |

**混合状态两个方向都会坏**，因此两个包必须同批升级。插件的 deb 精确依赖 `bibit-agenthub-cli`（同包内自洽），但 `agent-power-manager` 未锁版本，所以这是真实风险，已写入两侧 changelog 与 `README.md`。回滚需两侧一起回滚。

## 8. 未改的部分（外部契约，勿动）

| 保留项 | 理由 |
| --- | --- |
| APC 的 wire 取值 `agent`、目录分组 `agents`、`APC-API.md` 的契约内容 | APC 已实现且不再维护；客户端只在边界翻译 |
| `agents/<name>`、`cache/agents/...`、`staging/agents/...` | Bibit Runtime 按 `agent.id` 定位已安装子代理 |
| `agent.yaml` 及其 `agent:` 块 | 作者可见、已发布内容携带；`AGENT_TYPES`/权威文件表因此不变 |
| 清单文件的 `agents` 键 | 既有本地文件格式 |
| `--agent`、`AgentID`、`AgentAdapter`、`agentProfile` | 目标 Agent，正是要保留的那个含义 |

## 9. 已知限制

- 插件对 `type:"agent"` 的容忍与 apm 对 `--type=agent` 的别名都是**过渡期**的；等板上 apm 全部升到 0.0.2 后，`normalizePowerType` 的 `agent` 分支应与 apm 的别名一起删除，并在 apm ADR-044 标记 Superseded。
- 插件发的 `--type=expert` 与 apm 0.0.2 绑定，**板端实机未验收**；本仓库只覆盖单元/集成测试与本地构建。
- apm 的 deb 版本从 0.0.1 升到 0.0.2 仅用于本次发布标识，不涉及 apm 的版本号策略。
- 未做 CLI 版本探测：插件不会主动判断板上 apm 的版本，只能靠「`--type=expert` 被拒」时的错误文案。

## 10. 提交状态

两个仓库分别提交在各自 `bianbu-26.04` 分支：apm `0b31f96`（发布标签 `bianbu/0.3.0`）；插件 `4115a70`（0.4.0，含缺陷）+ 本记录所在提交（0.4.1，类型调色板修复与测试）。两者都尚未 push。
