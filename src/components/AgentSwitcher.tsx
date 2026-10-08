import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { useAgentHubI18n } from '../agentHubI18n'

export interface AgentSwitcherProps {
  agents: readonly string[]
  agent: string
  onAgentChange(agent: string): void
}

/**
 * The page's one Agent control, parked at the right end of the tab row.
 *
 * It is deliberately not a tab: choosing an Agent changes which catalog the list
 * is read from (and which Agent an install targets), never which tab is showing.
 * That is why the trigger carries `aria-haspopup`/`aria-expanded` and no
 * `aria-pressed`.
 *
 * Hover and click both open the menu, and clicking the trigger only opens --
 * it does not toggle -- because hover has already opened it by the time a mouse
 * user clicks, so a toggle would read as "clicking closed it".
 */
export function AgentSwitcher({ agents, agent, onAgentChange }: AgentSwitcherProps) {
  const t = useAgentHubI18n()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstAgentRef = useRef<HTMLButtonElement>(null)
  // Restoring focus to the trigger re-enters the wrapper and would immediately
  // reopen the menu; the restore flags it so the focus handler stands down.
  const suppressFocusOpenRef = useRef(false)

  const openMenu = (focusFirst = false) => {
    if (agents.length === 0) return
    setOpen(true)
    if (focusFirst) requestAnimationFrame(() => firstAgentRef.current?.focus())
  }

  const closeMenu = (restoreFocus = false) => {
    setOpen(false)
    if (!restoreFocus) return
    suppressFocusOpenRef.current = true
    requestAnimationFrame(() => {
      triggerRef.current?.focus()
      suppressFocusOpenRef.current = false
    })
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenu()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (!open) {
      event.preventDefault()
      openMenu(true)
      return
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    )
    if (items.length === 0) return
    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex =
      currentIndex < 0
        ? direction === 1
          ? 0
          : items.length - 1
        : (currentIndex + direction + items.length) % items.length
    items[nextIndex].focus()
  }

  return (
    <div
      className="power-filters__agent-switcher"
      onMouseEnter={() => openMenu()}
      onMouseLeave={() => closeMenu()}
      onFocusCapture={(event) => {
        // Only the trigger opens on focus: focusing a menu item (from ArrowDown
        // or a click) must not restart the open sequence.
        if ((event.target as Node | null) === triggerRef.current && !suppressFocusOpenRef.current) {
          openMenu()
        }
      }}
      onBlurCapture={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="power-filters__agent-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('Agent: {agent}', { agent })}
        onClick={() => openMenu()}
      >
        {agent} <span aria-hidden="true">⌄</span>
      </button>
      {open && agents.length > 0 && (
        <div className="power-filters__agent-menu" role="menu" aria-label={t('Agent')}>
          {agents.map((value, index) => (
            <button
              ref={index === 0 ? firstAgentRef : undefined}
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={value === agent}
              onClick={() => {
                if (value !== agent) onAgentChange(value)
                closeMenu(true)
              }}
            >
              {value === agent && <span aria-hidden="true">✓</span>}
              {value}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
