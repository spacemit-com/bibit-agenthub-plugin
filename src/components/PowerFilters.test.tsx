import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PowerFilters, type PowerFiltersProps } from './PowerFilters'
import { AgentHubI18nProvider } from '../agentHubI18n'

afterEach(cleanup)

function renderFilters(overrides: Partial<PowerFiltersProps> = {}) {
  const props: PowerFiltersProps = {
    scope: 'installed',
    agents: ['bibit', 'atlas'],
    agent: 'bibit',
    type: 'skill',
    availableTags: ['alpha', 'beta', 'gamma'],
    selectedTags: [],
    onScopeChange: vi.fn(),
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
      scope: 'installed',
      agents: ['bibit', 'atlas'],
      agent: 'bibit',
      type: 'skill',
      availableTags: ['alpha', 'beta'],
      selectedTags: [],
      onScopeChange: vi.fn(),
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
    expect(screen.getByRole('button', { name: 'My Powers' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Power market' })).toBeTruthy()
    expect(screen.getByText('Type')).toBeTruthy()
    expect(screen.getByText('Tags')).toBeTruthy()

    view.rerender(filters('zh-CN'))
    expect(screen.getByRole('button', { name: '我的 Power' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Power 市场' })).toBeTruthy()
    expect(screen.getByText('类型')).toBeTruthy()
    expect(screen.getByText('标签')).toBeTruthy()
  })

  it('opens the Agent menu from My Powers and marks the current Agent', async () => {
    const user = userEvent.setup()
    renderFilters()

    expect(document.querySelector('.power-filters__scopes')).toBeTruthy()
    expect(document.querySelector('.power-filters__panel')).toBeTruthy()
    expect(document.querySelector('.power-filters__tags')).toBeTruthy()

    const trigger = screen.getByRole('button', { name: 'My Powers' })
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

  it('selects an Agent, closes the menu, and keeps the scope installed', async () => {
    const user = userEvent.setup()
    const props = renderFilters()

    await user.click(screen.getByRole('button', { name: 'My Powers' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'atlas' }))

    expect(props.onAgentChange).toHaveBeenCalledWith('atlas')
    expect(props.onScopeChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('switches from market to the selected installed Agent from the menu', async () => {
    const user = userEvent.setup()
    const props = renderFilters({ scope: 'market' })

    await user.hover(screen.getByRole('button', { name: 'My Powers' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'atlas' }))

    expect(props.onScopeChange).toHaveBeenCalledWith('installed')
    expect(props.onAgentChange).toHaveBeenCalledWith('atlas')
  })

  it('opens the Agent menu with ArrowDown and restores focus with Escape', async () => {
    const user = userEvent.setup()
    renderFilters()
    const trigger = screen.getByRole('button', { name: 'My Powers' })

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

    await user.click(screen.getByRole('button', { name: 'My Powers' }))
    act(() => {
      screen.getByRole('button', { name: 'Power market' }).focus()
    })

    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('renders exactly the four type controls with no "all" option', async () => {
    const user = userEvent.setup()
    const props = renderFilters()

    const typeGroup = screen.getByRole('group', { name: 'Type' })
    const typeButtons = within(typeGroup).getAllByRole('button')
    expect(typeButtons.map((button) => button.textContent)).toEqual(['skill', 'plugin', 'mcp', 'agent'])
    expect(screen.queryByRole('button', { name: 'all' })).toBeNull()

    const currentType = screen.getByRole('button', { name: 'skill' })
    expect(currentType.getAttribute('aria-pressed')).toBe('true')
    expect(currentType.getAttribute('data-power-type')).toBe('skill')

    await user.click(screen.getByRole('button', { name: 'mcp' }))
    expect(props.onTypeChange).toHaveBeenCalledWith('mcp')
  })

  it('toggles tags via buttons and reports them sorted and unique', async () => {
    const user = userEvent.setup()
    const onTagsChange = vi.fn()
    const base: PowerFiltersProps = {
      scope: 'installed',
      agents: ['bibit', 'atlas'],
      agent: 'bibit',
      type: 'skill',
      availableTags: ['alpha', 'beta', 'gamma'],
      selectedTags: [],
      onScopeChange: vi.fn(),
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
