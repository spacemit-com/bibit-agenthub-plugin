# Power 展示字段（name_zh / name_en / description_zh）前端适配

> APC 仓库说明（2026-10-08）：相邻的 APC 仓库已停止维护，本文中的 `../apc` 路径与命令只是当时的记录，
> 不再可用；APC 的服务端契约以 APC 仓库根目录的 `APC-API.md` 为准。

日期：2026-09-28
范围：`bibit-agenthub-plugin` 0.3.3（`src/api` DTO 与解析、语言 context、两个展示组件、文档与测试）
上游依据：APM Power 资源格式 V2（`../apm/ivory-tower/adr/ADR-038-power-format-v2-localized-display-fields.md`、`ADR-039-add-name-en-and-display-name-length-limits.md`）与 **APM 目录/CLI JSON 通道（`../apm/ivory-tower/adr/ADR-040-catalog-and-cli-json-carry-display-fields.md`，apm 0.1.6）**

## 结论

前端已按 V2 契约接收并渲染 `name_zh`、`name_en`、`description_zh`：中文宿主显示 `name_zh`/`description_zh`，英文宿主显示 `name_en`/`description`，canonical `name` 只作为回退，不再直接作为标题。V1 资源（三个字段全缺）渲染结果与升级前一致。`name` 仍然是请求参数、安装状态比对键、缓存键与 React key，展示名不参与任何身份判断。

**数据通道已就绪（apm 0.1.6）**：`list --json`（`--all`、`--installed`、`--agent=all` 分组模式）与
`show --json` 的每条记录恒带三字段（空为 `""`），安装时捕获的三字段持久化到本地 manifest 与 journal。
本仓库无需任何功能改动即可生效，只更新了两处过期注释并新增一个跨仓库契约锚点测试。APC 公共目录
item 尚未发布三字段，因此 market 范围在字段发布前仍走回退（命令正常，字段为空串）。

> 本文件 §「上游字段缺口证据」记录的是改动前（apm ≤ 0.1.5）的取证，保留作为**为什么需要 ADR-040** 的历史依据；
> 当前状态以本节与文末「未验证项」为准。

## 上游字段缺口证据

| 证据 | 来源 | 结论 |
| --- | --- | --- |
| `list --json` 输出不变是明确决策 | `../apm/ivory-tower/adr/ADR-038-...md` 第 7 条、`../apm/docs/Changelog.md` 2026-09-28 条目 | 展示字段只存在于资源文件内容，APM 不把它们加进 `list`/`show` 输出 |
| CLI 记录结构未含展示字段 | `../apm/internal/cli/list_render.go` 的 `listPowerJSON`（`agent/type/name/version/description/tags`） | 本机 HEAD `210f50a` 上 `list --installed --agent=bibit --json` 实测输出同样只有这 6 个键 |
| 目录契约不改 | `../apm/ivory-tower/features/031-power-format-v2/spec.md` §2.2「不修改 APC 目录契约」 | APC item 不会有展示字段契约 |
| 两套环境实测 | `GET https://developer.bianbu.xyz/api-server/apc/api/v1/resources`、`GET https://www.spacemit.com/api-server/apc/api/v1/resources` | 两类环境全部 item 均为 `schema_version: 1`，键集合为 `content_md5/content_size/content_type/description/download_url/message/name/published_at/schema_version/tags/version`，无 `name_*`/`description_*` |
| `../apc` 仓库未定义展示字段 | `cd ../apc && git grep -l name_zh $(git branch -a)` 为空 | 目录与提交接口文档都没有这三个字段 |

## 回退规则

| 语言 | 标题 | 描述 |
| --- | --- | --- |
| `zh` / `zh-CN` | `name_zh` → `name_en` → `name` | `description_zh` → `description` |
| 其他（归一化为 `en`） | `name_en` → `name` | `description` |

- `name_*` 提升到**系列级**：标题不随版本选择变化，避免闪烁；取自该系列中版本号最高且字段非空的记录。
- `description_zh` 留在**版本级**，与它翻译的 `description` 一起随版本切换。
- 空白串（含仅空格）按缺失处理：`normalizeDisplayField` 丢弃，contracts 解析层对 `powers.list.v1` 结果判非法（该结果由本插件聚合产生，出现空白串即是内部 bug）。
- 非字符串一律报错并点名字段，不静默错渲染。

## 不变量

- `powers.list.v1` 的请求/结果形状、operation ID、grant、Provider DTO 与 wire 信封不变；`provider/` 零改动。
- installed 范围 `snapshotForRecords` 纳入展示字段：只改展示名也会触发 `reset_required` 与重渲染。
- 语言切换只换文案与展示字段解析结果，不重挂载 Provider 子树、不放宽列表 effect 依赖（`src/AgentHubPage.test.tsx` 断言 `powers.list.v1` 请求数不变）。
- 未新增任何词典键，`agentHubChinese` 死键扫描仍为 0 孤儿。

## 本地验证

| 命令 | 结果 |
| --- | --- |
| `npm test` | 378/378（23 个文件；0.3.2 基线 337） |
| `npm run typecheck` | 通过（`tsc --noEmit`，无输出） |
| `npm run build:dev` | 通过 |
| `npm run build:plugin` | 通过，产物 `artifacts/agent-hub-0.3.3.bibit-plugin.tgz` |
| `git diff --check` | 无空白错误 |

新用例的失败验证（证明测试确实覆盖实现）：

- 把 `src/displayFields.ts` 的两个回退分支改为直接返回 `series.name` / `version.description` 后，`displayFields` + 两个组件 + 页面共 13 项失败；
- 把 `src/api/contracts.ts` 的 `SERIES_KEYS`/`VERSION_KEYS` 还原为不含新字段后，`contracts.test.ts` 2 项失败。

测试覆盖重点：

- `src/displayFields.test.ts`（新增）：中/英回退链全组合，含「英文宿主不得显示中文」与空白串。
- `src/api/contracts.test.ts`：新键透传、缺失保持缺席、非字符串/空白串被拒。
- `src/api/apm.test.ts`：解析容错与报错、`name_*` 提升到系列、`description_zh` 逐版本、最高版本缺字段时回落到旧版本、只改展示字段改变 snapshot。
- `src/api/apc.test.ts`：目录 item 携带展示字段、V1 目录缺失与空白容忍、非字符串报错。
- `src/components/PowerCard.test.tsx` / `PowerDetailsDialog.test.tsx`：中文与英文渲染、V1 回退、版本切换时标题稳定而描述跟随、弹窗 `aria-label` 与标题一致。
- `src/AgentHubPage.test.tsx`：installed 与 market 两条链路的中文渲染、切换语言换展示名但 `powers.list.v1` 请求数不变。
- `src/agentHubI18n.test.tsx`：`useAgentHubLanguage()` 归一化（`zh`/`zh-CN`/`en-US`/缺省/provider 外）。

## 板端部署（bianbu@board-host，riscv64，开发签名）

双 deb 由本机 `dpkg-buildpackage -us -uc -b -a riscv64 -d` 产出（`-d` 跳过目标机 golang-go 版本检查；Provider 先经 `make -C provider build GOARCH=riscv64` 交叉编译）：

```text
bibit-agenthub-plugin_0.3.3_all.deb     sha256 c2b4d65baf65ce003dad47df2d391d3f8d818047fb2d6864f08a447ca745ebad
bibit-agenthub-cli_0.3.3_riscv64.deb    sha256 0e2dc5e3364cbf96a8bb2d1c1cc454a344ac0ed57174a58c4f13c31919ea619b
```

部署步骤与证据：

1. 升级前把 0.3.2 的 bundle、CLI 可执行、两个 drop-in 配置与 `registry.json` 备份到 `/home/bianbu/agenthub-backup-0.3.2/`（bundle `a1e03d47…`、可执行 `428d05b3…`、registry `e0345546…`）。
2. 上传到板端并以 `sha256sum` 与本地比对一致后 `dpkg --force-confold -i` 安装；两个包 `0.3.3` 均 `install ok installed`，`dpkg --audit` 无输出。
3. `/usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz` = `7fe951e3…`（与本机 `artifacts/agent-hub-0.3.3.bibit-plugin.tgz` 一致）；`/usr/libexec/bibit/bibit-agenthub` = `55e90177…`（与本机 riscv64 构建一致）。
4. `/usr/libexec/bibit/bibit-agenthub --self-test` 退出 0。
5. 重启 `bibit-gui`（`pkill -x bibit-gui` 后以 LXQt 会话环境 `DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 BIBIT_RUNTIME_PROFILE=bianbu` 拉起），宿主在启动时重扫系统插件目录并自行收敛，**无需手工改 `registry.json`**：
   - `registry.json` 收敛为 `active/current/desired = 0.3.3`、`previous = 0.3.2`；
   - `system-installed.json` 的 agent-hub 条目更新为 `version 0.3.3`、`sha256 7fe951e3…`；
   - GUI 日志 `Loaded trusted plugins: agent-hub@0.3.3, filesearch@0.1.0, memory@0.1.5, runtime@0.2.35`，无 `rejected` / `request_unauthorized`；
   - 落盘目录 `/home/bianbu/.local/share/BiBit/data/plugins/installed/agent-hub/0.3.3/` 生成，`plugin.json` 的 `featureManifest.version` 为 `0.3.3`，`dist/plugin.js` 含 14 处 `name_zh`（证明板上运行的就是带展示字段解析的构建）。

部署过程记录（不是本次插件缺陷）：首次 `sudo dpkg -i` 期间板端整机死机，重启后 `/tmp`（tmpfs）被清空、包未安装、`dpkg --audit` 干净。用户重启后改用 `/home/bianbu` 暂存重装。日志证据显示死机前只有常规 `bibit-embed` 推理与语音轮询，无 OOM / hung task / 内核 BUG，`/var/log/kern.log` 上一次启动无异常尾部，因此未能定位到可归因于本次安装的原因；该次死机与插件无关（安装的是同一批 deb，第二次安装全程正常）。

## 上游数据通道就绪后的复核（apm 0.1.6）

apm 侧按 `../apm/ivory-tower/adr/ADR-040-catalog-and-cli-json-carry-display-fields.md` 打通通道后，本仓库的改动只有三处，均为注释/测试：

| 变更 | 文件 | 性质 |
| --- | --- | --- |
| 修正「apm 尚不输出这些字段」的过期说明 | `src/api/apm.ts`、`src/api/apc.ts` | 注释 |
| 新增跨仓库契约锚点测试 | `src/api/apm.test.ts` | 测试 |

契约锚点测试使用 **apm 0.1.6 的真实 `list --installed --json` 输出原文**（V2 与 V1 各一条），断言：
解析保留非空展示字段、丢弃 V1 记录的空串，且系列聚合同样把 `name_*` 提升到系列级、把 `description_zh`
留在版本级。这样上游输出一旦漂移，本仓库的门禁会直接失败。

板端实测（apm 0.1.6 已安装、Local provider 指向仓库内 fixture）：

```text
apm list --installed --agent bibit --json
[{"agent":"bibit","type":"skill","name":"brief-status","version":"v0.0.1",
  "description":"Use when writing a concise progress status update.","tags":[],
  "name_zh":"简报状态","name_en":"Brief Status","description_zh":"用于撰写简洁的进度状态更新。"}]
```

同一输出已作为测试夹具写入 `src/api/apm.test.ts`。

## 未验证项

- **market 范围**：APC 公共目录 item 尚未发布三字段，线上 16 条记录全部为空串，因此 market 卡片在字段
  发布前仍走回退（命令成功、不回退失败）。APC 发布后无需本仓库改动即生效。
- **已安装范围需重装回填**：展示字段是安装时捕获的元数据，同版本重装命中 `manifestSameVersion` 短路返回
  `unchanged`，升级 apm 后旧记录仍为空串；需卸载后重装（或变更版本）才会写入。板端已用隔离环境确认这一
  行为（见 `../apm/ivory-tower/features/031-power-format-v2/verification.md` §4.5）。
- 板端 GUI 内切换系统语言、确认卡片与详情弹窗按语言显示展示名这一步仍未执行：需要先按上一项重装以回填
  已安装 Power 的记录。
- `dev/main.tsx` 未新增 Mock：Local Preview 通过 `apm`/APC 真实取数，本仓库没有静态 Power fixture，
  展示字段路径由测试（含上面的契约锚点）覆盖。

