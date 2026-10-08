# Bibit Agent Hub 插件开发与部署指南

本文面向 Agent Hub 模块开发者、平台维护者及负责实施的 Coding Agent。按照本文操作，可以在不编译完整 Bibit 的情况下独立开发 Agent Hub 前端，通过公开 Host API 连接模块团队独立部署的 Store 服务，并把签名插件作为系统组件安装到 Bibit。

## 1. 适用版本与当前交付

| 项目 | 当前版本 |
| --- | --- |
| Agent Hub 插件 | `0.3.16` |

| `manifestSchemaVersion` | `1` |
| `sdkApiVersion` | `1` |
| `@bibit/feature-contracts` | `0.4.0` |
| `@bibit/feature-sdk` | `0.4.0` |
| `@bibit/feature-plugin-sdk` | `0.4.0` |
| `@bibit/feature-dev-host` | `0.4.0` |
| React / React DOM | `19.0.0` |
| 构建用 Node（bundle 字节取决于它的 zlib） | `24.16.0`（`.nvmrc`、`package.json` `engines`、`scripts/check-node.mjs` 三处一致） |
| 已验证目标 Bibit | `b5387833927e052fe3728bc0631cef2df0138092`（`bianbu/0.1.8`，插件加载与商店链路） |
| 宿主语言支持 | 插件中英文文案跟随宿主 `language`；需要 `bi-bit` 0.1.4 及以上的宿主。插件已不声明 settings contribution，因此不再有设置菜单 `titleKey` |
| 新会话入口所需宿主 | 页头「创建资源」入口需要登记了 `conversation.compose` 的宿主：`conversation.compose` 的类型与 `host:actions` capability 只在 `@bibit/feature-*@0.4.0`（随 bibit 主线 `0e3d7b4f820f3a75c1ac549f4488c6f2fd45c91d` 发布）里，已发布的 `bi-bit`（板端 0.1.18、`bianbu/0.1.22`）只有 `conversation.create`，此时入口提示「当前宿主不支持发起会话」 |

> SDK 版本与宿主是绑定的：升级 vendor 时必须整套一起升，不能只升某一个包。


当前插件只提供一个贡献点：`pages.home`，显示在 Bibit 主导航的 Agent Hub 页面。它不包含语言设置项：页面中英文文案跟随 Bibit 系统语言（宿主传入 `language`），菜单、导航与描述键通过 `pluginLocales` 交给宿主解析。详细规则见 7.1。

当前 Demo 已实现 APC Power 展示与安装原型：通过 `powers.list.v1` 提供“我的 Power / Power 市场”两种数据范围、Agent / 类型 / tags 分层筛选、系列级卡片、卡片固定显示最新版本与每页 20 张卡片的分页，并配套 Local Preview；通过 `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` 提供详情查看与「安装 / 更新 / 降级 / 卸载」闭环（按选中版本与已安装版本的关系决定动作）。`powers.custom.list.v1` 在“我的 Power”里额外并入手动安装到各 Agent 目录下的自定义资源（卡片带 `Custom` 标记，版本槽是静态标签，不满足最低格式的目录以 warning 提示），`powers.upload.v1` / `powers.delete.v1` 提供卡片弹窗内的 APC 上传与本地删除；上传所需的 APC API Key 在页面内的「设置」标签页维护。页面一级标签为「我的 Power / Power 市场 / 设置」。设置标签是一个 **APC API Key 列表管理器**：输入框旁只有「保存 Key」一个动作，保存后 Key 以 `头****尾` 的遮蔽形式出现在列表里，每行各有独立的「启用」和「删除」（删除单击即执行，不做二次确认）；列表中任何时刻最多只有一个 Key 处于启用状态，它就是 `apm submit` 实际使用的凭据，列表为空时新建的第一个 Key 默认启用。删除当前启用的 Key 不会自动启用其它 Key，需要用户自己点。删除与卸载都需要弹窗内的二次确认；确认成功后弹窗关闭、回到列表，失败时弹窗保留并显示原因，安装成功后弹窗保持打开。Power 下载、提交审核、搜索等能力尚未实现，这些属于 Agent Hub 模块团队后续定制范围。

页头另有**「创建资源」入口**：点击后经 `host:actions` 的 `conversation.compose` 打开一个新会话，默认 Agent 不变，输入框里预填一段点名 `using-apm` 的草稿，**不发送**。用户补充需求后自己发送，由 bibit 内置的 `using-apm` skill 完成资源创建。该入口的降级规则见 §17「创建资源」入口变灰，或点击后提示不支持」一节。

该入口左侧还有一个**纯图标手动刷新入口**（`↻`，`aria-label`/`title` 为 `Refresh`/`刷新`）：只重取当前标签页的列表数据，保持当前筛选与页码，不跳页也不重置滚动；**「设置」标签页不渲染它**（该标签页读的是 `settings.get.v2`，刷新目录对它没有意义）。列表读取进行中时按钮 `disabled`——刷新会 abort 在途请求再重发，这与「窗口获焦不得打断在途读取」是同一条约束（§7.2）。

当前插件**不依赖** `@bibit/feature-ui`：页面用 `.agent-hub*` 命名空间内的自持 CSS 和原生控件，只通过 Bibit 主题 token 适配明暗主题。若某个贡献点以后需要 `FeatureSettingsPage` / `Button` / 状态组件等平台 UI，必须与 React 及其余 SDK 一起锁定升级该包，并在 vendor 里同步引入；不得直接导入 Bibit 私有 UI 源码。

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
  ├─ service:store（列表与设置）
  ├─ file:transfer（原生选择文件/保存位置，只返回 grantId）
  └─ job:manage（启动、进度、续订、取消）
       └─ Bibit Provider Broker -> AgentHub CLI Provider stdin/stdout
```

## 3. 仓库结构

```text
bibit-agenthub-plugin/
├── AGENTS.md
├── bibit.feature.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── dev/
│   ├── main.tsx
│   ├── store.ts          # wire 校验 + settings 内存 echo（密钥列表 + 遮蔽预览）
│   ├── sources.ts        # 与 Go 同语义的 APM/APC transport
│   ├── custom.ts         # 与 Go 同语义的自定义资源扫描/上传/删除
│   └── *.test.ts
├── src/
│   ├── feature.tsx
│   ├── plugin.tsx
│   ├── AgentHubPage.tsx
│   ├── agentHubI18n.tsx   # 中英文词典、Provider、语言 context、菜单 locales
│   ├── displayFields.ts   # V2 展示字段的语言回退（name_zh/name_en/description_zh）
│   ├── agentHub.css
│   ├── components/
│   │   ├── PowerCard.tsx / PowerFilters.tsx / PowerDetailsDialog.tsx / PowerPagination.tsx
│   │   └── AgentHubSettingsPanel.tsx   # 页面「设置」标签页内容（APC API Key 列表）
│   ├── api/
│   │   ├── contracts.ts          # 协议边界 DTO + wire 信封（含 custom/settings）
│   │   ├── apm.ts                # installed 解析/聚合（含 custom 合并）
│   │   ├── apc.ts                # market 解析
│   │   ├── customResources.ts    # 自定义资源读取/上传/删除客户端
│   │   ├── settingsClient.ts     # APC Key 读取/新增/删除/启用客户端
│   │   ├── powerCatalogClient.ts # 共享缓存客户端
│   │   ├── conversationCompose.ts # host:actions 预置新会话
│   │   └── catalogIntegrity.ts   # SHA-256 校验

│   └── components/
│       ├── PowerCard.tsx
│       ├── PowerDetailsDialog.tsx
│       ├── PowerFilters.tsx
│       └── PowerPagination.tsx
├── provider/                      # 纯 Go 标准库 module（v1）
│   ├── go.mod
│   ├── Makefile
│   ├── cmd/bibit-agenthub/        # 正式入口（含 --self-test）
│   ├── cmd/provider-probe/        # stdio 驱动
│   └── internal/provider/
├── debian/
│   ├── control                    # plugin(all) + cli(any)
│   ├── rules
│   ├── changelog
│   ├── agenthub-provider.json     # Registry v2 drop-in（含 credentialParameters）
│   ├── agenthub-feature-grants.json  # capability + operation grant（安装为系统 drop-in）

│   └── vendor/                    # 公司签名 bundle（不提交）
├── vendor/                        # bibit-feature-* tarball（锁定版本）
├── .bibit-keys/                   # 忽略
├── artifacts/                     # 忽略
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
| `vite.config.ts` 的 automatic JSX runtime | SDK 源码包兼容基线 | 保留 `esbuild.jsx = automatic`，防止源码形式 UI SDK 生成未定义的全局 `React` | 平台构建器不再分发 TSX 源码时 |
| `.gitignore` 对 `.bibit-keys/` 的排除 | 安全边界 | 不删除、不反向提交密钥 | 不允许例外 |
| Manifest 的 `manifestSchemaVersion`、`sdkApiVersion`、`id` | 公共身份契约 | 当前保持 `1`、`1`、`agent-hub` | 平台升级 Schema/API，或经过迁移评审创建全新 Feature |
| Manifest 的 `requiredHostCapabilities` | 最小授权契约 | 当前保留 `service:store`、`file:transfer`、`job:manage`，不把 operation、URL 或 command 当 capability | 平台发布新的公共能力时 |

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
| `src/AgentHubPage.tsx` | 列表、搜索、筛选、详情入口、上传/删除入口、空态、错误态 | 只通过 Host capability 获取数据；卸载时取消请求 |
| `src/components/AgentHubSettingsPanel.tsx` | 「设置」标签页内容：APC 凭据字段、校验、保存状态 | 只渲染页内 `section`（不能是 `main`，不能自带滚动容器），不回显已保存的凭据 |
| `src/agentHub.css` | 页面与页内面板样式 | 不覆盖 Bibit 全局选择器，不依赖宿主私有 class |
| 业务 DTO 和 operation ID | 请求参数、返回数据、错误语义、版本 | 破坏性变更发布新 operation 版本 |
| `dev/main.tsx` | Mock 数据、Mock operation、真实开发服务地址注入 | Mock 必须与生产 DTO 一致；不得导入生产插件包 |
| Manifest `display` | 标题、说明、合法 icon | `iconKey` 只能使用平台 Schema 已允许的 token |
| Manifest `navigation` | 合法 group 和排序 | 主页面用页面允许的 group；插件当前不声明 settings contribution，故不再使用设置页的 group |
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
| 改页面布局、列表、详情或交互 | `src/AgentHubPage.tsx`、`src/components/*`、`agentHub.css` | `plugin.tsx`、SDK vendor、Bibit 私有页面 |
| 自定义资源的可见范围或最低格式 | `provider/internal/provider/custom.go`、`dev/custom.ts`、两边对应的测试 | 放宽上传门槛（上传仍由 `apm validate` 按 v2 判定）、把路径放进 `params` |
| 改设置字段或校验 | `AgentHubSettingsPanel.tsx`、DTO、Store operation、Mock、Registry `credentialParameters`（仅当字段是凭据） | 宿主 Store、在页面里回显已保存的凭据 |
| 新增后端能力 | 模块 DTO、带版本 operation、Store 服务、Mock、`debian/agenthub-feature-grants.json` 的 grant | 直接 `fetch`、Tauri command、未在 Registry `credentialParameters` 声明的凭据字段 |
| 新增 Agent Hub 内部详情路由 | 页面组件和 `FeaturePageProps.navigation` | Bibit Router、全局 URL 前缀、主侧边栏源码 |
| 需要跨 Feature 行为（打开会话、跳宿主界面、交接上下文） | Manifest 声明 `host:actions`、drop-in grant、调用登记动作（见 §9.1） | Feature 内导航、localStorage/URL 传状态、直接调 Tauri command |
| 新增主页面或设置贡献点 | 组件、`feature.tsx`、Manifest 三者同步 | 只改 Manifest 或只改 Feature Module；也注意 `contributions.settings` 必须存在（可为空数组） |

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
  "version": "0.3.16",

  "owner": "agent-hub-team",
  "display": {
    "titleKey": "agent-hub:title",
    "fallbackTitle": "Agent Hub",
    "iconKey": "store",
    "descriptionKey": "agent-hub:description",
    "fallbackDescription": "Browse and manage Agent packages"
  },
  "targets": ["desktop"],
  "requiredHostCapabilities": ["service:store", "host:actions"],
  "contributions": {
    "pages": [
      {
        "id": "home",
        "path": "",
        "surfaces": ["main"],
        "navigation": { "group": "library", "order": 100 }
      }
    ],
    "settings": [],
    "conversation": [],
    "locales": ["en", "zh-CN"]
  }
}
```

### 6.2 当前 Feature Module

```tsx
import type { FeatureModuleV1 } from '@bibit/feature-sdk'
import { AgentHubPage } from './AgentHubPage'
import { agentHubLocales, withAgentHubI18n } from './agentHubI18n'

// 当前只导出页面贡献点。`contributions.settings` 在 Manifest 里保留为空数组
// （宿主 Schema 要求该键存在），Feature Module 则完全不带 `settings`。
export const featureModule: FeatureModuleV1 = {
  sdkApiVersion: 1,
  locales: agentHubLocales,
  pages: { home: withAgentHubI18n(AgentHubPage) },
}
```

`src/plugin.tsx` 额外导出宿主读取的菜单资源：

```tsx
export { agentHubLocales as pluginLocales } from './agentHubI18n'
```

`withAgentHubI18n` 只注入语言 Provider，不引入 `key`，因此语言切换不会重挂载页面或重新发起请求。

必须始终满足：

```text
Manifest id = agent-hub
Manifest pages 中的 id = FeatureModule.pages 的 key
Manifest settings 中的 id = FeatureModule.settings 的 key
Manifest sdkApiVersion = FeatureModule sdkApiVersion
Manifest version = package.json version
Manifest contributions.locales = FeatureModule.locales 的 key（且必须包含 en）
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
  if (subpath.startsWith('powers/')) {
    const powerName = subpath.slice('powers/'.length)
    return (
      <section>
        <button type="button" onClick={() => navigation.back()}>
          Back to catalog
        </button>
        <h1>Power detail</h1>
        <p>Power name: {powerName}</p>
      </section>
    )
  }

  return (
    <section>
      <h1>Power catalog</h1>
      <button
        type="button"
        onClick={() => navigation.push('powers/incident-helper')}
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

### 7.1 多语言（跟随 Bibit 系统语言）

插件不提供语言设置项。页面中英文文案跟随宿主传入的 `language`（`en` 或 `zh-CN`），菜单、导航与描述键通过 `pluginLocales` 交给宿主解析。

**源语言是英文。** 字典只把英文源串映射成中文，因此：

- 组件里写英文源串：`const t = useAgentHubI18n()` 后 `t('Install')`、`t('Installed {version}', { version })`；
- 产品名保持不译：Agent Hub、Power、Agent、bibit、skill / plugin / mcp 等类型名不进字典；
- 字典缺少条目时回落英文源串，不会渲染空标签；
- 宿主不传 `language`（0.1.4 之前的宿主）时页面就是英文。

词典位置与用法：

```text
src/agentHubI18n.tsx
├── agentHubChinese        # 英文源串 → 中文，唯一词典
├── agentHubLocales        # en / zh-CN 的菜单、描述、设置菜单标题
├── AgentHubI18nProvider   # 读取宿主 language
├── useAgentHubI18n        # 身份稳定的 t（useRef + useCallback）
└── withAgentHubI18n       # 给页面/设置 contribution 注入 Provider
```

**数据层不保存语言。** `src/api/operationMessages.ts` 的 operation 文案和 `installationStore` 的 notices 都是 `TranslatableText { text, values? }`：英文源串加占位符值，在渲染边界才翻译。这样安装状态、缓存与写互斥都不持有所在语言，切换语言不会改变状态机语义。

**展示信息也随语言切换。** Power 资源的 V2 展示字段（`name_zh`/`name_en`/`description_zh`）是数据而非文案，因此不进词典，而是由 `src/displayFields.ts` 的 `resolvePowerTitle` / `resolvePowerDescription` 按当前语言解析（语言由 `useAgentHubLanguage()` 读取，与翻译器同一份规范化值）：

| 语言 | 标题 | 描述 |
| --- | --- | --- |
| 中文 | `name_zh` → `name_en` → `name` | `description_zh` → `description` |
| 英文 | `name_en` → `name` | `description`（英文界面不显示中文） |

`name`/`description` 始终是回退项，所以 V1 资源（无展示字段）渲染结果与升级前一致；`name` 继续用于请求、安装状态比对、缓存键与 React key，展示名不参与任何身份判断。apm `list --json` 与 APC 目录尚未输出这三个字段（APM ADR-038 明确不改 `list`/`show` 输出），解析层已容忍其缺失，上游就绪后无需再改前端。

**语言切换不得重挂载。** 不要在 Provider 子树或页面上加 `key`，也不要把 `language` 放进列表请求的 effect 依赖；`withAgentHubI18n` 只更新 context，页面保持组件身份与在途请求。`src/AgentHubPage.test.tsx` 有对应回归：切换语言后 `powers.list.v1` 请求数不变、已打开的详情弹窗与已选版本保持不变。

**新增文案的顺序：**

1. 组件里写英文源串并使用 `t(...)`；
2. 在 `agentHubChinese` 增加同串中文（键必须是源码中出现过的字面量，`src/agentHubI18n.test.tsx` 会校验，防止拼写错或残留键）；
3. 若是菜单、导航或描述文案，同步更新 `agentHubLocales` 与 `bibit.feature.json` 的 `contributions.locales`、`titleKey` / `fallbackTitle`；
4. 在对应组件的语言切换测试里确认中英文两种渲染。

Local Preview 使用 `?lang=zh-CN` 打开中文界面，`dev/main.tsx` 右上角的下拉框可以在不刷新页面的情况下切换语言。

### 7.2 页面布局与滚动（页面自己持有滚动条）

页面 contribution 渲染在 `<SidebarInset>` → `<div class="size-full">` → `FeatureContributionHost` 的 `h-full min-h-0` 包装节点里，而 `SidebarInset` / `SidebarProvider` 只有 `min-h-svh`（**没有确定高度**），`html, body, #root` 又是 `height: 100%; overflow: hidden`（窗口级裁切）。**因此百分比高度在页面里解析不出确定值：页面只会随内容变高，`overflow` 永远不触发，超出窗口的内容直接不可达。**

规则：

- 页面根元素必须用**视口单位**给高度，而不是百分比：`.agent-hub` 用 `height: 100svh`（`100vh` 兜底），再 `overflow-y: auto`；宿主自己的全高页面（如设置路由的 `h-svh`）就是这么做的。**页面的宽度盒不是整个窗口**：`Sidebar` 的侧栏本体是 `fixed`，但同一个组件里还有一个 `h-svh w-(--sidebar-width)` 的「占位」div 留在文档流里（`hidden md:block`，`md` 以下侧栏变成浮层 Sheet），`SidebarInset` 又是 `flex-1`，所以页面盒 = 窗口 − 15rem 侧栏 − 未最大化时窗口外框的 2px 边框；卡片宽度就是按这个盒子算的（见下一条与 §7.2 的令牌）；
- 视口单位只是兜底：`AgentHubPage` 用 `useLayoutEffect`（绘制前）量出真实可用高度 `window.innerHeight - rect.top` 写成内联 `height`，并在窗口 resize 时重算，这样不依赖“页面区域正好等于窗口”这个假设；
- 一页最多 20 张卡片（`POWER_PAGE_SIZE` 由契约锁定为 20），所以列表长度必须由页面滚动兜住，分页控件用 `position: sticky; bottom: 0` 常驻窗口底部；
- **卡片宽度由 BiBit 默认窗口推导，窗口只改变列数**：`.agent-hub` 用令牌声明宿主几何 `--hub-default-window: 1200px`（`bibit/src-tauri/tauri.linux.conf.json`）、`--hub-host-sidebar: 15rem`（`SIDEBAR_WIDTH`，即 240px）、`--hub-host-frame: 2px`（未最大化时窗口外框的 1px 边框 × 2）、`--hub-page-padding: 48px`（该窗口下 `clamp(20px, 4vw, 56px)` 的取值）与列间距 `--hub-card-gap: 20px`，并由此推导卡片宽度 `--hub-card-width: calc((1200px − 15rem − 2px − 2 × 48px − 3 × 20px) / 3)` = **267.33px**：默认窗口的页面盒 = 1200 − 240 − 2 = 958px，减去两侧 48px 内边距后内容列 862px，3 张卡片 + 2 个间距只要 842px，余下 20px 就是「默认窗口一律 3 列」的余量（实测两侧各空 10px）；内容列上限 `--hub-content-max: 1460px` 不动，`1460 ≥ 5 × 267.33 + 4 × 20 = 1417`，所以全屏仍然 5 列。**这两处数字是绑定的**：改成 276px（旧的「全屏 5 列尺寸」）时默认窗口只剩 2 列、两侧各空 144px，正是用户第二轮反馈的现象；`src/agentHubLayout.test.ts` 会把 `calc()` 展开后断言默认窗口必须正好 3 列。`.agent-hub__grid` 用 `repeat(auto-fill, minmax(min(var(--hub-card-width), 100%), var(--hub-card-width)))` + `justify-content: center`：窗口变窄只减少列数，卡片宽度不变；`auto-fill` 保留空轨道，所以网格块整体居中而每一行（含不满的最后一行）都从该块左缘开始排列；**不再有按断点改列数的 `@media` 规则**。`min()` 只在窗口窄于一张卡片（内容列 < 267px，即窗口约 <300px，远低于目标最小窗口 1024×740）时生效，那时卡片降到可用宽度而不是被 `overflow-x: hidden` 裁掉（实测 300px 窗口仍是 267.33px，299px 起才开始降）。回归前卡片宽度会随窗口漂移（本机实测 1600→232.8px、1440→200.8px、1276→170px、1024→159.5px、400→368px），这也是 custom 卡片错位的成因之一；
- 卡片右上角的版本槽是一个**静态标签**，显示该系列当前的最新版本（自定义资源显示其声明版本，没有则 `No version`）。版本选择只在详情弹窗里做，卡片本身不可选。`.power-card__version` 用 `display: inline-flex` + `align-items: center` + `justify-content: flex-end` + `min-height: var(--hub-version-height)` + `max-width: 112px` + `overflow: hidden` 占满一个固定盒子：所有卡片共用同一个类，所以头部高度天然一致，`min-height` 与 `overflow: hidden` 只是兜住极长版本不把标题与描述挤到别行（`text-overflow` 对 inline-flex 盒无效，只做裁切；真实数据最长约 99px）。`--hub-version-height` 仍保留 31px（原来是为对齐原生 `<select>` 实测的高度），目的是让卡片度量不因这次改动而变化；自定义资源的外观改由 `.power-card[data-source='custom'] .power-card__version` 承担（虚线 + 玫红）；
- 卡片头部的排布：`.power-card__type` 吃下剩余空间（`margin-right: auto`），徽标与版本槽因此从右往左紧排。**不能**给每个徽标各加 `margin-left: auto`——两个徽标会平分空白、把 `New` 与 `Installed` 推开；
- 卡片高度不能跟着描述长度走：APC 目录里的描述从 1 行到 14 行都有，`.power-card__description` 是固定 5 行（`7.5em`，行高 21px）的无边框滚动区，`overflow-x: hidden` 且长词换行，完整描述在详情弹窗里看；
- 卡片标题（Power 名字）**不换行**：`.power-card h2` 固定 `height/line-height: 26px`（所有卡片的标题行等高，卡片网格才能对齐）、`white-space: nowrap` + `text-overflow: ellipsis`，字号由 `src/useFittedFontSize.ts` 在 19px（上限）与 13px（下限）之间按“文本自然宽度 / 盒子宽度”线性反解——一行文本的宽度与字号成正比，所以量一次就够；`ResizeObserver` + `window.resize` 负责列数变化时重算，`clientWidth` 为 0（jsdom 或尚未排版）时保持样式表里的 19px。卡片宽度固定为 267.33px 后，标题盒内宽恒为 229px，开发板实测真实目录里最长的 `foo-before-summary`（19px 下 193px）与 `markdown-maker`（165px）在任何窗口都完整显示且保持满号 19px；构造出的超长名字才会落到 13px 下限并被省略号截断；
- 滚动条统一成“静止时不显示、滚动时显示位置”，但**不能靠 CSS 改平台滚动条**（下面 7.2.3 是开发板上实测结论），而是由插件隐藏原生滚动条（`scrollbar-width: none`，这是插件能设的属性）并在滚动区内画一个 `<ScrollThumb>`：按 `client/scroll` 比例算长度与位置、8px 圆角（颜色取 `--hub-thumb`，明暗各一档）、`pointer-events: none`，滚动时显示、停止 1s 后淡出；页面大滚动条、卡片描述区、卡片标签行、筛选标签行、详情弹窗内容区都是这一套，`ScrollThumb` 的 `targetRef` 必须指向它所在的那个滚动容器；
- 换了查询（翻页、范围、Agent、类型、tags）后要把页面滚动位置归零；
- `src/agentHubLayout.test.ts` 以文本级契约守住以上几条（jsdom 没有排版引擎，这是唯一的自动化防线），`src/AgentHubPage.test.tsx` 守住量高与回顶两条行为。

#### 7.2.1 跟随宿主明暗主题（`light-dark()`，不是 `.dark` 后代选择器）

宿主切换主题时做的是**两件事**：给 `<html>` 加 `class="dark"`（`web-app/src/providers/ThemeProvider.tsx` 的 `document.documentElement.classList.toggle('dark', isDark)`），并在 `.dark` 上把 `color-scheme` 切成 `dark`（`web-app/src/index.css`）。`<html>` 上的 `class` 因此**不在插件根节点内部**，这一点决定了插件只能用哪种写法：

| 写法 | 结果 |
| --- | --- |
| `--x: light-dark(a, b)`，由继承来的 `color-scheme` 决定取哪一支 | ✅ 正确。`color-scheme` 是可继承属性，`light-dark()` 读它，插件根节点天然继承 `<html>` 的值；宿主样式隔离只给选择器**加前缀**，不碰声明值，所以 `light-dark()` 原样穿过隔离与打包（已核对：`bibit-plugin build` 产出的 `dist/agent-hub-plugin.css` 里 58 个 `light-dark()` 全部保留） |
| `.dark .agent-hub { ... }` | ❌ 永不生效。宿主把插件样式重写为 `:where(<plugin-root>) <原选择器>`（`trustedPluginStyles.ts` 的 `isolatePluginStyles`），于是这条变成 `:where(<plugin-root>) .dark .agent-hub`——它要求 `.dark` 是插件根的**后代**，而实际上 `.dark` 在 `<html>` 上、是祖先。用真实算法跑过：`.dark .agent-hub` → `:where(bibit-agent-hub-page-home) .dark .agent-hub` |
| `@media (prefers-color-scheme: dark)` | ⚠️ 只在宿主自己跟随系统时凑巧正确。宿主的主题是**权威值**（Linux 走 XDG Desktop Portal 的 `color-scheme`，还有用户显式选择与 Tauri 广播），与 `prefers-color-scheme` 可以不一致（用户手动选深色而系统是浅色时就会错） |
| 插件自己读 `matchMedia` 并加 class | ❌ 另一套真值来源，必然与宿主不同步，还要在插件根上写 `color-scheme`（等于覆盖宿主 token） |

因此约定是：

- **所有颜色都写成 `light-dark(浅色, 深色)` 成对声明**，集中在 `.agent-hub` 的 token 段（`--hub-bg`、`--hub-surface`、`--hub-text`、`--hub-muted`、`--hub-border`、四个语义色系、四个 type 色系等）。浅色一支就是明色主题下原样的设计值；深色一支按「保持色相、提高明度直到对深色表面达到 4.5:1」推导；
- **不得在任何规则体里写裸颜色字面量**。写一个 `#fff` 就等于把那个元素钉死在明色主题；`src/agentHubLayout.test.ts` 会把每个 `light-dark(...)` 剥掉后检查剩余字面量为空，并断言所有颜色型 token 都是成对声明；
- 唯一允许的单值 token 是 `--hub-on-primary`（品牌蓝上的白字，两种主题下分别是 5.81:1 / 6.61:1，成对声明只是噪声），测试里显式豁免；
- 语义色也走 token：`--hub-status-*`、`--hub-error-*`、`--hub-install-*`、`--hub-uninstall-*`、`--hub-scope*`、`--hub-option-*`、`--hub-shadow*`、`--hub-backdrop`、`--hub-version-chip`。渐变、阴影与 `::backdrop` 里的 `light-dark()` 都已实测生效（`::backdrop` 既能直接写，也能读自定义属性）；
- 宿主若不设置 `color-scheme`，`light-dark()` 按 `normal` 解析，取**浅色**一支——也就是本插件 0.3.14 之前的行为，因此对老宿主是安全的降级，不是坏掉。

验证方式：`docs/verification/probe-dark-mode.py` 用离屏 WebKitGTK 把同一份页面在 `light` 与 `color-scheme: dark` 两种状态下各渲染一次，读回 `getComputedStyle` 与 `::backdrop` 的颜色，断言表面色确实翻转、正文对比度 ≥ 4.5:1、且自定义资源的色相与 MCP 至少差 40°（见 §7.2.2）。

#### 7.2.2 自定义资源的色相必须与 MCP 分开

自定义资源（`data-source="custom"`）原先用琥珀色 `#d9a13b` 作为强调色。它和 MCP 的橙色 `#a95e16` 在 OKLCH 色相上只差 **21°**，而且两张卡片的填充色（custom `#fdf6e6` 与 mcp `#fff6eb`）只差 **0.7 ΔE** ——并排看几乎是同一种颜色，用户因此反馈“自定义资源的颜色应与 MCP 区分”。现在自定义资源改用玫红家族（OKLCH 色相 **345°**）：离 MCP 73°、离最近的邻居（skill 的紫）57°；填充色与 MCP 的差 3.2 ΔE。色相只是“别再撞色”，识别手段仍然是自定义卡片独有的**虚线边框 + `Custom` 徽标**。`src/agentHubLayout.test.ts` 会断言该 token 的色相与四个 type 色相均相距 40° 以上、明暗两支色相一致，并禁止琥珀色字面量回归；探针在两种主题下都比较徽标、卡片边框与卡片填充。

#### 7.2.3 为什么不能用 CSS 控制滚动条（WebKitGTK 2.52 实测）

在开发板（`bianbu@10.0.91.51`，WebKitGTK 2.52.0 + GTK 3.24，Yaru 主题，`gtk-overlay-scrolling=True`）上用一个离屏 `WebKit2.WebView` 渲染探针页面、直接读快照像素得到：

| 写法 | 结果 |
| --- | --- |
| `::-webkit-scrollbar { width: 10px }` + `::-webkit-scrollbar-thumb { background: red }` | 生效，8/10px 槽位 + 纯红 thumb ✓ |
| `::-webkit-scrollbar-thumb { background: transparent }` | 生效（什么都不画，滚动条不可见）✓ |
| `scrollbar-color: red yellow` | **完全被忽略**（thumb 仍是主题灰 `#cccccc`）✗ |
| `scrollbar-width: none` | 生效：不画、不占槽位 ✓ |
| `scrollbar-width: thin` | 生效：等同原生 overlay 条（不占槽位），无操作数秒后自己淡出 ✓ |
| 运行时把 `none` 翻成 `thin`（或翻 `[data-x]` 的伪元素颜色） | **永不重绘**：翻完再滚动也还是不画 ✗ |

而宿主自己的全局样式（`web-app/src/index.css`）给**所有元素**设了 `* { scrollbar-width: thin; scrollbar-color: oklch(...) }` 加一组全局 `::-webkit-scrollbar`：按规范，`scrollbar-width` 只要不是 `auto`，`::-webkit-scrollbar` 规则就全部失效——所以插件写的任何 `::-webkit-scrollbar` 都是死代码，这就是之前两次“改滚动条”在真实 GUI 里毫无变化的原因。

结论：平台滚动条**无法**做到“静止隐藏、滚动时出现”，插件只能自己画（见上），或者在原生 overlay 条（宿主的 thin）下接受系统的淡出时机。

Local Preview 的 `dev/devHostViewport.css` 去掉 Dev Host 的 stage 内边距与页头，让预览画布从视口顶部开始、正好一个视口高，等价于宿主给插件的那个盒子——否则预览里的吸底分页会掉到可见区域之外，看不出真实效果。

#### 7.2.4 Agent 切换控件（标签栏最右侧，唯一真值来源）

Agent 的选择只有一处：标签栏（`.power-filters__scopes`）最右侧的独立控件。它由 `src/components/AgentSwitcher.tsx` 渲染，文本就是当前 Agent（默认 `bibit`），随选择改变。

- **不是标签页**：`我的能力` 退化成一个普通标签按钮（只切 scope），不再在 hover/点击时弹出 Agent 菜单，也没有 `aria-haspopup`。控件本身带 `aria-haspopup="menu"` / `aria-expanded` 而**不带** `aria-pressed`，语义上不会和标签页混淆；DOM 上三个标签同属 `role="group" aria-label="范围"` 的 `.power-filters__tabs`，控件是它的兄弟节点。
- **hover 与点击都能展开**：鼠标移入即展开、移出即收起；点击触发器只展开、不做 toggle（鼠标用户已经用 hover 展开过了，toggle 会读成「点一下反而关掉」）。键盘同样可达：焦点落在触发器上即展开、`ArrowDown`/`ArrowUp` 在选项间循环、`Escape` 关闭并把焦点还给触发器。焦点归还时会重入包装层，代码用一个 `suppressFocusOpenRef` 阻止它把菜单又开回来。
- **三个标签页都在**：控件常驻标签行，`设置` 页也显示。设置页本身不发 `powers.list.v1`，所以在那里切换不产生请求、也没有可见变化；它决定的是下次进入目录时读取哪个 Agent（以及安装目标）。
- **清空筛选只在真正相关时发生**：只有 `installed` 的列表按 Agent 读取，因此在 `installed` 下切换 Agent 会重置页码/标签/snapshot；`market` 的目录与 Agent 无关（请求体不带 `agent`），在市场上切换**不重发请求、也不清掉用户已选的标签**，只改变安装目标。
- **`Expert`（`agent` 类型）只在 bibit 下出现**：`agent` 类型的 Power 只能装进 bibit，所以选中其它 Agent 时类型筛选行根本不渲染 `Expert`。这条规则集中在 `src/api/contracts.ts` 的 `powerTypesForAgent`（`supportsAgentType` 是它的原语），两处 wire 目标校验与详情弹窗的「能否安装」读的是同一处，不再各写一遍。切换 Agent 时如果当前类型正好是被隐藏的那个，类型会回退到该 Agent 支持的第一个类型（`skill`），并按一次显式类型切换重置标签/页码/snapshot——否则列表会停在一个用户既看不见、也切不走的类型上。
- **市场卡片可以有两个徽标**：`Installed` 表示该 Agent 装了它，`New` 表示目录里的最新版本比装的那版更新（两个同时出现时 `New` 在 `Installed` 左侧）。`New` 只在已安装时出现，因为「比你手上的新」离开已安装版本就没有意义；
- **市场卡片显示 `Installed` 徽标**：市场列表与 Agent 无关（wire 请求不带 `agent`），所以徽标读的是**目标 Agent 的安装清单**（快照里的 `fullLists`，按 Agent 存）——页面进入市场/切 Agent/窗口聚焦时预载一次。徽标是**版本无关**的：装了任意版本就算已安装（卡片固定显示目录里的最新版本，具体装的哪一版看详情弹窗的 `已安装 {version}`）。installed 页不加这个徽标（那里的卡片按定义都已安装）。清单读取失败时市场仍可用，只是没有徽标。
- **详情弹窗只读显示 Agent**：弹窗不再提供 Agent 选项（它本身是 `showModal()` 模态，用户也够不到标签栏上的控件）。`agent` 类型遇到非 bibit 目标时仍显示「该类型仅支持 bibit Agent。」并隐藏安装按钮，但不再有「切换到 bibit」的纠正按钮——要换 Agent 请关闭弹窗、用控件切换。
- 实现上 `dialogAgent` 这个第二份 state 已删除：列表查询、弹窗、安装/卸载、自定义资源的上传与删除全部读同一个 `agent`。

## 8. 设置内容开发（页面内「设置」标签页）

当前插件**不声明 settings contribution**：`contributions.settings` 是空数组，Feature Module 里也没有 `settings`。这是刻意的产品决定——原先的设置页只有 APC 凭据一个真实字段，其余两个（`showExperimental`、`refreshMinutes`）没有任何消费方，因此设置内容改为 Agent Hub 页面一级标签中的第三个标签，与「我的 Power」「Power 市场」并列。

随之而来的可见变化：Bibit 设置子菜单里不再有「Agent Hub 设置」条目，`agentHubLocales` 也不再提供该菜单的 `titleKey`。宿主对空 settings 数组的处理已经过源码核对（`registry.ts` 的 `makeContributions('settings')`、`trustedPluginLoader` 的 `expectedElementTags`/`registerSettings`、SDK 的 `registerGroup` 在空 id 列表上都是 no-op）。若旧 manifest 仍被宿主缓存，重启 GUI 即收敛（安装脚本已包含）。

页面内的「设置」标签页由 `src/components/AgentHubSettingsPanel.tsx` 渲染，约束与页面其他区块一致：

- 根节点是 `section`，不得使用 `main` 或 `role="main"`（页面本身已经是一个 `main`）。
- 不得自带滚动容器：`.agent-hub` 是页面唯一的滚动容器，面板不得声明 `overflow-y`、`height` 或 `max-height`（`src/agentHubLayout.test.ts` 有对应断言）。
- 标签切换即挂载/卸载：设置读取随卸载取消（`AbortController`），新增/启用/删除三个写入也随卸载取消，切回目录标签时重新读取。

设置值由 Store 服务持久化，插件不能把生产设置只保存在 React state、`localStorage` 或 Bibit 私有 Store 中。

当前 DTO：`settings.get.v2` 读列表，三个写入各管一件事。

```ts
interface AgentHubSettingsKeyV1 {
  id: string        // Provider 生成的 128-bit hex 句柄，页面只能拿它做启用/删除
  preview: string   // 头****尾，必须含 mask，否则前端按不兼容拒绝
  enabled: boolean
}

interface AgentHubSettingsV1 {
  showExperimental: boolean
  refreshMinutes: number
  keys: AgentHubSettingsKeyV1[]
}

interface AgentHubSettingsKeyAddV1 { apiKey: string }
interface AgentHubSettingsKeyTargetV1 { id: string }
```

operation 与超时（全部 30 s，都是短写入）：

| operation | 入参 | 结果 |
| --- | --- | --- |
| `settings.get.v2` | `{}` | `AgentHubSettingsV1` |
| `settings.keys.add.v1` | `AgentHubSettingsKeyAddV1` | `AgentHubSettingsV1` |
| `settings.keys.delete.v1` | `AgentHubSettingsKeyTargetV1` | `AgentHubSettingsV1` |
| `settings.keys.enable.v1` | `AgentHubSettingsKeyTargetV1` | `AgentHubSettingsV1` |

结果里永远没有 Key 本身，只有 `preview`：遮蔽在 Provider 侧完成（`MaskAPIKey`），前端 `parseSettingsView` 还会再拒绝不含 `****` 的 `preview`、重复 `id` 和超过一条 `enabled`，所以一次后端 bug 不会变成屏幕上的凭据。`apiKey` 属于宿主 `credentialParameters` 声明范围，必须同时在 Registry drop-in 的 `settings.keys.add.v1` 下声明。

启用语义由 Provider 决定，页面只回显：

- 列表为空时新增的第一个 Key 自动启用；已有 Key 时新增的 Key 一律 `enabled: false`，添加不会偷偷换掉正在使用的凭据。
- `settings.keys.enable.v1` 把目标 Key 置为唯一启用项。
- `settings.keys.delete.v1` 删除当前启用的 Key 后**不**自动启用其它 Key；此时 `SettingsAPIKey` 返回 `unauthorized`，上传提示未配置，直到用户自己点「启用」。
- 上限 `SETTINGS_MAX_KEYS = 50`，重复 Key 被拒绝（`incompatible`）。

`showExperimental` 与 `refreshMinutes` 仍是 `settings.get.v2` 结果里的字段，但**没有任何消费方**，也不再有写入入口：面板读取后原样忽略，不要为了「对称」给它们加回无效果的控件或恢复 `settings.update`。

模块团队增加字段时必须同时更新：

1. DTO 定义和运行时校验（`src/api/contracts.ts`）与客户端（`src/api/settingsClient.ts`）；
2. `AgentHubSettingsPanel.tsx`；
3. `settings.get.v2` 与 `settings.keys.*.v1` 的 Provider 实现；
4. `dev/store.ts` Mock；
5. 迁移和默认值规则；
6. 真实服务保存后重新读取的验收（切换标签离开再回来）。

存储迁移：Provider 的 `settings.json` 从 v1（单个 `apiKey`）升到 v2（`apiKeys: [{id,key,enabled}]`）。读到 v1 文件时在内存里迁移成「一条已启用记录」，下一次写入落成 v2；v2 文件里再出现 `apiKey` 字段会被拒绝，不做静默修复。

`showExperimental`/`refreshMinutes` 这两个无消费方字段若将来要被消费，先实现行为，再加回控件。若字段变化不能向后兼容，应发布新版本的 `settings.get.v3` 等，并保留明确迁移窗口。

如果将来重新引入 settings contribution（例如设置项多到需要独立页面），仍需遵守 Bibit 的 settings content 契约：根节点用 `section`/`div` 且能收缩到宿主内容区（`width: 100%; min-width: 0; max-width: 100%`），不复制 `HeaderPage`、`SettingsMenu`、全局「设置」标题、宿主内容滚动容器或返回按钮。完整契约见目标 Bibit 仓库的 `docs/feature-sdk/settings-content-contract.md`。

## 9. Host API 使用规则

获取 Store capability：

```tsx
const store = useFeatureCapability('service:store')
```

发起请求：

页面只通过 `src/api/powerCatalogClient.ts` 的 `listPowers` 发起业务数据请求，它封装了请求投影与运行时校验：

```tsx
const controller = new AbortController()

const result = await listPowers(store, input, controller.signal)
// listPowers 内部调用 store.request({
//   serviceId: 'store',
//   operationId: 'powers.list.v1',
//   params: toListPowersParams(input),
//   timeoutMs: 30_000,
//   signal: controller.signal,
// })
// 并对返回的 powers.list.v1 结果执行 parseListPowersResult 闭集运行时校验。
```

组件卸载时执行：

```tsx
return () => controller.abort()
```

失败路径与五条铁律：

- capability 不存在时显示 Agent Hub 局部错误，不直接回退到 `fetch`；
- `serviceId` 固定为 `store`；
- `operationId` 必须带版本，页面数据使用 `powers.list.v1`，详情/安装/卸载使用 `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1`，自定义资源使用 `powers.custom.list.v1` / `powers.upload.v1` / `powers.delete.v1`，设置为 `settings.get.v2` / `settings.keys.add.v1` / `settings.keys.delete.v1` / `settings.keys.enable.v1`；
- `params` 必须是 JSON object，由 `toListPowersParams` / `parsePowerTarget` / `parseInstallInput` / `parseCustomListInput` / `parseUploadInput` / `parseDeleteTarget` / `parseSettingsUpdate` 投影为字段闭集；
- timeout 必须在 `1..300000` 毫秒内；读取默认 30000 毫秒，写入（安装/卸载/上传/删除）默认 120000 毫秒；
- 路径绝不进入 `params`：自定义资源只传 `(agent,type,name[,message])`，由 Provider 解析并重新校验路径；
- 单个请求最大 1 MiB，单个响应最大 4 MiB；正式发布前必须验证 `powers.list.v1` 单响应不超过 Host 的 4 MiB 上限；
- 不把 URL、header、authorization、token、API key、cookie、credential 或 secret 放入 `params`；唯一例外是 `settings.keys.add.v1` 的 `apiKey`——它必须同时在该 operation 的 Registry `credentialParameters` 中声明，宿主才会放行，且结果永不回传该值（只回传遮蔽预览）；
- 不显示或记录原始凭据、请求 header 或后端内部堆栈。

`powers.list.v1` 在插件 API 边界执行闭集运行时校验（`parseListPowersInput` / `parseListPowersResult`）：未知字段、非法 Power 类型、非 20 的 pageSize、版本乱序、重复或未排序 tags、market 携带 agent 等都会被拒绝。`powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` 用 `parsePowerTarget` / `parseInstallInput` 校验（安装必须带规范版本，卸载/详情不带版本；agent/type/name 必须满足规范命名）。`powers.custom.list.v1` / `powers.upload.v1` / `powers.delete.v1` 用 `parseCustomListInput` / `parseUploadInput` / `parseDeleteTarget` 校验：agent 必须是四个已安装 Agent 之一，`type=agent` 只允许 bibit，name 必须是规范 kebab，upload 必须带单行非空 `message`；自定义系列在 `powers.list.v1` 结果里恰好一个版本、版本可为空串、tags 必须为空。`settings.get.v2` / `settings.keys.add.v1` / `settings.keys.delete.v1` / `settings.keys.enable.v1` 由 store 服务处理（dev 为内存列表，Provider 为 `settings.json` 持久化；`apiKey` 只在 add 入参出现，结果只有遮蔽 `preview` 与 `enabled`）。校验失败或后端返回未知结构时映射为局部错误态（`incompatible`），不能让页面白屏。

### 9.1 跨 Feature 动作（`host:actions`）

跨 Feature 的行为只走宿主动作，插件内不做导航、也不为某个插件加宿主特判。v1 登记的动作里本插件只用 `conversation.compose`：

```tsx
const actions = useFeatureCapability('host:actions')
if (!actions) return /* 入口禁用并说明原因 */

const result = await actions.invoke('conversation.compose', {
  prompt: composePrompt(t),   // 可选；也可带 target / skills，本插件不用
})
```

语义保证（写在契约里，不用猜）：

- **一定新建会话**，不会复用当前会话；
- **一定不发送**：草稿留在输入框，等用户自己编辑后发送；
- `target` 与 `skills` 互相独立，只给 `prompt` 就沿用用户的默认专家；
- 输入上限：`skills` 去重后 ≤ 100 个（对齐 Runtime 的 `skill_ids`），`prompt` ≤ 16 000 字符，空白文本按未提供处理；
- 结果只有三种：`completed` / `cancelled` / `rejected`。

实际要处理的 `rejected.error.code`：

| code | 触发条件 | 处理 |
| --- | --- | --- |
| `UNSUPPORTED` | 宿主没登记这个动作（宿主机版本较旧） | 禁用或提示「宿主不支持」；`message` 是 `Unknown host action: …` 开发者串，**不要上屏** |
| `INVALID_INPUT` | 资源引用不是 `runtime/skill`、技能不存在或不可分配、`prompt` 超长、技能超过 100 个 | 上屏 `message`；这是调用方问题，不要重试 |
| `FAILED` | 无可用 Runtime 目标、校验期间目标被切换、输入框已有未发送草稿 | 上屏 `message`；`retryable` 为 true 时提示用户处理后重试，**不要自动重试循环** |

`NOT_GRANTED` 在类型里存在，但**不会作为动作结果返回**：没 grant 时 `getCapability('host:actions')` 直接是 `undefined`，调用方根本拿不到 `invoke`。所以「能力缺失」必须在取能力时判空降级，不能用 `?.` 把「能力缺失」和「调用成功」抹平。

技能 id 的形态：`skills[].id` 必须与 Runtime 技能目录里的 id 完全一致（Agent 声明里的 `plugin/成员`，例如 `spacemit-power/vibe-coder`），用展示名 `plugin:成员` 会直接拿到 `INVALID_INPUT`。插件拿不到 Runtime 技能目录（`runtime_skills_list` 是宿主内部命令，插件不得绕走 Tauri 命令），所以 id 只能来自自己的 Power / Agent 包声明；确实需要运行时枚举技能时先提需求在框架侧加动作。

## 10. Store 服务协议

### 10.1 当前 operation

| operationId | params | result |
| --- | --- | --- |
| `powers.list.v1` | `ListPowersInput` | `ListPowersResult`（`ready` 或 `reset_required` 联合） |
| `powers.inspect.v1` | `PowerTarget` | `InspectResult`（`listJson`） |
| `powers.install.v1` | `InstallInput` | `MutationResult`（`exited`/`unavailable` 联合） |
| `powers.uninstall.v1` | `PowerTarget` | `MutationResult`（`exited`/`unavailable` 联合） |
| `powers.custom.list.v1` | `{agent}` | `{scope:'custom',status:'data',itemsJson}` |
| `powers.upload.v1` | `{agent,type,name,message}` | `UploadResult`（`exited` + `stage`/`reason`/`stdout`） |
| `powers.delete.v1` | `{agent,type,name}` | `{status:'deleted'}` |
| `settings.get.v2` | `{}` | `AgentHubSettingsV1`（密钥列表，遮蔽预览） |
| `settings.keys.add.v1` | `AgentHubSettingsKeyAddV1` | `AgentHubSettingsV1` |
| `settings.keys.delete.v1` | `AgentHubSettingsKeyTargetV1` | `AgentHubSettingsV1` |
| `settings.keys.enable.v1` | `AgentHubSettingsKeyTargetV1` | `AgentHubSettingsV1` |
| `agents.upload.v1` | Job input `{displayName}` + input FileGrant | `{agentId,displayName,bytes,sha256}` |
| `agents.download.v1` | Job input `{agentId}` + output FileGrant | `{agentId,bytes,sha256}` |

`powers.list.v1` 是页面的业务数据 operation；`powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` 是详情与写入 operation，均通过共享安装状态 `installationStore` 驱动页面（见 10.5）。`powers.custom.list.v1` 是只读扫描（Provider 不调用 apm），`powers.upload.v1` / `powers.delete.v1` 是自定义资源的写入 operation，由弹窗内联表单驱动、成功后重新读取 installed 清单；两者的参数都只携带 `(agent,type,name[,message])`，路径由 Provider 自己解析并重新校验，前端永远不传路径。请求与结果类型（与 `src/api/contracts.ts` 一致）：

```ts
export const POWER_TYPES = ['skill', 'plugin', 'mcp', 'agent'] as const
export const POWER_PAGE_SIZE = 20 as const
export const POWERS_LIST_OPERATION_ID = 'powers.list.v1' as const

type PowerScope = 'installed' | 'market'
type PowerType = (typeof POWER_TYPES)[number]

interface ListPowersInput {
  scope: PowerScope
  agent?: string          // 仅 installed 必填；market 必须省略
  type: PowerType
  tags: string[]          // 0–20 个 canonical tag，字典序排序且唯一，多项 AND（交集）
  page: number            // 从 1 开始
  pageSize: 20            // v1 固定
  snapshot?: string       // page=1 省略；page>1 必填并等于上一页结果 snapshot
}

interface PowerVersion {
  version: string
  description: string
  tags: string[]
  description_zh?: string   // V2 展示字段；缺失即 V1 资源
}

interface PowerSeries {
  type: PowerType
  name: string
  versions: PowerVersion[]
  name_zh?: string          // V2 展示字段，仅展示；name 仍是身份、调用名与缓存键
  name_en?: string
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
      facets: { agents: string[]; tags: string[] }
      warnings: PowerWarning[]
    }
  | {
      status: 'reset_required'
      reason: 'snapshot_changed'
    }

interface AgentHubSettingsV1 {
  showExperimental: boolean
  refreshMinutes: number
}
```

结果规则：items 按 type、name 升序；每系列 versions 至少一项且按严格 SemVer `vMAJOR.MINOR.PATCH` 降序；tags、facets.agents、facets.tags 排序去重；market 的 facets.agents 恒为 `[]`；total 是当前筛选条件下的系列数；nextPage 仅在有下一页时返回；snapshot 变化时返回 `reset_required`，页面回第 1 页重新加载且不混合新旧结果。请求与结果均为字段闭集，未知字段在 API 边界被拒绝。

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
  "operationId": "powers.list.v1",
  "params": {
    "scope": "installed",
    "agent": "bibit",
    "type": "skill",
    "tags": [],
    "page": 1,
    "pageSize": 20
  },
  "timeoutMs": 30000
}
```

成功响应：

```json
{
  "protocolVersion": 1,
  "requestId": "host-generated-request-id",
  "ok": true,
  "result": {
    "status": "ready",
    "snapshot": "local-preview-v1",
    "items": [
      {
        "type": "skill",
        "name": "code-review",
        "versions": [
          { "version": "v2.0.0", "description": "Peer review with a quality gate.", "tags": ["quality"] }
        ]
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "facets": { "agents": ["bibit"], "tags": ["code-review", "quality"] },
    "warnings": []
  }
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

HTTP 模式仍使用上面的 `version/services/store` 结构，并由模块安装包提供 Adapter、systemd unit 和 Provider drop-in。CLI 模式不需要 Adapter 或 systemd unit，由 CLI 包安装 executable 和 Registry v2 drop-in。插件 deb 安装经平台批准的 capability/operation grant，参考 `debian/agenthub-feature-grants.json`（`debian/rules` 安装为系统 drop-in）。具体内容见 CLI Provider 指南。两种模式都不得从安装或维护脚本写入任何用户 home；用户数据目录配置和 `BIBIT_EXTERNAL_SERVICE_CONFIG` 只作为更高优先级的显式覆盖。

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

### 10.4 Installed 数据源（APM CLI）

Store 收到 `scope=installed` 时，前端发送 raw wire 输入（仅信封，业务过滤不进入 wire）：

```text
{scope:"installed", agent:"<selected>"}
```

Go Provider 用固定 argv（无 shell，且不做 `--agent=all` 发现）执行：

```text
apm list --installed --agent=<selected> --json
```

返回 raw wire（原始 UTF-8 JSON 文本，Provider 不解析业务字段）：

```text
{scope:"installed", status:"data", listJson:"[...]"}
```

语义：

- apm 启动失败（含不存在）或非零退出 → 可重试的 `unavailable`，绝不伪造空清单；
- exit 0 且 stdout 为 `[]` → 数据态空清单，前端渲染空内容；
- stdout 非法 UTF-8 → `unavailable`；超 4 MiB → `resource_exhausted`；
- 不透传 CLI stderr、物理路径、环境变量、堆栈或命令内部错误。

前端 Agent 切换控件固定为 bibit / codex / claude-code / hermes-agent 四个选项（`claude-code` 即 apm 中 Claude 的 id），由插件常量 `INSTALLED_AGENTS` 提供，不依赖 `facets.agents` 做发现；每次请求只解析所选 agent 的返回。该控件是标签栏最右侧的独立控件（见 §7.2.4），`installed` 的列查询只认它的值（`market` 与 Agent 无关，请求体不带 agent）；`agent` 类型（UI 上的 `Expert`）只在 bibit 下可用，选中其它 Agent 时类型筛选不渲染它（§7.2.4）。`listJson` 由前端数据层用 `parseApmInstalledList` 解析为 `APMPowerRecord[]`，再经 `buildInstalledPowersResult` 完成 type 过滤与 tag AND（交集）过滤、按 type/name 聚合、去重、分页与 facets——这些聚合只存在于前端 `src/api/`，Provider 与 dev transport 不复制。

### 10.5 Power 详情与安装/卸载（APM CLI）

详情与写入共用 `service:store` 三个 operation，Go Provider 与 dev transport 使用与 10.4 相同的固定 argv（无 shell、不重序列化）：

```text
apm list <name> --installed --json --agent=<agent> --type=<type>          # powers.inspect.v1
apm install <name>=<version> --agent=<agent> --type=<type>               # powers.install.v1
apm uninstall <name> --agent=<agent> --type=<type>                       # powers.uninstall.v1
```

wire 输入闭集：

```text
{agent:"<agent>", type:"<type>", name:"<name>"}                          // inspect / uninstall
{agent:"<agent>", type:"<type>", name:"<name>", version:"v<x>.<y>.<z>"}  // install（规范版本）
```

wire 结果闭集：

```text
{listJson:"[...]"}                     // inspect 透传 apm 单目标输出
{status:"exited", exitCode:<int>}      // install/uninstall：非零退出是正常结果
{status:"unavailable"}                 // apm 不可用，交由前端固定文案
```

语义与前端状态机（`src/api/installationStore.ts`）：

- 写超时 120 秒；Provider 保留 1000ms 子进程清理预算，宿主写超时按 `min(request.timeout_ms, connection.request_timeout_ms)` 截断；
- 安装/卸载是“先预检、后执行、再刷新”的生命周期：preflight（install 会先 inspect 目标，已安装则拒绝）→ running → reconciling（重新读取 installed）→ settled；刷新失败不吞掉已执行命令，页面显示固定“状态确认失败”文案并可刷新；
- **详情弹窗按版本给出动作**：选中版本与已安装版本比较——未安装是「安装」，更高是「更新」，相同是「卸载」，更低是「降级」。安装是一次点击；更新/降级/卸载都先进入内联二次确认（都会替换或移除当前版本）。版本选择器**只在写入进行中或只读视图里禁用**，不再因为「已安装」而锁死；已安装的那个版本在选项文本里标记为 `{version} (installed)`。若目录已经把已安装版本下架，该版本仍会被补进选项列表——否则「卸载」这个状态将无法到达。动作变化（换版本、记录出现或消失）会清掉已按下的确认；
- 弹窗的 `readOnly`（「我的能力」页）保持只读语义：选择器禁用、动作恒为「卸载」（未安装时不显示动作）；
- 前端对写结果只区分 `exited` 与 `unavailable`，非零 `exitCode` 返回为正常结果，由 `operationMessage` 映射为固定文案（如“安装失败”/“卸载失败”），不透传 CLI stderr 或物理路径；
- 共享安装状态以 `JSON.stringify([agent,type,name])` 为条目键，跨详情弹窗与列表卡片复用同一份 state；全局写锁确保同一时刻只有一个变更在途，重复点击被阻止；
- 卸载的中断语义：发起后即进入 running 并阻止重复提交；若页面卸载或详情关闭，请求被取消但写命令可能已完成，重开页面靠刷新 installed 恢复真实状态。
- 卸载是**两段式**：第一次点击只在弹窗底部展开确认（写明 `agent`/`type`/`name`，`role="alertdialog"`），「取消」不发请求；确认后才提交。安装保持一键。
- 卸载成功后弹窗**自动关闭**回到列表（列表已重新读取，卡片消失）：判定依据是 `installationStore` 快照里的 `confirmedRemovals`，它与结论文案由同一份证据（意图、退出码、对账后的清单）算出，因此"说什么"和"关不关"不会漂移。`isRemovalConfirmed` 为真的情形有两种：对账后目标已不在清单里（无论退出码是 0 还是非零——后者说明 apm 报错但事实已达成）。其余情形（仍安装着、平台错误、对账未完成）都保持弹窗打开，因为那里是失败原因的唯一落点。安装永远不满足该判定，弹窗保留。

### 10.6 自定义资源（扫描、上传、删除）

「我的 Power」是 APM 清单与**手动安装资源**的并集。手动安装资源（下文简称自定义资源）在本地数据层用同一次 `powers.list.v1` 请求返回，卡片以 `source: "custom"` 标记区分，因此筛选、分页、tags facets 与版本选择逻辑完全复用。

#### 10.6.1 识别规则（Provider 只做扫描）

Provider 通过 `powers.custom.list.v1` 扫描固定目录，**不调用 apm、不读取 APM 清单、不做业务聚合**；`itemsJson` 是原始 JSON 文本，由前端 `parseCustomResourceList` 解析：

```text
{items:[{type,name,version,description,tags,source[,name_zh,name_en,description_zh]}], skipped:[{type,name,expected,reason}]}
```

| Agent | 根目录（用户 home 下） | 扫描类型 |
| --- | --- | --- |
| `bibit` | `.bianbu-agent` | skill `skills/`、plugin `plugins/`、agent `agents/` |
| `codex` | `.codex` | skill `skills/` |
| `claude-code` | `.claude` | skill `skills/` |
| `hermes-agent` | `.hermes` | skill `skills/`、plugin `plugins/` |

- **身份取目录名**，必须满足 APM 规范命名；以 `.` 开头的目录忽略，不是目录（含指向目录的符号链接以外的项）忽略。这些情况**不产生 warning**。身份与展示名是两件事，见下一条。
- 权威文件：skill = `SKILL.md`；plugin = `apc-plugin.json` / `plugin.yaml` / `.claude-plugin/plugin.json` / `.codex-plugin/plugin.json`；agent = `agent.yaml`。
- **显示门槛（低于上传门槛）**：skill 只要 frontmatter 是 YAML 映射且 `name`、`description` 非空；plugin 清单只要有非空 `name`；agent 只要有非空 `agent.name`。**不要求**满足 Power 资源 schema（`schema_version`、展示字段、长度限制等一律不检查），v1 与 v2 都按同一最低要求处理。
- **frontmatter 支持块标量**：`description: >-` / `|-` 这类把值放在后续缩进行的写法会被正常读出——`>` 折叠行内换行、空行分段落，`|` 保留换行；`+` / `-` / 数字缩进指示符同样接受。板端真实 Skill（`k3-media-pipeline`、`vpu-benchmark`）都用了 `>-`，因此这是显示门槛必须覆盖的写法。
- **卡片标题**用展示名而不是目录名：扫描器把权威文件里声明的 `name` 投影到 `name_en`（仅在资源自己没有 `name_en` 时），前端仍按 `name_zh → name_en → name` 回退。因此 v1 资源显示作者声明的名字，而不是它恰好所在的目录；中文宿主仍优先 `name_zh`，英文宿主不看中文。目录名始终只是**身份**（APM 调用名），用于去重、上传与删除的目标解析，从不作为标题。
- 低于门槛 / frontmatter 不是映射 / 非法 UTF-8 / 超过 64 KiB → 计入 `skipped`（最多 20 条），reason 为 `invalid-authority-file`；看起来是候选但缺权威文件（如 plugin 目录只有 `skills/`）→ `missing-authority-file`，`expected` 给出该类型主权威文件名。前端把每条 `skipped` 渲染为页面 warning，**不阻断列表**；但**已被 APM 清单管理的 `(type,name)` 不渲染 warning**——那张卡片由清单供数，扫描器只是重新走了一遍同一个目录，报"最低格式不达标"是误报。
- `version` 只接受规范 `v<x>.<y>.<z>`（缺 `v` 前缀时补齐）；其它写法或缺失一律置空串，卡片显示占位符，不猜测版本。
- 扫描失败（含 Provider 不支持该 operation）降级为一条 `custom-resources-unavailable` warning，installed 列表仍正常显示——旧版 CLI 因此天然兼容。
- MCP 不在扫描范围：APM 不为 MCP 维护目录。codex / claude-code 的 Plugin 由各自 CLI 管理，也不扫描。

#### 10.6.2 合并规则（前端数据层）

`buildMergedInstalledPowersResult` 先按 10.4 归一化 APM 记录，再合入自定义记录：

- 同 `(type,name)` 已存在于 APM 清单 → **丢弃自定义项**，以 APM 清单为准（避免同一系列出现两个来源）。
- 自定义资源是单个目录，因此它的系列**恰好一个版本**；契约层强制执行这一点（`parseListPowersResult` 在 `source: 'custom'` 时要求 `versions.length === 1`、版本可为空串、`tags` 必须为空）。
- `source` 进入 snapshot 哈希：从 Hub 安装/卸载导致来源变化时，第 2 页会得到 `reset_required`，不会显示过期内容。

#### 10.6.3 上传与删除（弹窗内联操作）

两个 operation 的 wire 输入都是闭集，**绝不携带路径**：

```text
{agent, type, name, message}   // powers.upload.v1，message 单行非空 ≤200 字符
{agent, type, name}            // powers.delete.v1，不带 version
```

Provider 按同一套规则把 `(agent,type,name)` 解析回路径并**重新校验**（规范名、该 Agent 支持的类型、类型目录必须是目录、结果必须是类型目录的直接子项），非法即 `incompatible`；前端在发送前也用 `parseUploadInput` / `parseDeleteTarget` 做同样校验。

上传固定 argv（无 shell，先校验后提交，`powers.upload.v1`）：

```text
apm validate <path> --type=<type> --json
apm submit   <path> --type=<type> --message=<message>
```

- APC 凭据来自页面「设置」标签页保存的 `apiKey`，经环境变量 `APC_API_KEY` 注入子进程（配置了 `--apc-root-url` 时额外注入 `APC_BASE_URL`）；未配置 Key 时直接 `unauthorized`，**不启动 apm**。
- 结果是 `{status:"exited", exitCode, stage:"validate"|"submit", reason?, stdout?}`：非零退出是正常结果，`validate` 失败不会执行 `submit`。`reason` 取 apm 失败日志的 `error` 属性（成功走 stdout、失败走 stderr 是 apm 自身约定），再清洗（Key 替换为 `***`、去 ANSI 与控制字符、压单行、截断 300 字节），前端只把它当文本显示；usage 块与日志前缀不会进入结果。
- 上传门槛高于显示门槛：显示只需最低格式，**上传必须满足 Power 格式 v2**，由 `apm validate` 判定；apm 的 stderr 只用于提取那一行失败原因，usage 块、日志前缀与任何堆栈都不进入结果。

删除执行系统删除语义（`os.RemoveAll` 只作用于已解析并校验过的直接子项）：资源目录本身是符号链接时只删链接、不跟随；目标不存在返回错误而不是静默成功。前端在弹窗内先显示确认文案（明确写出 `agent`/`type`/`name`）再提交。

两个写操作走 `installationStore` 之外的独立控制器（`customControllerRef`）：同一时刻只有一个自定义写请求在途，页面卸载即取消，成功后固定重新读取 installed 清单。

### 10.7 Market 数据源（APC 公共接口）

Store 收到 `scope=market` 时，前端发送 raw wire 输入：

```text
{scope:"market", knownSnapshot?:"<sha256>"}   // 首次省略；命中缓存后携带
```

Go Provider 每次请求先 `GET {base}/resources/version`；`catalog_sha256` 等于 `knownSnapshot` 时返回：

```text
{scope:"market", status:"not_modified", snapshot:"<sha256>"}
```

否则下载全量 `GET {base}/resources` 并返回：

```text
{scope:"market", status:"data", snapshot:"<sha256>", catalogJson:"{...}"}
```

market 列表本身**不带 agent**，但卡片要回答「选中的 Agent 是否已经装了它」，所以进入市场 / 切换 Agent / 窗口重新聚焦时，页面会额外为该 Agent 预载一次安装清单（`installationStore.refreshAgent`，走 `powers.list.v1` + `scope=installed` + `agent`），卡片据此显示 `Installed` 徽标（见 §7.2.4）。这次预载是**尽力而为**：清单读不到时市场照常可用，只是不显示徽标，不新增错误态；卸载/安装后 `reconcile` 会重新读清单，徽标随之更新。代价是每次进入市场会多一次 installed 读。

APC 全量约束：只调用 `resources/version` 与 `resources`，不调用 `resources/list` 或 `resources/tags`；类型过滤、tag AND 过滤、系列聚合、分页与 facets 全在前端 `buildPowersResult` 完成。前端在解析 `catalogJson` 前先用 Web Crypto 对原始 UTF-8 字节计算 SHA-256 并与 `snapshot` 比对（`src/api/catalogIntegrity.ts`），不一致抛可重试 `unavailable` 且不写入缓存。默认 base 为 `https://developer.bianbu.xyz/api-server/apc/api/v1`；HTTP 客户端使用系统受信 CA，重定向 ≤5 跳且禁止 https→http 降级，无跳过 TLS 校验的开关。

### 10.8 部署与发布前置项

已实现并纳入两个 deb：

- Go 标准库 Provider（v1，`powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` / `powers.custom.list.v1` / `powers.upload.v1` / `powers.delete.v1` / `settings.get.v2` / `settings.keys.add.v1` / `settings.keys.delete.v1` / `settings.keys.enable.v1`），`bibit-agenthub-cli`（Architecture: any）拥有 `/usr/libexec/bibit/bibit-agenthub` 与 `/etc/bibit/external-services.d/agenthub.json`（Registry `version: 2`、`protocolVersions: [1]`、managed stdio、`requestTimeoutMs: 120000`、`credentialParameters` 声明 `settings.keys.add.v1` 的 `apiKey`）；
- 前端 bundle 与 capability grant 仍在 `bibit-agenthub-plugin`（Architecture: all）；grant 的 store operations 追加 inspect/install/uninstall/custom.list/upload/delete，capability 仍只有 `service:store`，不新增 job/file grant；
- 前端数据层在 dev 与生产共用，`dev/sources.ts`（APM/APC）与 `dev/custom.ts`（自定义资源扫描与两个写操作）与 Go Provider 语义一致。

发布与板端验收仍依赖以下前置项，缺少时如实记录阻塞：

- 按现有签名流程取得受信签名 bundle（开发签名不能代替 Release 信任链）；
- 构建环境提供 ≥1.26.5 的 Go 工具链（目标 suite 的 `golang-go` 可能只有旧版本，需回填工具链或记录阻塞）；
- 开发板安装两包并重启宿主，验证 Registry 加载、协议 v1 协商、两个 scope 真实数据、详情/安装/卸载闭环，以及自定义资源的展示/上传/删除与 APC Key 配置。

在这些前置项完成前，只能宣称协议与构建已验证，不能宣称板端真实链路已接通。

## 11. 独立开发调试

### 11.1 获取代码

```bash
git clone -b main \
  git@gitlab.dc.com:bianbu/bianbu-star/bibit-agenthub-plugin.git
cd bibit-agenthub-plugin
git rev-parse HEAD
npm ci
```

交付负责人还应提供经过验收的固定 commit SHA；正式集成时记录并检出该提交，不要只依赖会变化的 `main`。远程默认分支目前仍可能显示为 `dev`，所以开发初始化必须显式克隆 `main`。使用 `npm ci` 保持 lockfile 中的确切版本，不要用 `npm update` 随机改变 SDK 或 React 版本。

确认依赖：

```bash
npm ls react react-dom \
  @bibit/feature-contracts \
  @bibit/feature-sdk \
  @bibit/feature-plugin-sdk \
  @bibit/feature-dev-host
```

### 11.2 Local Preview（开发模式）

```bash
npm test
npm run typecheck
npm run dev
```

浏览器打开 Vite 输出地址；首页地址追加 `?lang=zh-CN` 即为中文界面，右上角下拉框可随时切换语言（不刷新页面）。Feature Dev Host 读取真实 Manifest 和 Feature Module，并通过 `dev/main.tsx` 的 `serviceConnections` 把 `powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` / `powers.custom.list.v1` / `powers.upload.v1` / `powers.delete.v1` / `settings.get.v2` / `settings.keys.add.v1` / `settings.keys.delete.v1` / `settings.keys.enable.v1` 路由到 Vite 中间件（`vite.config.ts` → `dev/store.ts`）提供的 Store。`scope=installed` 会真实执行 PATH 中的 `apm list --installed --agent=<selected> --json`（身份记录）；详情/安装/卸载分别执行 `apm list <name> --installed ...` / `apm install <name>=<version> ...` / `apm uninstall <name> ...`（argv 与 Go Provider 一致，读 30s / 写 120s）；`scope=market` 会每次请求真实拉取 APC 公开目录（`GET /resources/version` 取快照 + `GET /resources` 跟随重定向取全量列表），再按 `type` 过滤聚合；`settings.get.v2` / `settings.keys.add.v1` / `settings.keys.delete.v1` / `settings.keys.enable.v1` 使用内存设置（Key 只保留在 dev 进程内，只回传遮蔽 `preview`）；`powers.custom.list.v1` 扫描**本机真实 home**（`dev/custom.ts` 复刻 Provider 的目录、最低格式与展示名兜底规则），`powers.upload.v1` / `powers.delete.v1` 分别调用本机 `apm validate` + `apm submit` 与真实删除。此模式不启动、不编译 Bibit，也不要求远程 Store 后端在线；未安装 `apm` 时 installed 页显示可重试的 unavailable 错误，APC 不可达时 market 页显示可重试的 unavailable 错误。

market 每次点击类型/标签、翻页都重新拉取并解析 APC 全量列表（无本地 fixture、无跨请求缓存），并在进入市场/切 Agent/窗口聚焦时额外读一次目标 Agent 的安装清单（只用于卡片徽标），覆盖 skill / plugin / mcp / agent 四种 Power 类型（筛选行里 `agent` 只在 bibit 下出现）；installed 由真实 apm 输出驱动，Agent 由标签栏最右侧的独立控件切换，选项固定为 bibit / codex / claude-code / hermes-agent 四个。两种 scope 复用同一套筛选、聚合、分页、facets 与 snapshot 规则，与未来 Remote Store 一致。

APC Base URL 默认测试环境 `https://developer.bianbu.xyz/api-server/apc/api/v1`，可用 `APC_BASE_URL` 环境变量覆盖。测试环境证书不受信，dev-only 传输层（`vite.config.ts`）关闭了 TLS 校验；正式 CLI Provider 必须使用受信 CA。APC 公开目录无按类型列表端点，因此 market 采用“全量列表 + 客户端按 `type` 过滤”的映射。

冒烟检查（filters / version selection / pagination / warnings / Retry）：

- 默认进入“我的 Power / Bibit / skill”，第 1 页显示最多 20 张系列卡，翻页显示“第 X / Y 页”；
- “Power 市场”隐藏 Agent 层，Agent 层固定显示 bibit / codex / claude-code / hermes-agent 四个选项；
- 切换 Agent / 类型会清空失效 tags 并回到第 1 页；
- 选择多个 tag 时按 AND（交集）过滤：选得越多结果越窄，只保留同时带有全部所选 tag 的版本；tag 清单随上层筛选刷新；
- 同一系列切换版本时 description 与 tags 同步变化；
- 选择未安装任何 Power 的 Agent 时，页面显示空内容（No Powers are available.）；
- 切换语言后当前列表、筛选、分页与已打开的详情弹窗保持不变，只替换文案，且不重新请求 `powers.list.v1`；
- 停止或未连接 Store 时页面显示局部错误与 Retry，恢复后 Retry 可恢复列表；
- 设置标签页可以读取 Mock 密钥列表、保存后出现遮蔽行，保存/启用/删除后再次进入值一致；
- 未知 operation 返回错误，而不是伪造成功；
- 页头「创建资源」按钮在本模式下是**禁用**的，并显示「当前宿主未提供发起会话的能力」：Dev Host 只为 service mock / connection（以及 `file:transfer`）构造 capability，不提供 `host:actions` mock。这正好复现旧宿主的降级形态；要预览可点状态，需要注入自定义 `hostApi`（`FeatureDevHost` 支持 `hostApi` 属性），或等宿主提供 Dev Host 的 `host:actions` mock。

该模式只验证插件业务状态机、公开 SDK 用法、apm CLI 数据投影与 APC 公开目录投影，不启动 Provider、不读取真实文件，也不会产生下载文件；它不构成 Tauri、FileGrant staging 或 CLI Provider 端到端证据。

### 11.3 连接模拟或真实 CLI Provider

真实 CLI 必须由 Tauri Bibit 的 Provider Broker 启动，浏览器 Dev Host 不提供 executable、argv、文件系统或 Provider 生命周期。先完成自检并准备隔离调试目录：

```bash
npm run keygen
npm run build:plugin
make -C provider build
./artifacts/provider/<arch>/bibit-agenthub --self-test
go run ./provider/cmd/provider-probe --executable <binary> --scope market
```

调试只写指定隔离目录，输出 `XDG_DATA_HOME`、`JAN_DATA_FOLDER`、Provider Registry、capability grant、系统插件目录和开发 trust store 的完整环境变量前缀。把该前缀放到目标 Bibit `yarn dev:tauri` 或已构建 Debug binary 前；不要写入正式 `/etc`、`/usr` 或用户数据目录。

真实 Provider 调试必须验证：

- `powers.list.v1` 数据来自服务，不是 Local Preview Mock；
- 浏览器网络请求中的 `requestId` 与服务响应一致；
- 设置保存后重新 GET 得到相同值；
- Store 服务停止后页面显示局部错误和 Retry；
- Store 恢复后 Retry 能恢复列表；
- Agent Hub 失败不影响 Dev Host 切换到设置贡献点。

模块团队替换模拟 CLI 时保持 Registry 固定入口和 Provider v2 协议不变即可；正式 CLI 的内部语言、子命令实现和后端连接不属于插件前端契约。完整线协议见 [AgentHub CLI Provider 开发与部署指南](./cli-provider-development-and-deployment.md)。

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

构建用的 Node 版本是**钉死的**（`.nvmrc` = `24.16.0`）。插件 bundle 是一个 gzip 压缩的 tar，压缩用的是 Node 运行时的 zlib：Node 18 带 zlib 1.3、Node 24 带 1.3.1，同一份源码在两者下会产出**两份字节不同**的 `.bibit-plugin.tgz`（SHA-256 也不同）。按 level 0–9 × 5 种 strategy 共 20 种组合逐一验证，没有一种能跨这两个运行时得到相同字节，所以只能钉工具链，不能靠调压缩参数。

```bash
nvm install            # 读 .nvmrc，装 24.16.0
nvm use                # 之后所有构建都在这个版本下
node --version         # 24.16.0
```

`npm run build:plugin` 会先跑 `scripts/check-node.mjs`；版本不符时**直接失败并打印当前 zlib 版本与修复命令**，不会产出另一份 bundle。`debian/rules` 同样先跑这个检查，并且用 `.nvmrc` 解析出的解释器去跑 `npm ci` / `npx bibit-plugin build`（把它的 `bin` 放在 `PATH` 最前面），所以打包路径与本地构建产出同一份字节。构造时需要换解释器可以显式指定：

```bash
NODE="$HOME/.nvm/versions/node/v24.16.0/bin/node" dpkg-buildpackage -us -uc -b
```

要改这个 pin，改 `.nvmrc` 一处即可（`package.json` 的 `engines.node` 由 `src/nodePin.test.ts` 约束为同值）；但**必须重新构建并重记所有已发布的 bundle SHA-256**，因为那些哈希只对旧 pin 成立。

构建：

```bash
npm test
npm run typecheck
npm run build:dev
npm run build:plugin
```

产物：

```text
artifacts/agent-hub-0.3.16.bibit-plugin.tgz

```

检查：

```bash
tar -tzf artifacts/agent-hub-0.3.16.bibit-plugin.tgz
tar -xOf artifacts/agent-hub-0.3.16.bibit-plugin.tgz plugin.json
tar -xOf artifacts/agent-hub-0.3.16.bibit-plugin.tgz plugin.sig
sha256sum artifacts/agent-hub-0.3.16.bibit-plugin.tgz

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

截至目标 Bibit `49bcd55ece89c6ee970abab4e4cb69b393b21201`，`src-tauri/resources/plugin-trusted-keys.json` 仍为空。正式发布前必须由平台登记公司公钥并重新构建 Bibit。

## 13. 在 Bibit 中开发安装

启动 Debug Bibit 时指定 Agent Hub 开发 trust store：

```bash
XDG_DATA_HOME=/absolute/path/bibit-agenthub-demo/xdg-data \
  BIBIT_PLUGIN_TRUST_STORE=/absolute/path/.bibit-keys/agent-hub-development-trust-store.json \
  yarn dev:tauri
```

调试时必须使用独立的 `XDG_DATA_HOME`，避免开发插件、Provider 数据和用户配置写入正式 Bibit 用户目录。`demo/deploy-debug.sh` 会创建该目录并输出完整启动命令。

进入：

```text
Settings > Extensions > Trusted plugins
```

选择：

```text
artifacts/agent-hub-0.3.16.bibit-plugin.tgz
```

Bibit 会验签、校验 hash、安装、激活并刷新 Feature Registry。确认主导航出现 Agent Hub（插件已不声明 settings contribution，因此设置子菜单里不再有 Agent Hub 条目）。

不要同时激活另一个使用 Feature ID `agent-hub` 的内置 Demo 或插件。重复 Feature ID 会被宿主拒绝或隔离。

Debug Bibit 使用真实 Store 服务时，还要配置第 10.3 节的 `BIBIT_EXTERNAL_SERVICE_CONFIG`。插件成功加载不代表 Store 服务已经接通。

若不写系统目录，Debug Bibit 可设置 `BIBIT_FEATURE_CAPABILITY_GRANTS_DIR` 指向包含 `debian/agenthub-feature-grants.json` 的开发目录；Release Bibit 忽略该环境变量。授权与插件均在启动阶段装载，修改后需要重启 Bibit。

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
  artifacts/agent-hub-0.3.16.bibit-plugin.tgz \

  /usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz
sudo install -Dm0644 \
  debian/agenthub-feature-grants.json \
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
Depends: bibit-agenthub-cli (= ${binary:Version}), agent-power-manager, ${misc:Depends}
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
export SIGNED_AGENT_HUB_BUNDLE=/absolute/path/agent-hub-0.3.16.bibit-plugin.tgz

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
5. 验证 Power 目录和设置协议仍与后端兼容。

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
- Dev Host 只列出 `Page · home`（插件不声明 settings contribution）；
- Mock 市场筛选、系列卡、版本选择、分页、warning 与 Retry 可见；
- Mock 设置可以读取和保存；
- bundle 包含 `plugin.json`、`plugin.sig`、JS 和 CSS；
- `.bibit-keys` 和 `artifacts` 没有进入 Git。

### 16.2 Store 短请求与 Provider 协议

如果模块同时提供 HTTP Provider，使用真实 HTTP 服务验证：

1. `POST /bibit/v1/invoke` 可达；
2. 全部 v1 operation 均返回合法信封（含 `powers.custom.list.v1` / `powers.upload.v1` / `powers.delete.v1`）；
3. 响应回显请求 `requestId`；
4. `powers.list.v1` 返回通过闭集运行时校验的 `ready` / `reset_required` 结果；
5. `settings.keys.add.v1` 后再次调用 `settings.get.v2` 得到持久化列表（结果只有遮蔽 `preview`，不得出现 Key）；`settings.keys.enable.v1` 后只有一行 `enabled`，`settings.keys.delete.v1` 删掉启用行后其余行为未启用；
6. 重启 Store 服务后设置值仍存在；
7. 非法 operation、超时、未授权和离线产生约定错误；
8. 日志不包含 token 或完整凭据。

当前 AgentHub CLI 路径还必须执行 `/usr/libexec/bibit/bibit-agenthub --self-test`（或本机二进制路径），并确认 `bibit.initialize` 协商 v1、`powers.list.v1` 完整、`invoke` 能力与 Registry 的 `protocolVersions: [1]` 一致。HTTP 探针不能替代 CLI 协商和传输验收。

### 16.3 Bibit 插件加载

验收：

- 目标 Bibit 信任正式 `keyId`；
- 系统目录只有预期 Agent Hub bundle；
- Bibit 插件管理页显示 `agent-hub@0.3.16` 已激活；
- 主导航出现 Agent Hub；
- 设置子菜单**不再**出现 Agent Hub（插件已不声明 settings contribution）；
- Agent Hub 页面一级标签为「我的 Power / Power 市场 / 设置」；
- 停用插件后主导航入口消失，Bibit 其他页面仍可使用。

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

1. 在 Store 服务准备一条唯一测试 Power 系列，例如 `acceptance-power-20260826`；
2. 启动目标 Bibit，确认插件已激活且 `service:store` 已授予；
3. 打开 Agent Hub，确认唯一测试 Power 的 name、version、description 与 tags 来自真实 Store；
4. 停止 Store 服务，点击 Retry，确认只显示 Agent Hub 局部错误；
5. 确认 Bibit 对话、设置和其他页面仍可操作；
6. 恢复 Store 服务，点击 Retry，确认列表恢复；
7. 把 Bibit 系统语言切成中文，确认主导航、设置子菜单标题、页面文案与操作提示变为中文，且切换瞬间列表不重新请求、详情弹窗不关闭；
8. 切回英文，确认文案回到英文；
   - 对同一条测试 Power 分别用 V1（只有 `name`/`description`）与 V2（带 `name_zh`/`name_en`/`description_zh`）记录验收：V2 记录在中文下显示 `name_zh`/`description_zh`、英文下显示 `name_en`/`description`；V1 记录两种语言都回退到 `name`/`description`；两种情况下的安装、卸载与详情请求参数都仍是 canonical `name`。注意 apm `list --json` 与 APC 目录尚未输出展示字段，需用能返回这些字段的夹具或临时 Store 服务构造；
9. 在**默认窗口（1200×800）**打开 Power 市场：应正好一行 **3 张卡片**、两侧余量各约 10px（而不是 2 张卡片 + 两侧各 144px 的大空隙）；卡片宽度 267.33px、卡片等高、描述在无边框框内可上下滚动、分页控件常驻可见，向下滚动能到达第 20 张卡片；把窗口从 1024 拖到 1920 再拖回，卡片宽度始终不变、只有一行里的卡片个数变化（1024→2 列、1200→3 列、1440→3 列、1600→4 列、1920→5 列），网格整体居中且不满的最后一行从左侧排列；`Custom` 卡片与管理态卡片在同一行时标题与描述对齐（版本槽同为 31px 高、都是静态标签）；翻页或切换类型后列表回到顶部，没有横向滚动条；
10. 切到页面的「设置」标签页：确认目录的 Type/Tags 筛选消失、面板只显示 APC API Key 列表，且该切换没有产生新的 `powers.list.v1` 请求；
11. 输入一个 APC Key 并点「保存 Key」：确认列表出现 `头****尾` 的行、输入框被清空、页面任何位置都不回显该 Key，且该行因是第一条而处于「已启用」；再保存第二条，确认新行是「未启用」而第一条仍是「已启用」；
12. 点第二条的「启用」：确认启用手到第二条、第一条变回未启用（任何时刻只有一行启用），然后上传一次自定义资源，确认 apm 拿到的是第二条 Key；
13. 点当前启用行的「删除」（**单击即删，无二次确认**）：确认该行消失、剩下的行是「未启用」，再上传一次确认返回未配置；点剩下那行的「启用」后可再次上传；切回「我的 Power」再切回「设置」并重启 Bibit 与 Store 服务，确认列表与启用状态都持久化；
14. tag 交集：用一份「A 带 `x`+`y`、B 只带 `x`」的夹具，先点 `x` 确认 A 与 B 都在；再点 `y`，确认 B 消失、只留 A（**选得越多结果越窄**），且 tag 按钮本身没有跟着变少；取消 `y` 后 B 回来；再选一个任何版本都不带的 tag，确认显示空列表而不是报错；
15. 在「我的 Power」打开一个**已安装**的 Power 详情：点「卸载」只展开确认（此时 Store 未收到 `powers.uninstall.v1`），点「取消」不产生请求；再点「卸载」→「确认卸载」，确认请求参数为 `{agent,type,name}`，且**卸载成功后弹窗关闭、回到列表、卡片消失**；
16. 制造一次卸载失败（例如让 `apm uninstall` 返回非零、且目标仍在清单里）：确认弹窗**保持打开**并显示失败文案（仍安装着某个版本时显示 `The command failed; version … is still installed.`）；
17. 安装一条 Power：确认安装**不需要**二次确认、成功后弹窗**保持打开**并显示 `Installation complete.`；
18. 保存 Store 服务按 `requestId` 关联的请求日志、Bibit 日志、页面截图和最终设置读取结果。

入口可见、端口可达或 Dev Host Mock 成功都不算真实端到端接通。

## 17. 常见问题

### 插件已加载但主导航没有 Agent Hub

检查 Manifest 的 `pages.home`、`navigation.group`、Feature Module 的 `pages.home`、插件激活状态和重复 Feature ID。不要直接修改 Bibit 侧边栏清单。

### 设置标签页出现两个滚动条或高度异常

`.agent-hub` 是页面唯一的滚动容器，`AgentHubSettingsPanel` 不得声明 `overflow-y`、`height`、`max-height`。`src/agentHubLayout.test.ts` 会捕获这类回归。

### 选了多个 tag 后列表空了

0.3.14 起 tag 筛选是**交集**：只有同时带有全部已选 tag 的版本会留下，因此若两个 tag 从未同时出现在任何版本上，结果就是空的（这是交集的定义，不是缺陷）。tag 按钮（facets）仍取当前 type 的全量集合、不随选择收窄，所以取消其中一个 tag 即可回到非空结果。另注意 tag 是版本级字段：一个系列若只有部分版本带全部已选 tag，系列会保留但 `versions` 里只留下匹配的那些。

### 升级后 Bibit 设置子菜单里仍有「Agent Hub 设置」

插件 0.3.6 起不再声明 settings contribution。若宿主仍显示旧条目，说明它还在用缓存的旧 manifest：重启 Bibit（或按安装脚本重启 `bibit-gui`）后即消失。

### 页面显示 Store capability 不可用

依次检查 Manifest 的 `requiredHostCapabilities`、`/etc/bibit/feature-capability-grants.d/agenthub.json`、operation allowlist、Provider Registry 和插件是否运行在 `main` surface。不要回退到直接 `fetch`。

### 「创建资源」入口变灰，或点击后提示不支持

两种情况要分开看，因为它们的修复方不同：

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| 按钮 `disabled`，旁边显示「当前宿主未提供发起会话的能力」 | `getCapability('host:actions')` 返回 `undefined` | 插件侧缺 `host:actions` 声明、系统 drop-in 缺该 grant，或宿主根本没注册这个 capability。先核对 `bibit.feature.json` 的 `requiredHostCapabilities` 与 `/etc/bibit/feature-capability-grants.d/agenthub.json`（两者由 `src/manifestGrants.test.ts` 守住）；仍然变灰说明宿主版本不带 `host:actions` |
| 按钮可点，点击后显示「当前宿主不支持发起会话」 | capability 拿到了，但动作表里没有 `conversation.compose`（宿主返回 `UNSUPPORTED`） | 宿主较旧。任何已发布的 `bi-bit`（板端 0.1.18、`bianbu/0.1.22`）都只有 `conversation.create`；需要由 bibit 主线 ≥ `0e3d7b4` 构建的宿主 |
| 点击后显示「输入框仍有未发送内容」+「请先清空输入框，再重试」 | 首页存在未发送草稿，宿主按设计拒绝，`retryable: true` | 提示用户清空后重试。插件**不会**自动重试，也不会覆盖用户的草稿 |
| 点击后显示宿主给的其他 message（例如技能不可分配） | `INVALID_INPUT`：调用或资源引用有问题 | 修调用方或资源，不要重试 |

不要为了「让按钮可点」而把技能 id、提示词或跳转逻辑塞进别处：跨模块行为只能走 `host:actions`，插件也不得直接调 Tauri 命令或 import 宿主私有模块。

### Dev Host Mock 正常，真实服务失败

Dev Host 当前只注入内存 Host API，不接受 `storeEndpoint` URL 参数，也不会启动 CLI。执行第 11.3 节的隔离 Tauri 调试，依次核对插件激活、capability grant、Provider Registry、协议 v2 协商和 operation 集合。

### Bibit 中服务请求失败

CLI 模式检查 Registry 是否为 `version: 2`、`transport: stdio`、固定绝对 executable、`lifecycle: managed` 和 `protocolVersions: [1]`，再检查 Provider stderr。HTTP 模式才检查 `baseUrl`、`authRef`、超时和 HTTP 状态；不要在 `baseUrl` 中重复写 `/bibit/v1/invoke`。

### 返回成功但页面白屏

`powers.list.v1` 的结果在 API 边界经过闭集运行时校验。后端若返回未知字段、非法 Power 类型、非 20 的 pageSize、版本乱序或重复未排序 tags，插件会拒绝该结果并进入局部错误态；此时应修正后端响应，或在破坏性变更时发布新的 operation 版本并同步更新 `src/api/contracts.ts`。

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
- CLI 自检和 Provider v2 协商结果；
- Bibit 插件加载、激活、停用和回退结果；
- 真实 Power 列表、自定义资源展示（含 warning）、上传/删除、设置持久化（含 APC Key 不回显）、错误映射与重试证据；
- 中英文切换证据（系统语言切换后页面文案、菜单标题与不重新请求的观察结果）；
- 「创建资源」入口的证据：新会话已打开、提示词预填、消息列表为空（未自动发送）、补字后可发送，以及首页已有未发送草稿时返回 `FAILED` 且原草稿不被覆盖；
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
- 页头「创建资源」入口经 `conversation.compose` 打开新会话并预置草稿，但**实机 happy path 尚未验证**：该动作只在 bibit 主线 `0e3d7b4` 之后存在，已发布的 `bi-bit` 都还没有，因此当前板上点击只会得到「当前宿主不支持发起会话」。降级路径（能力缺失即禁用、`UNSUPPORTED` 提示、可重试 `FAILED` 只提示不自动重试）已由单测锁定；
- 预置草稿只点名 `using-apm`，不把该技能作为临时 chip 挂到输入框：`using-apm` 是 `presets.skills` 里对所有专家固定启用的技能，且设备未装该技能时带 `skills` 会让整次调用以 `INVALID_INPUT` 失败；
- 当前插件实现 APC Power 展示原型（筛选、系列卡、版本选择、每页 20 的分页、warning 与 Retry）、详情弹窗与单版本安装/卸载，以及自定义资源的扫描/上传/删除，和三个设置字段（实验 Agent、刷新间隔、APC API Key）；
- 页头刷新入口只重取当前标签页的当前查询（筛选与页码不变）；`retry` 计数一 bump 就会 abort 在途的 `powers.list.v1` 再重发，因此列表加载中该按钮 `disabled`，**不会**成为第二个「把 market 读取掐掉」的入口；
- Power 下载、提交审核、下架、恢复以及搜索尚未实现；
- `powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` / `powers.custom.list.v1` / `powers.upload.v1` / `powers.delete.v1` DTO 已做闭集运行时校验；`settings.get.v2` / `settings.keys.*.v1` 由 store 服务处理（dev 为内存列表，Provider 侧为 `settings.json` 持久化，Key 只回传遮蔽 `preview`）；
- 自定义资源只覆盖 skill / plugin / agent：MCP 没有可扫描目录，codex 与 claude-code 的 Plugin 由各自 CLI 管理，两者都不在本期范围；
- 自定义资源的**显示**只要求主流最低格式，**上传**仍要求 Power 格式 v2（由 `apm validate` 判定）；
- 删除是本地系统删除（`os.RemoveAll` 只作用于已校验的直接子项），资源目录是符号链接时只删链接，无法从 APC 侧下架或恢复；
- 安装/卸载依赖 Agent 自身 `apm` CLI；无 `apm` 时详情与写入降级为可重试 `unavailable`，页面显示固定“操作不可用”文案；
- 自动化测试使用 Vitest 覆盖 DTO、dev transport、客户端、组件与页面行为（`src/api/contracts.test.ts` 等与源文件同目录）；
- 「设置」标签页的样式使用 `.agent-hub*` 命名空间内的独立 CSS，不依赖 `@bibit/feature-ui` 的 Settings Shell（插件已不声明 settings contribution）；

- Agent 控件常驻标签行（含设置页）：在设置页切换没有可见效果，它决定的是下次进入目录时读取哪个 Agent、以及安装目标（§7.2.4）；
- 市场的 `Installed` 徽标是版本无关的（装了任意版本即算已安装），且清单读取失败时**静默**降级为「没有徽标」，不提示原因；板端实机外观尚未验收；
- 「更新」「降级」实现为带选中版本的 `apm install <name>=<version>`，**依赖 apm 能替换已安装的另一个版本**；前端只把非零退出映射为固定失败文案，因此这一条必须板端实测。前端侧的能力门槛已放开（预检只在「同一版本已安装」时短路），但 apm 的实际行为不在本仓库控制范围内；
- 明暗主题由宿主的 `color-scheme` 驱动，插件的每个颜色都是 `light-dark()` 成对声明（§7.2.1）；深色一支是推导出来的，**板端实机深色外观尚未验收**，本次证据是离屏 WebKitGTK 探针 `docs/verification/probe-dark-mode.py`；
- 中英文由插件自带词典（`src/agentHubI18n.tsx`）提供，跟随宿主 `language`，目前只有 `en` 与 `zh-CN` 两种；新增语言需要同时扩展 `agentHubChinese`/`agentHubLocales` 与 `bibit.feature.json` 的 `contributions.locales`；
- 宿主 `language` 传入组件自 `bi-bit` 0.1.4 起；更早的宿主不传该值时页面固定为英文；
- 插件属于公司可信内部代码，不是不可信代码沙箱；
- 更新需要提升版本、重新签名并重新启动或刷新 Bibit；
- 删除系统 bundle 不会自动停用已激活版本；
- 当前平台没有无人值守停用插件的 CLI/API；
- 目标 Release Bibit 的信任库尚未登记 Agent Hub 正式公钥；
- 公司正式签名服务的具体调用 SOP 尚未由本仓库定义。
