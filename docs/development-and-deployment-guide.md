# Bibit Agent Hub 插件开发与部署指南

本文面向 Agent Hub 模块开发者、平台维护者及负责实施的 Coding Agent。按照本文操作，可以在不编译完整 Bibit 的情况下独立开发 Agent Hub 前端，通过公开 Host API 连接模块团队独立部署的 Store 服务，并把签名插件作为系统组件安装到 Bibit。

## 1. 适用版本与当前交付

| 项目 | 当前版本 |
| --- | --- |
| Agent Hub 插件 | `0.3.1` |
| `manifestSchemaVersion` | `1` |
| `sdkApiVersion` | `1` |
| `@bibit/feature-contracts` | `0.3.0` |
| `@bibit/feature-sdk` | `0.3.0` |
| `@bibit/feature-plugin-sdk` | `0.3.0` |
| `@bibit/feature-dev-host` | `0.3.0` |
| React / React DOM | `19.0.0` |
| 已验证目标 Bibit | `b5387833927e052fe3728bc0631cef2df0138092`（`bianbu/0.1.8`） |
| 宿主语言支持 | 插件中英文文案跟随宿主 `language`；需要 `bi-bit` 0.1.4 及以上的宿主（设置菜单 `titleKey` 同样自 0.1.4 起生效） |

当前插件提供两个贡献点：

- `pages.home`：显示在 Bibit 主导航的 Agent Hub 页面；
- `settings.settings`：显示在 Bibit 设置子菜单的 Agent Hub 设置页面。

两个贡献点都不包含语言设置项：页面中英文文案跟随 Bibit 系统语言（宿主传入 `language`），菜单、导航与描述键通过 `pluginLocales` 交给宿主解析。详细规则见 7.1。

当前 Demo 已实现 APC Power 展示与安装原型：通过 `powers.list.v1` 提供“我的 Power / Power 市场”两种数据范围、Agent / 类型 / tags 分层筛选、系列级卡片、版本选择与每页 20 张卡片的分页，并配套 Local Preview；通过 `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` 提供详情查看与单版本安装/卸载闭环。设置页仍提供实验 Agent 开关和刷新间隔两个字段。Power 下载、提交、审核、下架、恢复以及搜索等能力尚未实现，这些属于 Agent Hub 模块团队后续定制范围。

当前插件使用平台随目标 Bibit 一并发布的 `@bibit/feature-ui@0.3.0`，复用 `FeatureSettingsPage`、`Button`、状态组件和图标，并通过 Bibit 主题 token 适配明暗主题。该包必须与 React 及其余 SDK 一起锁定升级；不得直接导入 Bibit 私有 UI 源码。

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
│   ├── store.ts          # wire 校验 + settings 内存 echo
│   ├── sources.ts        # 与 Go 同语义的 APM/APC transport
│   └── *.test.ts
├── src/
│   ├── feature.tsx
│   ├── plugin.tsx
│   ├── AgentHubPage.tsx
│   ├── AgentHubSettingsPage.tsx
│   ├── agentHubI18n.tsx   # 中英文词典、Provider、菜单 locales
│   ├── agentHub.css
│   ├── api/
│   │   ├── contracts.ts          # 协议边界 DTO + wire 信封
│   │   ├── apm.ts                # installed 解析/聚合
│   │   ├── apc.ts                # market 解析
│   │   ├── powerCatalogClient.ts # 共享缓存客户端
│   │   └── catalogIntegrity.ts   # SHA-256 校验
│   └── components/
│       ├── PowerCard.tsx
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
│   ├── agenthub-provider.json     # Registry v2 drop-in
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
  "version": "0.3.1",
  "owner": "agent-hub-team",
  "display": {
    "titleKey": "agent-hub:title",
    "fallbackTitle": "Agent Hub",
    "iconKey": "store",
    "descriptionKey": "agent-hub:description",
    "fallbackDescription": "Browse and manage Agent packages"
  },
  "targets": ["desktop"],
  "requiredHostCapabilities": ["service:store", "file:transfer", "job:manage"],
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
        "navigation": {
          "group": "integrations",
          "order": 100,
          "titleKey": "agent-hub:settings",
          "fallbackTitle": "Agent Hub settings"
        }
      }
    ],
    "conversation": [],
    "locales": ["en", "zh-CN"]
  }
}
```

### 6.2 当前 Feature Module

```tsx
import type { FeatureModuleV1 } from '@bibit/feature-sdk'
import { AgentHubPage } from './AgentHubPage'
import { AgentHubSettingsPage } from './AgentHubSettingsPage'
import { agentHubLocales, withAgentHubI18n } from './agentHubI18n'

export const featureModule: FeatureModuleV1 = {
  sdkApiVersion: 1,
  locales: agentHubLocales,
  pages: { home: withAgentHubI18n(AgentHubPage) },
  settings: { settings: withAgentHubI18n(AgentHubSettingsPage) },
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

**语言切换不得重挂载。** 不要在 Provider 子树或页面上加 `key`，也不要把 `language` 放进列表请求的 effect 依赖；`withAgentHubI18n` 只更新 context，页面保持组件身份与在途请求。`src/AgentHubPage.test.tsx` 有对应回归：切换语言后 `powers.list.v1` 请求数不变、已打开的详情弹窗与已选版本保持不变。

**新增文案的顺序：**

1. 组件里写英文源串并使用 `t(...)`；
2. 在 `agentHubChinese` 增加同串中文（键必须是源码中出现过的字面量，`src/agentHubI18n.test.tsx` 会校验，防止拼写错或残留键）；
3. 若是菜单、导航或描述文案，同步更新 `agentHubLocales` 与 `bibit.feature.json` 的 `contributions.locales`、`titleKey` / `fallbackTitle`；
4. 在对应组件的语言切换测试里确认中英文两种渲染。

Local Preview 使用 `?lang=zh-CN` 打开中文界面，`dev/main.tsx` 右上角的下拉框可以在不刷新页面的情况下切换语言。

### 7.2 页面布局与滚动（页面自己持有滚动条）

宿主把页面 contribution 放在一个全高、无滚动的盒子里：`FeatureContributionHost` 的包装节点是 `h-full min-h-0`，而 `html, body, #root` 都是 `height: 100%; overflow: hidden`。**因此页面比视口高时不会被裁出滚动条，超出的内容直接不可达。**

规则：

- 页面根元素必须 `height: 100%` 并自己 `overflow-y: auto`（`.agent-hub` 就是这么做的），不要依赖宿主提供滚动；
- 一页最多 20 张卡片（`POWER_PAGE_SIZE` 由契约锁定为 20），所以列表长度必须由页面滚动兜住，分页控件用 `position: sticky; bottom: 0` 常驻可视区底部；
- 卡片高度不能跟着描述长度走：APC 目录里的描述从 1 行到 14 行都有，`.power-card__description` 是固定 3–4 行的无边框滚动区（窗口高 ≤820px 时 3 行），完整描述在详情弹窗里看；
- 换了查询（翻页、范围、Agent、类型、tags）后要把页面滚动位置归零；
- `src/agentHubLayout.test.ts` 以文本级契约守住以上几条（jsdom 没有排版引擎，这是唯一的自动化防线）。

Local Preview 的 `dev/devHostViewport.css` 把 Dev Host 画布压成固定高度，用来复现宿主的裁切契约——Dev Host 原本是自适应高度，会掩盖这类问题。

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

必须遵守：

- capability 不存在时显示 Agent Hub 局部错误，不直接回退到 `fetch`；
- `serviceId` 固定为 `store`；
- `operationId` 必须带版本，页面数据使用 `powers.list.v1`，详情/安装/卸载使用 `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1`；
- `params` 必须是 JSON object，由 `toListPowersParams` / `parsePowerTarget` / `parseInstallInput` 投影为字段闭集；
- timeout 必须在 `1..300000` 毫秒内；读取默认 30000 毫秒，写入（安装/卸载）默认 120000 毫秒；
- 单个请求最大 1 MiB，单个响应最大 4 MiB；正式发布前必须验证 `powers.list.v1` 单响应不超过 Host 的 4 MiB 上限；
- 不把 URL、header、authorization、token、API key、cookie、credential 或 secret 放入 `params`；
- 不显示或记录原始凭据、请求 header 或后端内部堆栈。

`powers.list.v1` 在插件 API 边界执行闭集运行时校验（`parseListPowersInput` / `parseListPowersResult`）：未知字段、非法 Power 类型、非 20 的 pageSize、版本乱序、重复或未排序 tags、market 携带 agent 等都会被拒绝。`powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` 用 `parsePowerTarget` / `parseInstallInput` 校验（安装必须带规范版本，卸载/详情不带版本；agent/type/name 必须满足规范命名）。`settings.get.v1` / `settings.update.v1` 由 store 服务处理（dev 为内存 echo；settings 持久化不在本期范围）。校验失败或后端返回未知结构时映射为局部错误态（`incompatible`），不能让页面白屏。

## 10. Store 服务协议

### 10.1 当前 operation

| operationId | params | result |
| --- | --- | --- |
| `powers.list.v1` | `ListPowersInput` | `ListPowersResult`（`ready` 或 `reset_required` 联合） |
| `powers.inspect.v1` | `PowerTarget` | `InspectResult`（`listJson`） |
| `powers.install.v1` | `InstallInput` | `MutationResult`（`exited`/`unavailable` 联合） |
| `powers.uninstall.v1` | `PowerTarget` | `MutationResult`（`exited`/`unavailable` 联合） |
| `settings.get.v1` | `{}` | `AgentHubSettingsV1` |
| `settings.update.v1` | `AgentHubSettingsV1` | `AgentHubSettingsV1` |
| `agents.upload.v1` | Job input `{displayName}` + input FileGrant | `{agentId,displayName,bytes,sha256}` |
| `agents.download.v1` | Job input `{agentId}` + output FileGrant | `{agentId,bytes,sha256}` |

`powers.list.v1` 是页面的业务数据 operation；`powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` 是详情与写入 operation，均通过共享安装状态 `installationStore` 驱动页面（见 10.5）。请求与结果类型（与 `src/api/contracts.ts` 一致）：

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
  tags: string[]          // 0–20 个 canonical tag，字典序排序且唯一，多项 OR
  page: number            // 从 1 开始
  pageSize: 20            // v1 固定
  snapshot?: string       // page=1 省略；page>1 必填并等于上一页结果 snapshot
}

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

前端 Agent 菜单固定为 bibit / codex / claude-code / hermes-agent 四个选项（`claude-code` 即 apm 中 Claude 的 id），由插件常量提供，不依赖 `facets.agents` 做发现；每次请求只解析所选 agent 的返回。`listJson` 由前端数据层用 `parseApmInstalledList` 解析为 `APMPowerRecord[]`，再经 `buildInstalledPowersResult` 完成 type/tags 过滤、按 type/name 聚合、去重、分页与 facets——这些聚合只存在于前端 `src/api/`，Provider 与 dev transport 不复制。

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
- 前端对写结果只区分 `exited` 与 `unavailable`，非零 `exitCode` 返回为正常结果，由 `operationMessage` 映射为固定文案（如“安装失败”/“卸载失败”），不透传 CLI stderr 或物理路径；
- 共享安装状态以 `JSON.stringify([agent,type,name])` 为条目键，跨详情弹窗与列表卡片复用同一份 state；全局写锁确保同一时刻只有一个变更在途，重复点击被阻止；
- 卸载的中断语义：发起后即进入 running 并阻止重复提交；若页面卸载或详情关闭，请求被取消但写命令可能已完成，重开页面靠刷新 installed 恢复真实状态。

### 10.6 Market 数据源（APC 公共接口）

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

APC 全量约束：只调用 `resources/version` 与 `resources`，不调用 `resources/list` 或 `resources/tags`；类型过滤、tag OR 过滤、系列聚合、分页与 facets 全在前端 `buildPowersResult` 完成。前端在解析 `catalogJson` 前先用 Web Crypto 对原始 UTF-8 字节计算 SHA-256 并与 `snapshot` 比对（`src/api/catalogIntegrity.ts`），不一致抛可重试 `unavailable` 且不写入缓存。默认 base 为 `https://developer.bianbu.xyz/api-server/apc/api/v1`；HTTP 客户端使用系统受信 CA，重定向 ≤5 跳且禁止 https→http 降级，无跳过 TLS 校验的开关。

### 10.7 部署与发布前置项

已实现并纳入两个 deb：

- Go 标准库 Provider（v1，`powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1`），`bibit-agenthub-cli`（Architecture: any）拥有 `/usr/libexec/bibit/bibit-agenthub` 与 `/etc/bibit/external-services.d/agenthub.json`（Registry `version: 2`、`protocolVersions: [1]`、managed stdio、`requestTimeoutMs: 120000`）；
- 前端 bundle 与 capability grant 仍在 `bibit-agenthub-plugin`（Architecture: all）；grant 的 store operations 追加 inspect/install/uninstall，capability 仍只有 `service:store`，不新增 job/file grant；
- 前端数据层在 dev 与生产共用，`dev/sources.ts` 与 Go Provider 语义一致。

发布与板端验收仍依赖以下前置项，缺少时如实记录阻塞：

- 按现有签名流程取得 0.2.3 的受信签名 bundle（开发签名不能代替 Release 信任链）；
- 构建环境提供 ≥1.26.5 的 Go 工具链（目标 suite 的 `golang-go` 可能只有旧版本，需回填工具链或记录阻塞）；
- 开发板安装两包并重启宿主，验证 Registry 加载、协议 v1 协商、两个 scope 真实数据与详情/安装/卸载闭环。

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

浏览器打开 Vite 输出地址；首页地址追加 `?lang=zh-CN` 即为中文界面，右上角下拉框可随时切换语言（不刷新页面）。Feature Dev Host 读取真实 Manifest 和 Feature Module，并通过 `dev/main.tsx` 的 `serviceConnections` 把 `powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` 路由到 Vite 中间件（`vite.config.ts` → `dev/store.ts`）提供的 Store。`scope=installed` 会真实执行 PATH 中的 `apm list --installed --agent=<selected> --json`（身份记录）；详情/安装/卸载分别执行 `apm list <name> --installed ...` / `apm install <name>=<version> ...` / `apm uninstall <name> ...`（argv 与 Go Provider 一致，读 30s / 写 120s）；`scope=market` 会每次请求真实拉取 APC 公开目录（`GET /resources/version` 取快照 + `GET /resources` 跟随重定向取全量列表），再按 `type` 过滤聚合；`settings.get.v1` / `settings.update.v1` 使用内存设置。此模式不启动、不编译 Bibit，也不要求远程 Store 后端在线；未安装 `apm` 时 installed 页显示可重试的 unavailable 错误，APC 不可达时 market 页显示可重试的 unavailable 错误。

market 每次点击类型/标签、翻页都重新拉取并解析 APC 全量列表（无本地 fixture、无跨请求缓存），覆盖 skill / plugin / mcp / agent 四种 Power 类型；installed 由真实 apm 输出驱动，Agent 菜单固定为 bibit / codex / claude-code / hermes-agent 四个选项。两种 scope 复用同一套筛选、聚合、分页、facets 与 snapshot 规则，与未来 Remote Store 一致。

APC Base URL 默认测试环境 `https://developer.bianbu.xyz/api-server/apc/api/v1`，可用 `APC_BASE_URL` 环境变量覆盖。测试环境证书不受信，dev-only 传输层（`vite.config.ts`）关闭了 TLS 校验；正式 CLI Provider 必须使用受信 CA。APC 公开目录无按类型列表端点，因此 market 采用“全量列表 + 客户端按 `type` 过滤”的映射。

冒烟检查（filters / version selection / pagination / warnings / Retry）：

- 默认进入“我的 Power / Bibit / skill”，第 1 页显示最多 20 张系列卡，翻页显示“第 X / Y 页”；
- “Power 市场”隐藏 Agent 层，Agent 层固定显示 bibit / codex / claude-code / hermes-agent 四个选项；
- 切换 Agent / 类型会清空失效 tags 并回到第 1 页；
- 选择多个 tag 时按 OR 过滤，tag 清单随上层筛选刷新；
- 同一系列切换版本时 description 与 tags 同步变化；
- 选择未安装任何 Power 的 Agent 时，页面显示空内容（No Powers are available.）；
- 切换语言后当前列表、筛选、分页与已打开的详情弹窗保持不变，只替换文案，且不重新请求 `powers.list.v1`；
- 停止或未连接 Store 时页面显示局部错误与 Retry，恢复后 Retry 可恢复列表；
- `Settings · settings` 可以读取当前 Mock 设置、保存后再次进入值一致；
- 未知 operation 返回错误，而不是伪造成功。

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

构建：

```bash
npm test
npm run typecheck
npm run build:dev
npm run build:plugin
```

产物：

```text
artifacts/agent-hub-0.3.1.bibit-plugin.tgz
```

检查：

```bash
tar -tzf artifacts/agent-hub-0.3.1.bibit-plugin.tgz
tar -xOf artifacts/agent-hub-0.3.1.bibit-plugin.tgz plugin.json
tar -xOf artifacts/agent-hub-0.3.1.bibit-plugin.tgz plugin.sig
sha256sum artifacts/agent-hub-0.3.1.bibit-plugin.tgz
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
artifacts/agent-hub-0.3.1.bibit-plugin.tgz
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
  artifacts/agent-hub-0.3.1.bibit-plugin.tgz \
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
export SIGNED_AGENT_HUB_BUNDLE=/absolute/path/agent-hub-0.3.1.bibit-plugin.tgz
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
- Dev Host 同时列出 `Page · home` 和 `Settings · settings`；
- Mock 市场筛选、系列卡、版本选择、分页、warning 与 Retry 可见；
- Mock 设置可以读取和保存；
- bundle 包含 `plugin.json`、`plugin.sig`、JS 和 CSS；
- `.bibit-keys` 和 `artifacts` 没有进入 Git。

### 16.2 Store 短请求与 Provider 协议

如果模块同时提供 HTTP Provider，使用真实 HTTP 服务验证：

1. `POST /bibit/v1/invoke` 可达；
2. 三个 v1 operation 均返回合法信封；
3. 响应回显请求 `requestId`；
4. `powers.list.v1` 返回通过闭集运行时校验的 `ready` / `reset_required` 结果；
5. `settings.update.v1` 后再次调用 `settings.get.v1` 得到持久化值；
6. 重启 Store 服务后设置值仍存在；
7. 非法 operation、超时、未授权和离线产生约定错误；
8. 日志不包含 token 或完整凭据。

当前 AgentHub CLI 路径还必须执行 `/usr/libexec/bibit/bibit-agenthub --self-test`（或本机二进制路径），并确认 `bibit.initialize` 协商 v1、`powers.list.v1` 完整、`invoke` 能力与 Registry 的 `protocolVersions: [1]` 一致。HTTP 探针不能替代 CLI 协商和传输验收。

### 16.3 Bibit 插件加载

验收：

- 目标 Bibit 信任正式 `keyId`；
- 系统目录只有预期 Agent Hub bundle；
- Bibit 插件管理页显示 `agent-hub@0.3.1` 已激活；
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

1. 在 Store 服务准备一条唯一测试 Power 系列，例如 `acceptance-power-20260826`；
2. 启动目标 Bibit，确认插件已激活且 `service:store` 已授予；
3. 打开 Agent Hub，确认唯一测试 Power 的 name、version、description 与 tags 来自真实 Store；
4. 停止 Store 服务，点击 Retry，确认只显示 Agent Hub 局部错误；
5. 确认 Bibit 对话、设置和其他页面仍可操作；
6. 恢复 Store 服务，点击 Retry，确认列表恢复；
7. 把 Bibit 系统语言切成中文，确认主导航、设置子菜单标题、页面文案与操作提示变为中文，且切换瞬间列表不重新请求、详情弹窗不关闭；
8. 切回英文，确认文案回到英文；
9. 在默认窗口（1200×800）与最小窗口（1024×740）下打开 Power 市场：卡片等高、描述在无边框框内可上下滚动、分页控件常驻可见，向下滚动能到达第 20 张卡片；翻页或切换类型后列表回到顶部，没有横向滚动条；
10. 打开 Agent Hub 设置，修改 `showExperimental` 和 `refreshMinutes` 并保存；
11. 关闭并重新打开设置页，确认读取到保存值；
12. 重启 Bibit 和 Store 服务，再次确认设置值；
13. 保存 Store 服务按 `requestId` 关联的请求日志、Bibit 日志、页面截图和最终设置读取结果。

入口可见、端口可达或 Dev Host Mock 成功都不算真实端到端接通。

## 17. 常见问题

### 插件已加载但主导航没有 Agent Hub

检查 Manifest 的 `pages.home`、`navigation.group`、Feature Module 的 `pages.home`、插件激活状态和重复 Feature ID。不要直接修改 Bibit 侧边栏清单。

### 设置页标题或菜单滚动消失

检查插件是否复制了 `HeaderPage`、`SettingsMenu` 或外层滚动容器。设置 renderer 只提供内容，宿主负责 Settings Shell。

### 页面显示 Store capability 不可用

依次检查 Manifest 的 `requiredHostCapabilities`、`/etc/bibit/feature-capability-grants.d/agenthub.json`、operation allowlist、Provider Registry 和插件是否运行在 `main` surface。不要回退到直接 `fetch`。

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
- 真实 Power 列表、设置持久化、错误映射与重试证据；
- 中英文切换证据（系统语言切换后页面文案、菜单标题与不重新请求的观察结果）；
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
- 当前插件实现 APC Power 展示原型（筛选、系列卡、版本选择、每页 20 的分页、warning 与 Retry）、详情弹窗与单版本安装/卸载，和两个设置字段；
- Power 下载、提交、审核、下架、恢复以及搜索尚未实现；
- `powers.list.v1` / `powers.inspect.v1` / `powers.install.v1` / `powers.uninstall.v1` DTO 已做闭集运行时校验；`settings.get.v1` / `settings.update.v1` 由 store 服务处理（dev 为内存 echo，settings 持久化不在本期范围）；
- 安装/卸载依赖 Agent 自身 `apm` CLI；无 `apm` 时详情与写入降级为可重试 `unavailable`，页面显示固定“操作不可用”文案；
- 自动化测试使用 Vitest 覆盖 DTO、dev transport、客户端、组件与页面行为（`src/api/contracts.test.ts` 等与源文件同目录）；
- 设置页复用目标 Bibit 同版本的 `@bibit/feature-ui`；市场页使用 `.agent-hub*` 命名空间内的独立 CSS；
- 中英文由插件自带词典（`src/agentHubI18n.tsx`）提供，跟随宿主 `language`，目前只有 `en` 与 `zh-CN` 两种；新增语言需要同时扩展 `agentHubChinese`/`agentHubLocales` 与 `bibit.feature.json` 的 `contributions.locales`；
- 宿主 `language` 传入组件自 `bi-bit` 0.1.4 起；更早的宿主不传该值时页面固定为英文；
- 插件属于公司可信内部代码，不是不可信代码沙箱；
- 更新需要提升版本、重新签名并重新启动或刷新 Bibit；
- 删除系统 bundle 不会自动停用已激活版本；
- 当前平台没有无人值守停用插件的 CLI/API；
- 目标 Release Bibit 的信任库尚未登记 Agent Hub 正式公钥；
- 公司正式签名服务的具体调用 SOP 尚未由本仓库定义。
