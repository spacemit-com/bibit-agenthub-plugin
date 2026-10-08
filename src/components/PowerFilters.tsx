import { useRef } from 'react'
import { ScrollThumb } from '../ScrollThumb'
import { AgentSwitcher } from './AgentSwitcher'
import { useAgentHubI18n } from '../agentHubI18n'
import { resolvePowerTypeLabel } from '../displayFields'
import { POWER_TYPES, type PowerScope, type PowerType } from '../api/contracts'

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
  onTabChange(tab: PowerTab): void
  onAgentChange(agent: string): void
  onTypeChange(type: PowerType): void
  onTagsChange(tags: string[]): void
}

export function PowerFilters({
  tab,
  agents,
  agent,
  type,
  availableTags,
  selectedTags,
  onTabChange,
  onAgentChange,
  onTypeChange,
  onTagsChange,
}: PowerFiltersProps) {
  const t = useAgentHubI18n()
  const tagsRef = useRef<HTMLDivElement>(null)

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
            onClick={() => tab !== 'installed' && onTabChange('installed')}
          >
            {t('My Capabilities')}
          </button>
          <button
            type="button"
            className="power-filters__scope"
            aria-pressed={tab === 'market'}
            onClick={() => tab !== 'market' && onTabChange('market')}
          >
            {t('Capability Market')}
          </button>
          <button
            type="button"
            className="power-filters__scope"
            aria-pressed={tab === 'settings'}
            onClick={() => tab !== 'settings' && onTabChange('settings')}
          >
            {t('Settings')}
          </button>
        </div>
        <AgentSwitcher agents={agents} agent={agent} onAgentChange={onAgentChange} />
      </div>
      {/* Type and tag filters describe the catalog only; the Settings tab has
          neither, so its panel would be a row of controls that do nothing. */}
      {tab !== 'settings' && (
      <div className="power-filters__panel">
        <div className="power-filters__filter-row">
          <span className="power-filters__label">{t('Type')}</span>
          <div className="power-filters__types" role="group" aria-label={t('Type')}>
            {POWER_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                data-power-type={value}
                aria-pressed={value === type}
                onClick={() => value !== type && onTypeChange(value)}
              >
                {resolvePowerTypeLabel(value)}
              </button>
            ))}
          </div>
        </div>
        <div className="power-filters__filter-row">
          <span className="power-filters__label">{t('Tags')}</span>
          <div
            className="power-filters__tags"
            data-power-type={type}
            role="group"
            aria-label={t('Tags')}
            ref={tagsRef}
          >
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed={selectedTags.includes(tag)}
                onClick={() => {
                  const next = selectedTags.includes(tag)
                    ? selectedTags.filter((value) => value !== tag)
                    : [...selectedTags, tag]
                  onTagsChange([...next].sort())
                }}
              >
                {tag}
              </button>
            ))}
            <ScrollThumb targetRef={tagsRef} axis="x" />
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
