import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { ScrollThumb } from '../ScrollThumb'
import { useAgentHubI18n } from '../agentHubI18n'
import { POWER_TYPES, type PowerScope, type PowerType } from '../api/contracts'

export interface PowerFiltersProps {
  scope: PowerScope
  agents: readonly string[]
  agent: string
  type: PowerType
  availableTags: readonly string[]
  selectedTags: readonly string[]
  onScopeChange(scope: PowerScope): void
  onAgentChange(agent: string): void
  onTypeChange(type: PowerType): void
  onTagsChange(tags: string[]): void
}

export function PowerFilters({
  scope,
  agents,
  agent,
  type,
  availableTags,
  selectedTags,
  onScopeChange,
  onAgentChange,
  onTypeChange,
  onTagsChange,
}: PowerFiltersProps) {
  const t = useAgentHubI18n()
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const installedTriggerRef = useRef<HTMLButtonElement>(null)
  const firstAgentRef = useRef<HTMLButtonElement>(null)
  const suppressFocusOpenRef = useRef(false)
  const tagsRef = useRef<HTMLDivElement>(null)

  const openAgentMenu = (focusFirst = false) => {
    if (agents.length === 0) return
    setAgentMenuOpen(true)
    if (focusFirst) requestAnimationFrame(() => firstAgentRef.current?.focus())
  }

  const closeAgentMenu = (restoreFocus = false) => {
    setAgentMenuOpen(false)
    if (restoreFocus) {
      suppressFocusOpenRef.current = true
      requestAnimationFrame(() => {
        installedTriggerRef.current?.focus()
        suppressFocusOpenRef.current = false
      })
    }
  }

  const handleAgentWrapperBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeAgentMenu()
  }

  const handleAgentMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAgentMenu(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    )
    if (items.length === 0) return
    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = currentIndex < 0
      ? (direction === 1 ? 0 : items.length - 1)
      : (currentIndex + direction + items.length) % items.length
    items[nextIndex].focus()
  }

  return (
    <div className="power-filters">
      <div className="power-filters__scopes" role="group" aria-label={t('Scope')}>
        <div
          className="power-filters__scope-agent"
          onMouseEnter={() => openAgentMenu()}
          onMouseLeave={() => closeAgentMenu()}
          onFocusCapture={(event) => {
            if ((event.target as Node | null) === installedTriggerRef.current && !suppressFocusOpenRef.current) {
              openAgentMenu()
            }
          }}
          onBlurCapture={handleAgentWrapperBlur}
          onKeyDown={handleAgentMenuKeyDown}
        >
          <button
            ref={installedTriggerRef}
            type="button"
            className="power-filters__scope"
            aria-pressed={scope === 'installed'}
            aria-haspopup="menu"
            aria-expanded={agentMenuOpen}
            onClick={() => {
              if (scope !== 'installed') onScopeChange('installed')
              openAgentMenu()
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                openAgentMenu(true)
              }
            }}
          >
            {t('My Powers')} <span aria-hidden="true">⌄</span>
          </button>
          {agentMenuOpen && agents.length > 0 && (
            <div className="power-filters__agent-menu" role="menu" aria-label={t('Agent')}>
              {agents.map((value, index) => (
                <button
                  ref={index === 0 ? firstAgentRef : undefined}
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === agent}
                  onClick={() => {
                    if (scope !== 'installed') onScopeChange('installed')
                    if (value !== agent) onAgentChange(value)
                    closeAgentMenu(true)
                  }}
                >
                  {value === agent && <span aria-hidden="true">✓</span>}
                  {value}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="power-filters__scope"
          aria-pressed={scope === 'market'}
          onClick={() => scope !== 'market' && onScopeChange('market')}
        >
          {t('Power market')}
        </button>
      </div>
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
                {value}
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
    </div>
  )
}
