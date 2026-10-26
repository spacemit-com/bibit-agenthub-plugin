# 0.3.8 验证记录：块标量 frontmatter + APM 已管理资源不再报跳过

- 变更版本：0.3.8（上一版 0.3.7）
- 验证环境：amd64 开发机（Node 18.19.1 / npm 9.2.0 / Go 1.26.5）；板端 riscv64（Bianbu 4.0.6，board-host）
- 相关提交：见文末「提交状态」

## 1. 用户问题

> 板上的bibit agent root的skill k3-media-pipeline vpu-benchmark为什么不符合hub的skill最低格式要求

## 2. 定位证据（修复前）

| 证据 | 内容 |
| --- | --- |
| 板上扫描 | `powers.custom.list.v1`（`--user-home /home/bianbu`）→ `items` 9 条，`skipped` 恰为 `k3-media-pipeline` / `vpu-benchmark`，`reason: invalid-authority-file` |
| 权威文件 | 两者 `SKILL.md` 的 `name`/`version` 齐全、UTF-8 合法、为常规文件；唯一特殊处是 `description: >-` 折叠块标量 |
| 真实 YAML | `python3 yaml.safe_load` 读出完整 `description`，键为 `['description','metadata','name','version']` |
| APM 事实 | `apm list --installed --agent=bibit --json` 与 `~/.apm/manifests/bibit.json` 均有完整记录（含 `tags: ["official"]`），`powers.list.v1 installed` 也带完整 description —— **卡片本就正常显示**，警告是误报 |
| 受控复现 | 5 个 fixture：`plain` / `"quoted"` / `inline # comment` 被列出，`>-` 与 `|` 被跳过 |
| 解析器代码 | 旧 `parseYAMLSubset` 遇块标量头只记 `blockScalarIndent` 后 `continue`，键从未写入 `fields`；`custom.go` 的 skill 门槛因此判定 `description == ""` |

## 3. 实现要点

| 层 | 改动 |
| --- | --- |
| `provider/internal/provider/custom.go` | `parseYAMLSubset` 改为按索引推进；块标量头（`|`/`>` 及 `+`/`-`/数字修饰符）触发 `readBlockScalar` 消费缩进块，`blockScalarValue` 按 `>` 折叠（空格连接、空行分段）或 `|` 保留换行；块后同级键不受影响，空块不投影。新增 `countLeadingSpaces` / `blockScalarIndicator` / `readBlockScalar` / `blockScalarValue` |
| `dev/custom.ts` | 同一算法的 TS 镜像（`readBlockScalar` / `renderBlockScalar` / `blockScalarIndicator` / `countLeadingSpaces`），Dev Host 与真实 CLI 判断一致 |
| `src/api/apm.ts` | 导出 `powerSeriesKey(type,name)`，系列身份的唯一构造点（合并与过滤共用） |
| `src/api/powerCatalogClient.ts` | installed 分支用 `refreshAgent` 的记录构造 managed 集合，`customSkippedWarnings` 过滤已被 APM 清单管理的 `(type,name)` |

语义：

- 被列入 `skipped` 仍以「能否解析出最低要求」为准；块标量只要解析出非空值即满足门槛，否则照旧拒绝（空块有专门用例）。
- 过滤只影响**警告**，不影响 `items` 合并（合并原本就以清单为准），也不影响 Provider 输出（Provider 仍如实报告 `skipped`，消费者是前端）。

## 4. 门禁结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 474/477（25 个文件）。3 项失败全部在 `dev/sources.test.ts` 的 `readMarket`（本机 Node 18.19 下 `The "listener" argument must be of type function`），`git stash` 后在基线上同样失败同样 3 项，与本次改动无关 |
| `npm run typecheck` | 无输出 |
| `npm run build:dev` | 成功（`dist/assets/index-C-LJdb7q.js`，255.44 kB / gzip 80.24 kB） |
| `npm run build:plugin` | 成功，`artifacts/agent-hub-0.3.8.bibit-plugin.tgz`，sha256 `de8ff9d7ea16a88086af7b6189c7f5c7ad3b3040142b17614336e5d7ff88c2a0` |
| `make -C provider test vet build` | 通过（Provider 129 个用例；`go vet` 无输出；amd64 产物 sha256 `060a679c9bf90e6b3037662889543bbacf45cececcb041c58ed61d0cce12d995`） |
| `--self-test` | exit 0 |
| `gofmt -l provider/` | 无输出 |

## 5. 测试覆盖（新增 4 例）

| 用例 | 断言 |
| --- | --- |
| `TestParseYAMLSubsetReadsBlockScalars` | `>-` 折叠为空格连接的长串；`|` 保留换行；空行分段落得到 `one two\nthree`；`metadata.target` 等块后键仍在；空块不投影且 `other` 仍可读 |
| `TestScanCustomSkillAcceptsBlockScalarDescription` | 板端形态的两个 Skill 目录不再进 `skipped`，`version` 归一化正确，两种块标量的 `description` 逐字匹配 |
| `dev/custom.test.ts` `reads a folded or literal block scalar description` | Dev 扫描器与 Provider 同结果（`skipped` 为空、两个名称有序、描述逐字） |
| `powerCatalogClient.test.ts` `drops skip warnings for a directory the APM manifest already manages` | 同名 `hub-skill` 的 skip 不产生警告，未管理的 `partial` 仍产生 1 条 |

## 6. 反向验证

每一项单独还原实现后，对应用例必须失败；随后恢复并重跑确认通过。

| # | 变异 | 期望失败 | 实测 |
| --- | --- | --- | --- |
| 1 | `custom.go` 还原为旧解析器 | 两个新 Go 用例 | 2 failed ✓（`folded description = ""`；两条仍 `invalid-authority-file`） |
| 2 | `dev/custom.ts` 还原为旧解析器 | dev 块标量用例 | 1 failed ✓ |
| 3 | `powerCatalogClient.ts` + `apm.ts` 还原（警告不过滤 managed） | managed 过滤用例 | 1 failed ✓ |

## 7. 板端验证（已执行）

把 amd64 上交叉构建的 riscv64 Provider 拷到板上，用**真实 home** 驱动：

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=riscv64 go build -trimpath -ldflags="-s -w" -o bibit-agenthub ./cmd/bibit-agenthub
# 板上：
# bibit.initialize + powers.custom.list.v1 {agent:bibit}  → --user-home /home/bianbu
# bibit.initialize + powers.list.v1 {scope:installed,agent:bibit}
```

| 观察项 | 结果 |
| --- | --- |
| `skipped` | `[]`（修复前为 2 条 `invalid-authority-file`） |
| `k3-media-pipeline` | `v1.0.0`，description 完整（`在 K3 板卡上使用 GStreamer 或 FFmpeg …`） |
| `vpu-benchmark` | `v0.13.12`，description 完整（`测试 SpacemiT K3 VPU 硬件视频编解码器的基准性能、FPS、吞吐和 MVX 带宽，…`） |
| 扫描器与 APM 清单逐字一致 | 两条均为 `True`（`powers.custom.list.v1` 的 description == `powers.list.v1 installed` 的同名记录），说明折叠规则与 APC/apm 写入清单时的规则一致 |

交叉构建产物：`artifacts/provider/riscv64/bibit-agenthub`，sha256 `710515dd7dd8ab71d4d98da9b52bee815659057ff66cb941796eaf98712581fd`（`ELF 64-bit LSB executable, UCB RISC-V, statically linked`）。

## 8. 未执行 / 未验证

- **未在板上安装新 deb**：只跑了新 Provider 二进制 + 真实 home；deb 打包、插件 bundle 上板、真实 GUI 中不再出现该警告均未执行。
- **未覆盖 `+`/数字缩进指示符与显式缩进块**：解析器接受这些写法，但没有独立用例（真实数据只出现 `>-` 与 `|`）。
- **`|` 的尾随空行（`|+` 保留模式）**：实现统一裁掉块尾空行，未区分 keep/strip；资源 frontmatter 的 description 不受影响。
- 前端 `npm test` 的 3 项 `dev/sources.test.ts` 既有失败（Node 18.19 专属）未一并处理。

## 9. 提交状态

待提交。`APC-API.md` 的工作区改动与本功能无关，不纳入本次提交。
