import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom has no layout engine, so this guards the CSS contract by reading the source.
// It exists because the page contribution lives in a full-height host box
// (`h-full min-h-0`) under `html, body, #root { overflow: hidden }`: if the page stops
// owning its scroll, or the card starts growing with the description again, the last
// cards and the pagination silently become unreachable instead of failing a test.

interface CssBlock {
  selectors: string[]
  /** At-rule preludes wrapping the rule, e.g. `@media (max-height: 820px)`. */
  conditions: string[]
  body: string
}

const NESTING_AT_RULES = /^@(media|supports|layer|container|scope)\b/

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Splits a selector list on commas that are not inside a functional pseudo-class. */
function splitSelectors(list: string): string[] {
  const selectors: string[] = []
  let depth = 0
  let current = ''
  for (const character of list) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      selectors.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  selectors.push(current.trim())
  return selectors.filter(Boolean)
}

function matchingBrace(css: string, open: number): number {
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function parseBlocks(css: string, conditions: string[] = [], blocks: CssBlock[] = []): CssBlock[] {
  let cursor = 0
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor)
    if (open === -1) break
    const prelude = css.slice(cursor, open)
    const selectorText = prelude.slice(prelude.lastIndexOf('}') + 1).trim()
    const close = matchingBrace(css, open)
    if (close === -1) break
    const body = css.slice(open + 1, close)
    if (selectorText.startsWith('@')) {
      if (NESTING_AT_RULES.test(selectorText)) parseBlocks(body, [...conditions, selectorText], blocks)
    } else if (selectorText) {
      blocks.push({ selectors: splitSelectors(selectorText), conditions, body })
    }
    cursor = close + 1
  }
  return blocks
}

const blocks = parseBlocks(stripComments(readFileSync(join(process.cwd(), 'src/agentHub.css'), 'utf8')))

/** Every rule whose selector list contains `selector`. */
function rules(selector: string): CssBlock[] {
  return blocks.filter((block) => block.selectors.includes(selector))
}

/** Declared values of `property` in one rule body. */
function declared(block: CssBlock, property: string): string[] {
  return block.body
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .flatMap((declaration) => {
      const colon = declaration.indexOf(':')
      if (colon === -1) return []
      const name = declaration.slice(0, colon).trim()
      return name === property ? [declaration.slice(colon + 1).trim()] : []
    })
}

/**
 * Resolve a `calc()` of `var()` tokens to a number, so a test can check the arithmetic
 * instead of a literal. Only the operators the stylesheet uses are accepted.
 */
function resolveCalc(expression: string, tokens: Record<string, number>): number {
  const substituted = expression.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => {
    if (!(name in tokens)) throw new Error(`missing token ${name}`)
    return String(tokens[name])
  })
  const body = substituted.replace(/^calc\(/, '').replace(/\)$/, '')
  if (!/^[\d\s+\-*/().]+$/.test(body)) throw new Error(`unsupported calc: ${body}`)
  return Function(`"use strict"; return (${body});`)() as number
}

describe('Agent Hub layout contract', () => {
  it('makes the page contribution its own scroll container', () => {
    const page = rules('.agent-hub')
    // The host box is `min-h-svh`-based, so a percentage height stays indefinite and the
    // page would silently never scroll. Only a viewport unit gives it a definite height.
    expect(
      page.some(
        (block) =>
          declared(block, 'height').some((value) => /^100(svh|vh|dvh)$/.test(value)) &&
          declared(block, 'overflow-y').includes('auto')
      )
    ).toBe(true)
  })

  it('themes every colour from the host signal instead of a light-only literal', () => {
    // The page painted light-only literals, so it stayed light while the host
    // switched to dark. `color-scheme` is inherited and `light-dark()` reads it, and
    // the host's style isolation only prefixes selectors, so a pair resolves from the
    // host's own signal. The alternative, a `.dark .agent-hub { ... }` block, cannot
    // work: the isolation rewrites it to `:where(<plugin-root>) .dark .agent-hub`,
    // where `.dark` would have to be a descendant of the plugin root, and on <html>
    // it is an ancestor.
    const page = rules('.agent-hub')
    const tokens = page.flatMap((block) => block.body.match(/--[\w-]+:/g) ?? [])
    expect(tokens.length).toBeGreaterThan(20)
    for (const declaration of page.flatMap((block) => block.body.split(';'))) {
      const match = /^\s*(--[\w-]+):\s*(.+?)\s*$/.exec(declaration)
      if (!match) continue
      const [, name, value] = match
      // Widths, radii and the card arithmetic are numbers, not colours.
      if (!/light-dark\(|#[0-9a-f]{3,8}|rgb/.test(value)) continue
      // The one deliberate single value: white on the brand blue clears 4.5:1 in
      // both themes, so a pair would only be noise. Anything else must be a pair.
      if (name === '--hub-on-primary') continue
      expect(`${name}=${value}`).toMatch(/light-dark\(/)
    }
    // No bare colour may sit in a rule body: it would freeze one theme.
    const bareLiteral = /(?<!light-dark\()\s(?:#[0-9a-f]{3,8}\b|rgba?\()/i
    const offenders = blocks
      .filter((block) => !block.selectors.includes('.agent-hub'))
      .map((block) => ({ selector: block.selectors.join(', '), body: block.body }))
      .filter(({ body }) => {
        // Strip every light-dark(...) pair first, so only bare literals remain.
        let stripped = body
        let guard = 0
        while (stripped.includes('light-dark(') && guard < 200) {
          stripped = stripped.replace(/light-dark\([^()]*(?:\([^()]*\)[^()]*)*\)/, '')
          guard += 1
        }
        return bareLiteral.test(` ${stripped}`)
      })
    expect(offenders).toEqual([])
  })

  it('keeps the card height independent of the description length', () => {
    expect(rules('.power-card').flatMap((block) => declared(block, 'min-height'))).toEqual([])

    const description = rules('.power-card__description')
    expect(
      description.some(
        (block) =>
          declared(block, 'overflow-y').includes('auto') &&
          declared(block, 'height').some((value) => value !== 'auto' && value !== '100%')
      )
    ).toBe(true)
  })

  it('keeps a Power name on one line at the same height on every card', () => {
    const title = rules('.power-card h2')
    const declaredOnce = (property: string) => title.flatMap((block) => declared(block, property))

    // No wrapping, and a box that is exactly one line high; useFittedFontSize fits the name.
    expect(declaredOnce('white-space')).toContain('nowrap')
    expect(declaredOnce('overflow')).toContain('hidden')
    expect(declaredOnce('text-overflow')).toContain('ellipsis')
    const height = declaredOnce('height')
    expect(height).toHaveLength(1)
    expect(height[0]).toBe(declaredOnce('line-height')[0])
    // A multi-line clamp would have to go; it was the old "at most two lines" rule.
    expect(declaredOnce('-webkit-line-clamp')).toEqual([])
  })

  it('clips the description horizontally', () => {
    const description = rules('.power-card__description')
    expect(description.flatMap((block) => declared(block, 'overflow-x'))).toContain('hidden')
  })

  it('hides the native bar on every plugin scroller and draws its own', () => {
    // The host's global `scrollbar-width: thin` makes WebKit ignore ::-webkit-scrollbar and
    // keeps the bar visible, so the plugin opts out per scroller and draws the indicator.
    const hidden = blocks.filter((block) => declared(block, 'scrollbar-width').includes('none'))
    const hiddenSelectors = hidden.flatMap((block) => block.selectors)
    for (const scroller of [
      '.agent-hub',
      '.power-card__description',
      '.power-card__tags',
      '.power-filters__tags',
      '.agent-hub-dialog__body',
    ]) {
      expect(hiddenSelectors).toContain(scroller)
      // The thumb is absolutely positioned, so its scroller must be the containing block.
      expect(
        rules(scroller).some((block) => declared(block, 'position').includes('relative'))
      ).toBe(true)
    }
    expect(
      blocks.some(
        (block) =>
          block.selectors.includes('.agent-hub__scroll-thumb') &&
          declared(block, 'position').includes('absolute')
      )
    ).toBe(true)
  })

  it('keeps the drawn thumb idle until its scroller moves', () => {
    const thumb = rules('.agent-hub__scroll-thumb')
    expect(thumb.flatMap((block) => declared(block, 'opacity'))).toContain('0')
    expect(thumb.flatMap((block) => declared(block, 'pointer-events'))).toContain('none')
    expect(
      rules(".agent-hub__scroll-thumb[data-visible='true']").flatMap((block) =>
        declared(block, 'opacity')
      )
    ).toContain('1')
    // The page's content-centering rule must not resize the thumb.
    const centering = blocks.find((block) =>
      block.selectors.includes('.agent-hub > :not(.agent-hub-dialog):not(.agent-hub__scroll-thumb)')
    )
    expect(centering).toBeDefined()
  })

  it('pins the pagination to the bottom of the page scroller', () => {
    const pagination = rules('.agent-hub .power-pagination')
    expect(
      pagination.some(
        (block) =>
          declared(block, 'position').includes('sticky') && declared(block, 'bottom').includes('0')
      )
    ).toBe(true)
  })

  it('never forces the closed details dialog to render', () => {
    // An author `display` on the bare selector outranks the UA
    // `dialog:not([open]) { display: none }`, so it may only appear under [open].
    expect(rules('.agent-hub-dialog').flatMap((block) => declared(block, 'display'))).toEqual([])
    expect(rules('.agent-hub-dialog[open]').flatMap((block) => declared(block, 'display'))).toEqual([
      'flex',
    ])
  })

  it('keeps the Settings tab a panel of the page, not a second scroll container', () => {
    // The panel is rendered inside the page contribution, which already owns the
    // heading and the only scroller. A height or overflow here would nest a second
    // scroll container; the width rules keep it inside the page column.
    const panel = rules('.agent-hub-settings-panel')
    expect(panel).not.toHaveLength(0)
    const declaredOnce = (property: string) => panel.flatMap((block) => declared(block, property))
    expect(declaredOnce('overflow-y')).toEqual([])
    expect(declaredOnce('height')).toEqual([])
    expect(declaredOnce('max-height')).toEqual([])
    expect(declaredOnce('width')).toContain('100%')
    expect(declaredOnce('min-width')).toContain('0')
    expect(declaredOnce('max-width')).toContain('100%')
  })

  it('lets a saved-key row shrink instead of pushing its actions out of the panel', () => {
    // A key preview is a long monospace token; without a shrinkable preview and a
    // wrapping rule the row would widen the panel and add a horizontal scrollbar
    // to a page that must never scroll sideways.
    const row = rules('.agent-hub-settings-panel__key')
    expect(row.flatMap((block) => declared(block, 'min-width'))).toContain('0')
    const preview = rules('.agent-hub-settings-panel__key-preview')
    expect(preview.flatMap((block) => declared(block, 'min-width'))).toContain('0')
    expect(preview.flatMap((block) => declared(block, 'overflow-wrap'))).toContain('anywhere')
    const actions = rules('.agent-hub-settings-panel__key-actions')
    // `flex: 0 0 auto` keeps the two buttons intact while the preview gives way.
    expect(actions.flatMap((block) => declared(block, 'flex'))).toContain('0 0 auto')
  })

  it('keeps a custom Power card visibly distinct from a Hub-managed one', () => {
    const custom = rules(".power-card[data-source='custom']")
    expect(custom.flatMap((block) => declared(block, 'border-style'))).toContain('dashed')
    const badge = rules('.power-card__badge')
    expect(badge.flatMap((block) => declared(block, 'text-transform'))).toContain('uppercase')
    // The static version label reuses the version slot but drops the control look.
    const staticVersion = rules('.power-card__version--static')
    expect(staticVersion.flatMap((block) => declared(block, 'border-style'))).toContain('dashed')
  })

  it('gives the custom accent a hue of its own, away from every Power type', () => {
    // The accent shipped as amber, 21 degrees of OKLCH hue from MCP's orange, and the
    // two card fills came out within 0.7 ΔE of each other -- a Custom badge next to an
    // MCP chip read as the same colour. The declaration only has to keep a hue that is
    // not the MCP or skill family; the exact value is a design choice.
    const custom = rules('.agent-hub').flatMap((block) => declared(block, '--hub-custom'))
    expect(custom).toHaveLength(1)
    const [light, dark] = custom[0].match(/light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/)?.slice(1) ?? []
    expect(light).toBeTruthy()
    expect(dark).toBeTruthy()

    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)]
      if (max === min) return 0
      const raw = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min)
      return ((raw * 60) % 360 + 360) % 360
    }
    const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
    // The four type accents, as shipped, measured the same way (HSV hue, since that
    // is what the check above computes).
    const typeHues = [251.8, 163.3, 29.4, 215.3]
    for (const hex of [light, dark]) {
      const own = hue(hex)
      const nearest = Math.min(...typeHues.map((type) => gap(own, type)))
      expect(nearest).toBeGreaterThan(40)
    }
    // And the two themes agree on the hue, so the token is one accent family.
    expect(gap(hue(light), hue(dark))).toBeLessThan(10)
  })

  it('moves the custom card and badge off the amber literals', () => {
    // A regression guard for the exact values a previous build hard-coded.
    for (const block of blocks) {
      expect(block.body).not.toMatch(/#d9a13b|#fdf6e6|#fdf1d8|#fffaf0|#8a5a06/i)
    }
  })

  it('gives every card the same fixed width at every window size', () => {
    // A fixed track plus `auto-fill` is what makes the window change only the column
    // count: with the old `repeat(N, minmax(0, 1fr))` the track absorbed the window
    // width, so a windowed card was narrower than a fullscreen one and the Custom badge
    // and description drifted out of their row. `auto-fill` (not `auto-fit`) keeps the
    // empty tracks, so the centred grid still starts every row at its left edge.
    const grid = rules('.agent-hub__grid')
    const templates = grid.flatMap((block) => declared(block, 'grid-template-columns'))
    expect(templates).toHaveLength(1)
    expect(templates[0]).toMatch(/auto-fill/)
    expect(templates[0]).toContain('var(--hub-card-width)')
    expect(grid.flatMap((block) => declared(block, 'justify-content'))).toContain('center')
    expect(grid.flatMap((block) => declared(block, 'gap'))).toContain('var(--hub-card-gap)')
  })

  it('sizes the fixed card so the host default window shows three columns', () => {
    // The card is fixed-width, so this derivation is the only thing deciding how many
    // cards the host's default window (1200x800) shows. If it drifts back above the
    // three-column budget the page silently returns to two cards with large side gaps;
    // if it drops too far the four/five-column layouts appear far too early. Kept as
    // arithmetic over the declared tokens so the number cannot be edited on its own.
    const page = rules('.agent-hub')
    const token = (name: string): string => {
      const values = page.flatMap((block) => declared(block, name))
      expect(values, name).toHaveLength(1)
      return values[0]
    }
    // The host root font size is the browser default: Bibit only customises
    // `--font-size-base`, so 15rem of sidebar is 240px.
    const px = (value: string): number => {
      const rem = /^(-?[\d.]+)rem$/.exec(value)
      if (rem) return Number(rem[1]) * 16
      const abs = /^(-?[\d.]+)px$/.exec(value)
      if (abs) return Number(abs[1])
      throw new Error(`unexpected length ${value}`)
    }
    const window_ = px(token('--hub-default-window'))
    const sidebar = px(token('--hub-host-sidebar'))
    const frame = px(token('--hub-host-frame'))
    const gap = px(token('--hub-card-gap'))
    const pagePadding = px(token('--hub-page-padding'))

    // The page padding token must be reachable from the clamp the page actually
    // declares: `clamp(20px, 4vw, 56px)` at the default window, where `vw` is the
    // window (not the narrower page box).
    const padding = rules('.agent-hub').flatMap((block) => declared(block, 'padding'))
    expect(padding).toHaveLength(1)
    expect(padding[0]).toContain('clamp(20px')
    expect(padding[0]).toContain('4vw')
    expect(padding[0]).toContain('56px')
    expect(Math.min(Math.max(20, 0.04 * window_), 56)).toBe(pagePadding)

    const content = window_ - sidebar - frame - 2 * pagePadding
    const width = resolveCalc(token('--hub-card-width'), {
      '--hub-default-window': window_,
      '--hub-host-sidebar': sidebar,
      '--hub-host-frame': frame,
      '--hub-page-padding': pagePadding,
      '--hub-card-gap': gap,
    })
    const columns = Math.floor((content + gap) / (width + gap))
    expect(columns).toBe(3)
    // A row only needs two gaps, so the third one is spare: a small host difference must
    // not push the default window back to two columns.
    expect(content - (3 * width + 2 * gap)).toBeGreaterThanOrEqual(10)
    // …and not so much spare that a fourth column would have fitted anyway.
    expect(content - (4 * width + 3 * gap)).toBeLessThan(0)
    // The narrowed card must still fill the widest page column with five columns: the
    // fullscreen layout is the reference the fixed width was chosen from.
    const contentMax = px(token('--hub-content-max'))
    expect(contentMax - (5 * width + 4 * gap)).toBeGreaterThanOrEqual(0)
    expect(contentMax - (6 * width + 5 * gap)).toBeLessThan(0)
  })

  it('never changes the column count from a breakpoint again', () => {
    // Breakpoint column counts would reintroduce a per-breakpoint card width. The
    // narrow-window fallback may only adjust the page padding and the filter rows.
    const breakpointGridRules = blocks.filter(
      (block) => block.conditions.length > 0 && block.selectors.includes('.agent-hub__grid')
    )
    expect(breakpointGridRules).toEqual([])
  })

  it('keeps the version slot one height across managed and custom cards', () => {
    // A Hub-managed card shows a native <select> (31px at 14px/1.5); the custom card's
    // static label must fill the same box or the two cards in one row disagree by 5px
    // and the custom card's title and description sit on a different line.
    const token = rules('.agent-hub').flatMap((block) => declared(block, '--hub-version-height'))
    expect(token).toHaveLength(1)
    const staticVersion = rules('.power-card__version--static')
    expect(staticVersion.flatMap((block) => declared(block, 'min-height'))).toEqual([
      'var(--hub-version-height)',
    ])
    expect(staticVersion.flatMap((block) => declared(block, 'display'))).toContain('inline-flex')
    expect(staticVersion.flatMap((block) => declared(block, 'align-items'))).toContain('center')
    // An extreme version must stay inside the slot instead of drawing over the description.
    expect(staticVersion.flatMap((block) => declared(block, 'overflow'))).toContain('hidden')
  })

  it('keeps the header refresh icon and the create entry on one height', () => {
    // WebKit sizes the create entry from its own control font (39px on WebKitGTK 2.52
    // with a fallback family, not the 41px the 14px/1.5 padding arithmetic predicts), so
    // the two entries are pinned to one token instead of each following its content.
    const token = rules('.agent-hub').flatMap((block) => declared(block, '--hub-action-height'))
    expect(token).toHaveLength(1)
    const createEntry = rules('.agent-hub .agent-hub__actions > button')
    expect(createEntry.flatMap((block) => declared(block, 'min-height'))).toEqual([
      'var(--hub-action-height)',
    ])
    const refresh = rules('.agent-hub .agent-hub__refresh')
    expect(refresh.flatMap((block) => declared(block, 'width'))).toEqual(['var(--hub-action-height)'])
    expect(refresh.flatMap((block) => declared(block, 'height'))).toEqual(['var(--hub-action-height)'])
    // The icon's own rules need the page prefix too: a bare `.agent-hub__refresh` loses
    // to the base button rule below (`0,2,0`), which would drop `display: grid` and leave
    // the glyph squeezed into a text-width box.
    expect(rules('.agent-hub__refresh')).toEqual([])
    expect(rules('.agent-hub .agent-hub__refresh:disabled')).toHaveLength(1)
    expect(rules('.agent-hub__actions').flatMap((block) => declared(block, 'display'))).toContain('flex')
  })
})
