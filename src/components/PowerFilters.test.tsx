import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PowerFilters, type PowerFiltersProps } from './PowerFilters'
import { AgentHubI18nProvider } from '../agentHubI18n'

afterEach(cleanup)

function renderFilters(overrides: Partial<PowerFiltersProps> = {}) {
  const props: PowerFiltersProps = {
    tab: 'installed',
    agents: ['bibit', 'atlas'],
    agent: 'bibit',
    type: 'skill',
    availableTags: ['alpha', 'beta', 'gamma'],
    selectedTags: [],
    onTabChange: vi.fn(),
    onAgentChange: vi.fn(),
    onTypeChange: vi.fn(),
    onTagsChange: vi.fn(),
    ...overrides,
  }
  render(<PowerFilters {...props} />)
  return props
}

describe('PowerFilters', () => {
  it('switches the scope and filter labels with the host language prop', () => {
    const props: PowerFiltersProps = {
      tab: 'installed',
      agents: ['bibit', 'atlas'],
      agent: 'bibit',
      type: 'skill',
      availableTags: ['alpha', 'beta'],
      selectedTags: [],
      onTabChange: vi.fn(),
      onAgentChange: vi.fn(),
      onTypeChange: vi.fn(),
      onTagsChange: vi.fn(),
    }
    const filters = (language: string) => (
      <AgentHubI18nProvider language={language}>
        <PowerFilters {...props} />
      </AgentHubI18nProvider>
    )
    const view = render(filters('en'))
    expect(screen.getByRole('button', { name: 'My Capabilities' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Capability Market' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Type')).toBeTruthy()
    expect(screen.getByText('Tags')).toBeTruthy()

    view.rerender(filters('zh-CN'))
    expect(screen.getByRole('button', { name: '我的能力' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '能力市场' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
    expect(screen.getByText('类型')).toBeTruthy()
    expect(screen.getByText('标签')).toBeTruthy()
  })

  it('selects the Settings tab and drops the catalog filters with it', async () => {
    const user = userEvent.setup()
    const props = renderFilters()

    // The two catalog scopes and Settings are one mutually exclusive tab row.
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(props.onTabChange).toHaveBeenCalledWith('settings')
  })

  it('hides the Type and Tag filters on the Settings tab but keeps the Agent control', () => {
    renderFilters({ tab: 'settings' })

    expect(screen.queryByText('Type')).toBeNull()
    expect(screen.queryByText('Tags')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Type' })).toBeNull()
    // The tab row itself stays, so the user can come back to the catalog, and the
    // Agent control stays with it so the next catalog visit reads the chosen Agent.
    expect(screen.getByRole('button', { name: 'My Capabilities' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Agent: bibit' })).toBeTruthy()
  })

  it('parks the Agent control at the right end of the tab row, outside the scope group', () => {
    renderFilters()

    expect(document.querySelector('.power-filters__panel')).toBeTruthy()
    expect(document.querySelector('.power-filters__tags')).toBeTruthy()

    const row = document.querySelector('.power-filters__scopes')
    const scopes = screen.getByRole('group', { name: 'Scope' })
    const switcher = screen.getByRole('button', { name: 'Agent: bibit' })
    expect(row?.contains(switcher)).toBe(true)
    // The switcher is a sibling of the scope group, not one of its tabs.
    expect(scopes.contains(switcher)).toBe(false)
    expect(scopes.contains(document.querySelector('.power-filters__agent-switcher'))).toBe(false)
  })

  it('keeps the Agent menu off My Capabilities', async () => {
    const user = userEvent.setup()
    // Start on another tab so the click below is a real tab change: clicking the
    // already-active tab is a no-op by design.
    const props = renderFilters({ tab: 'market' })

    const tab = screen.getByRole('button', { name: 'My Capabilities' })
    expect(tab.getAttribute('aria-haspopup')).toBeNull()
    expect(tab.getAttribute('aria-expanded')).toBeNull()
    expect(tab.textContent).toBe('My Capabilities')

    await user.hover(tab)
    await user.click(tab)
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
    // Clicking the tab still switches scope -- that is all it does now.
    expect(props.onTabChange).toHaveBeenCalledWith('installed')
  })

  it('opens the Agent menu from the right-hand control and marks the current Agent', async () => {
    const user = userEvent.setup()
    renderFilters()

    const trigger = screen.getByRole('button', { name: 'Agent: bibit' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await user.hover(trigger)

    const menu = screen.getByRole('menu', { name: 'Agent' })
    const current = within(menu).getByRole('menuitemradio', { name: /bibit/ })
    expect(current.getAttribute('aria-checked')).toBe('true')
    expect(within(menu).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      '✓bibit',
      'atlas',
    ])
  })

  it('selects an Agent without switching the tab', async () => {
    const user = userEvent.setup()
    const props = renderFilters()

    await user.click(screen.getByRole('button', { name: 'Agent: bibit' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'atlas' }))

    expect(props.onAgentChange).toHaveBeenCalledWith('atlas')
    expect(props.onTabChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('offers the Agent control on every tab, including Settings', () => {
    for (const tab of ['installed', 'market', 'settings'] as const) {
      const { unmount } = render(
        <AgentHubI18nProvider language="en">
          <PowerFilters
            tab={tab}
            agents={['bibit', 'atlas']}
            agent="bibit"
            type="skill"
            availableTags={[]}
            selectedTags={[]}
            onTabChange={vi.fn()}
            onAgentChange={vi.fn()}
            onTypeChange={vi.fn()}
            onTagsChange={vi.fn()}
          />
        </AgentHubI18nProvider>
      )
      expect(screen.getByRole('button', { name: 'Agent: bibit' })).toBeTruthy()
      unmount()
    }
  })

  it('opens the Agent menu with ArrowDown and restores focus with Escape', async () => {
    const user = userEvent.setup()
    renderFilters()
    const trigger = screen.getByRole('button', { name: 'Agent: bibit' })

    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /bibit/ }))
    )
    // The trigger's ArrowDown also moves focus from a requestAnimationFrame. Let
    // that frame land before stepping again, otherwise it can reassign focus
    // between the next keydown and its assertion and shift the wrap-around index.
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    await user.keyboard('{ArrowDown}')
    // Focus moves from a post-render effect, so each keyboard step needs its own
    // flush; asserting synchronously loses the race under parallel workers.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'atlas' }))
    )
    await user.keyboard('{ArrowUp}')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /bibit/ }))
    )

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('closes the Agent menu when focus leaves its wrapper', async () => {
    const user = userEvent.setup()
    renderFilters()

    await user.click(screen.getByRole('button', { name: 'Agent: bibit' }))
    act(() => {
      screen.getByRole('button', { name: 'Capability Market' }).focus()
    })

    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('renders exactly the four type controls with no "all" option', async () => {
    const user = userEvent.setup()
    const props = renderFilters()

    const typeGroup = screen.getByRole('group', { name: 'Type' })
    const typeButtons = within(typeGroup).getAllByRole('button')
    // The type is the displayed word; the filter row's CSS capitalises it.
    expect(typeButtons.map((button) => button.textContent)).toEqual(['skill', 'plugin', 'mcp', 'expert'])
    expect(screen.queryByRole('button', { name: 'all' })).toBeNull()

    const currentType = screen.getByRole('button', { name: 'skill' })
    expect(currentType.getAttribute('aria-pressed')).toBe('true')
    expect(currentType.getAttribute('data-power-type')).toBe('skill')

    await user.click(screen.getByRole('button', { name: 'mcp' }))
    expect(props.onTypeChange).toHaveBeenCalledWith('mcp')

    await user.click(screen.getByRole('button', { name: 'expert' }))
    expect(props.onTypeChange).toHaveBeenLastCalledWith('expert')
  })

  it('offers no Expert type for an Agent that cannot take one', () => {
    renderFilters({ agent: 'codex' })

    const typeGroup = screen.getByRole('group', { name: 'Type' })
    // An `agent`-type Power is bibit-only, so its chip is not offered here.
    expect(within(typeGroup).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'skill',
      'plugin',
      'mcp',
    ])
    expect(screen.queryByRole('button', { name: 'expert' })).toBeNull()
  })

  it('toggles tags via buttons and reports them sorted and unique', async () => {
    const user = userEvent.setup()
    const onTagsChange = vi.fn()
    const base: PowerFiltersProps = {
      tab: 'installed',
      agents: ['bibit', 'atlas'],
      agent: 'bibit',
      type: 'skill',
      availableTags: ['alpha', 'beta', 'gamma'],
      selectedTags: [],
      onTabChange: vi.fn(),
      onAgentChange: vi.fn(),
      onTypeChange: vi.fn(),
      onTagsChange,
    }

    let selectedTags: string[] = []
    function Harness() {
      return (
        <PowerFilters
          {...base}
          selectedTags={selectedTags}
          onTagsChange={(next) => {
            selectedTags = next
            onTagsChange(next)
          }}
        />
      )
    }
    const { rerender } = render(<Harness />)

    const tagGroup = screen.getByRole('group', { name: 'Tags' })
    const tagButtons = within(tagGroup).getAllByRole('button')
    expect(tagButtons.map((button) => button.textContent)).toEqual(['alpha', 'beta', 'gamma'])
    expect(screen.getByRole('button', { name: 'alpha' }).getAttribute('aria-pressed')).toBe('false')

    await user.click(screen.getByRole('button', { name: 'gamma' }))
    expect(onTagsChange).toHaveBeenLastCalledWith(['gamma'])
    rerender(<Harness />)

    await user.click(screen.getByRole('button', { name: 'alpha' }))
    expect(onTagsChange).toHaveBeenLastCalledWith(['alpha', 'gamma'])
  })
})
