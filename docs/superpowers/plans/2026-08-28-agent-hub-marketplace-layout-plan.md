# Agent Hub Marketplace Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Agent Hub into a centered, accessible Marketplace layout with unified scope navigation, an Agent menu on “我的 Power”, type-coordinated filters and cards, a maximum five-column grid, and direct page entry.

**Architecture:** Keep Store requests, snapshots, errors, and filter state in `AgentHubPage`; make `PowerFilters`, `PowerCard`, and a new `PowerPagination` focused presentation components. Drive the four Power type palettes through `data-power-type` and CSS custom properties so filter selection, card borders, and card tags stay visually consistent without changing the Store contract.

**Tech Stack:** React 19, TypeScript 5.9, Vite 6, CSS, Vitest 3.2.4, jsdom 26.1.0, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-28-agent-hub-marketplace-layout-design.md`

## Global Constraints

- Do not change `powers.list.v1`, `ListPowersInput`, `ReadyListPowersResult`, or `POWER_PAGE_SIZE`; every page remains exactly 20 Power series.
- Power types remain exactly `skill`, `plugin`, `mcp`, and `agent`; do not add an all-types option.
- Tags retain sorted, unique, multi-select OR semantics.
- Keep the visible scope labels exactly `我的 Power` and `Power 市场`; the current Agent is indicated only inside the Agent menu.
- Preserve the selected installed Agent when switching to the market and back.
- Agent selection must work with hover, click, touch/focus, ArrowDown, and Escape; it must not depend on hover alone.
- Use the approved soft palettes: Skill purple, Plugin green, MCP orange, Agent blue.
- Cards use a maximum of five columns; the grid container is centered, while incomplete rows remain left-aligned.
- Version controls show only version values such as `v2.0.0`; retain the accessible name `Version` without rendering visible “Version” copy.
- Pagination uses previous/next arrows plus an editable page number; Enter or blur commits, bounds clamp to `1..totalPages`, and invalid/blank input restores the current page.
- Preserve all pre-existing user changes. At plan creation, the worktree already contains edits in `dev/powerCatalogMock.ts`, `dev/powerCatalogMock.test.ts`, `src/AgentHubPage.test.tsx`, `src/agentHub.css`, and the Power filter/card source and test files.
- Do not stage or commit `.superpowers/`; it contains brainstorming previews, not product source.
- Use TDD for every behavior change and make one focused commit after each task passes its targeted tests.
- Add one reverse-chronological `docs/Changelog.md` entry only after the implementation and full verification complete.

---

## File Map

- `src/components/PowerFilters.tsx`: scope tabs, persistent Agent popover, type buttons, and Tag chips.
- `src/components/PowerFilters.test.tsx`: scope, Agent menu, keyboard, type, and Tag behavior.
- `src/components/PowerCard.tsx`: semantic card structure, version state, description region, Tags, and type styling hook.
- `src/components/PowerCard.test.tsx`: version accessibility, content synchronization, and semantic layout hooks.
- `src/components/PowerPagination.tsx`: controlled page navigation with local input draft.
- `src/components/PowerPagination.test.tsx`: arrows, Enter/blur, clamping, and invalid-input behavior.
- `src/AgentHubPage.tsx`: Store/request state, installed Agent facet retention, component composition, and page changes.
- `src/AgentHubPage.test.tsx`: request regression tests, Agent retention, and direct-page snapshot behavior.
- `src/agentHub.css`: Marketplace layout, palettes, grid, scrolling, focus, popover, status, and responsive rules.
- `docs/Changelog.md`: one completed-request behavior record after verification.

---

### Task 1: Refactor the Unified Filters and Agent Menu

**Files:**

- Modify: `src/components/PowerFilters.tsx:1-96`
- Modify: `src/components/PowerFilters.test.tsx:1-123`

**Interfaces:**

- Consumes: existing `PowerFiltersProps`, `POWER_TYPES`, `PowerScope`, and `PowerType`.
- Produces: the same public `PowerFilters(props): JSX.Element` interface; no caller change is required in this task.
- Produces styling hooks: `.power-filters`, `.power-filters__scopes`, `.power-filters__scope-agent`, `.power-filters__agent-menu`, `.power-filters__panel`, `.power-filters__types`, `.power-filters__tags`, and `data-power-type`.

- [ ] **Step 1: Replace the old Agent-button expectations with failing menu tests**

Keep the existing `renderFilters` fixture, then replace the scope/Agent tests with assertions equivalent to:

```tsx
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
  await user.click(screen.getByRole('menuitemradio', { name: 'atlas' }))

  expect(props.onAgentChange).toHaveBeenCalledWith('atlas')
  expect(props.onScopeChange).not.toHaveBeenCalled()
  expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
})

it('switches from market to the selected installed Agent from the menu', async () => {
  const user = userEvent.setup()
  const props = renderFilters({ scope: 'market' })

  await user.hover(screen.getByRole('button', { name: '我的 Power' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'atlas' }))

  expect(props.onScopeChange).toHaveBeenCalledWith('installed')
  expect(props.onAgentChange).toHaveBeenCalledWith('atlas')
})
```

Keep the existing tests for the four types and sorted unique Tags, but change the current scope/type assertions so selected controls are not expected to be disabled. Assert `aria-pressed="true"` and `data-power-type="skill"` instead.

- [ ] **Step 2: Add failing keyboard and menu-dismissal tests**

```tsx
it('opens the Agent menu with ArrowDown and restores focus with Escape', async () => {
  const user = userEvent.setup()
  renderFilters()
  const trigger = screen.getByRole('button', { name: '我的 Power' })

  trigger.focus()
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /bibit/ }))

  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'atlas' }))
  await user.keyboard('{ArrowUp}')
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /bibit/ }))

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('closes the Agent menu when focus leaves its wrapper', async () => {
  const user = userEvent.setup()
  renderFilters()

  await user.click(screen.getByRole('button', { name: '我的 Power' }))
  screen.getByRole('button', { name: 'Power 市场' }).focus()

  expect(screen.queryByRole('menu', { name: 'Agent' })).toBeNull()
})
```

- [ ] **Step 3: Run the filter tests and verify RED**

Run:

```bash
npx vitest run src/components/PowerFilters.test.tsx
```

Expected: FAIL because Agents still render as a separate group, “我的 Power” has no menu semantics, and the selected controls are disabled.

- [ ] **Step 4: Implement the Agent menu state and focus behavior**

Import React state/ref support:

```tsx
import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
```

Inside `PowerFilters`, add:

```tsx
const [agentMenuOpen, setAgentMenuOpen] = useState(false)
const installedTriggerRef = useRef<HTMLButtonElement>(null)
const firstAgentRef = useRef<HTMLButtonElement>(null)
const suppressFocusOpenRef = useRef(false)

const openAgentMenu = (focusFirst = false) => {
  if (agents.length === 0) return
  setAgentMenuOpen(true)
  if (focusFirst) requestAnimationFrame(() => firstAgentRef.current?.focus())
}

const closeAgentMenu = (restoreFocus = false) => {
  setAgentMenuOpen(false)
  if (restoreFocus) {
    suppressFocusOpenRef.current = true
    requestAnimationFrame(() => {
      installedTriggerRef.current?.focus()
      suppressFocusOpenRef.current = false
    })
  }
}

const handleAgentWrapperBlur = (event: FocusEvent<HTMLDivElement>) => {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeAgentMenu()
}

const handleAgentMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeAgentMenu(true)
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
  )
  if (items.length === 0) return
  event.preventDefault()
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  const direction = event.key === 'ArrowDown' ? 1 : -1
  const nextIndex = currentIndex < 0
    ? (direction === 1 ? 0 : items.length - 1)
    : (currentIndex + direction + items.length) % items.length
  items[nextIndex].focus()
}
```

Render the scope row with “我的 Power” wrapped together with the menu. The trigger must remain enabled so it can open the menu:

```tsx
<div className="power-filters__scopes" role="group" aria-label="Scope">
  <div
    className="power-filters__scope-agent"
    onMouseEnter={() => openAgentMenu()}
    onMouseLeave={() => closeAgentMenu()}
    onFocusCapture={(event) => {
      if (event.target === installedTriggerRef.current && !suppressFocusOpenRef.current) {
        openAgentMenu()
      }
    }}
    onBlurCapture={handleAgentWrapperBlur}
    onKeyDown={handleAgentMenuKeyDown}
  >
    <button
      ref={installedTriggerRef}
      type="button"
      className="power-filters__scope"
      aria-pressed={scope === 'installed'}
      aria-haspopup="menu"
      aria-expanded={agentMenuOpen}
      onClick={() => {
        if (scope !== 'installed') onScopeChange('installed')
        openAgentMenu()
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          openAgentMenu(true)
        }
      }}
    >
      我的 Power <span aria-hidden="true">⌄</span>
    </button>
    {agentMenuOpen && agents.length > 0 && (
      <div className="power-filters__agent-menu" role="menu" aria-label="Agent">
        {agents.map((value, index) => (
          <button
            ref={index === 0 ? firstAgentRef : undefined}
            key={value}
            type="button"
            role="menuitemradio"
            aria-checked={value === agent}
            onClick={() => {
              if (scope !== 'installed') onScopeChange('installed')
              if (value !== agent) onAgentChange(value)
              closeAgentMenu(true)
            }}
          >
            {value === agent && <span aria-hidden="true">✓</span>}
            {value}
          </button>
        ))}
      </div>
    )}
  </div>
  <button
    type="button"
    className="power-filters__scope"
    aria-pressed={scope === 'market'}
    onClick={() => scope !== 'market' && onScopeChange('market')}
  >
    Power 市场
  </button>
</div>
```

- [ ] **Step 5: Implement the independent type/Tag panel and styling hooks**

Wrap types and Tags in `.power-filters__panel`. Keep existing callbacks and sorted Tag toggling, but render the exact structural hooks:

```tsx
<div className="power-filters__panel">
  <div className="power-filters__filter-row">
    <span className="power-filters__label">Type</span>
    <div className="power-filters__types" role="group" aria-label="Type">
      {POWER_TYPES.map((value) => (
        <button
          key={value}
          type="button"
          data-power-type={value}
          aria-pressed={value === type}
          onClick={() => value !== type && onTypeChange(value)}
        >
          {value}
        </button>
      ))}
    </div>
  </div>
  <div className="power-filters__filter-row">
    <span className="power-filters__label">Tags</span>
    <div
      className="power-filters__tags"
      data-power-type={type}
      role="group"
      aria-label="Tags"
    >
      {availableTags.map((tag) => (
        <button
          key={tag}
          type="button"
          aria-pressed={selectedTags.includes(tag)}
          onClick={() => {
            const next = selectedTags.includes(tag)
              ? selectedTags.filter((value) => value !== tag)
              : [...selectedTags, tag]
            onTagsChange([...next].sort())
          }}
        >
          {tag}
        </button>
      ))}
    </div>
  </div>
</div>
```

- [ ] **Step 6: Run the filter tests and verify GREEN**

Run:

```bash
npx vitest run src/components/PowerFilters.test.tsx
```

Expected: all `PowerFilters` tests PASS with no React act warnings.

- [ ] **Step 7: Commit the filter refactor**

```bash
git add src/components/PowerFilters.tsx src/components/PowerFilters.test.tsx
git commit -m "feat: unify Agent Hub filters"
```

---

### Task 2: Restructure the Type-Colored Power Card

**Files:**

- Modify: `src/components/PowerCard.tsx:1-44`
- Modify: `src/components/PowerCard.test.tsx:1-77`

**Interfaces:**

- Consumes: existing `PowerSeries` and `PowerVersion` structures.
- Produces: unchanged `PowerCard({ series }: PowerCardProps)` signature.
- Produces styling hooks: `.power-card`, `.power-card__header`, `.power-card__type`, `.power-card__version`, `.power-card__description`, `.power-card__tags`, `.power-card__tag`, and `data-power-type`.

- [ ] **Step 1: Write failing semantic-card tests**

Update the default-version and version-change tests so descriptions are queried as text, not form values. Add these assertions:

```tsx
it('uses the type palette hook and hides the visible Version label', () => {
  const { container } = render(<PowerCard series={series} />)

  const card = container.querySelector('.power-card')
  expect(card?.getAttribute('data-power-type')).toBe('skill')
  expect(screen.queryByText('Version')).toBeNull()
  expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('v2.0.0')
})

it('renders description as text and Tags as chips', () => {
  render(<PowerCard series={series} />)

  expect(screen.getByText('Peer review with a quality gate.').tagName).toBe('P')
  const tags = screen.getByTestId('power-card-tags')
  expect(within(tags).getByText('code-review')).toBeTruthy()
  expect(within(tags).getByText('quality')).toBeTruthy()
})
```

In the existing version-change test, use `screen.getByText('Peer review workflow.')` and assert the previous description with `queryByText`.

- [ ] **Step 2: Run the card tests and verify RED**

Run:

```bash
npx vitest run src/components/PowerCard.test.tsx
```

Expected: FAIL because the card lacks `data-power-type`, renders a visible label, and still uses a textarea for the description.

- [ ] **Step 3: Implement the semantic card structure**

Keep the existing selected-version state and reset effect. Replace the returned article with:

```tsx
<article className="power-card" data-power-type={series.type}>
  <div className="power-card__header">
    <span className="power-card__type">{series.type}</span>
    <select
      className="power-card__version"
      aria-label="Version"
      value={selectedVersion}
      onChange={(event) => setSelectedVersion(event.target.value)}
    >
      {series.versions.map((version) => (
        <option key={version.version} value={version.version}>
          {version.version}
        </option>
      ))}
    </select>
  </div>
  <h2>{series.name}</h2>
  <p className="power-card__description">{current.description}</p>
  <div className="power-card__tags" data-testid="power-card-tags">
    {current.tags.map((tag) => (
      <span key={tag} className="power-card__tag">
        {tag}
      </span>
    ))}
  </div>
</article>
```

- [ ] **Step 4: Run the card tests and verify GREEN**

Run:

```bash
npx vitest run src/components/PowerCard.test.tsx
```

Expected: all `PowerCard` tests PASS, including version reset and synchronized description/Tags.

- [ ] **Step 5: Commit the card refactor**

```bash
git add src/components/PowerCard.tsx src/components/PowerCard.test.tsx
git commit -m "feat: restyle Power card content"
```

---

### Task 3: Add the Direct-Entry Pagination Component

**Files:**

- Create: `src/components/PowerPagination.tsx`
- Create: `src/components/PowerPagination.test.tsx`

**Interfaces:**

- Produces:

```ts
export interface PowerPaginationProps {
  page: number
  totalPages: number
  canGoNext: boolean
  onPageChange(page: number): void
}
```

- Produces: `PowerPagination(props): JSX.Element` with accessible `Previous page`, `Next page`, and `Page number` controls.

- [ ] **Step 1: Write failing arrow and input tests**

Create `src/components/PowerPagination.test.tsx` with:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PowerPagination } from './PowerPagination'

afterEach(cleanup)

describe('PowerPagination', () => {
  it('disables boundary arrows and moves one page at a time', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    const { rerender } = render(
      <PowerPagination page={1} totalPages={4} canGoNext onPageChange={onPageChange} />
    )

    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)

    rerender(
      <PowerPagination page={4} totalPages={4} canGoNext={false} onPageChange={onPageChange} />
    )
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('commits a page number on Enter', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<PowerPagination page={1} totalPages={4} canGoNext onPageChange={onPageChange} />)

    const input = screen.getByRole('spinbutton', { name: 'Page number' })
    await user.clear(input)
    await user.type(input, '3{Enter}')
    expect(onPageChange).toHaveBeenCalledOnce()
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('clamps on blur and restores invalid input', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<PowerPagination page={2} totalPages={4} canGoNext onPageChange={onPageChange} />)
    const input = screen.getByRole('spinbutton', { name: 'Page number' })

    await user.clear(input)
    await user.type(input, '9')
    await user.tab()
    expect(onPageChange).toHaveBeenLastCalledWith(4)

    await user.clear(input)
    await user.type(input, 'abc')
    await user.tab()
    expect((input as HTMLInputElement).value).toBe('2')
    expect(onPageChange).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the pagination tests and verify RED**

Run:

```bash
npx vitest run src/components/PowerPagination.test.tsx
```

Expected: FAIL because `PowerPagination.tsx` does not exist.

- [ ] **Step 3: Implement page draft normalization and navigation**

Create `src/components/PowerPagination.tsx`:

```tsx
import { useEffect, useState } from 'react'

export interface PowerPaginationProps {
  page: number
  totalPages: number
  canGoNext: boolean
  onPageChange(page: number): void
}

export function PowerPagination({
  page,
  totalPages,
  canGoNext,
  onPageChange,
}: PowerPaginationProps) {
  const [draft, setDraft] = useState(String(page))

  useEffect(() => setDraft(String(page)), [page])

  const commitDraft = () => {
    const trimmed = draft.trim()
    if (!/^\d+$/.test(trimmed)) {
      setDraft(String(page))
      return
    }
    const next = Math.min(totalPages, Math.max(1, Number(trimmed)))
    setDraft(String(next))
    if (next !== page) onPageChange(next)
  }

  return (
    <nav className="power-pagination" aria-label="Power pages">
      <button
        type="button"
        aria-label="Previous page"
        disabled={page === 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <span>第</span>
      <input
        aria-label="Page number"
        type="number"
        min={1}
        max={totalPages}
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitDraft()
        }}
      />
      <span>/ {totalPages} 页</span>
      <button
        type="button"
        aria-label="Next page"
        disabled={!canGoNext || page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  )
}
```

- [ ] **Step 4: Run the pagination tests and verify GREEN**

Run:

```bash
npx vitest run src/components/PowerPagination.test.tsx
```

Expected: all pagination tests PASS. If jsdom accepts alphabetic text in a number input as an empty value, the invalid-input assertion still passes because `commitDraft` restores `page`.

- [ ] **Step 5: Commit the pagination component**

```bash
git add src/components/PowerPagination.tsx src/components/PowerPagination.test.tsx
git commit -m "feat: add direct Power pagination"
```

---

### Task 4: Integrate Pagination and Preserve Installed Agent Options

**Files:**

- Modify: `src/AgentHubPage.tsx:1-211`
- Modify: `src/AgentHubPage.test.tsx:113-445`

**Interfaces:**

- Consumes: `PowerPaginationProps` from Task 3.
- Produces: `knownAgents: string[]` page state retained across market responses whose `facets.agents` is empty.
- Produces: `changePage(nextPage: number): void`, passed to `PowerPagination.onPageChange`.

- [ ] **Step 1: Update page tests for accessible pagination names**

Replace queries for `Next` with `Next page` and `Previous` with `Previous page`. Change the initial pagination assertion from one combined text node to:

```tsx
expect((screen.getByRole('spinbutton', { name: 'Page number' }) as HTMLInputElement).value).toBe('1')
expect(screen.getByText('/ 1 页')).toBeTruthy()
```

- [ ] **Step 2: Add failing direct-jump and Agent-retention page tests**

Add:

```tsx
it('jumps directly with the current snapshot', async () => {
  const user = userEvent.setup()
  const { hostApi, calls } = makeStoreHost((input) => {
    const params = paramsOf(input)
    return readyResult({
      page: params.page,
      total: 80,
      nextPage: params.page < 4 ? params.page + 1 : undefined,
      items: [params.page === 3 ? secondPageSkill : codeReview],
    })
  })
  renderPage(hostApi)
  await screen.findByRole('heading', { name: 'code-review' })

  const pageInput = screen.getByRole('spinbutton', { name: 'Page number' })
  await user.clear(pageInput)
  await user.type(pageInput, '3{Enter}')
  await screen.findByRole('heading', { name: 'second-page' })

  const last = paramsOf(calls[calls.length - 1])
  expect(last.page).toBe(3)
  expect(last.snapshot).toBe('snap-1')
})

it('retains the installed Agent menu after visiting the market', async () => {
  const user = userEvent.setup()
  const { hostApi, calls } = makeStoreHost((input) => {
    const params = paramsOf(input)
    return readyResult({
      facets: params.scope === 'installed'
        ? { agents: ['atlas', 'bibit'], tags: [] }
        : { agents: [], tags: [] },
    })
  })
  renderPage(hostApi)
  await screen.findByRole('heading', { name: 'code-review' })

  await user.hover(screen.getByRole('button', { name: '我的 Power' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'atlas' }))
  await waitFor(() => expect(paramsOf(calls[calls.length - 1]).agent).toBe('atlas'))

  await user.click(screen.getByRole('button', { name: 'Power 市场' }))
  await waitFor(() => expect(paramsOf(calls[calls.length - 1]).scope).toBe('market'))
  await user.hover(screen.getByRole('button', { name: '我的 Power' }))

  expect(screen.getByRole('menuitemradio', { name: /atlas/ }).getAttribute('aria-checked')).toBe('true')
})
```

Update the existing Agent selection test to open the “我的 Power” menu before clicking `atlas`.

- [ ] **Step 3: Run page tests and verify RED**

Run:

```bash
npx vitest run src/AgentHubPage.test.tsx
```

Expected: FAIL because the old inline pager has no page input and market results discard installed Agent facets.

- [ ] **Step 4: Retain known installed Agents without changing the Store request**

Import `PowerPagination` and add state:

```tsx
import { PowerPagination } from './components/PowerPagination'

const [knownAgents, setKnownAgents] = useState<string[]>([])
```

In the `ready` result branch, before validating the current Agent, retain installed facets:

```tsx
if (scope === 'installed' && result.facets.agents.length > 0) {
  setKnownAgents(result.facets.agents)
}
```

Use retained Agents only for the filter UI; continue using current ready Tags:

```tsx
const facets = view.status === 'ready' ? view.data.facets : { agents: [], tags: [] }
const agents = scope === 'installed' && facets.agents.length > 0 ? facets.agents : knownAgents
```

Pass `agents={agents}` to `PowerFilters`. Do not add `knownAgents` to the request effect dependencies because it does not affect request params.

- [ ] **Step 5: Replace the inline pager with `PowerPagination`**

Replace `goPrevious` and `goNext` with:

```tsx
const changePage = (nextPage: number) => setPage(nextPage)
```

Replace the inline Previous/text/Next block with:

```tsx
<PowerPagination
  page={view.data.page}
  totalPages={totalPages}
  canGoNext={view.data.nextPage !== undefined}
  onPageChange={changePage}
/>
```

Keep the existing snapshot reset rules unchanged. A direct page greater than 1 will use the current `snapshot` through the existing `ListPowersInput` construction.

- [ ] **Step 6: Run focused page and component tests**

Run:

```bash
npx vitest run \
  src/AgentHubPage.test.tsx \
  src/components/PowerFilters.test.tsx \
  src/components/PowerPagination.test.tsx
```

Expected: all listed tests PASS. Existing reset-required, stale-response, request-cancellation, error mapping, and tag-reset tests remain green.

- [ ] **Step 7: Commit the page integration**

```bash
git add src/AgentHubPage.tsx src/AgentHubPage.test.tsx
git commit -m "feat: integrate Agent Hub navigation"
```

---

### Task 5: Apply the Marketplace Visual System and Responsive Grid

**Files:**

- Modify: `src/agentHub.css:1-19`

**Interfaces:**

- Consumes: class names and `data-power-type` hooks produced by Tasks 1–4.
- Produces: one centered content surface, scope tabs above an independent filter panel, four soft type palettes, a maximum five-column left-flowing grid, fixed card content regions, centered pagination, and responsive 4/3/2/1 column fallbacks.

- [ ] **Step 1: Add structural hook assertions before styling**

Add these non-visual assertions to existing component tests:

```tsx
expect(document.querySelector('.power-filters__scopes')).toBeTruthy()
expect(document.querySelector('.power-filters__panel')).toBeTruthy()
expect(document.querySelector('.power-filters__tags')).toBeTruthy()
```

In `AgentHubPage.test.tsx`, after the first card renders:

```tsx
expect(document.querySelector('.agent-hub__grid')).toBeTruthy()
expect(document.querySelector('.power-pagination')).toBeTruthy()
```

- [ ] **Step 2: Run tests before the CSS replacement**

Run:

```bash
npx vitest run src/components/PowerFilters.test.tsx src/AgentHubPage.test.tsx
```

Expected: PASS. These assertions lock the DOM/CSS contract before the visual rewrite; CSS is verified by build and browser inspection rather than jsdom layout calculations.

- [ ] **Step 3: Define shared Marketplace and type tokens**

Replace the minified page CSS with readable rules beginning with:

```css
.agent-hub {
  --hub-bg: #f5f6f8;
  --hub-surface: #ffffff;
  --hub-text: #172033;
  --hub-muted: #687386;
  --hub-border: #dfe4ec;
  box-sizing: border-box;
  min-height: 100%;
  padding: 36px clamp(20px, 4vw, 56px) 48px;
  background: var(--hub-bg);
  color: var(--hub-text);
  font: 14px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
}

.agent-hub *, .agent-hub *::before, .agent-hub *::after { box-sizing: border-box; }
.agent-hub > * { width: min(100%, 1460px); margin-inline: auto; }

[data-power-type='skill']  { --type: #6d55cf; --type-soft: #f2efff; --type-line: #b8acf0; }
[data-power-type='plugin'] { --type: #16775c; --type-soft: #eef9f5; --type-line: #a9d8ca; }
[data-power-type='mcp']    { --type: #a95e16; --type-soft: #fff6eb; --type-line: #e9c59e; }
[data-power-type='agent']  { --type: #356dbd; --type-soft: #eff6ff; --type-line: #abc7ed; }
```

Keep `.agent-hub-settings` behavior visually isolated by retaining its existing settings-specific selectors after the Agent Hub page rules.

- [ ] **Step 4: Style scope navigation, popover, filters, and selection states**

Add exact behavioral layout rules:

```css
.power-filters { margin-bottom: 24px; }
.power-filters__scopes { display: flex; gap: 6px; border-bottom: 1px solid var(--hub-border); }
.power-filters__scope-agent { position: relative; }
.power-filters__scope {
  border: 0;
  border-bottom: 3px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--hub-muted);
  font-weight: 750;
}
.power-filters__scope[aria-pressed='true'] { border-bottom-color: #6550d8; color: #4f3cb3; }
.power-filters__agent-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  left: 0;
  min-width: 180px;
  padding: 7px;
  border: 1px solid var(--hub-border);
  border-radius: 12px;
  background: var(--hub-surface);
  box-shadow: 0 18px 40px rgb(23 32 51 / 16%);
}
.power-filters__agent-menu button { display: flex; width: 100%; gap: 8px; border-color: transparent; }
.power-filters__agent-menu button[aria-checked='true'] { border-color: #8f7ee6; background: #f3f0ff; }
.power-filters__panel {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding: 15px 18px;
  border: 1px solid var(--hub-border);
  border-radius: 14px;
  background: var(--hub-surface);
  box-shadow: 0 8px 24px rgb(28 39 64 / 5%);
}
.power-filters__filter-row { display: flex; align-items: flex-start; gap: 14px; }
.power-filters__label { min-width: 42px; padding-top: 9px; color: #8a93a4; font-size: 11px; font-weight: 800; text-transform: uppercase; }
.power-filters__types, .power-filters__tags { display: flex; flex-wrap: wrap; gap: 8px; }
.power-filters__tags { max-height: 82px; overflow-y: auto; padding: 2px 4px 2px 2px; }
.power-filters__types button { border-color: var(--type-line); background: var(--type-soft); color: var(--type); font-weight: 750; text-transform: capitalize; }
.power-filters__types button[aria-pressed='true'],
.power-filters__tags button[aria-pressed='true'] {
  border-color: var(--type);
  background: var(--type-soft);
  color: var(--type);
  box-shadow: inset 0 0 0 1px var(--type);
}
.power-filters__tags button { padding: 7px 11px; border-radius: 999px; }
```

Add a visible shared focus rule:

```css
.agent-hub button:focus-visible,
.agent-hub select:focus-visible,
.agent-hub input:focus-visible {
  outline: 3px solid rgb(101 80 216 / 28%);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Style the five-column grid and fixed-height card regions**

Use a centered grid container with a fixed maximum of five tracks. `justify-content: start` is what keeps an incomplete row left-aligned:

```css
.agent-hub__grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  justify-content: start;
  gap: 20px;
  margin-top: 22px;
}
.power-card {
  display: grid;
  grid-template-rows: auto auto minmax(96px, 1fr) 62px;
  min-width: 0;
  min-height: 310px;
  padding: 20px;
  border: 1px solid var(--type-line);
  border-radius: 16px;
  background: linear-gradient(145deg, #fff 34%, var(--type-soft));
  box-shadow: 0 9px 28px rgb(27 38 61 / 7%);
  transition: transform 160ms ease, box-shadow 160ms ease;
}
.power-card:hover { transform: translateY(-3px); box-shadow: 0 15px 34px rgb(27 38 61 / 12%); }
.power-card__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.power-card__type { color: var(--type); font-size: 11px; font-weight: 850; letter-spacing: .09em; text-transform: uppercase; }
.power-card__version { max-width: 112px; border: 1px solid var(--type-line); border-radius: 8px; background: rgb(255 255 255 / 78%); color: var(--hub-text); }
.power-card h2 { min-width: 0; margin: 15px 0 10px; overflow-wrap: anywhere; font-size: 19px; }
.power-card__description { min-height: 0; margin: 0; overflow-y: auto; color: var(--hub-muted); }
.power-card__tags { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 6px; min-height: 0; margin-top: 14px; overflow-y: auto; }
.power-card__tag { padding: 5px 9px; border-radius: 999px; background: var(--type-soft); color: var(--type); font-size: 11px; font-weight: 700; }
```

Use the following breakpoints so cards remain readable:

```css
@media (max-width: 1240px) { .agent-hub__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 980px)  { .agent-hub__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 720px)  { .agent-hub__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px)  {
  .agent-hub { padding-inline: 14px; }
  .agent-hub__grid { grid-template-columns: minmax(0, 1fr); }
  .power-filters__filter-row { display: grid; gap: 6px; }
  .power-filters__label { padding-top: 0; }
}
```

- [ ] **Step 6: Style status messages, scrollbars, and centered pagination**

Add:

```css
.power-pagination { display: flex; align-items: center; justify-content: center; gap: 9px; margin-top: 28px; }
.power-pagination button { display: grid; width: 38px; height: 38px; place-items: center; padding: 0; font-size: 22px; }
.power-pagination input { width: 58px; padding: 8px; border: 1px solid #c9d0dc; border-radius: 8px; text-align: center; }
.power-pagination button:disabled { cursor: not-allowed; opacity: .42; }
.agent-hub__status, .agent-hub__error { margin-top: 18px; }
.power-card__description, .power-card__tags, .power-filters__tags { scrollbar-width: thin; scrollbar-color: #bcc5d3 transparent; }
```

Retain the existing loading/error colors and retry-button semantics while expanding their selectors into readable blocks.

- [ ] **Step 7: Run automated CSS-adjacent verification**

Run:

```bash
npm run typecheck
npm run build:dev
npx vitest run src/components/PowerFilters.test.tsx src/components/PowerCard.test.tsx src/AgentHubPage.test.tsx
git diff --check
```

Expected: all commands exit 0; Vite emits a development build; no whitespace errors appear.

- [ ] **Step 8: Perform browser layout verification**

Run:

```bash
npm run dev
```

In the local Dev Host, verify at approximately 1440, 1200, 900, 700, and 420 CSS pixels:

- the grid shows 5, 4, 3, 2, and 1 columns respectively;
- the grid surface is centered, and the final incomplete row starts at its left edge;
- “我的 Power” opens a menu on hover and keyboard focus without clipping beneath the cards;
- the current Agent has a check and survives a market round trip;
- type buttons, selected borders, cards, and card Tags use matching purple/green/orange/blue palettes;
- long descriptions, card Tags, and filter Tags scroll inside their fixed regions;
- pagination remains centered and focus rings are visible;
- no card changes width or moves neighboring cards on hover.

Stop the dev server after the inspection.

- [ ] **Step 9: Commit the visual system**

```bash
git add src/agentHub.css src/components/PowerFilters.test.tsx src/AgentHubPage.test.tsx
git commit -m "feat: apply Agent Hub marketplace layout"
```

---

### Task 6: Run Full Verification and Record the Behavior Change

**Files:**

- Modify: `docs/Changelog.md`

**Interfaces:**

- Consumes: all implementation commits from Tasks 1–5 plus design commit `27b31e7`.
- Produces: one reverse-chronological Changelog entry for this user request.

- [ ] **Step 1: Run the complete automated verification suite**

Run:

```bash
npm test
npm run typecheck
npm run build:dev
git diff --check
```

Expected: every Vitest file passes, TypeScript and Vite exit 0, and diff check prints no errors. Record the exact test-file and test counts from Vitest for the Changelog.

- [ ] **Step 2: Confirm scope and preserved user changes**

Run:

```bash
git status --short
git diff --stat 27b31e7..HEAD
git diff -- dev/powerCatalogMock.ts dev/powerCatalogMock.test.ts
```

Expected:

- implementation commits touch only the planned source/test/CSS paths;
- the pre-existing Dev Mock edits remain present and uncommitted unless the user independently asks to include them;
- `.superpowers/` remains untracked or ignored and is not staged;
- no Store contract or SDK/vendor file changed.

- [ ] **Step 3: Gather the exact related commits**

Run:

```bash
git log --reverse --format='- `%h %s`' 27b31e7^..HEAD
```

Use every design and implementation line from this output under `相关提交：`. Do not include unrelated commits that may have landed concurrently.

- [ ] **Step 4: Add the Changelog entry from the required template**

Insert a new top entry beneath `# Changelog` with:

```markdown
## 2026-08-28

分类：功能变更

用户需求：

将 Agent Hub 前端重构为统一 Marketplace 风格：Agent 选择收进“我的 Power”菜单，类型与 Tags 提供选中边框和类型配色，卡片支持固定区域滚动与最多五列布局，分页改为箭头和页码输入。

相关提交：
```

Immediately below `相关提交：`, paste the exact filtered lines gathered in Step 3. Then append:

```markdown

解决方案或完成结果：

采用一级范围页签与独立筛选面板，保留已选 Agent；统一四种 Power 类型的筛选与卡片配色；重排版本、描述和 Tags；增加响应式五列网格以及支持 Enter/失焦提交的快速翻页。

验证结果或限制：

记录本轮 `npm test` 的准确通过数量，并注明 `npm run typecheck`、`npm run build:dev`、`git diff --check` 和浏览器五至一列检查均通过。Store DTO、每页 20 项和安装/市场数据语义未改变。
```

Replace the sentence requesting the test count with the exact count observed in Step 1 before saving the file.

- [ ] **Step 5: Validate and commit the Changelog**

Run:

```bash
git diff --check -- docs/Changelog.md
git diff -- docs/Changelog.md
```

Expected: one new reverse-chronological entry, no incomplete language, and every listed commit belongs to this request.

Commit:

```bash
git add docs/Changelog.md
git commit -m "docs: record Agent Hub marketplace layout"
```

- [ ] **Step 6: Re-run final repository checks**

Run:

```bash
npm test
npm run typecheck
npm run build:dev
git diff --check
git status --short
```

Expected: verification remains green. `git status --short` may show only the preserved pre-existing Dev Mock edits and `.superpowers/`; no planned implementation or Changelog file remains uncommitted.
