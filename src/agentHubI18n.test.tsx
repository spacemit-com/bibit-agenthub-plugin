import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  AgentHubI18nProvider,
  agentHubChinese,
  agentHubLocales,
  normalizeAgentHubLanguage,
  useAgentHubI18n,
  useAgentHubLanguage,
} from './agentHubI18n'

afterEach(cleanup)

function Probe({ source }: { source: string }) {
  const t = useAgentHubI18n()
  return <p data-testid="value">{t(source)}</p>
}

function LanguageProbe() {
  return <p data-testid="language">{useAgentHubLanguage()}</p>
}

function ValueProbe() {
  const t = useAgentHubI18n()
  return (
    <p data-testid="value">
      {t('Installed {version}', { version: 'v1.2.3' })}
      {'|'}
      {t('Installed {version}', {})}
    </p>
  )
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('normalizeAgentHubLanguage', () => {
  it('treats every Chinese variant as zh and everything else as en', () => {
    expect(normalizeAgentHubLanguage('zh')).toBe('zh')
    expect(normalizeAgentHubLanguage('zh-CN')).toBe('zh')
    expect(normalizeAgentHubLanguage('ZH-hans')).toBe('zh')
    expect(normalizeAgentHubLanguage('en')).toBe('en')
    expect(normalizeAgentHubLanguage('en-US')).toBe('en')
  })

  it('defaults to English when the host omits the language prop', () => {
    expect(normalizeAgentHubLanguage(undefined)).toBe('en')
    expect(normalizeAgentHubLanguage('')).toBe('en')
  })
})

describe('AgentHubI18nProvider', () => {
  it('renders the English source unchanged for English hosts', () => {
    render(
      <AgentHubI18nProvider language="en">
        <Probe source="No powers match these tags." />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('value').textContent).toBe('No powers match these tags.')
  })

  it('renders Chinese copy for a Chinese host', () => {
    render(
      <AgentHubI18nProvider language="zh-CN">
        <Probe source="No powers match these tags." />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('value').textContent).toBe('没有匹配这些标签的能力。')
  })

  it('interpolates the type and agent into the empty-list copy', () => {
    // The empty-list copy is the one place a translated string carries the filters that
    // produced it, so the placeholders have to survive into both languages.
    function EmptyProbe() {
      const t = useAgentHubI18n()
      return <p data-testid="value">{t('No {type} powers are installed for {agent}.', { type: 'expert', agent: 'bibit' })}</p>
    }
    render(
      <AgentHubI18nProvider language="zh-CN">
        <EmptyProbe />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('value').textContent).toBe('bibit 没有安装 expert 类型的能力。')
  })

  it('switches copy when only the language prop changes', () => {
    const view = render(
      <AgentHubI18nProvider language="en">
        <Probe source="Install" />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('value').textContent).toBe('Install')
    view.rerender(
      <AgentHubI18nProvider language="zh-CN">
        <Probe source="Install" />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('value').textContent).toBe('安装')
  })

  it('falls back to the source string instead of an empty label', () => {
    render(
      <AgentHubI18nProvider language="zh-CN">
        <Probe source="A string without a dictionary entry." />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('value').textContent).toBe(
      'A string without a dictionary entry.'
    )
  })

  it('interpolates values and keeps unresolved slots visible', () => {
    render(
      <AgentHubI18nProvider language="en">
        <ValueProbe />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('value').textContent).toBe(
      'Installed v1.2.3|Installed {version}'
    )
  })

  it('translates the source outside a provider, so unit tests read English', () => {
    render(<Probe source="Install" />)
    expect(screen.getByTestId('value').textContent).toBe('Install')
  })
})

describe('useAgentHubLanguage', () => {
  it('exposes the normalized host language next to the translator', () => {
    const view = render(
      <AgentHubI18nProvider language="zh-CN">
        <LanguageProbe />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('language').textContent).toBe('zh')

    view.rerender(
      <AgentHubI18nProvider language="en-US">
        <LanguageProbe />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('language').textContent).toBe('en')
  })

  it('defaults to en outside a provider and for an omitted host language', () => {
    render(<LanguageProbe />)
    expect(screen.getByTestId('language').textContent).toBe('en')

    cleanup()
    render(
      <AgentHubI18nProvider>
        <LanguageProbe />
      </AgentHubI18nProvider>
    )
    expect(screen.getByTestId('language').textContent).toBe('en')
  })
})

describe('agentHubLocales', () => {
  it('declares the same menu keys for every shipped locale', () => {
    const english = Object.keys(agentHubLocales.en).sort()
    const chinese = Object.keys(agentHubLocales['zh-CN']).sort()
    expect(chinese).toEqual(english)
    // The plugin ships no settings contribution any more, so the namespace only
    // carries the page's own menu copy.
    expect(english).toEqual(['description', 'title'])
  })

  it('keeps the manifest display keys resolvable', () => {
    for (const locale of Object.values(agentHubLocales)) {
      expect(locale.title).toBeTruthy()
      expect(locale.description).toBeTruthy()
    }
  })
})

describe('Chinese dictionary', () => {
  it('maps every key to a non-empty Chinese value', () => {
    const empty = Object.entries(agentHubChinese)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key)
    expect(empty).toEqual([])
  })

  it('only uses keys that still exist as literals in the plugin sources', () => {
    // Guards against a typo or a stale key silently dropping a translation.
    const dir = join(process.cwd(), 'src')
    const contents = sourceFiles(dir)
      .filter((file) => !file.includes('.test.') && !file.endsWith('agentHubI18n.tsx'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    const orphans = Object.keys(agentHubChinese).filter(
      (key) => !contents.includes(`'${key}'`) && !contents.includes(`"${key}"`)
    )
    expect(orphans).toEqual([])
  })
})
