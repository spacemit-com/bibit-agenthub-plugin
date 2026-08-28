# Bibit Agent Hub 插件开发与部署指南

本文面向 Agent Hub 模块开发者、平台维护者及负责实施的 Coding Agent。按照本文操作，可以在不编译完整 Bibit 的情况下独立开发 Agent Hub 前端，通过公开 Host API 连接模块团队独立部署的 Store 服务，并把签名插件作为系统组件安装到 Bibit。

## 1. 适用版本与当前交付

| 项目 | 当前版本 |
| --- | --- |
| Agent Hub 插件 | `0.3.0` |
| `manifestSchemaVersion` | `1` |
| `sdkApiVersion` | `1` |
| `@bibit/feature-contracts` | `0.3.0` |
| `@bibit/feature-sdk` | `0.3.0` |
| `@bibit/feature-plugin-sdk` | `0.3.0` |
| `@bibit/feature-dev-host` | `0.3.0` |
| React / React DOM | `19.0.0` |
| 已验证目标 Bibit | `3a6adda0c47637accc59f0612d83bca47e0e4f9e` |

当前插件提供两个贡献点：

- `pages.home`：显示在 Bibit 主导航的 Agent Hub 页面；
- `settings.settings`：显示在 Bibit 设置子菜单的 Agent Hub 设置页面。

当前 Demo 只实现 Agent 列表、列表重试、实验 Agent 开关和刷新间隔设置。Agent 详情、搜索、分页、上传、下载、删除、版本管理和发布流程尚未实现，这些属于 Agent Hub 模块团队后续定制范围。

当前插件没有使用 `@bibit/feature-ui`。如果后续引入，必须由平台提供与目标 Bibit 完全一致的版本快照，并与 React 及其余 SDK 一起锁定升级；不得直接导入 Bibit 私有 UI 源码。

## 2. 总体职责边界

### 2.1 Agent Hub 模块团队负责

- Agent Hub 页面、设置内容和交互体验；
- Agent、Skill 或包的领域 DTO、字段语义和 operation 版本；
- 加载、空态、错误态、重试、搜索、分页和编辑等页面逻辑；
- Store 服务的实现、部署、持久化、鉴权策略和可用性；
- `dev/main.tsx` 中与生产 DTO 一致的 Mock；
- 插件版本、测试、构建输入和发布说明；
- 提交给公司签名服务的固定源码和构建材料。

### 2.2 Bibit 平台负责

- Manifest Schema、Feature Module 和 Host API 公共契约；
- 主导航、Settings Shell、路由挂载和插件错误隔离；
- `service:store` capability、operation grant 与 Provider Broker；
- Store Provider 发现、HTTP/stdio 路由、凭据注入和安全错误映射；
- 插件验签、完整性校验、安装、激活、回退和系统目录扫描；
- 目标 Bibit 的 React、Feature SDK 和可选 Feature UI 版本发布；
- Release Bibit 内置的可信公钥。

### 2.3 Store 后端边界

Store 能力可以由模块团队独立部署的 HTTP 服务提供，也可以由系统安装的 AgentHub CLI Provider 提供。插件不感知具体传输，只依赖 `store` operation；CLI 的完整协议和部署方式见 [AgentHub CLI Provider 开发与部署指南](./cli-provider-development-and-deployment.md)。

插件不得直接连接后端。正式链路必须是：

```text
Agent Hub React UI
  └─ useFeatureCapability("service:store")
       └─ Bibit Host API / Provider Broker
            ├─ HTTP Provider POST /bibit/v1/invoke
            └─ AgentHub CLI Provider stdin/stdout
```

## 3. 仓库结构

```text
bibit-agenthub-plugin/
├── AGENTS.md
├── bibit.feature.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── index.html
├── dev/
│   └── main.tsx
├── src/
│   ├── feature.tsx
│   ├── plugin.tsx
│   ├── AgentHubPage.tsx
│   ├── AgentHubSettingsPage.tsx
│   ├── storeContracts.ts
│   └── agentHub.css
├── tests/
│   └── storeContracts.test.ts
├── vendor/
│   ├── bibit-feature-contracts-0.3.0.tgz
│   ├── bibit-feature-dev-host-0.3.0.tgz
│   ├── bibit-feature-plugin-sdk-0.3.0.tgz
│   └── bibit-feature-sdk-0.3.0.tgz
├── .bibit-keys/
├── artifacts/
└── docs/
```

`.bibit-keys/`、`artifacts/`、`dist/` 和 `node_modules/` 已被 `.gitignore` 排除。不得强制提交私钥、本地信任库或构建产物。

## 4. 哪些代码不要自行修改

这里的“不要修改”不是永远禁止变化，而是指模块团队不应在日常业务开发中自行改写。确需变化时，应由平台发布新模板或新 SDK，模块团队按一次完整升级处理。

| 文件或内容 | 维护属性 | 日常规则 | 允许变化的条件 |
| --- | --- | --- | --- |
| `vendor/bibit-feature-*.tgz` | 平台发布物 | 不解包修改、不重新打包、不单独升级某一个包 | 平台提供目标 Bibit 的完整 SDK 版本组时整体替换 |
| React、React DOM 和 `@types/react*` 版本 | 平台兼容基线 | 不自行升降版本，不使用 `^` 或 `~` | 目标 Bibit 和 SDK 同步升级并提供确切版本时 |
| `package.json` 的 `bibitPlugin.entry`、`manifest`、`artifactDir` | 构建器契约 | 保持现有值 | 平台构建器契约升级时 |
| `package.json` 的 `keygen`、`build:plugin` | 签名工具接线 | 不把私钥路径改成仓库内可提交文件，不绕过签名工具 | 平台签名工具或正式签名 SOP 变更时 |
| `src/plugin.tsx` | 插件注册入口 | 保持纯注册，不放业务逻辑、网络连接、定时器或全局监听 | 仅随 `@bibit/feature-plugin-sdk` 接口升级 |
| `tsconfig.json` 的严格模式、ES 模块和 JSX 配置 | SDK 编译基线 | 不关闭 `strict`，不改成 CommonJS，不放宽类型检查 | 平台提供新版 TypeScript 模板时 |
| `.gitignore` 对 `.bibit-keys/` 的排除 | 安全边界 | 不删除、不反向提交密钥 | 不允许例外 |
| Manifest 的 `manifestSchemaVersion`、`sdkApiVersion`、`id` | 公共身份契约 | 当前保持 `1`、`1`、`agent-hub` | 平台升级 Schema/API，或经过迁移评审创建全新 Feature |
| Manifest 的 `requiredHostCapabilities` | 最小授权契约 | 保留实际使用的 `service:store`，不把 operation、URL 或 command 当 capability | 功能确实需要新的 Service 或非 Service 公共能力时 |

`src/plugin.tsx` 推荐长期保持如下形态：

```tsx
import { registerFeaturePlugin } from '@bibit/feature-plugin-sdk'
import type { FeatureManifestV1 } from '@bibit/feature-contracts'
import manifestJson from '../bibit.feature.json'
import { featureModule } from './feature'

registerFeaturePlugin({
  manifest: manifestJson as FeatureManifestV1,
  module: featureModule,
})
```

禁止从插件导入以下内容：

- Bibit 的 `web-app/src`、`src-tauri` 或 `@/` 私有模块；
- `@tauri-apps/*`；
- Bibit Store、ServiceHub、Runtime 私有实现；
- 其他业务 Feature 的源码；
- axios、ky、got、undici 或自行封装的网络通道。

禁止在插件中直接使用 `fetch`、`WebSocket` 或 `EventSource` 访问业务服务。`dev/main.tsx` 为连接真实开发服务而使用的 Dev Host `serviceConnections` 是开发工作台能力，不会进入生产插件入口。

## 5. 哪些代码应由模块团队定制

| 文件或内容 | 定制范围 | 必须遵守的边界 |
| --- | --- | --- |
| `src/AgentHubPage.tsx` | 列表、搜索、筛选、详情入口、上传下载入口、空态、错误态 | 只通过 Host capability 获取数据；卸载时取消请求 |
| `src/AgentHubSettingsPage.tsx` | Agent Hub 自身设置字段、校验、保存状态 | 只渲染设置内容，不复制 Bibit Settings Shell |
| `src/agentHub.css` | 页面和设置内容样式 | 不覆盖 Bibit 全局选择器，不依赖宿主私有 class |
| 业务 DTO 和 operation ID | 请求参数、返回数据、错误语义、版本 | 破坏性变更发布新 operation 版本 |
| `dev/main.tsx` | Mock 数据、Mock operation、真实开发服务地址注入 | Mock 必须与生产 DTO 一致；不得导入生产插件包 |
| Manifest `display` | 标题、说明、合法 icon | `iconKey` 只能使用平台 Schema 已允许的 token |
| Manifest `navigation` | 合法 group 和排序 | 主页面和设置页分别使用各自允许的 group |
| Manifest `owner`、`version` | 团队标识和发布版本 | `version` 必须与 `package.json.version` 一致 |
| 文档和发布说明 | operation、兼容性、验收证据、已知限制 | 固定到 commit 和 bundle SHA-256，不只给分支链接 |

推荐把后续增大的业务代码拆成模块自有目录：

```text
src/
├── api/
│   ├── contracts.ts
│   └── useAgentHubService.ts
├── pages/
│   ├── AgentCatalogPage.tsx
│   └── AgentDetailPage.tsx
├── settings/
│   └── AgentHubSettingsPage.tsx
├── components/
├── feature.tsx
├── plugin.tsx
└── agentHub.css
```

这只是业务代码增长后的整理方式，不要求当前 Demo 立即重构。不要为尚未实现的页面预先创建空目录和抽象层。

### 5.1 给 Coding Agent 的修改决策表

收到 Agent Hub 需求后，Coding Agent 先按下表确定修改范围：

| 需求 | 应修改 | 不应修改 |
| --- | --- | --- |
| 改页面布局、列表、详情或交互 | `src/AgentHubPage.tsx`、模块组件、`agentHub.css` | `plugin.tsx`、SDK vendor、Bibit 私有页面 |
| 改设置字段或校验 | `AgentHubSettingsPage.tsx`、DTO、Store operation、Mock | Bibit Settings Shell、宿主 Store |
| 新增后端能力 | 模块 DTO、带版本 operation、Store 服务、Mock | 直接 `fetch`、Tauri command、凭据字段 |
| 新增 Agent Hub 内部详情路由 | 页面组件和 `FeaturePageProps.navigation` | Bibit Router、全局 URL 前缀、主侧边栏源码 |
| 新增主页面或设置贡献点 | 组件、`feature.tsx`、Manifest 三者同步 | 只改 Manifest 或只改 Feature Module |
| 需要新 icon、navigation group 或非 Service capability | 先提交平台契约缺口 | 在 Manifest 写入 Schema 未允许的字符串 |
| 需要新的模块 Service | 使用合法 `service:<kebab-id>`，提交 operation grant 与 Registry | 为每个 Service 新增 Tauri command 或直接执行 CLI |
| React 或 SDK 类型冲突 | 核对目标版本矩阵和 vendor 完整性 | 临时升级 React、关闭 `strict`、修改 vendor 内源码 |
| 插件无法连接真实服务 | 检查 capability、grant、连接配置和协议 | 绕过 Host API 直连后端 |

如果需求只能通过“修改 Bibit 私有源码、引入未知 capability、直接联网或改变 SDK 契约”才能完成，模块 Agent 应停止该路径，输出所需公共契约和平台缺口，由平台维护者处理。不得在插件仓库内建立临时旁路。

## 6. 受控接线代码如何修改

`bibit.feature.json` 和 `src/feature.tsx` 位于平台契约与业务组件之间。它们可以修改，但必须成对、最小化地修改。

### 6.1 当前 Manifest

```json
{
  "manifestSchemaVersion": 1,
  "sdkApiVersion": 1,
  "id": "agent-hub",
  "version": "0.3.0",
  "owner": "agent-hub-team",
  "display": {
    "titleKey": "agent-hub:title",
    "fallbackTitle": "Agent Hub",
    "iconKey": "store",
    "descriptionKey": "agent-hub:description",
    "fallbackDescription": "Browse and manage Agent packages"
  },
  "targets": ["desktop"],
  "requiredHostCapabilities": ["service:store"],
  "contributions": {
    "pages": [
      {
        "id": "home",
        "path": "",
        "surfaces": ["main"],
        "navigation": { "group": "library", "order": 100 }
      }
    ],
    "settings": [
      {
        "id": "settings",
        "path": "",
        "surfaces": ["main"],
        "navigation": { "group": "integrations", "order": 100 }
      }
    ],
    "conversation": [],
    "locales": ["en"]
  }
}
```

### 6.2 当前 Feature Module

```tsx
import type { FeatureModuleV1 } from '@bibit/feature-sdk'
import { AgentHubPage } from './AgentHubPage'
import { AgentHubSettingsPage } from './AgentHubSettingsPage'

export const featureModule: FeatureModuleV1 = {
  sdkApiVersion: 1,
  pages: { home: AgentHubPage },
  settings: { settings: AgentHubSettingsPage },
}
```

必须始终满足：

```text
Manifest id = agent-hub
Manifest pages 中的 id = FeatureModule.pages 的 key
Manifest settings 中的 id = FeatureModule.settings 的 key
Manifest sdkApiVersion = FeatureModule sdkApiVersion
Manifest version = package.json version
组件需要的 capability ⊆ Manifest requiredHostCapabilities
```

新增贡献点的正确顺序：

1. 先实现真实 React 组件；
2. 在 `featureModule` 中增加唯一 key；
3. 在 Manifest 对应贡献数组增加同名 id；
4. 选择 Schema 已允许的 `path`、`surface`、navigation group 和 icon；
5. 在 Dev Host 中确认贡献点可以独立打开；
6. 提升插件版本并重新签名。

不得在 `feature.tsx` 顶层请求数据、连接服务或注册监听器。它只做静态组件装配。

## 7. 页面和路由开发

Bibit 根据 Manifest 自动生成主导航项。模块团队只提供 `FeaturePageProps` 对应的页面内容，不修改 Bibit 侧边栏代码。

```ts
interface FeaturePageProps {
  featureId: string
  contributionId: string
  subpath: string
  search: Readonly<Record<string, string | readonly string[] | undefined>>
  navigation: {
    push(subpath: string, search?: Readonly<Record<string, string | readonly string[] | undefined>>): void
    replace(subpath: string, search?: Readonly<Record<string, string | readonly string[] | undefined>>): void
    back(): void
  }
}
```

复杂页面应使用相对路由：

```tsx
import type { FeaturePageProps } from '@bibit/feature-sdk'

export function AgentHubPage({ subpath, navigation }: FeaturePageProps) {
  if (subpath.startsWith('agents/')) {
    const agentId = subpath.slice('agents/'.length)
    return (
      <section>
        <button type="button" onClick={() => navigation.back()}>
          Back to catalog
        </button>
        <h1>Agent detail</h1>
        <p>Agent ID: {agentId}</p>
      </section>
    )
  }

  return (
    <section>
      <h1>Agent catalog</h1>
      <button
        type="button"
        onClick={() => navigation.push('agents/incident-helper')}
      >
        Open Incident Helper
      </button>
    </section>
  )
}
```

不要直接使用 Bibit Router、修改全局 URL、硬编码宿主路由前缀或自行添加侧边栏项。Feature 的 `navigation` 会把路由限制在 Agent Hub namespace 中。

页面必须覆盖：

- 初次加载；
- 正常数据；
- 空列表；
- 服务离线；
- 超时；
- 未授权；
- 协议不兼容；
- 用户主动重试；
- 组件卸载时取消未完成请求。

## 8. 设置页面开发

Bibit 自动提供 Settings Shell、“设置”页头、设置子菜单、选中状态、菜单滚动和内容滚动容器。插件只提供 Agent Hub 设置内容。

设置 renderer 的根节点必须使用 `section`、`div` 等内容容器，不得使用 `main` 或 `role="main"`。根节点必须能够收缩到宿主内容区（至少设置 `width: 100%; min-width: 0; max-width: 100%`，或更小的业务最大宽度）。完整契约见目标 Bibit 仓库的 `docs/feature-sdk/settings-content-contract.md`。

插件设置页可以包含自己的分区标题，例如“Catalog preferences”，但不得复制以下宿主结构：

- `HeaderPage`；
- `SettingsMenu`；
- 全局“设置”标题；
- 宿主内容滚动容器；
- 返回按钮或外层路由 Shell。

设置值由 Store 服务持久化。插件不能把生产设置只保存在 React state、`localStorage` 或 Bibit 私有 Store 中。

当前 DTO：

```ts
interface AgentHubSettingsV1 {
  showExperimental: boolean
  refreshMinutes: number
}
```

模块团队增加字段时必须同时更新：

1. DTO 定义和运行时校验；
2. 设置 UI；
3. `settings.get.v1` 与 `settings.update.v1` 后端实现；
4. `dev/main.tsx` Mock；
5. 迁移和默认值规则；
6. 真实服务保存后重新读取的验收。

如果字段变化不能向后兼容，应发布 `settings.get.v2` 和 `settings.update.v2`，并保留明确迁移窗口。

## 9. Host API 使用规则

获取 Store capability：

```tsx
const store = useFeatureCapability('service:store')
```

发起请求：

```tsx
const controller = new AbortController()

const response = await store.request<unknown>({
  serviceId: 'store',
  operationId: 'agents.list.v1',
  params: {},
  timeoutMs: 30_000,
  signal: controller.signal,
})

const agents = parseAgentSummaries(response)
```

组件卸载时执行：

```tsx
return () => controller.abort()
```

必须遵守：

- capability 不存在时显示 Agent Hub 局部错误，不直接回退到 `fetch`；
- `serviceId` 固定为 `store`；
- `operationId` 必须带版本，例如 `agents.list.v1`；
- `params` 必须是 JSON object；
- timeout 必须在 `1..300000` 毫秒内，默认值为 30000 毫秒；
- 单个请求最大 1 MiB，单个响应最大 4 MiB；
- 不把 URL、header、authorization、token、API key、cookie、credential 或 secret 放入 `params`；
- 不显示或记录原始凭据、请求 header 或后端内部堆栈。

当前 `src/storeContracts.ts` 对列表和设置 v1 返回值执行运行时校验。新增上传、下载、分页或复杂 DTO 时，必须在同一协议边界增加对应校验；后端返回错误结构时进入局部错误态，不能让页面白屏。

## 10. Store 服务协议

### 10.1 当前 operation

| operationId | params | result |
| --- | --- | --- |
| `agents.list.v1` | `{}` | `AgentSummaryV1[]` |
| `settings.get.v1` | `{}` | `AgentHubSettingsV1` |
| `settings.update.v1` | `AgentHubSettingsV1` | `AgentHubSettingsV1` |

```ts
interface AgentSummaryV1 {
  id: string
  name: string
  description: string
}

interface AgentHubSettingsV1 {
  showExperimental: boolean
  refreshMinutes: number
}
```

注意：当前 `agents.list.v1` 返回的是数组本身，不是 `{ items: AgentSummaryV1[] }`。如果未来需要 cursor、total 或分页元数据，应发布新的 operation 版本，不要悄悄更改 v1 返回结构。

### 10.2 HTTP 请求

```text
POST <baseUrl>/bibit/v1/invoke
Content-Type: application/json
```

请求示例：

```json
{
  "protocolVersion": 1,
  "requestId": "host-generated-request-id",
  "serviceId": "store",
  "operationId": "agents.list.v1",
  "params": {},
  "timeoutMs": 30000
}
```

成功响应：

```json
{
  "protocolVersion": 1,
  "requestId": "host-generated-request-id",
  "ok": true,
  "result": [
    {
      "id": "incident-helper",
      "name": "Incident Helper",
      "description": "Collects evidence and prepares an incident timeline."
    }
  ]
}
```

业务或协议失败响应：

```json
{
  "protocolVersion": 1,
  "requestId": "host-generated-request-id",
  "ok": false,
  "error": {
    "code": "unavailable",
    "message": "Store service is unavailable",
    "retryable": true
  }
}
```

响应应使用 `Content-Type: application/json`。包含 `ok: true` 或 `ok: false` 信封的协议响应必须使用 HTTP 2xx；Bibit 只有在 2xx 响应中才解析信封。非 2xx 响应的 body 不会作为协议信封处理，而是按 HTTP 状态映射为 Host 错误。

| HTTP 状态 | Host 错误码 |
| --- | --- |
| `401`、`403` | `unauthorized` |
| `408`、`504` | `timeout` |
| `426` | `incompatible` |
| `502`、`503` | `unavailable` |
| 其他非 2xx | `unknown` |

允许的协议信封错误码：`cancelled`、`offline`、`timeout`、`unauthorized`、`incompatible`、`unavailable`、`provider_crashed`、`resource_exhausted`、`unknown`。

服务必须回显原始 `requestId`。`protocolVersion`、`requestId`、`ok`、`result/error` 互斥关系不正确时，Bibit 返回 `incompatible`。

### 10.3 Bibit 连接配置

Debug Bibit 可以使用：

```bash
export BIBIT_EXTERNAL_SERVICE_CONFIG=/absolute/path/external-service-connections.json
```

配置内容：

```json
{
  "version": 1,
  "services": {
    "store": {
      "baseUrl": "http://127.0.0.1:18081",
      "requestTimeoutMs": 30000
    }
  }
}
```

Bibit Host 会自动追加 `/bibit/v1/invoke`。`baseUrl` 不得包含用户名、密码、query 或 fragment。

生产系统包必须安装模块独立的 Registry drop-in：

```text
/etc/bibit/external-services.d/agenthub.json
/etc/bibit/feature-capability-grants.d/agenthub.json
```

HTTP 模式仍使用上面的 `version/services/store` 结构，并由模块安装包提供 Adapter、systemd unit 和 Provider drop-in。CLI 模式不需要 Adapter 或 systemd unit，由 CLI 包安装 executable 和 Registry v2 drop-in。插件 deb 安装经平台批准的 capability/operation grant，参考 `deploy/agenthub-feature-grants.example.json`。具体内容见 CLI Provider 指南。两种模式都不得从安装或维护脚本写入任何用户 home；用户数据目录配置和 `BIBIT_EXTERNAL_SERVICE_CONFIG` 只作为更高优先级的显式覆盖。

需要认证时只在连接配置中填写 `authRef`：

```json
{
  "version": 1,
  "services": {
    "store": {
      "baseUrl": "https://agent-store.internal.example",
      "authRef": "agent-hub-service",
      "requestTimeoutMs": 30000
    }
  }
}
```

token 由 Bibit 凭据存储提供。不得把 token 写入插件、Manifest、URL、仓库或日志。

## 11. 独立开发调试

### 11.1 获取代码

```bash
git clone -b dev \
  git@gitlab.dc.com:bianbu/bianbu-star/bibit-agenthub-plugin.git
cd bibit-agenthub-plugin
npm ci
```

使用 `npm ci` 保持 lockfile 中的确切版本。不要用 `npm update` 随机改变 SDK 或 React 版本。

确认依赖：

```bash
npm ls react react-dom \
  @bibit/feature-contracts \
  @bibit/feature-sdk \
  @bibit/feature-plugin-sdk \
  @bibit/feature-dev-host
```

### 11.2 Mock 模式

```bash
npm test
npm run typecheck
npm run dev
```

浏览器打开 Vite 输出地址。Feature Dev Host 会读取真实 Manifest 和 Feature Module，并通过 `dev/main.tsx` 注入内存 Mock。此模式不启动、不编译 Bibit，也不要求 Store 后端在线。

必须检查：

- `Page · home` 显示两条 Mock Agent；
- 加载结束后列表可见；
- `Settings · settings` 可以读取当前 Mock 设置；
- 修改开关和刷新间隔后保存；
- 再次进入设置页时 Mock 值一致；
- 未知 operation 返回错误，而不是伪造成功。

### 11.3 连接真实开发 Store 服务

Dev Host 的 `storeEndpoint` 是完整 invoke 地址，与 Bibit 连接配置中的 `baseUrl` 不同：

```text
http://127.0.0.1:5173/?storeEndpoint=http%3A%2F%2F127.0.0.1%3A18081%2Fbibit%2Fv1%2Finvoke
```

此时 `dev/main.tsx` 不再注入 Mock，而由浏览器直接向 Store 服务发送第 10 节信封。Store 开发服务必须允许 Dev Host origin 的 CORS；正式 Bibit 使用 Rust Host Gateway，不依赖浏览器 CORS。

真实服务调试必须验证：

- `agents.list.v1` 数据来自服务，不是 `mockAgents`；
- 浏览器网络请求中的 `requestId` 与服务响应一致；
- 设置保存后重新 GET 得到相同值；
- Store 服务停止后页面显示局部错误和 Retry；
- Store 恢复后 Retry 能恢复列表；
- Agent Hub 失败不影响 Dev Host 切换到设置贡献点。

### 11.4 开发构建

```bash
npm test
npm run typecheck
npm run build:dev
```

`build:dev` 只证明浏览器工作台可以编译，不等同于签名插件已能被 Bibit 加载。

## 12. 构建与签名

### 12.1 开发签名

首次生成开发 key：

```bash
npm run keygen
```

生成：

```text
.bibit-keys/agent-hub-development-private.pem
.bibit-keys/agent-hub-development-public.json
.bibit-keys/agent-hub-development-trust-store.json
```

构建：

```bash
npm test
npm run typecheck
npm run build:dev
npm run build:plugin
```

产物：

```text
artifacts/agent-hub-0.3.0.bibit-plugin.tgz
```

检查：

```bash
tar -tzf artifacts/agent-hub-0.3.0.bibit-plugin.tgz
tar -xOf artifacts/agent-hub-0.3.0.bibit-plugin.tgz plugin.json
tar -xOf artifacts/agent-hub-0.3.0.bibit-plugin.tgz plugin.sig
sha256sum artifacts/agent-hub-0.3.0.bibit-plugin.tgz
```

归档必须包含：

```text
plugin.json
plugin.sig
dist/plugin.js
dist/agent-hub-plugin.css
```

不得手工向签名归档添加文件。

### 12.2 正式签名交接

开发私钥不得用于正式发布。公司签名服务的命令、API、权限和审批 SOP 由签名服务维护者提供，不属于本仓库契约。模块团队与平台维护者之间至少交接：

1. 固定的 Agent Hub 源码 commit；
2. `package-lock.json` 和完整 SDK vendor 快照；
3. 插件 ID `agent-hub`、插件版本和目标 Bibit commit；
4. 公司签名服务返回的 `.bibit-plugin.tgz`；
5. bundle SHA-256；
6. `plugin.sig` 中的正式 `keyId`；
7. 对应公钥的 Bibit 登记结果。

收到正式 bundle 后执行第 12.1 节的四条检查命令。拿不到“正式签名 bundle + SHA-256 + key ID + 目标 Bibit 公钥登记结果”时，Release 部署处于阻塞状态；开发 key 不能代替这些交付物。

截至目标 Bibit `3a6adda0c47637accc59f0612d83bca47e0e4f9e`，`src-tauri/resources/plugin-trusted-keys.json` 仍为空。正式发布前必须由平台登记公司公钥并重新构建 Bibit。

## 13. 在 Bibit 中开发安装

启动 Debug Bibit 时指定 Agent Hub 开发 trust store：

```bash
BIBIT_PLUGIN_TRUST_STORE=/absolute/path/.bibit-keys/agent-hub-development-trust-store.json \
  yarn dev:tauri
```

进入：

```text
Settings > Extensions > Trusted plugins
```

选择：

```text
artifacts/agent-hub-0.3.0.bibit-plugin.tgz
```

Bibit 会验签、校验 hash、安装、激活并刷新 Feature Registry。确认主导航出现 Agent Hub，设置子菜单也出现 Agent Hub。

不要同时激活另一个使用 Feature ID `agent-hub` 的内置 Demo 或插件。重复 Feature ID 会被宿主拒绝或隔离。

Debug Bibit 使用真实 Store 服务时，还要配置第 10.3 节的 `BIBIT_EXTERNAL_SERVICE_CONFIG`。插件成功加载不代表 Store 服务已经接通。

若不写系统目录，Debug Bibit 可设置 `BIBIT_FEATURE_CAPABILITY_GRANTS_DIR` 指向包含 `deploy/agenthub-feature-grants.example.json` 的开发目录；Release Bibit 忽略该环境变量。授权与插件均在启动阶段装载，修改后需要重启 Bibit。

## 14. 系统插件与 Debian 部署

### 14.1 系统自动发现

Agent Hub 插件 deb 应安装：

```text
/usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz
/etc/bibit/feature-capability-grants.d/agenthub.json
```

本地安装：

```bash
sudo install -Dm0644 \
  artifacts/agent-hub-0.3.0.bibit-plugin.tgz \
  /usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz
sudo install -Dm0644 \
  deploy/agenthub-feature-grants.example.json \
  /etc/bibit/feature-capability-grants.d/agenthub.json
```

在下一次启动 Bibit 时，宿主扫描系统目录、逐个验签并自动激活有效插件。最小插件 deb 不应擅自重启用户正在使用的 Bibit；由发布流程安排重启，或通知用户退出后重新打开。

Bibit deb 不包含 Agent Hub 插件，两个包独立升级。Release Bibit 只接受内置可信公钥，不接受开发 trust store 环境变量。

### 14.2 最小 Debian 源包

Debian 源包只包装已由公司签名服务生成的 bundle：

```text
debian/
├── changelog
├── control
├── rules
├── source/format
├── agenthub-feature-grants.json
└── vendor/agent-hub.bibit-plugin.tgz
```

`debian/control`：

```debcontrol
Source: bibit-agenthub-plugin
Section: utils
Priority: optional
Maintainer: Agent Hub Team <agent-hub-team@dc.com>
Build-Depends: debhelper-compat (= 13)
Standards-Version: 4.6.2
Rules-Requires-Root: no

Package: bibit-agenthub-plugin
Architecture: all
Depends: bi-bit, ${misc:Depends}
Description: Bibit Agent Hub trusted frontend plugin
 Provides the Agent Hub main page and settings contribution.
```

`debian/rules`：

```make
#!/usr/bin/make -f

%:
	dh $@

override_dh_auto_build:
	test -f debian/vendor/agent-hub.bibit-plugin.tgz
	test -f debian/agenthub-feature-grants.json

override_dh_auto_install:
	install -Dm0644 \
	  debian/vendor/agent-hub.bibit-plugin.tgz \
	  debian/bibit-agenthub-plugin/usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz
	install -Dm0644 \
	  debian/agenthub-feature-grants.json \
	  debian/bibit-agenthub-plugin/etc/bibit/feature-capability-grants.d/agenthub.json
```

`debian/source/format`：

```text
3.0 (native)
```

构建：

```bash
dpkg-buildpackage -us -uc -b
```

正式签名私钥不能进入 Debian 源包或构建机。`dpkg-buildpackage` 只包装已签名并记录 SHA-256 的 bundle。

### 14.3 K3DEB1 Release 示例

K3DEB1 的 Release 部署必须使用正式签名、且 `keyId` 已进入目标 Bibit 内置信任库的 bundle：

```bash
export SIGNED_AGENT_HUB_BUNDLE=/absolute/path/agent-hub-0.3.0.bibit-plugin.tgz
test -f "$SIGNED_AGENT_HUB_BUNDLE"
tar -xOf "$SIGNED_AGENT_HUB_BUNDLE" plugin.json
tar -xOf "$SIGNED_AGENT_HUB_BUNDLE" plugin.sig
sha256sum "$SIGNED_AGENT_HUB_BUNDLE"
scp "$SIGNED_AGENT_HUB_BUNDLE" \
  root@K3DEB1:/tmp/agent-hub.bibit-plugin.tgz
ssh root@K3DEB1 \
  'install -Dm0644 /tmp/agent-hub.bibit-plugin.tgz /usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz'
```

部署前必须取得目标 Bibit 版本/commit 和公钥登记结果，确认 `plugin.sig.keyId` 一致。然后退出并重新启动目标用户的 Bibit，再执行第 16 节验收。

如果目标机运行 Debug Bibit，可使用开发签名和开发 trust store，但该结果不能代替 Release 验签证据。

## 15. 升级、回滚与卸载

### 15.1 升级

1. 修改业务代码和 Dev Host Mock；
2. 同时提升 `package.json.version` 与 `bibit.feature.json.version`；
3. 如果升级目标 Bibit SDK，从平台发布物整体替换 `vendor/` tarball；
4. 更新 `package.json` 的确切依赖版本和 file 路径；
5. 重新生成 `package-lock.json` 后执行 `npm ci`；
6. 完成类型检查、Dev Host、真实 Store 和插件构建验证；
7. 重新正式签名；
8. 使用新插件 deb 替换系统 bundle；
9. 重新启动 Bibit 并验证版本、页面、设置和真实数据链路。

### 15.2 回滚

1. 取回上一版正式签名 bundle 和 SHA-256；
2. 覆盖 `/usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz`；
3. 重新启动 Bibit；
4. 确认 Registry 激活版本已经回退；
5. 验证 Agent 列表和设置协议仍与后端兼容。

### 15.3 卸载

当前平台删除系统 bundle 后不会自动停用已激活版本，也没有供插件 deb 调用的无人值守停用 CLI/API。当前可执行顺序：

1. 在 `Settings > Extensions > Trusted plugins` 停用 Agent Hub；
2. 停止 Bibit；
3. 卸载 Agent Hub 插件 deb；
4. 重新启动 Bibit；
5. 确认主导航和设置子菜单不再出现 Agent Hub。

不得只删除 `/usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz` 就宣称卸载完成。无人值守卸载必须等待平台提供受支持的停用 CLI/API。

## 16. 分层验收方法

服务可达、插件被发现、插件已激活、Host capability 已授予、真实业务数据展示和真实设置持久化是不同证据，不能互相替代。

### 16.1 独立仓库构建

```bash
npm ci
npm test
npm run typecheck
npm run build:dev
npm run build:plugin
```

验收：

- 所有命令退出码为 0；
- package version 与 Manifest version 一致；
- Dev Host 同时列出 `Page · home` 和 `Settings · settings`；
- Mock 列表、空态、错误态和 Retry 可见；
- Mock 设置可以读取和保存；
- bundle 包含 `plugin.json`、`plugin.sig`、JS 和 CSS；
- `.bibit-keys` 和 `artifacts` 没有进入 Git。

### 16.2 Store 服务协议

使用真实服务验证：

1. `POST /bibit/v1/invoke` 可达；
2. 三个 v1 operation 均返回合法信封；
3. 响应回显请求 `requestId`；
4. `agents.list.v1` 返回直接数组；
5. `settings.update.v1` 后再次调用 `settings.get.v1` 得到持久化值；
6. 重启 Store 服务后设置值仍存在；
7. 非法 operation、超时、未授权和离线产生约定错误；
8. 日志不包含 token 或完整凭据。

### 16.3 Bibit 插件加载

验收：

- 目标 Bibit 信任正式 `keyId`；
- 系统目录只有预期 Agent Hub bundle；
- Bibit 插件管理页显示 `agent-hub@0.3.0` 已激活；
- 主导航出现 Agent Hub；
- 设置子菜单出现 Agent Hub；
- 选中设置页后全局“设置”页头和子菜单滚动不消失；
- 插件没有重复渲染 Settings Shell；
- 停用插件后 Agent Hub 两个入口消失，Bibit 其他页面仍可使用。

### 16.4 真实端到端数据链路

执行前记录：

```text
Agent Hub commit
Agent Hub bundle SHA-256
Agent Hub keyId
Bibit commit/version
Store service version
/etc/bibit/external-services.d/agenthub.json 的非敏感摘要及用户覆盖状态
/etc/bibit/feature-capability-grants.d/agenthub.json 的 capability 与 operation 列表
验收开始时间
```

执行：

1. 在 Store 服务准备一条唯一测试 Agent，例如 `acceptance-agent-20260826`；
2. 启动目标 Bibit，确认插件已激活且 `service:store` 或其 SDK v1 兼容能力已授予；
3. 打开 Agent Hub，确认唯一测试 Agent 的名称和描述来自真实 Store；
4. 停止 Store 服务，点击 Retry，确认只显示 Agent Hub 局部错误；
5. 确认 Bibit 对话、设置和其他页面仍可操作；
6. 恢复 Store 服务，点击 Retry，确认列表恢复；
7. 打开 Agent Hub 设置，修改 `showExperimental` 和 `refreshMinutes` 并保存；
8. 关闭并重新打开设置页，确认读取到保存值；
9. 重启 Bibit 和 Store 服务，再次确认设置值；
10. 保存 Store 服务按 `requestId` 关联的请求日志、Bibit 日志、页面截图和最终设置读取结果。

只有第 3、8、9、10 步共同成立，才能证明“真实功能已接通”。只看到端口可达、插件入口或 Mock 数据不算端到端接通。

## 17. 常见问题

### 插件已加载但主导航没有 Agent Hub

检查 Manifest 的 `pages.home`、`navigation.group`、Feature Module 的 `pages.home`、插件激活状态和重复 Feature ID。不要直接修改 Bibit 侧边栏清单。

### 设置页标题或菜单滚动消失

检查插件是否复制了 `HeaderPage`、`SettingsMenu` 或外层滚动容器。设置 renderer 只提供内容，宿主负责 Settings Shell。

### 页面显示 Store capability 不可用

依次检查 Manifest 的 `requiredHostCapabilities`、`/etc/bibit/feature-capability-grants.d/agenthub.json`、operation allowlist、Provider Registry 和插件是否运行在 `main` surface。不要回退到直接 `fetch`。

### Dev Host Mock 正常，真实服务失败

确认 URL 参数传入的是完整 `/bibit/v1/invoke` 地址，并检查浏览器 CORS。再核对 operation ID、DTO、HTTP 2xx、JSON 信封和 `requestId`。

### Bibit 中服务请求失败

确认 Bibit 配置使用的是 `baseUrl`，不要在 `baseUrl` 中重复写 `/bibit/v1/invoke`。检查 `authRef`、超时、HTTP 状态和 Store 服务日志。

### 返回成功但页面白屏

当前 `agents.list.v1` 必须返回数组。如果后端返回 `{ "items": [] }`，TypeScript 泛型不会在运行时转换它。修正后端 v1 响应，或发布新的 operation 版本并更新前端运行时校验。

### 更新后仍显示旧版本

检查两个版本号是否同时提升、系统目录是否存在多个 Agent Hub bundle、目标文件 SHA-256 是否正确，以及 Bibit 是否已重新启动并激活新版本。

### Release 报未知签名 key

开发环境使用匹配的 `BIBIT_PLUGIN_TRUST_STORE`。Release 环境必须由平台把正式公钥内置到 Bibit 并重新发布；Manifest 不能自行扩大信任。

## 18. 每次交付清单

模块团队交给平台维护者：

- Agent Hub 仓库 URL、分支和固定 commit SHA；
- 插件版本和目标 Bibit commit/version；
- Manifest、React、SDK 和可选 Feature UI 版本；
- operation ID、请求 DTO、响应 DTO 和错误语义；
- Store 连接要求和非敏感配置样例；
- 正式签名 bundle、SHA-256 和 key ID；
- 公司公钥登记申请及登记结果；
- 独立 Dev Host Mock 验收结果；
- 真实 Store Dev Host 验收结果；
- Bibit 插件加载、激活、停用和回退结果；
- 真实列表、设置持久化及重启后读取证据；
- 已知限制和可用回滚版本。

不要交付：

- 私钥；
- token、cookie 或真实凭据；
- 只有分支名而没有 commit 的链接；
- 未签名或使用开发 key 冒充正式发布的 bundle；
- 与目标 Bibit 不同版本的 React 或 SDK；
- 只能展示 Mock、无法证明真实服务路径的验收结论。

## 19. 当前已知边界

- v1 只支持 `desktop/main`；
- 当前插件只实现 Agent 列表和两个设置字段；
- 上传、下载、详情、分页、搜索和版本管理尚未实现；
- 当前列表和设置 DTO 已有运行时校验及最小契约测试；页面交互仍没有自动化组件测试；
- 当前 Demo 使用独立 CSS，尚未使用 `@bibit/feature-ui`；
- 当前 `locales` 只声明 `en`，页面文案仍直接写在组件中；
- 插件属于公司可信内部代码，不是不可信代码沙箱；
- 更新需要提升版本、重新签名并重新启动或刷新 Bibit；
- 删除系统 bundle 不会自动停用已激活版本；
- 当前平台没有无人值守停用插件的 CLI/API；
- 目标 Release Bibit 的信任库尚未登记 Agent Hub 正式公钥；
- 公司正式签名服务的具体调用 SOP 尚未由本仓库定义。
