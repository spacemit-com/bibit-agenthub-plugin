import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react'

/**
 * A user-facing text produced outside React (the api layer, the installation
 * store) together with the values its `{placeholder}` slots need. The text is
 * the English source string; the render boundary translates it.
 */
export interface TranslatableText {
  text: string
  values?: Record<string, string | number>
}

export type AgentHubLanguage = 'en' | 'zh'

export type AgentHubTranslate = (
  source: string,
  values?: Record<string, string | number>
) => string

/**
 * Chinese copy for the plugin's own UI. Keys are the English source strings
 * exactly as they appear in the components and in the api layer, so a missing
 * entry degrades to the English source instead of an empty label.
 *
 * Product names (Power, Agent, bibit) stay untranslated, and `Capabilities` is
 * the page's own title rather than a product name. Entries that already existed
 * in Chinese before i18n keep their original wording.
 */
const zh: Readonly<Record<string, string>> = {
  // ---- page header ----
  'Capabilities': '能力中心',
  'Loading Powers…': '正在加载 Power…',
  'Retry': '重试',
  'Refresh': '刷新',
  'Available Powers': '可用的 Power',
  'No powers match these tags.': '没有匹配这些标签的能力。',
  'Clear tags': '清除标签',
  'No {type} powers are installed for {agent}.': '{agent} 没有安装 {type} 类型的能力。',
  'No {type} powers in the catalog.': '目录里没有 {type} 类型的能力。',
  'Store capability is not available.': 'Store 能力不可用。',
  'Power catalog request was cancelled.': 'Power 目录请求已取消。',
  'Power catalog is offline.': 'Power 目录处于离线状态。',
  'Power catalog request timed out.': 'Power 目录请求超时。',
  'Power catalog authorization is required.': '需要 Power 目录授权。',
  'Power catalog service is incompatible with this plugin.':
    'Power 目录服务与此插件不兼容。',
  'Power catalog is unavailable.': 'Power 目录不可用。',
  'Power catalog provider crashed.': 'Power 目录 Provider 已崩溃。',
  'Power catalog resources are exhausted.': 'Power 目录资源已耗尽。',
  'Could not load Power catalog.': '无法加载 Power 目录。',
  'Power catalog is unavailable: the apm CLI could not be started.':
    'Power 目录不可用：无法启动 apm CLI。',
  'Power catalog is unavailable: the APC catalog could not be loaded.':
    'Power 目录不可用：无法加载 APC 目录。',
  'Diagnostic ID: {diagnosticId}': '诊断 ID：{diagnosticId}',

  // ---- create-resource entry (host:actions) ----
  'Create': '创建',
  'Opening a new conversation is unavailable because this host does not provide it.':
    '当前宿主未提供发起会话的能力，入口不可用。',
  'This host version does not support opening a new conversation.':
    '当前宿主不支持发起会话。',
  'The host rejected the request to open a new conversation.':
    '宿主拒绝了发起会话的请求。',
  'Clear the input box, then click again.': '请先清空输入框，再重试。',
  'Use the using-apm skill to create a new Power resource.':
    '请使用using-apm技能帮我新建一个能力资源。',
  'Resource type (Skill/Plugin/MCP/Expert):':
    '资源类型（Skill/Plugin/MCP/Expert）：',
  'What the resource should do:': '资源的要求：',

  // ---- filters and cards ----
  'Scope': '范围',
  'Agent': 'Agent',
  'Agent: {agent}': 'Agent：{agent}',
  'My Capabilities': '我的能力',
  'Capability Market': '能力市场',
  'Type': '类型',
  'Tags': '标签',
  'Version': '版本',
  'Installed': '已安装',
  'New': '新版本',

  // ---- details dialog ----
  'Close': '关闭',
  'Only the bibit agent supports this type.': '该类型仅支持 bibit Agent。',
  'Reading installation state…': '正在读取安装状态…',
  'Checking…': '检查中…',
  'Running…': '执行中…',
  'Confirming installation state…': '确认安装状态…',
  'Not installed': '未安装',
  'Installed {version}': '已安装 {version}',
  '{version} (installed)': '{version}（已安装）',
  'Install': '安装',
  'Update': '更新',
  'Downgrade': '降级',
  'Uninstall': '卸载',

  // ---- pagination ----
  'Power pages': 'Power 分页',
  'Previous page': '上一页',
  'Page number': '页码',
  'Next page': '下一页',
  'Page': '第',
  'of {total}': '/ {total} 页',

  // ---- settings tab (in-page, next to My Capabilities / Capability Market) ----
  'Settings': '设置',
  'Loading settings…': '正在加载设置…',
  'Store capability is unavailable.': 'Store 能力不可用。',
  'Settings synchronized.': '设置已同步。',
  'Could not load Agent Hub settings.': '无法加载 Agent Hub 设置。',
  'Saving…': '正在保存…',
  'Key saved.': 'Key 已保存。',
  'Could not save the key.': '无法保存该 Key。',
  'Key deleted.': 'Key 已删除。',
  'Could not delete the key.': '无法删除该 Key。',
  'Key enabled.': 'Key 已启用。',
  'Could not enable the key.': '无法启用该 Key。',

  // ---- installation store and operation messages ----
  'This version is already installed; uninstall it first.':
    '该版本已安装，请先卸载后再安装',
  'Refresh failed; the installed state could not be confirmed.':
    '刷新失败，无法确认安装状态',
  'This installation is not authorized for that operation; do not retry.':
    '当前安装未授权此操作，不建议重复执行',
  'The current provider does not support that operation; do not retry.':
    '当前 Provider 不支持该操作，不建议重复执行',
  'The operation result needs confirmation; refresh to read the actual state.':
    '操作结果待确认，请刷新实际状态',
  'The operation is unavailable; the installed state could not be confirmed.':
    '操作不可用，无法确认安装状态',
  'The command failed and the current installed state could not be confirmed.':
    '执行异常，且无法确认当前安装状态',
  'The command completed, but the installed state could not be confirmed; refresh.':
    '命令已执行完成，安装状态确认失败，请刷新',
  'Installation complete.': '安装完成',
  'Uninstall complete.': '卸载完成',
  'The command finished, but the installed state does not match the expectation.':
    '命令已结束，但当前安装状态与预期不一致',
  'The command reported an error; version {version} is confirmed installed.':
    '命令报告异常；当前已确认安装 {version}',
  'The command reported an error; nothing is installed.':
    '命令报告异常；当前未安装',
  'The command failed; version {version} is still installed.':
    '命令执行失败，当前仍安装 {version}',
  'The command failed; nothing is installed.': '命令执行失败，当前未安装',

  // ---- custom (hand-installed) resources ----
  'Custom': '自定义',
  'No version': '无版本',
  'Installed outside Agent Hub; not managed by APM.': '在 Agent Hub 之外手动安装，不受 APM 管理。',
  'Upload': '上传',
  'Delete': '删除',
  'Upload to APC': '上传到 APC',
  'Publish message': '发布说明',
  'Required for the APC submission.': 'APC 提交必填。',
  'Upload requires Power format v2.': '上传要求资源满足 Power 格式 v2。',
  'Cancel': '取消',
  'Uninstall this Power?': '卸载该 Power？',
  'Update this Power?': '更新该 Power？',
  'Downgrade this Power?': '降级该 Power？',
  'Removes {type} "{name}" for {agent}.': '将卸载 {agent} 的 {type} “{name}”。',
  'Replaces {type} "{name}" for {agent} with {version}.':
    '将把 {agent} 的 {type} “{name}” 替换为 {version}。',
  'Confirm uninstall': '确认卸载',
  'Confirm update': '确认更新',
  'Confirm downgrade': '确认降级',
  'Confirm delete': '确认删除',
  'Delete this resource?': '删除该资源？',
  'Removes the local {type} "{name}" for {agent}. This cannot be undone.':
    '将删除 {agent} 本地的 {type} “{name}”，且不可恢复。',
  'Uploading…': '正在上传…',
  'Deleting…': '正在删除…',
  'Upload complete.': '上传完成',
  'Upload complete: {submissionId}': '上传完成：{submissionId}',
  'Upload failed.': '上传失败',
  'Upload failed: {reason}': '上传失败：{reason}',
  'This resource does not meet the Power format required for upload; fix it and retry.':
    '该资源不满足上传所需的 Power 格式，请修正后重试。',
  'Deleted {type} "{name}".': '已删除 {type} “{name}”。',
  'The custom resource request was cancelled.': '自定义资源请求已取消。',
  'The custom resource service is offline.': '自定义资源服务处于离线状态。',
  'The custom resource request timed out.': '自定义资源请求超时。',
  'The custom resource service is incompatible with this plugin.': '自定义资源服务与此插件不兼容。',
  'The custom resource service is unavailable.': '自定义资源服务不可用。',
  'The custom resource provider crashed.': '自定义资源 Provider 已崩溃。',
  'The custom resource request exceeded a resource limit.': '自定义资源请求超出资源上限。',
  'The custom resource operation failed.': '自定义资源操作失败。',
  'APC API Key is not configured; set it in the Settings tab.':
    '未配置 APC API Key，请在「设置」标签页中填写。',
  'Skipped {type} "{name}": {expected} is missing.': '已跳过 {type} “{name}”：缺少 {expected}。',
  'Skipped {type} "{name}": its {expected} does not meet the minimum format.':
    '已跳过 {type} “{name}”：{expected} 不满足最低格式要求。',
  'Custom resources could not be scanned for this Agent.': '无法扫描该 Agent 的自定义资源。',

  // ---- settings: APC credential ----
  'APC API Key': 'APC API Key',
  'Required to upload custom resources to APC.': '用于把自定义资源上传到 APC。',
  'No key saved': '尚未保存 Key',
  '{count} saved': '已保存 {count} 个',
  'Save key': '保存 Key',
  'The saved key is only shown masked.': '已保存的 Key 只显示遮蔽形式。',
  'Saved API Keys': '已保存的 API Key',
  'Enabled': '已启用',
  'Not enabled': '未启用',
  'Enable': '启用',
  'Enabling…': '正在启用…',
  'Enable key {preview}': '启用 Key {preview}',
  'Delete key {preview}': '删除 Key {preview}',
  // 'Delete' / 'Deleting…' are shared with the custom-resource dialog above.
}

export const agentHubChinese: Readonly<Record<string, string>> = zh

/**
 * Menu, navigation and description copy the host resolves from the plugin
 * bundle's `pluginLocales` export under the `agent-hub` namespace. Language
 * keys are the host's `en` / `zh-CN` values.
 */
export const agentHubLocales = {
  en: {
    title: 'Capabilities',
    description: 'Browse and manage Agent packages',
  },
  'zh-CN': {
    title: '能力中心',
    description: '浏览和管理 Agent 包',
  },
} as const

function format(
  template: string,
  values?: Record<string, string | number>
): string {
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? `{${key}}`)
  )
}

/** Reads the host language prop; anything that is not Chinese means English. */
export function normalizeAgentHubLanguage(
  language?: string
): AgentHubLanguage {
  return language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const AgentHubI18nContext = createContext<AgentHubTranslate>((source, values) =>
  format(source, values)
)

/**
 * The normalized host language, exposed next to the translator so components can
 * pick between localized data fields (for example a Power's `name_zh` and
 * `name_en`) with the same value the copy is rendered in.
 */
const AgentHubLanguageContext = createContext<AgentHubLanguage>('en')

export function AgentHubI18nProvider({
  language,
  children,
}: {
  language?: string
  children: ReactNode
}) {
  const normalized = normalizeAgentHubLanguage(language)
  const translate = useMemo<AgentHubTranslate>(
    () => (source, values) =>
      format(normalized === 'zh' ? zh[source] ?? source : source, values),
    [normalized]
  )
  return (
    <AgentHubLanguageContext.Provider value={normalized}>
      <AgentHubI18nContext.Provider value={translate}>
        {children}
      </AgentHubI18nContext.Provider>
    </AgentHubLanguageContext.Provider>
  )
}

/**
 * Returns an identity-stable translator so a language change only updates
 * rendered copy: effects, request callbacks and the page's in-flight reads keep
 * their identity and are never restarted by the switch.
 */
export function useAgentHubI18n(): AgentHubTranslate {
  const current = useContext(AgentHubI18nContext)
  const currentRef = useRef(current)
  currentRef.current = current
  return useCallback<AgentHubTranslate>(
    (source, values) => currentRef.current(source, values),
    []
  )
}

/** Reads the normalized host language; `en` outside a provider. */
export function useAgentHubLanguage(): AgentHubLanguage {
  return useContext(AgentHubLanguageContext)
}

/**
 * Injects the host `language` prop as translation context. The subtree is never
 * key-remounted, so an open dialog and unsaved state survive the switch.
 */
export function withAgentHubI18n<P extends { language?: string }>(
  Component: ComponentType<P>
): ComponentType<P> {
  function Localized(props: P) {
    return (
      <AgentHubI18nProvider language={props.language}>
        <Component {...props} />
      </AgentHubI18nProvider>
    )
  }
  const name = Component.displayName ?? Component.name ?? 'Component'
  Localized.displayName = `withAgentHubI18n(${name})`
  return Localized
}
