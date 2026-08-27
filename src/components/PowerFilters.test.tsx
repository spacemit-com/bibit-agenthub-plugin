import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  it('marks the current scope pressed and disabled, and switches scope', async () => {
    const user = userEvent.setup()
    const props = renderFilters()

    const installedButton = screen.getByRole('button', { name: '我的 Power' })
    const marketButton = screen.getByRole('button', { name: 'Power 市场' })
    expect(installedButton.getAttribute('aria-pressed')).toBe('true')
    expect((installedButton as HTMLButtonElement).disabled).toBe(true)

    await user.click(marketButton)
    expect(props.onScopeChange).toHaveBeenCalledWith('market')
  })

  it('renders only the supplied agent buttons in installed scope', async () => {
    const user = userEvent.setup()
    const props = renderFilters()

    const agentGroup = screen.getByRole('group', { name: 'Agent' })
    const agentButtons = within(agentGroup).getAllByRole('button')
    expect(agentButtons.map((button) => button.textContent)).toEqual(['bibit', 'atlas'])

    const currentAgent = screen.getByRole('button', { name: 'bibit' })
    expect(currentAgent.getAttribute('aria-pressed')).toBe('true')
    expect((currentAgent as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'atlas' }))
    expect(props.onAgentChange).toHaveBeenCalledWith('atlas')
  })

  it('renders no agent controls in market scope', () => {
    renderFilters({ scope: 'market' })

    expect(screen.queryByRole('group', { name: 'Agent' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'bibit' })).toBeNull()
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
    expect((currentType as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'mcp' }))
    expect(props.onTypeChange).toHaveBeenCalledWith('mcp')
  })

  it('reports sorted selected tags from the native multiple select', () => {
    const props = renderFilters()
    const select = screen.getByLabelText('Tags') as HTMLSelectElement

    for (const option of Array.from(select.options)) {
      option.selected = option.value === 'gamma' || option.value === 'alpha'
    }
    fireEvent.change(select)

    expect(props.onTagsChange).toHaveBeenCalledWith(['alpha', 'gamma'])
  })
})
