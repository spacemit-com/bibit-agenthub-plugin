import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POWER_TYPES } from './api/contracts'

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

  it('gives every Power type its own palette rule', () => {
    // The palette is selected by the type value, so renaming a type silently drops its
    // colours: the element matches no rule, keeps the inherited --type/--type-soft/
    // --type-line, and renders as a plain bordered chip. That is exactly how the Expert
    // type lost its blue accent when it was renamed from `agent` -- nothing failed, the
    // card just went black. Keying the assertion off POWER_TYPES means the next rename
    // has to carry the palette with it.
    for (const powerType of POWER_TYPES) {
      const palette = rules(`[data-power-type='${powerType}']`)
      expect(palette, `no palette rule for type ${powerType}`).toHaveLength(1)
      for (const token of ['--type', '--type-soft', '--type-line']) {
        const values = palette.flatMap((block) => declared(block, token))
        expect(values, `${powerType} is missing ${token}`).toHaveLength(1)
        // Every accent must be a light/dark pair, like the rest of the stylesheet.
        expect(values[0]).toMatch(/^light-dark\(\s*#[0-9a-f]{6}\s*,\s*#[0-9a-f]{6}\s*\)$/)
      }
    }
    // And nothing else claims a Power type: a leftover key from a rename matches
    // nothing at runtime, so only a source-level check can see it.
    const declaredTypes = blocks
      .flatMap((block) => block.selectors)
      .map((selector) => /^\[data-power-type='([^']+)'\]$/.exec(selector)?.[1])
      .filter((value): value is string => value !== undefined)
    expect([...new Set(declaredTypes)].sort()).toEqual([...POWER_TYPES].sort())
  })

  it('keeps the focus ring opaque so it is actually visible', () => {
    // The ring was `rgb(101 80 216 / 28%)`, which composited to 1.51:1 on a white card
    // and 2.76:1 on a dark one -- under the 3:1 WCAG 1.4.11 asks of a non-text
    // indicator, so Tab moved an invisible focus through the page. Nothing failed when
    // that shipped: a token test that only checks the *shape* of the value cannot see
    // transparency, which is why this asserts the alpha directly.
    const token = rules('.agent-hub').flatMap((block) => declared(block, '--hub-focus'))
    expect(token).toHaveLength(1)
    expect(token[0]).toMatch(/^light-dark\(\s*#[0-9a-f]{6}\s*,\s*#[0-9a-f]{6}\s*\)$/)
    expect(token[0]).not.toMatch(/rgba?\(|\//)

    // And the ring rule must cover the clickable card, which is a control too.
    const ring = blocks.filter((block) =>
      block.selectors.some((selector) => selector.endsWith(':focus-visible'))
    )
    expect(ring.length).toBeGreaterThan(0)
    for (const block of ring) {
      // The ring is authored as the `outline` shorthand, so the style and width are
      // read out of it rather than from longhands that are never set.
      const shorthand = declared(block, 'outline')
      expect(shorthand).toHaveLength(1)
      expect(shorthand[0]).toContain('solid')
      expect(shorthand[0]).toContain('var(--hub-focus)')
      const width = Number.parseFloat(shorthand[0])
      expect(width).toBeGreaterThanOrEqual(2)
    }
    const covered = ring.flatMap((block) => block.selectors)
    expect(covered).toContain(".agent-hub .power-card[data-clickable='true']:focus-visible")
  })

  it('seats the sticky pagination on the scrollport edge', () => {
    // At `bottom: 0` the bar stopped short of the scrollport by the page's bottom inset,
    // and the grid scrolling underneath stayed legible in that strip -- cards showing
    // through a bar that is meant to be opaque. The bar reaches past the inset by the
    // same token the page pads by, so the two cannot drift apart.
    const inset = rules('.agent-hub').flatMap((block) => declared(block, '--hub-page-inset-end'))
    expect(inset).toHaveLength(1)

    const page = rules('.agent-hub')
    expect(
      page.some((block) => declared(block, 'padding').some((value) => value.includes('var(--hub-page-inset-end)')))
    ).toBe(true)

    const pagination = rules('.agent-hub .power-pagination')
    expect(pagination).toHaveLength(1)
    const bottom = declared(pagination[0], 'bottom')
    expect(bottom).toHaveLength(1)
    expect(bottom[0]).toBe('calc(-1 * var(--hub-page-inset-end))')
    // The padding grows by the same token so the controls keep their position.
    const padding = declared(pagination[0], 'padding')
    expect(padding).toHaveLength(1)
    expect(padding[0]).toContain('var(--hub-page-inset-end)')
    // Still opaque: the bar has to hide what scrolls under it.
    expect(declared(pagination[0], 'background')).toEqual(['var(--hub-bg)'])
    expect(declared(pagination[0], 'position')).toEqual(['sticky'])
  })

  it('resets the card title button at a specificity that beats the base button rule', () => {
    // The title button inherits `.agent-hub button:where(:not(.power-filters__scope))`,
    // which paints padding, a border and a background. `:where()` contributes nothing, so
    // that rule sits at (0,1,1); a bare `.power-card__open` is (0,1,0) and loses, which
    // shipped a bordered chip around every card title instead of invisible text. The
    // reset therefore has to carry a class of its own.
    const base = rules('.agent-hub button:where(:not(.power-filters__scope))')
    expect(base).toHaveLength(1)

    const reset = rules('.agent-hub .power-card__open')
    expect(reset, 'the reset must out-specify the base button surface').toHaveLength(1)
    const body = reset[0]
    expect(declared(body, 'border')).toEqual(['0'])
    expect(declared(body, 'padding')).toEqual(['0'])
    expect(declared(body, 'background')).toEqual(['none'])
    expect(declared(body, 'font')).toEqual(['inherit'])

    // A bare class selector is the regression; keep it from coming back.
    expect(rules('.power-card__open')).toEqual([])

    // The button is reachable and named, and its activation path is wired.
    expect(rules('.agent-hub .power-card__open:disabled')).toHaveLength(1)
  })

  it('keeps every text token at or above its contrast floor', () => {
    // The two tokens that carry body copy failed AA in the light theme: --hub-muted
    // measured 4.23:1 on the darkest card gradient stop and --hub-label 3.09:1 on the
    // filter panel. Both were "covered" by the light-dark() pair test, which says
    // nothing about legibility, so the floor is asserted here on the resolved pairs.
    const pair = (token: string, expected: number) => {
      const values = rules('.agent-hub').flatMap((block) => declared(block, token))
      expect(values, `missing ${token}`).toHaveLength(1)
      const [light, dark] = values[0].match(/#[0-9a-f]{6}/g) ?? []
      expect(light && dark, `${token} must be a light-dark() hex pair`).toBeTruthy()
      return { light: light as string, dark: dark as string, expected }
    }

    const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((value) => {
        const channel = value / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (a: string, b: string) => {
      const [high, low] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x)
      return (high + 0.05) / (low + 0.05)
    }

    // The card background is `linear-gradient(145deg, surface 34%, type-soft)`, so the
    // worst case for muted copy is the type tint, not the white stop.
    const lightSurface = '#ffffff'
    const lightTints = ['#f2efff', '#eef9f5', '#fff6eb', '#eff6ff']
    const darkSurface = '#171717'

    const muted = pair('--hub-muted', 4.5)
    for (const tint of lightTints) {
      expect(contrast(muted.light, tint)).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(muted.light, lightSurface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(muted.dark, darkSurface)).toBeGreaterThanOrEqual(4.5)

    const label = pair('--hub-label', 4.5)
    expect(contrast(label.light, lightSurface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(label.dark, darkSurface)).toBeGreaterThanOrEqual(4.5)
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
    // Sticky, so it stays reachable while the grid scrolls, and seated on the scrollport
    // edge rather than merely near it -- see the seating test below for why.
    const pagination = rules('.agent-hub .power-pagination')
    expect(
      pagination.some(
        (block) =>
          declared(block, 'position').includes('sticky') &&
          declared(block, 'bottom').includes('calc(-1 * var(--hub-page-inset-end))')
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

  it('marks an installed market card with the success family, not the custom one', () => {
    // The Installed badge overrides the custom badge's colours; it has to read from
    // tokens so the light/dark contract above keeps covering it, and it must not
    // inherit the rose that identifies a hand-installed resource.
    const installed = rules('.power-card__badge--installed')
    expect(installed).toHaveLength(1)
    expect(installed.flatMap((block) => declared(block, 'background'))).toEqual([
      'var(--hub-install-bg)',
    ])
    expect(installed.flatMap((block) => declared(block, 'color'))).toEqual([
      'var(--hub-install-text)',
    ])
    expect(installed.flatMap((block) => declared(block, 'border-color'))).toEqual([
      'var(--hub-install-line)',
    ])
    for (const block of installed) {
      expect(block.body).not.toContain('--hub-custom')
    }
  })

  it('keeps a custom Power card visibly distinct from a Hub-managed one', () => {
    const custom = rules(".power-card[data-source='custom']")
    expect(custom.flatMap((block) => declared(block, 'border-style'))).toContain('dashed')
    const badge = rules('.power-card__badge')
    expect(badge.flatMap((block) => declared(block, 'text-transform'))).toContain('uppercase')
    // The version slot keeps the dashed rose border only on a custom card.
    const customVersion = rules(".power-card[data-source='custom'] .power-card__version")
    expect(customVersion.flatMap((block) => declared(block, 'border-style'))).toContain('dashed')
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

  it('keeps the version slot one height on every card', () => {
    // No card chooses a version any more -- the slot is a label on all of them -- but it
    // still has to be one fixed height, or a long version grows a header and pushes that
    // card's title and description onto a different line than its neighbours.
    const token = rules('.agent-hub').flatMap((block) => declared(block, '--hub-version-height'))
    expect(token).toHaveLength(1)
    const version = rules('.power-card__version')
    expect(version.flatMap((block) => declared(block, 'min-height'))).toEqual([
      'var(--hub-version-height)',
    ])
    expect(version.flatMap((block) => declared(block, 'display'))).toContain('inline-flex')
    expect(version.flatMap((block) => declared(block, 'align-items'))).toContain('center')
    // An extreme version must stay inside the slot instead of drawing over the description.
    expect(version.flatMap((block) => declared(block, 'overflow'))).toContain('hidden')
    // The old control/static distinction is gone, so its modifier must not come back.
    expect(rules('.power-card__version--static')).toEqual([])
    expect(version.flatMap((block) => declared(block, 'border-style'))).toEqual([])
  })

  it('packs several badges against the right edge in DOM order', () => {
    // `New` sits left of `Installed`. Two badges that each carried `margin-left: auto`
    // would split the free space between them and push them apart, so the type label
    // takes the free space instead and the badges pack in order.
    const type = rules('.power-card__type')
    expect(type.flatMap((block) => declared(block, 'margin-right'))).toEqual(['auto'])
    const badge = rules('.power-card__badge')
    expect(badge.flatMap((block) => declared(block, 'margin-left'))).toEqual([])
    expect(badge.flatMap((block) => declared(block, 'flex'))).toEqual(['0 0 auto'])
  })

  it('gives the New badge its own family, apart from installed and custom', () => {
    const badge = rules('.power-card__badge--new')
    expect(badge).toHaveLength(1)
    expect(badge.flatMap((block) => declared(block, 'background'))).toEqual([
      'var(--hub-new-bg)',
    ])
    expect(badge.flatMap((block) => declared(block, 'color'))).toEqual(['var(--hub-new)'])
    expect(badge.flatMap((block) => declared(block, 'border-color'))).toEqual([
      'var(--hub-new-line)',
    ])
    for (const block of badge) {
      expect(block.body).not.toContain('--hub-install')
      expect(block.body).not.toContain('--hub-custom')
    }
  })

  it('parks the Agent control at the right end of the tab row and opens its menu inwards', () => {
    // The right-hand group is the bulk-upgrade entry plus the Agent control, and
    // `margin-left: auto` on that wrapper is the whole of "far right". It must not
    // live on the switcher as well: two auto margins would split the free space and
    // the pair would drift apart instead of staying adjacent.
    const actions = rules('.power-filters__actions')
    expect(actions.flatMap((block) => declared(block, 'margin-left'))).toEqual(['auto'])

    // `position: relative` is the containing block the absolutely positioned menu
    // is measured against.
    const switcher = rules('.power-filters__agent-switcher')
    expect(switcher.flatMap((block) => declared(block, 'margin-left'))).toEqual([])
    expect(switcher.flatMap((block) => declared(block, 'position'))).toEqual(['relative'])

    // The trigger sits on the page edge, so the menu must open leftwards; anchored
    // to `left: 0` it would overflow the page instead of staying inside it.
    const menu = rules('.power-filters__agent-menu')
    expect(menu.flatMap((block) => declared(block, 'position'))).toEqual(['absolute'])
    expect(menu.flatMap((block) => declared(block, 'right'))).toEqual(['0'])
    expect(menu.flatMap((block) => declared(block, 'left'))).toEqual([])

    // The triggers live outside the scope tab group, which keeps its own role.
    expect(rules('.power-filters__scope-agent')).toEqual([])
  })

  it('draws the bulk-upgrade spinner from a token and respects reduced motion', () => {
    // The spinner is the only animated thing on the page, so it is the only place
    // reduced motion has to be honoured. The ring's colour must come from an
    // existing token rather than a literal, so it follows the theme.
    // The base rule only: the reduced-motion branch below overrides `animation`,
    // so it must not be counted as a second declaration of the same property.
    const spinner = rules('.agent-hub__spinner').filter((block) => block.conditions.length === 0)
    expect(spinner).toHaveLength(1)
    const border = spinner[0].body
    expect(border).toContain('var(--hub-scope)')
    expect(border).not.toMatch(/(?<!var\(--[\w-]+\))(?:#[0-9a-f]{3,8}\b|rgba?\()/i)

    // Rotating only: nothing that moves or resizes the layout.
    const animated = declared(spinner[0], 'animation')
    expect(animated).toHaveLength(1)
    expect(animated[0]).toContain('linear')
    expect(animated[0]).toContain('infinite')

    // Under `prefers-reduced-motion: reduce` the rotation stops, but the ring stays
    // on screen: the state must remain visible without movement.
    const reduced = blocks.filter((block) =>
      block.conditions.some((condition) => condition.includes('prefers-reduced-motion'))
    )
    const spinnerRule = reduced.find((block) => block.selectors.includes('.agent-hub__spinner'))
    expect(spinnerRule, 'the spinner must have a reduced-motion branch').toBeTruthy()
    expect(declared(spinnerRule!, 'animation')).toEqual(['none'])
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
