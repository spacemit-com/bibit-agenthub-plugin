import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PowerSeries } from '../api/contracts'
import { PowerCard, type PowerCardProps } from './PowerCard'
import { AgentHubI18nProvider } from '../agentHubI18n'

afterEach(cleanup)

// jsdom's Range has no getBoundingClientRect (every real engine does); the card measures the
// natural width of the name with one, so the tests supply it.
let naturalTitleWidth = 0
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: naturalTitleWidth }) as DOMRect,
  })
})

const series: PowerSeries = {
  type: 'skill',
  name: 'code-review',
  versions: [
    {
      version: 'v2.0.0',
      description: 'Peer review with a quality gate.',
      tags: ['code-review', 'quality'],
    },
    {
      version: 'v1.0.0',
      description: 'Peer review workflow.',
      tags: ['writing'],
    },
  ],
}

function renderCard(overrides: Partial<PowerCardProps> = {}) {
  const onVersionChange = vi.fn()
  const onDetails = vi.fn()
  const result = render(
    <PowerCard
      series={series}
      selectedVersion="v2.0.0"
      onVersionChange={onVersionChange}
      busy={false}
      onDetails={onDetails}
      {...overrides}
    />
  )
  return { result, onVersionChange, onDetails }
}

describe('PowerCard', () => {
  it('switches the version control label with the host language prop', () => {
    const card = (language: string) => (
      <AgentHubI18nProvider language={language}>
        <PowerCard series={series} selectedVersion="v2.0.0" onVersionChange={vi.fn()} busy={false} />
      </AgentHubI18nProvider>
    )
    const view = render(card('en'))
    expect(screen.getByLabelText('Version')).toBeTruthy()

    view.rerender(card('zh-CN'))
    expect(screen.getByLabelText('版本')).toBeTruthy()
    expect(screen.queryByLabelText('Version')).toBeNull()
  })

  it('renders the series type and name', () => {
    renderCard()

    expect(screen.getByText('skill')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'code-review' })).toBeTruthy()
  })

  it('shrinks a long name so it stays on one line', () => {
    const { result } = renderCard()
    const title = result.container.querySelector('.power-card h2') as HTMLElement
    // A 260px box holding 400px of text at the 19px cap needs about 12px, so it stops at 13.
    Object.defineProperty(title, 'clientWidth', { configurable: true, value: 260 })
    naturalTitleWidth = 400
    fireEvent(window, new Event('resize'))

    expect(title.style.fontSize).toBe('13px')
  })

  it('keeps the cap size for a name that fits', () => {
    const { result } = renderCard()
    const title = result.container.querySelector('.power-card h2') as HTMLElement
    Object.defineProperty(title, 'clientWidth', { configurable: true, value: 260 })
    naturalTitleWidth = 200
    fireEvent(window, new Event('resize'))

    expect(title.style.fontSize).toBe('19px')
  })

  it('uses the type palette hook and hides the visible Version label', () => {
    const { result } = renderCard()

    const card = result.container.querySelector('.power-card')
    expect(card?.getAttribute('data-power-type')).toBe('skill')
    expect(screen.queryByText('Version')).toBeNull()
    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('v2.0.0')
  })

  it('renders the selected version description and tags', () => {
    renderCard({ selectedVersion: 'v2.0.0' })

    expect(screen.getByText('Peer review with a quality gate.')).toBeTruthy()
    const tags = screen.getByTestId('power-card-tags')
    expect(within(tags).getByText('quality')).toBeTruthy()
  })

  it('updates the description and tags when the controlled version changes', async () => {
    function Controlled() {
      const [version, setVersion] = useState('v2.0.0')
      return <PowerCard series={series} selectedVersion={version} onVersionChange={setVersion} busy={false} />
    }
    const user = userEvent.setup()
    render(<Controlled />)

    await user.selectOptions(screen.getByLabelText('Version'), 'v1.0.0')

    expect(screen.getByText('Peer review workflow.')).toBeTruthy()
    const tags = screen.getByTestId('power-card-tags')
    expect(within(tags).getByText('writing')).toBeTruthy()
    expect(screen.queryByText('Peer review with a quality gate.')).toBeNull()
  })

  it('falls back to the first version when the selected version is no longer available', () => {
    renderCard({ selectedVersion: 'v9.9.9' })

    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('v2.0.0')
    expect(screen.getByText('Peer review with a quality gate.')).toBeTruthy()
  })

  it('opens details when the card body is clicked', () => {
    const { onDetails } = renderCard()

    fireEvent.click(screen.getByRole('heading', { name: 'code-review' }))

    expect(onDetails).toHaveBeenCalled()
  })

  it('does not open details when the version select is clicked', () => {
    const { onDetails } = renderCard()

    fireEvent.click(screen.getByLabelText('Version'))

    expect(onDetails).not.toHaveBeenCalled()
  })

  it('does not open details when the card is not clickable', () => {
    renderCard({ onDetails: undefined })

    const card = document.querySelector('.power-card')
    expect(card?.getAttribute('data-clickable')).toBeNull()
  })

  it('disables the version select while busy', () => {
    renderCard({ busy: true })

    expect((screen.getByLabelText('Version') as HTMLSelectElement).disabled).toBe(true)
  })

  it('renders the notice when provided', () => {
    renderCard({ notice: { text: 'Installation complete.' } })

    expect(screen.getByText('Installation complete.')).toBeTruthy()
  })
})
