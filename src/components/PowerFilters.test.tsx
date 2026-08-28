import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PowerFilters, type PowerFiltersProps } from './PowerFilters'

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
  it('opens the Agent menu from 我的 Power and marks the current Agent', async () => {
    const user = userEvent.setup()
    renderFilters()

    const trigger = screen.getByRole('button', { name: '我的 Power' })
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

    await user.click(screen.getByRole('button', { name: '我的 Power' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'atlas' }))

    expect(props.onAgentChange).toHaveBeenCalledWith('atlas')
    expect(props.onScopeChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  })

  it('switches from market to the selected installed Agent from the menu', async () => {
    const user = userEvent.setup()
    const props = renderFilters({ scope: 'market' })

    await user.hover(screen.getByRole('button', { name: '我的 Power' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'atlas' }))

    expect(props.onScopeChange).toHaveBeenCalledWith('installed')
    expect(props.onAgentChange).toHaveBeenCalledWith('atlas')
  })

  it('opens the Agent menu with ArrowDown and restores focus with Escape', async () => {
    const user = userEvent.setup()
    renderFilters()
    const trigger = screen.getByRole('button', { name: '我的 Power' })

    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /bibit/ }))
    )

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'atlas' }))
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /bibit/ }))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('closes the Agent menu when focus leaves its wrapper', async () => {
    const user = userEvent.setup()
    renderFilters()

    await user.click(screen.getByRole('button', { name: '我的 Power' }))
    act(() => {
      screen.getByRole('button', { name: 'Power 市场' }).focus()
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
