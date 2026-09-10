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
 * Product names (Agent Hub, Power, Agent, bibit) stay untranslated. Entries
 * that already existed in Chinese before i18n keep their original wording.
 */
const zh: Readonly<Record<string, string>> = {
  // ---- Agent Hub page ----
  'INTERNAL CATALOG': '内部目录',
  'Loading Powers…': '正在加载 Power…',
  'Retry': '重试',
  'No Powers are available.': '没有可用的 Power。',
  'Available Powers': '可用的 Power',
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

  // ---- filters and cards ----
  'Scope': '范围',
  'Agent': 'Agent',
  'My Powers': '我的 Power',
  'Power market': 'Power 市场',
  'Type': '类型',
  'Tags': '标签',
  'Version': '版本',

  // ---- details dialog ----
  'Close': '关闭',
  'Only the bibit agent supports this type.': '该类型仅支持 bibit Agent。',
  'Switch to bibit': '切换到 bibit',
  'Reading installation state…': '正在读取安装状态…',
  'Checking…': '检查中…',
  'Running…': '执行中…',
  'Confirming installation state…': '确认安装状态…',
  'Not installed': '未安装',
  'Installed {version}': '已安装 {version}',
  'Install': '安装',
  'Uninstall': '卸载',

  // ---- pagination ----
  'Power pages': 'Power 分页',
  'Previous page': '上一页',
  'Page number': '页码',
  'Next page': '下一页',
  'Page': '第',
  'of {total}': '/ {total} 页',

  // ---- settings page ----
  'CATALOG PREFERENCES': '目录偏好',
  'Agent Hub settings': 'Agent Hub 设置',
  'Experimental Agents': '实验性 Agent',
  'Include preview Agents in the catalog.': '在目录中包含预览版 Agent。',
  'Catalog refresh': '目录刷新',
  'Refresh interval in minutes.': '刷新间隔（分钟）。',
  'Save settings': '保存设置',
  'Loading settings…': '正在加载设置…',
  'Store capability is unavailable.': 'Store 能力不可用。',
  'Settings synchronized.': '设置已同步。',
  'Could not load Agent Hub settings.': '无法加载 Agent Hub 设置。',
  'Saving…': '正在保存…',
  'Settings saved.': '设置已保存。',
  'Could not save Agent Hub settings.': '无法保存 Agent Hub 设置。',

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
}

export const agentHubChinese: Readonly<Record<string, string>> = zh

/**
 * Menu, navigation and description copy the host resolves from the plugin
 * bundle's `pluginLocales` export under the `agent-hub` namespace. Language
 * keys are the host's `en` / `zh-CN` values.
 */
export const agentHubLocales = {
  en: {
    title: 'Agent Hub',
    description: 'Browse and manage Agent packages',
    settings: 'Agent Hub settings',
  },
  'zh-CN': {
    title: 'Agent Hub',
    description: '浏览和管理 Agent 包',
    settings: 'Agent Hub 设置',
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
    <AgentHubI18nContext.Provider value={translate}>
      {children}
    </AgentHubI18nContext.Provider>
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
