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
  it('keeps version information out of cards in both languages', () => {
    const card = (language: string) => (
      <AgentHubI18nProvider language={language}>
        <PowerCard series={series} busy={false} />
      </AgentHubI18nProvider>
    )
    const view = render(card('en'))

    expect(screen.queryByText('v2.0.0')).toBeNull()
    expect(screen.queryByTestId('power-card-version')).toBeNull()
    expect(screen.queryByLabelText('Version')).toBeNull()

    view.rerender(card('zh-CN'))
    expect(screen.queryByText('v2.0.0')).toBeNull()
    expect(screen.queryByLabelText('版本')).toBeNull()
  })

  it('renders the series type and name', () => {
    renderCard()

    expect(screen.getByText('skill')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'code-review' })).toBeTruthy()
  })

  it('shows the Expert type chip from the type itself, capitalised by CSS', () => {
    const { container } = render(
      <AgentHubI18nProvider language="en">
        <PowerCard series={{ ...series, type: 'expert', name: 'reviewer' }} busy={false} />
      </AgentHubI18nProvider>
    )

    // No label mapping is left: the type IS the word, and `.power-card__type` uppercases it.
    expect(container.querySelector('.power-card__type')?.textContent).toBe('expert')
    expect(container.querySelector('.power-card')?.getAttribute('data-power-type')).toBe('expert')
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
    expect(screen.queryByTestId('power-card-version')).toBeNull()
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

  it('opens details when a footer tag is clicked', () => {
    const { onDetails } = renderCard()

    fireEvent.click(within(screen.getByTestId('power-card-tags')).getByText('quality'))

    expect(onDetails).toHaveBeenCalled()
  })

  it('opens details from the keyboard, not only from a pointer', () => {
    // The card opened on click alone, so a mouse could reach the details and a keyboard
    // could not: a pointer-only target has no keyboard equivalent. The title is now a
    // real button, which is what puts the card in the tab order and makes Enter/Space
    // work; it also keeps the heading's semantics instead of turning the card into a
    // role=button that would swallow the description's own scroller.
    const { onDetails } = renderCard()

    const open = screen.getByRole('button', { name: 'code-review' })
    expect(open.tagName).toBe('BUTTON')
    // It lives inside the heading, so the heading still names the card.
    expect(open.closest('h2')).toBeTruthy()

    fireEvent.click(open)
    expect(onDetails).toHaveBeenCalledTimes(1)
  })

  it('fires the details once per press, not twice through bubbling', () => {
    // The button sits inside the article that also handles onClick, so a missing
    // stopPropagation would open the dialog twice for one press.
    const { onDetails } = renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'code-review' }))

    expect(onDetails).toHaveBeenCalledTimes(1)
  })

  it('disables the keyboard control while a write is in flight', () => {
    const { onDetails } = renderCard({ busy: true })

    const open = screen.getByRole('button', { name: 'code-review' }) as HTMLButtonElement
    expect(open.disabled).toBe(true)

    fireEvent.click(open)
    expect(onDetails).not.toHaveBeenCalled()
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

  it('marks a hand-installed resource without displaying its version', () => {
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
    expect(screen.queryByLabelText('Version')).toBeNull()
    expect(screen.queryByText('v1.2.3')).toBeNull()
  })

  it('does not add a version placeholder for a hand-installed resource', () => {
    const custom: PowerSeries = {
      type: 'plugin',
      name: 'local-bundle',
      source: 'custom',
      versions: [{ version: '', description: '', tags: [] }],
    }
    render(<PowerCard series={custom} busy={false} />)

    expect(screen.queryByText('No version')).toBeNull()
    expect(screen.queryByTestId('power-card-version')).toBeNull()
  })

  it('renders no custom marker for a Hub-managed series', () => {
    const { result } = renderCard()

    const card = result.container.querySelector('.power-card')
    expect(card?.getAttribute('data-source')).toBeNull()
    expect(screen.queryByText('Custom')).toBeNull()
  })

  it('places Installed before the existing tags in the footer', () => {
    const { result } = renderCard({ installed: true })

    expect(screen.getByText('Installed')).toBeTruthy()
    // The modifier is what carries the success colours instead of the custom ones.
    expect(result.container.querySelector('.power-card__badge--installed')).toBeTruthy()
    const tags = screen.getByTestId('power-card-tags')
    expect(tags.closest('.power-card__footer')).toBeTruthy()
    expect(Array.from(tags.querySelectorAll('.power-card__tag')).map((tag) => tag.textContent))
      .toEqual(['Installed', 'code-review', 'quality'])
  })

  it('preserves the New notice in the header and Installed as the first footer tag', () => {
    const { result } = renderCard({ installed: true, hasNewer: true })

    expect(result.container.querySelector('.power-card__header .power-card__badge--new')?.textContent).toBe('New')
    expect(screen.getByTestId('power-card-tags').firstElementChild?.textContent).toBe('Installed')
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

  it('preserves the custom marker while labeling a local resource as installed', () => {
    const custom: PowerSeries = {
      type: 'skill',
      name: 'hand-written',
      source: 'custom',
      versions: [{ version: 'v1.2.3', description: 'Hand made.', tags: [] }],
    }
    render(<PowerCard series={custom} busy={false} installed />)

    expect(screen.getByText('Custom')).toBeTruthy()
    expect(screen.getByText('Installed')).toBeTruthy()
    expect(screen.getByTestId('power-card-tags').firstElementChild?.textContent).toBe('Installed')
  })

  it('only offers adding a catalog capability when an install handler is provided', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: 'Add capability' })).toBeNull()
  })

  it('runs the card install action without opening details', async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    const { onDetails } = renderCard({ onInstall })

    await user.click(screen.getByRole('button', { name: 'Add capability' }))

    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(onDetails).not.toHaveBeenCalled()
  })

  it.each([{ busy: true }, { installDisabled: true }])('disables adding when %o', async (state) => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    const { onDetails } = renderCard({ onInstall, ...state })
    const add = screen.getByRole('button', { name: 'Add capability' }) as HTMLButtonElement

    expect(add.disabled).toBe(true)
    await user.click(add)

    expect(onInstall).not.toHaveBeenCalled()
    expect(onDetails).not.toHaveBeenCalled()
  })

  it('never offers adding an installed capability or a custom resource', () => {
    const onInstall = vi.fn()
    const { result } = renderCard({ installed: true, onInstall })
    expect(screen.queryByRole('button', { name: 'Add capability' })).toBeNull()

    result.rerender(<PowerCard series={{ ...series, source: 'custom' }} busy={false} onInstall={onInstall} />)
    expect(screen.queryByRole('button', { name: 'Add capability' })).toBeNull()

    result.rerender(<PowerCard series={series} busy={false} onInstall={onInstall} />)
    expect(screen.getByRole('button', { name: 'Add capability' })).toBeTruthy()

    result.rerender(<PowerCard series={series} busy={false} onInstall={onInstall} installed />)
    expect(screen.queryByRole('button', { name: 'Add capability' })).toBeNull()
  })
})
