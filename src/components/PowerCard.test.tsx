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
  const onDetails = vi.fn()
  const result = render(<PowerCard series={series} busy={false} onDetails={onDetails} {...overrides} />)
  return { result, onDetails }
}

function renderLocalized(language: string) {
  return render(
    <AgentHubI18nProvider language={language}>
      <PowerCard series={localizedSeries} busy={false} />
    </AgentHubI18nProvider>
  )
}

describe('PowerCard', () => {
  it('shows the newest version as a label instead of a control', () => {
    const card = (language: string) => (
      <AgentHubI18nProvider language={language}>
        <PowerCard series={series} busy={false} />
      </AgentHubI18nProvider>
    )
    const view = render(card('en'))

    // Version choice lives in the details dialog, so the card only reports the newest.
    expect(screen.getByTestId('power-card-version').textContent).toBe('v2.0.0')
    expect(screen.queryByLabelText('Version')).toBeNull()
    expect(document.querySelector('.power-card__version')?.tagName).toBe('SPAN')

    view.rerender(card('zh-CN'))
    expect(screen.getByTestId('power-card-version').textContent).toBe('v2.0.0')
    expect(screen.queryByLabelText('版本')).toBeNull()
  })

  it('renders the series type and name', () => {
    renderCard()

    expect(screen.getByText('skill')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'code-review' })).toBeTruthy()
  })

  it('labels an agent-type series as Expert while keeping the wire type on the card', () => {
    const { container } = render(
      <AgentHubI18nProvider language="en">
        <PowerCard series={{ ...series, type: 'agent', name: 'reviewer' }} busy={false} />
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

  it('falls back per version when the newest version has no description_zh', () => {
    // The card shows the newest version, so the per-version fallback is exercised on a
    // series whose newest version is the V1 one that carries no `description_zh`.
    const v1 = localizedSeries.versions.find((version) => version.version === 'v1.0.0')!
    render(
      <AgentHubI18nProvider language="zh-CN">
        <PowerCard series={{ ...localizedSeries, versions: [v1] }} busy={false} />
      </AgentHubI18nProvider>
    )

    expect(screen.getByRole('heading', { name: '代码审查' })).toBeTruthy()
    expect(screen.getByText('Peer review workflow.')).toBeTruthy()
  })

  it('keeps the title on the series and the description on the newest version', () => {
    renderLocalized('zh-CN')

    // The series title stays put while the description below it is the newest version's.
    expect(screen.getByRole('heading', { name: '代码审查' })).toBeTruthy()
    expect(screen.getByText('带质量门禁的代码审查。')).toBeTruthy()
    expect(screen.queryByText('Peer review workflow.')).toBeNull()
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

  it('uses the type palette hook and shows no Version label', () => {
    const { result } = renderCard()

    const card = result.container.querySelector('.power-card')
    expect(card?.getAttribute('data-power-type')).toBe('skill')
    expect(screen.queryByText('Version')).toBeNull()
    expect(screen.getByTestId('power-card-version').textContent).toBe('v2.0.0')
  })

  it('renders the newest version description and tags', () => {
    renderCard()

    expect(screen.getByText('Peer review with a quality gate.')).toBeTruthy()
    const tags = screen.getByTestId('power-card-tags')
    expect(within(tags).getByText('quality')).toBeTruthy()
  })

  it('opens details when the card body is clicked', () => {
    const { onDetails } = renderCard()

    fireEvent.click(screen.getByRole('heading', { name: 'code-review' }))

    expect(onDetails).toHaveBeenCalled()
  })

  it('has no interactive version control to swallow the click', () => {
    const { onDetails } = renderCard()

    // The version slot is plain text now, so clicking it is a normal card click.
    fireEvent.click(screen.getByTestId('power-card-version'))

    expect(onDetails).toHaveBeenCalled()
  })

  it('does not open details when the card is not clickable', () => {
    renderCard({ onDetails: undefined })

    const card = document.querySelector('.power-card')
    expect(card?.getAttribute('data-clickable')).toBeNull()
  })

  it('does not open details while a write is in flight', () => {
    const { onDetails } = renderCard({ busy: true })

    fireEvent.click(screen.getByRole('heading', { name: 'code-review' }))

    expect(onDetails).not.toHaveBeenCalled()
  })

  it('renders the notice when provided', () => {
    renderCard({ notice: { text: 'Installation complete.' } })

    expect(screen.getByText('Installation complete.')).toBeTruthy()
  })

  it('marks a hand-installed resource and labels its version', () => {
    const custom: PowerSeries = {
      type: 'skill',
      name: 'hand-written',
      source: 'custom',
      versions: [{ version: 'v1.2.3', description: 'Hand made.', tags: [] }],
    }
    const view = render(<PowerCard series={custom} busy={false} />)

    const card = view.container.querySelector('.power-card')
    expect(card?.getAttribute('data-source')).toBe('custom')
    expect(screen.getByText('Custom')).toBeTruthy()
    // No card has a version control any more; the custom one keeps the dashed slot.
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
    render(<PowerCard series={custom} busy={false} />)

    expect(screen.getByTestId('power-card-version').textContent).toBe('No version')
  })

  it('renders no custom marker for a Hub-managed series', () => {
    const { result } = renderCard()

    const card = result.container.querySelector('.power-card')
    expect(card?.getAttribute('data-source')).toBeNull()
    expect(screen.queryByText('Custom')).toBeNull()
  })

  it('marks a Power the target Agent already has installed', () => {
    const { result } = renderCard({ installed: true })

    expect(screen.getByText('Installed')).toBeTruthy()
    // The modifier is what carries the success colours instead of the custom ones.
    expect(result.container.querySelector('.power-card__badge--installed')).toBeTruthy()
    // The badge is added alongside the version the catalog lists, not instead of it.
    expect(screen.getByTestId('power-card-version').textContent).toBe('v2.0.0')
  })

  it('puts the New badge to the left of Installed', () => {
    const { result } = renderCard({ installed: true, hasNewer: true })

    const badges = Array.from(result.container.querySelectorAll('.power-card__badge'))
    expect(badges.map((badge) => badge.textContent)).toEqual(['New', 'Installed'])
    expect(result.container.querySelector('.power-card__badge--new')).toBeTruthy()
  })

  it('shows no New badge without an install to be newer than', () => {
    // `New` means "newer than the version you have", so it never stands alone.
    const { result } = renderCard({ hasNewer: true })

    expect(screen.queryByText('New')).toBeNull()
    expect(result.container.querySelector('.power-card__badge--new')).toBeNull()
  })

  it('shows no installed marker unless the manifest says so', () => {
    const { result } = renderCard()

    expect(screen.queryByText('Installed')).toBeNull()
    expect(result.container.querySelector('.power-card__badge--installed')).toBeNull()
  })

  it('never shows the custom and installed markers together', () => {
    // A custom resource only comes from the local scan on the installed tab, and the
    // installed flag is only set for market cards, so the page cannot produce both.
    const custom: PowerSeries = {
      type: 'skill',
      name: 'hand-written',
      source: 'custom',
      versions: [{ version: 'v1.2.3', description: 'Hand made.', tags: [] }],
    }
    render(<PowerCard series={custom} busy={false} />)

    expect(screen.getByText('Custom')).toBeTruthy()
    expect(screen.queryByText('Installed')).toBeNull()

    cleanup()

    render(<PowerCard series={series} busy={false} installed />)
    expect(screen.getByText('Installed')).toBeTruthy()
    expect(screen.queryByText('Custom')).toBeNull()
  })
})
