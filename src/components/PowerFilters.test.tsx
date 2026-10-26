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
    type: 'all',
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
      type: 'all',
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

  it('hides the Type and Tag filters on the Settings tab', () => {
    renderFilters({ tab: 'settings' })

    expect(screen.queryByText('Type')).toBeNull()
    expect(screen.queryByText('Tags')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Type' })).toBeNull()
    // The tab row itself stays, so the user can come back to the catalog.
    expect(screen.getByRole('button', { name: 'My Capabilities' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('renders the scope group and filter panel', () => {
    renderFilters()

    expect(document.querySelector('.power-filters__panel')).toBeTruthy()
    expect(document.querySelector('.power-filters__tag-dropdown')).toBeTruthy()

    const scopes = screen.getByRole('group', { name: 'Scope' })
    expect(scopes).toBeTruthy()
  })

  it('switches scopes when tabs are clicked', async () => {
    const user = userEvent.setup()
    const props = renderFilters({ tab: 'market' })

    const tab = screen.getByRole('button', { name: 'My Capabilities' })
    expect(tab.textContent).toBe('My Capabilities')

    await user.click(tab)
    expect(props.onTabChange).toHaveBeenCalledWith('installed')
  })

  it('offers All and supported types in a single-select dropdown', async () => {
    const user = userEvent.setup()
    const props = renderFilters()
    const select = screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All', 'skill', 'plugin', 'mcp', 'expert',
    ])
    expect(select.value).toBe('all')
    await user.selectOptions(select, 'mcp')
    expect(props.onTypeChange).toHaveBeenCalledWith('mcp')
    await user.selectOptions(select, 'expert')
    expect(props.onTypeChange).toHaveBeenLastCalledWith('expert')
  })

  it('offers no Expert type for an Agent that cannot take one', () => {
    renderFilters({ agent: 'codex' })
    const select = screen.getByRole('combobox', { name: 'Type' })
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All', 'skill', 'plugin', 'mcp',
    ])
    expect(screen.queryByRole('option', { name: 'expert' })).toBeNull()
  })

  it('keeps the tag dropdown open while selecting multiple sorted unique tags', async () => {
    const user = userEvent.setup()
    const onTagsChange = vi.fn()
    const base: PowerFiltersProps = {
      tab: 'installed',
      agents: ['bibit', 'atlas'],
      agent: 'bibit',
      type: 'all',
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

    const trigger = screen.getByRole('button', { name: 'Tags' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.textContent).toContain('Any')
    await user.click(trigger)
    const popup = screen.getByRole('dialog', { name: 'Tags' })
    expect(within(popup).getAllByRole('checkbox').map((input) => input.parentElement?.textContent)).toEqual([
      'alpha', 'beta', 'gamma',
    ])

    await user.click(screen.getByRole('checkbox', { name: 'gamma' }))
    expect(onTagsChange).toHaveBeenLastCalledWith(['gamma'])
    rerender(<Harness />)
    expect(screen.getByRole('dialog', { name: 'Tags' })).toBeTruthy()

    await user.click(screen.getByRole('checkbox', { name: 'alpha' }))
    expect(onTagsChange).toHaveBeenLastCalledWith(['alpha', 'gamma'])
    rerender(<Harness />)
    expect(trigger.textContent).toContain('alpha, gamma')
    expect((screen.getByRole('checkbox', { name: 'alpha' }) as HTMLInputElement).checked).toBe(true)

    await user.click(screen.getByRole('checkbox', { name: 'gamma' }))
    expect(onTagsChange).toHaveBeenLastCalledWith(['alpha'])
    rerender(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Clear tags' }))
    expect(onTagsChange).toHaveBeenLastCalledWith([])

  })
  it('opens tags with ArrowDown, moves between options, and restores focus with Escape', async () => {
    const user = userEvent.setup()
    renderFilters()
    const trigger = screen.getByRole('button', { name: 'Tags' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'alpha' })))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'beta' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Tags' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses tags on outside pointer and when focus leaves the dropdown', async () => {
    const user = userEvent.setup()
    renderFilters()
    const trigger = screen.getByRole('button', { name: 'Tags' })
    await user.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Tags' })).toBeNull()
    await user.click(trigger)
    act(() => { screen.getByRole('button', { name: 'Capability Market' }).focus() })
    expect(screen.queryByRole('dialog', { name: 'Tags' })).toBeNull()
  })

  it('places a provided search control after the two filters in the catalog row', () => {
    renderFilters({ search: <input type="search" aria-label="Search capabilities" /> })
    const panel = document.querySelector('.power-filters__panel')!
    const search = screen.getByRole('searchbox', { name: 'Search capabilities' })
    const tags = screen.getByRole('button', { name: 'Tags' })
    expect(panel.contains(search)).toBe(true)
    expect(tags.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

})

describe('PowerFilters bulk upgrade entry', () => {
  it('renders the entry in the actions row when wired', () => {
    const props = renderFilters({ onUpgrade: vi.fn() })

    const actions = document.querySelector('.power-filters__actions')
    const upgrade = screen.getByRole('button', { name: 'Update all' })

    expect(actions?.contains(upgrade)).toBe(true)

    fireEvent.click(upgrade)
    expect(props.onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('omits the entry when the page offers no upgrade handler', () => {
    renderFilters()
    expect(screen.queryByRole('button', { name: 'Update all' })).toBeNull()
  })

  it('freezes the tabs and the entry while an upgrade runs', () => {
    renderFilters({ onUpgrade: vi.fn(), upgrading: true })

    for (const name of ['My Capabilities', 'Capability Market', 'Settings']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    const upgrade = screen.getByRole('button', { name: 'Update all' }) as HTMLButtonElement
    expect(upgrade.disabled).toBe(true)
    // Busy is announced, and the spinner is decorative rather than a second label.
    expect(upgrade.getAttribute('aria-busy')).toBe('true')
    expect(upgrade.querySelector('.agent-hub__spinner')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('does not report busy when idle', () => {
    renderFilters({ onUpgrade: vi.fn() })
    expect(
      screen.getByRole('button', { name: 'Update all' }).getAttribute('aria-busy')
    ).toBe('false')
  })
})
