# APC Power 展示页面与系列级资源接口设计

- Status：Approved for implementation
- Date：2026-08-27
- Repositories：bibit-agenthub-plugin、../apc

## 1. 目标

在 Bibit Agent Hub 插件中提供 APC 公开 Power 展示原型，同时保留未来切换到真实
APC 和本地 APM 清单的稳定接口边界。

页面提供：

- “我的 Power”和“Power 市场”两种数据范围；
- Agent 应用、Power 类型和 tags 分层筛选；
- Power 系列级卡片和固定每页 20 张卡片的分页；
- 同一 Power 的版本选择，以及 description、tags 随版本切换；
- Local Preview 与未来 Remote Store 完全相同的页面 DTO。

APC 公共资源列表调整为系列级分页，使服务端分页对象与前端卡片一一对应，并增加
tag 筛选和按 Power 类型获取完整 tag 列表的能力。

## 2. 非目标

本功能不包含：

- APC 服务端、数据库、索引或缓存实现；
- Remote Store 服务、Bibit Host adapter 或 capability grant；
- Power 安装、下载、提交、审核、下架或恢复；
- APM 源码修改；
- 新增、复制或调整页面 CSS；
- 修改 ../bibit、../apm 或 SDK vendor。

## 3. 架构

    AgentHubPage
      └─ PowerCatalogClient
           └─ external-service:store / powers.list.v1
                ├─ Local Preview：内存 Mock
                └─ Remote Store（发布前实现）
                     ├─ installed：APM CLI
                     └─ market：APC Public API

Feature 必须遵守 Bibit Feature SDK 边界：

- 只通过 useFeatureCapability("external-service:store") 获取业务数据；
- 不直接调用 fetch、WebSocket、EventSource、Tauri、文件系统或 CLI；
- 不在 params 中传 URL、header、authorization、token、API Key 或其它凭据；
- 使用有限正整数 timeout 和 AbortSignal；
- 组件卸载、筛选变化和翻页时取消旧请求；
- Store adapter 负责外部 DTO 校验、错误映射和安全日志。

## 4. Store 中间层契约

### 4.1 Operation

    serviceId: store
    operationId: powers.list.v1

请求类型：

    type PowerScope = 'installed' | 'market'
    type PowerType = 'skill' | 'plugin' | 'mcp' | 'agent'

    interface ListPowersInput {
      scope: PowerScope
      agent?: string
      type: PowerType
      tags: string[]
      page: number
      pageSize: 20
      snapshot?: string
    }

请求规则：

- scope=installed 时 agent 必填且 trim 后非空；
- scope=market 时 agent 必须省略；
- type 必须为 skill、plugin、mcp、agent 之一；
- 页面不提供“全部类型”；
- tags 为 0–20 个 canonical tag，必须按字典序排序且唯一，多项使用 OR；
- page 从 1 开始；
- pageSize 在 v1 中固定为 20；
- page=1 时 snapshot 必须省略；
- page>1 时 snapshot 必填，必须等于上一页结果的 snapshot；
- 请求为字段闭集，未知字段拒绝。

结果类型：

    interface PowerVersion {
      version: string
      description: string
      tags: string[]
    }

    interface PowerSeries {
      type: PowerType
      name: string
      versions: PowerVersion[]
    }

    interface PowerWarning {
      code: 'installed-agent-unavailable'
      agent: string
      message: string
    }

    type ListPowersResult =
      | {
          status: 'ready'
          snapshot: string
          items: PowerSeries[]
          page: number
          pageSize: 20
          total: number
          nextPage?: number
          facets: {
            agents: string[]
            tags: string[]
          }
          warnings: PowerWarning[]
        }
      | {
          status: 'reset_required'
          reason: 'snapshot_changed'
        }

结果规则：

- items 按 type、name 升序排列；
- 每个系列的 versions 至少一项；
- versions 使用严格 vMAJOR.MINOR.PATCH，按 SemVer 降序；
- tags、facets.agents 和 facets.tags 排序、去重；
- market 的 facets.agents 恒为 []；
- total 统计当前筛选条件下的 Power 系列数；
- nextPage 仅在存在下一页时返回；
- warnings 只包含稳定 code、Agent ID 和安全 message；
- Store DTO 是字段闭集，插件必须在 API 边界执行运行时校验；
- snapshot 变化返回 reset_required，页面不得混合新旧结果。

### 4.2 Installed 数据源

未来 Store 使用固定 argv 执行：

    apm list --installed --agent=all --all --json

禁止使用 shell 字符串拼接。APM JSON 单条记录为：

    interface APMPowerRecord {
      agent: string
      type: PowerType
      name: string
      version: string
      description?: string
      tags?: string[]
    }

Store 处理规则：

- 缺失 description 和 tags 分别规范化为 "" 和 []；
- 先按 agent、type、tags 过滤，再按 type、name 聚合；
- 相同 agent、type、name、version 重复记录去重；
- facets.agents 只包含实际返回记录中的已安装 Agent；
- facets.tags 来自当前 agent、type 的完整记录集合，不受当前 tag 选择限制；
- CLI 非零退出但 stdout 为合法 JSON 时，返回有效数据和安全 warnings；
- stdout 非法或 CLI 无法执行时映射为 Host external-service 错误；
- 不透传 CLI stderr、物理路径、环境变量、堆栈或命令内部错误。

### 4.3 Local Preview

dev/main.tsx 通过 serviceMocks 注入 powers.list.v1。Mock：

- 同时包含 installed 和 market fixture；
- 覆盖 Bibit 及其它已安装 Agent；
- 覆盖四种 Power 类型、多个 tags、多个版本和至少两页数据；
- 实现与 Remote 相同的筛选、聚合、分页、facets、warnings 和 snapshot 规则；
- 至少包含一个部分 Agent warning fixture；
- 不执行真实 APM CLI。

## 5. APC 公共接口修订

### 5.1 系列级资源列表

    GET /api/v1/resources/list
      ?type=skill
      &tag=code-review
      &tag=quality
      &view=all
      &page=1
      &page_size=20
      &catalog_sha256=<snapshot>

查询参数：

| 参数 | 规则 |
| --- | --- |
| type | 可选；skill、plugin、mcp、agent。Agent Hub 必传。 |
| tag | 可重复 0–20 次，OR；空值、重复或非法格式返回 INVALID_REQUEST。 |
| view | all 默认；latest 每系列只返回最高匹配版本。 |
| page | 从 1 开始，默认 1。 |
| page_size | 默认 100，范围 1–500。 |
| catalog_sha256 | page=1 时可省略；page>1 时必填并绑定首个响应快照。 |

响应：

    interface ResourceSeriesList {
      catalog_sha256: string
      catalog_size: number
      items: ResourceSeries[]
      page: number
      page_size: number
      total: number
      next_page?: number
    }

    interface ResourceSeries {
      type: PowerType
      name: string
      versions: ResourceVersionMetadata[]
    }

    interface ResourceVersionMetadata {
      version: string
      description: string
      message: string
      content_type: string
      content_size: number
      content_md5: string
      published_at: string
      tags: string[]
    }

处理顺序：

1. 从一个原子 Published Catalog 快照读取；
2. 排除 yanked、未发布和不可下载版本；
3. 应用 type 筛选；
4. 对精确版本应用 tags OR 筛选；
5. 删除没有匹配版本的系列；
6. view=latest 时仅保留每系列最高匹配 SemVer；
7. 系列按 type、name 排序，versions 按 SemVer 降序；
8. 按系列执行 page、page_size 分页；
9. 计算系列级 total 和 next_page。

分页与快照：

- catalog_sha256 和 catalog_size 与 /api/v1/resources/version 对应同一 catalog；
- page>1 缺失 catalog_sha256 返回 400 INVALID_PAGINATION；
- catalog_sha256 与当前目录不一致返回 400 INVALID_PAGINATION；
- 相同 snapshot 和筛选条件下翻页不得重复、遗漏或拆分系列；
- APC 不得返回来自不同 catalog 的 items、tags 或分页元数据。

### 5.2 Type Tag 列表

    GET /api/v1/resources/tags?type=skill

响应：

    {
      "catalog_sha256": "<64 lowercase hex>",
      "catalog_size": 123456,
      "items": ["code-review", "quality"]
    }

规则：

- type 必填，只接受四种 Power 类型；
- 不分页，不接受 page、page_size 等额外查询参数；
- items 来自该 type 所有 published、可下载版本；
- items 字典序排序、去重；无 tag 时返回 []；
- 响应与资源 list 使用同一 Published Catalog；
- 未知请求字段返回 400 INVALID_REQUEST；
- 普通响应新增可选字段遵循 APC v1 兼容规则，Store 只投影插件 DTO 所需字段。

### 5.3 APC 文档交付

未来实现阶段在 ../apc：

- 新建 ivory-tower/adr/ADR-007-filter-and-group-public-resources.md；
- 新建 ivory-tower/features/004-resource-series-discovery/spec.md；
- 更新 ADR-005，记录系列级分页、tag 和 snapshot 扩展；
- 更新 docs/APC-API.md 的模型、list、tags、错误、示例和变更记录；
- 更新 ivory-tower/project-overview.md 的公共接口表、分页和验收条件；
- 删除所有把公开 list items 描述为扁平 ResourceMetadata 版本条目的现行文本。

APC 尚未发布，因此不保留旧扁平 list 的兼容接口。

## 6. 页面设计

### 6.1 筛选层级

    我的 Power / Power 市场
      └─ Agent 应用（仅我的 Power）
           └─ skill / plugin / mcp / agent
                └─ tags

默认状态：

- scope：我的 Power；
- Agent：Bibit；
- Bibit 未安装时选择首个已安装 Agent；
- 没有已安装 Agent 时显示空态；
- type：skill；
- tags：空；
- page：1。

交互规则：

- Agent 层只显示 APM 返回的已安装 Agent；
- Power 市场完全隐藏 Agent 层；
- Power 类型必须四选一，不提供“全部”；
- tags 使用原生多选控件，多项使用 OR；
- 切换 scope、agent、type 时清除不再有效的 tags；
- 任一筛选变化取消旧请求、清除版本选择并回到第 1 页。

### 6.2 Power 卡片

installed 和 market 复用同一个 PowerCard：

- type 使用现有 article 小标签；
- name 使用 h2；
- version 使用原生 select，默认选择 versions[0]；
- description 使用只读原生 textarea，保持浏览器默认尺寸和纵向滚动；
- tags 使用单行、wrap="off" 的只读 textarea，保持默认宽度和横向滚动；
- 版本切换时 version、description、tags 同步变化；
- Agent 只参与筛选，不进入卡片布局。

### 6.3 分页和状态

- 每页最多 20 张系列卡；
- 显示上一页、第 X/Y 页、下一页；
- 首末页禁用对应按钮；
- 翻页替换当前页，不累计卡片；
- reset_required 时刷新 facets、清空旧结果并请求第 1 页；
- loading、empty、完整错误、Retry 和部分 warning 都是 Feature 局部状态；
- warning 可与有效卡片同时显示；
- unmount、筛选变化和翻页时 abort；
- 晚返回的旧请求不得覆盖当前查询。

### 6.4 样式边界

- src/agentHub.css 必须保持零修改；
- 不新增 CSS class 规则；
- 不使用 inline style；
- 不引入 UI 库；
- 只复用现有 class 和浏览器原生控件。

## 7. 错误处理

| 错误 | 页面行为 |
| --- | --- |
| capability unavailable | 局部错误并允许 Retry。 |
| offline、timeout、unavailable | 显示可恢复错误并允许 Retry。 |
| unauthorized | 显示重新认证提示，不自动重试。 |
| incompatible | 提示插件、Store 或 APC 契约不兼容。 |
| reset_required | 自动回第 1 页并重新加载。 |
| APM 部分失败 | 显示有效卡片和按 Agent warning。 |
| unknown | 仅显示安全通用信息和允许展示的 diagnosticId。 |

页面和日志禁止展示 APC 原始 problem body、CLI stderr、物理路径、header、凭据或内部堆栈。

## 8. 测试与验收

### 8.1 插件测试

按 Bibit Feature SDK 指南接入：

- Vitest 3.2.4；
- jsdom 26.1.0；
- @testing-library/dom 10.4.1；
- @testing-library/react 16.3.0；
- @testing-library/user-event 14.6.1。

覆盖：

- ListPowersInput 和 ListPowersResult 闭集及负向校验；
- APM 记录聚合、exact 去重、SemVer、tags OR 和 facets；
- 固定 20 系列分页和 snapshot reset；
- 默认“我的 Power / Bibit / skill”；
- 仅显示已安装 Agent；
- Power 市场隐藏 Agent；
- type、tags 和版本切换；
- 上一页、下一页和筛选重置；
- loading、empty、错误、Retry 和部分 warning；
- AbortSignal、unmount 和迟到响应；
- installed 和 market 使用相同卡片结构。

### 8.2 APC 契约测试要求

未来 APC 服务实现必须覆盖：

- type、单 tag、多 tag OR 和无匹配 tag；
- tag 非法、重复和超过 20 个；
- view=latest 和 view=all；
- 系列级 total、page_size 和 next_page；
- 系列不可跨页，versions 按 SemVer 降序；
- tags 全量接口的排序、去重和空数组；
- yanked、未发布版本不可见；
- catalog_sha256 缺失、匹配和失效；
- tags、list、version 来自同一 catalog snapshot；
- 未知 query 参数拒绝。

### 8.3 验证

    npm test
    npm run typecheck
    npm run build:dev
    git diff --check

验收还要求 git diff -- src/agentHub.css 无输出。

## 9. 发布前置项

插件原型完成后，正式发布仍依赖平台 owner：

- 批准 external-service:store capability grant；
- 注册真实 Host adapter；
- 实现安全的 APM CLI bridge；
- 实现 APC transport、timeout、认证和错误映射；
- 完成 APC 系列级 list 和 tags 服务端；
- 验证单响应不超过 Feature Host 4 MiB 上限。

行为实现完成后，在插件仓库按模板新增一条 docs/Changelog.md“新增功能”记录。仅设计文档落盘
不满足 Changelog 记录条件。
