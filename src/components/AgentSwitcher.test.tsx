import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentSwitcher, type AgentSwitcherProps } from './AgentSwitcher'
import { AgentHubI18nProvider } from '../agentHubI18n'

afterEach(cleanup)

function renderSwitcher(overrides: Partial<AgentSwitcherProps> = {}) {
  const props: AgentSwitcherProps = {
    agents: ['bibit', 'atlas', 'codex'],
    agent: 'bibit',
    onAgentChange: vi.fn(),
    ...overrides,
  }
  const view = render(
    <AgentHubI18nProvider language="en">
      <AgentSwitcher {...props} />
    </AgentHubI18nProvider>
  )
  return { props, view }
}

/** The trigger's visible text is the Agent itself; its accessible name adds the role. */
const trigger = () => screen.getByRole('button', { name: /^Agent: / })

describe('AgentSwitcher', () => {
  it('shows the selected Agent as its own text and follows the prop', () => {
    const { view } = renderSwitcher()

    expect(trigger().textContent).toContain('bibit')
    expect(trigger().getAttribute('aria-label')).toBe('Agent: bibit')

    view.rerender(
      <AgentHubI18nProvider language="en">
        <AgentSwitcher agents={['bibit', 'atlas']} agent="atlas" onAgentChange={vi.fn()} />
      </AgentHubI18nProvider>
    )
    expect(trigger().textContent).toContain('atlas')
    expect(trigger().getAttribute('aria-label')).toBe('Agent: atlas')
  })

  it('is a menu button, not a tab', () => {
    renderSwitcher()

    // A tab would carry aria-pressed; this control must not pretend to be one.
    expect(trigger().getAttribute('aria-pressed')).toBeNull()
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on hover and on click, and lists every Agent with the current one marked', async () => {
    const user = userEvent.setup()
    renderSwitcher()

    await user.hover(trigger())
    const menu = screen.getByRole('menu', { name: 'Agent' })
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(within(menu).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      '✓bibit',
      'atlas',
      'codex',
    ])
    expect(within(menu).getByRole('menuitemradio', { name: /bibit/ }).getAttribute('aria-checked')).toBe('true')
    expect(within(menu).getByRole('menuitemradio', { name: 'atlas' }).getAttribute('aria-checked')).toBe('false')

    await user.unhover(trigger())
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()

    // Click opens it too, and a click while it is already open must not close it:
    // a mouse user has already opened it by hovering, so a toggle would read as
    // "clicking closed it".
    await user.click(trigger())
    expect(screen.getByRole('menu', { name: 'Agent' })).toBeTruthy()
  })

  it('reports the chosen Agent through onAgentChange', async () => {
    const user = userEvent.setup()
    const { props } = renderSwitcher()

    await user.hover(trigger())
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'atlas' }))

    expect(props.onAgentChange).toHaveBeenCalledWith('atlas')
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('does not report a re-selection of the current Agent', async () => {
    const user = userEvent.setup()
    const { props } = renderSwitcher()

    await user.hover(trigger())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /bibit/ }))

    expect(props.onAgentChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('opens with ArrowDown, cycles with the arrows and closes with Escape', async () => {
    const user = userEvent.setup()
    renderSwitcher()

    trigger().focus()
    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /bibit/ }))
    )
    // The first item's focus lands from a requestAnimationFrame; let it settle
    // before stepping again so the wrap-around index is computed once.
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'atlas' }))
    )
    await user.keyboard('{ArrowUp}')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /bibit/ }))
    )

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
    // Escape returns focus to the trigger without the focus handler reopening the menu.
    await waitFor(() => expect(document.activeElement).toBe(trigger()))
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('closes when focus leaves the wrapper', async () => {
    const user = userEvent.setup()
    render(
      <AgentHubI18nProvider language="en">
        <AgentSwitcher agents={['bibit', 'atlas']} agent="bibit" onAgentChange={vi.fn()} />
        <button type="button">elsewhere</button>
      </AgentHubI18nProvider>
    )

    // `user.click` focuses the trigger as a real click does; `fireEvent.click`
    // would leave focus outside the wrapper and no focusout would follow.
    await user.click(trigger())
    expect(screen.getByRole('menu', { name: 'Agent' })).toBeTruthy()

    act(() => {
      screen.getByRole('button', { name: 'elsewhere' }).focus()
    })
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('stays closed when the Agent list is empty', async () => {
    const user = userEvent.setup()
    renderSwitcher({ agents: [] })

    await user.hover(trigger())
    await user.click(trigger())
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('translates the trigger label and the menu', () => {
    render(
      <AgentHubI18nProvider language="zh-CN">
        <AgentSwitcher agents={['bibit']} agent="bibit" onAgentChange={vi.fn()} />
      </AgentHubI18nProvider>
    )

    expect(screen.getByRole('button', { name: 'Agent：bibit' })).toBeTruthy()
  })
})
