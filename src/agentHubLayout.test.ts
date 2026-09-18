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

  it('clips the description horizontally but keeps a vertical indicator', () => {
    const description = rules('.power-card__description')
    expect(description.flatMap((block) => declared(block, 'overflow-x'))).toContain('hidden')
    // A hidden (`scrollbar-width: none`) or removed scrollbar would leave nowhere to show
    // the scroll position.
    const hidden = blocks.filter((block) =>
      declared(block, 'scrollbar-width').includes('none')
    )
    expect(hidden).toEqual([])
  })

  it('hides every scrollbar at rest and reveals it while its scroller moves', () => {
    const selectorLists = (property: string, value: string) =>
      blocks.filter((block) => declared(block, property).includes(value)).map((block) => block.selectors)

    // The page's own bar and every nested scroller share one rule set.
    expect(selectorLists('width', '8px')).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['.agent-hub::-webkit-scrollbar', '.agent-hub ::-webkit-scrollbar']),
      ])
    )
    // At rest the thumb is transparent: nothing is painted until something scrolls.
    expect(
      selectorLists('background', 'transparent').some(
        (list) =>
          list.includes('.agent-hub::-webkit-scrollbar-thumb') &&
          list.includes('.agent-hub ::-webkit-scrollbar-thumb')
      )
    ).toBe(true)
    expect(selectorLists('background', '#bcc5d3')).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([".agent-hub[data-scrolling='true']::-webkit-scrollbar-thumb"]),
        expect.arrayContaining([".agent-hub [data-scrolling='true']::-webkit-scrollbar-thumb"]),
      ])
    )
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
})
