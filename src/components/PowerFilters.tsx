import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AgentSwitcher } from './AgentSwitcher'
import { useAgentHubI18n } from '../agentHubI18n'
import { powerTypesForAgent, type PowerScope, type PowerType } from '../api/contracts'

/**
 * The page's first-level tab. `PowerScope` stays the wire-level data scope, so
 * the Settings tab is a UI sibling of the two catalog scopes and never reaches
 * a `powers.list.v1` request.
 */
export type PowerTab = PowerScope | 'settings'

export interface PowerFiltersProps {
  tab: PowerTab
  agents: readonly string[]
  agent: string
  type: PowerType
  availableTags: readonly string[]
  selectedTags: readonly string[]
  /** A bulk upgrade is running: the tabs and the Agent control are frozen. */
  upgrading?: boolean
  onTabChange(tab: PowerTab): void
  onAgentChange(agent: string): void
  onTypeChange(type: PowerType): void
  onTagsChange(tags: string[]): void
  onUpgrade?(): void
  search?: ReactNode
}

export function PowerFilters({
  tab,
  agents,
  agent,
  type,
  availableTags,
  selectedTags,
  upgrading = false,
  onTabChange,
  onAgentChange,
  onTypeChange,
  onTagsChange,
  onUpgrade,
  search,
}: PowerFiltersProps) {
  const t = useAgentHubI18n()
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsRef = useRef<HTMLDivElement>(null)
  const tagsTriggerRef = useRef<HTMLButtonElement>(null)
  const tagsMenuId = useId()

  useEffect(() => { setTagsOpen(false) }, [tab, agent, type])
  useEffect(() => {
    if (!tagsOpen) return
    const dismissOutside = (event: PointerEvent) => {
      if (!tagsRef.current?.contains(event.target as Node)) setTagsOpen(false)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [tagsOpen])

  return (
    <div className="power-filters">
      <div className="power-filters__scopes">
        {/* The tab group and the Agent control share the tab row but not the
            role: the group is the three scopes, and the Agent control is a
            sibling of it, not a fourth tab. */}
        <div className="power-filters__tabs" role="group" aria-label={t('Scope')}>
          <button
            type="button"
            className="power-filters__scope"
            aria-pressed={tab === 'installed'}
            disabled={upgrading}
            onClick={() => tab !== 'installed' && onTabChange('installed')}
          >
            {t('My Capabilities')}
          </button>
          <button
            type="button"
            className="power-filters__scope"
            aria-pressed={tab === 'market'}
            disabled={upgrading}
            onClick={() => tab !== 'market' && onTabChange('market')}
          >
            {t('Capability Market')}
          </button>
          <button
            type="button"
            className="power-filters__scope"
            aria-pressed={tab === 'settings'}
            disabled={upgrading}
            onClick={() => tab !== 'settings' && onTabChange('settings')}
          >
            {t('Settings')}
          </button>
        </div>
        {/* The upgrade entry sits immediately left of the Agent control, and the two
            travel together as the tab row's right-hand group: `margin-left: auto` on
            this wrapper is the whole of "far right". It cannot stay on the Agent
            switcher, or the two auto margins would split the free space and the pair
            would drift apart. */}
        <div className="power-filters__actions">
          {onUpgrade && (
            <button
              type="button"
              className="power-filters__upgrade"
              disabled={upgrading}
              aria-busy={upgrading}
              onClick={onUpgrade}
            >
              {upgrading && <span className="agent-hub__spinner" aria-hidden="true" />}
              {t('Update all')}
            </button>
          )}
          <AgentSwitcher agents={agents} agent={agent} onAgentChange={onAgentChange} />
        </div>
      </div>
      {/* Type and tag filters describe the catalog only; the Settings tab has
          neither, so its panel would be a row of controls that do nothing. */}
      {tab !== 'settings' && (
        <div className="power-filters__panel">
          <label className="power-filters__type-field">
            <span>{t('Type')}</span>
            <select
              className="power-filters__type-select"
              aria-label={t('Type')}
              value={type}
              onChange={(event) => {
                const next = event.target.value as PowerType
                if (next !== type) onTypeChange(next)
              }}
            >
              {powerTypesForAgent(agent).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <div
            className="power-filters__tag-dropdown"
            ref={tagsRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTagsOpen(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setTagsOpen(false)
                tagsTriggerRef.current?.focus()
                return
              }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
              event.preventDefault()
              if (!tagsOpen) {
                setTagsOpen(true)
                requestAnimationFrame(() => tagsRef.current?.querySelector<HTMLInputElement>('input')?.focus())
                return
              }
              const options = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input'))
              if (!options.length) return
              const index = options.indexOf(document.activeElement as HTMLInputElement)
              const direction = event.key === 'ArrowDown' ? 1 : -1
              const next = index < 0
                ? direction === 1 ? 0 : options.length - 1
                : (index + direction + options.length) % options.length
              options[next].focus()
            }}
          >
            <button
              ref={tagsTriggerRef}
              type="button"
              className="power-filters__tag-trigger"
              aria-label={t('Tags')}
              aria-haspopup="dialog"
              aria-expanded={tagsOpen}
              aria-controls={tagsMenuId}
              onClick={() => setTagsOpen((open) => !open)}
            >
              <span>{t('Tags')}</span>
              <span className="power-filters__tag-value">{selectedTags.length ? selectedTags.join(', ') : t('Any')}</span>
              <span aria-hidden="true">⌄</span>
            </button>
            {tagsOpen && (
              <div id={tagsMenuId} className="power-filters__tag-menu" role="dialog" aria-label={t('Tags')}>
                {availableTags.map((tag) => (
                  <label key={tag}>
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(tag)}
                      onChange={() => {
                        const next = selectedTags.includes(tag)
                          ? selectedTags.filter((value) => value !== tag)
                          : [...selectedTags, tag]
                        onTagsChange([...new Set(next)].sort())
                      }}
                    />
                    <span>{tag}</span>
                  </label>
                ))}
                <button type="button" disabled={!selectedTags.length} onClick={() => onTagsChange([])}>
                  {t('Clear tags')}
                </button>
              </div>
            )}
          </div>
          {search && <div className="power-filters__search">{search}</div>}
        </div>
      )}
    </div>
  )
}
