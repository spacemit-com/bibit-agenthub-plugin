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

  it('keeps the settings root content-only and able to shrink', () => {
    // The host owns the Settings shell; a fixed application width or a `main`
    // wrapper would nest a second shell inside it.
    const settings = rules('.agent-hub-settings')
    expect(settings).not.toHaveLength(0)
    const declaredOnce = (property: string) => settings.flatMap((block) => declared(block, property))
    expect(declaredOnce('width')).toContain('100%')
    expect(declaredOnce('min-width')).toContain('0')
    expect(declaredOnce('max-width')).toContain('100%')
    expect(declaredOnce('max-width')).not.toContain('720px')
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
})
