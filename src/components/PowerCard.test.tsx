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

const localizedSeries: PowerSeries = {
  type: 'skill',
  name: 'code-review',
  name_zh: '代码审查',
  name_en: 'Code Review',
  versions: [
    {
      version: 'v2.0.0',
      description: 'Peer review with a quality gate.',
      tags: ['quality'],
      description_zh: '带质量门禁的代码审查。',
    },
    {
      // A V1 version: no description_zh, so the Chinese UI falls back to `description`.
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

function renderLocalized(language: string, selectedVersion = 'v2.0.0') {
  return render(
    <AgentHubI18nProvider language={language}>
      <PowerCard
        series={localizedSeries}
        selectedVersion={selectedVersion}
        onVersionChange={vi.fn()}
        busy={false}
      />
    </AgentHubI18nProvider>
  )
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

  it('labels an agent-type series as Expert while keeping the wire type on the card', () => {
    const { container } = render(
      <AgentHubI18nProvider language="en">
        <PowerCard
          series={{ ...series, type: 'agent', name: 'reviewer' }}
          selectedVersion="v2.0.0"
          onVersionChange={vi.fn()}
          busy={false}
        />
      </AgentHubI18nProvider>
    )

    expect(container.querySelector('.power-card__type')?.textContent).toBe('Expert')
    // The canonical type still drives the card's type tokens and every request.
    expect(container.querySelector('.power-card')?.getAttribute('data-power-type')).toBe('agent')
  })

  it('shows the Chinese display name and description for a Chinese host', () => {
    renderLocalized('zh-CN')

    expect(screen.getByRole('heading', { name: '代码审查' })).toBeTruthy()
    expect(screen.getByText('带质量门禁的代码审查。')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'code-review' })).toBeNull()
  })

  it('shows the English display name and the source description for an English host', () => {
    renderLocalized('en')

    expect(screen.getByRole('heading', { name: 'Code Review' })).toBeTruthy()
    expect(screen.getByText('Peer review with a quality gate.')).toBeTruthy()
    expect(screen.queryByText('带质量门禁的代码审查。')).toBeNull()
  })

  it('falls back per version when a V1 version has no description_zh', () => {
    renderLocalized('zh-CN', 'v1.0.0')

    expect(screen.getByRole('heading', { name: '代码审查' })).toBeTruthy()
    expect(screen.getByText('Peer review workflow.')).toBeTruthy()
  })

  it('keeps the title on the series while the per-version description follows the select', async () => {
    function Controlled() {
      const [version, setVersion] = useState('v2.0.0')
      return (
        <PowerCard
          series={localizedSeries}
          selectedVersion={version}
          onVersionChange={setVersion}
          busy={false}
        />
      )
    }
    const user = userEvent.setup()
    render(
      <AgentHubI18nProvider language="zh-CN">
        <Controlled />
      </AgentHubI18nProvider>
    )

    expect(screen.getByRole('heading', { name: '代码审查' })).toBeTruthy()
    expect(screen.getByText('带质量门禁的代码审查。')).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('版本'), 'v1.0.0')

    expect(screen.getByRole('heading', { name: '代码审查' })).toBeTruthy()
    expect(screen.getByText('Peer review workflow.')).toBeTruthy()
    expect(screen.queryByText('带质量门禁的代码审查。')).toBeNull()
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

  it('marks a hand-installed resource and replaces its version select with a label', () => {
    const custom: PowerSeries = {
      type: 'skill',
      name: 'hand-written',
      source: 'custom',
      versions: [{ version: 'v1.2.3', description: 'Hand made.', tags: [] }],
    }
    const view = render(<PowerCard series={custom} selectedVersion="v1.2.3" onVersionChange={vi.fn()} busy={false} />)

    const card = view.container.querySelector('.power-card')
    expect(card?.getAttribute('data-source')).toBe('custom')
    expect(screen.getByText('Custom')).toBeTruthy()
    // Exactly one version exists, so there is no control to pick between them.
    expect(screen.queryByLabelText('Version')).toBeNull()
    expect(screen.getByTestId('power-card-version').textContent).toBe('v1.2.3')
  })

  it('shows a placeholder when a hand-installed resource declares no version', () => {
    const custom: PowerSeries = {
      type: 'plugin',
      name: 'local-bundle',
      source: 'custom',
      versions: [{ version: '', description: '', tags: [] }],
    }
    render(<PowerCard series={custom} selectedVersion="" onVersionChange={vi.fn()} busy={false} />)

    expect(screen.getByTestId('power-card-version').textContent).toBe('No version')
  })

  it('renders no custom marker for a Hub-managed series', () => {
    const { result } = renderCard()

    const card = result.container.querySelector('.power-card')
    expect(card?.getAttribute('data-source')).toBeNull()
    expect(screen.queryByText('Custom')).toBeNull()
  })
})
