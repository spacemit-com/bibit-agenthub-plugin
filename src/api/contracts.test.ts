import { describe, expect, it } from 'vitest'
import {
  POWERS_LIST_OPERATION_ID,
  POWER_PAGE_SIZE,
  POWER_TYPES,
  parseListPowersInput,
  parseListPowersResult,
  parsePowersWireInput,
  parsePowersWireResult,
  type ListPowersInput,
  type ReadyListPowersResult,
} from './contracts'

function readyFixture(): ReadyListPowersResult {
  return {
    status: 'ready',
    snapshot: 'catalog-1',
    items: [
      {
        type: 'skill',
        name: 'demo',
        versions: [
          { version: 'v2.0.0', description: 'new', tags: ['quality'] },
          { version: 'v1.0.0', description: 'old', tags: [] },
        ],
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    facets: { agents: [], tags: ['quality'] },
    warnings: [],
  }
}

function expectResultError(value: unknown): string {
  let message = ''
  try {
    parseListPowersResult(value)
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    message = (error as Error).message
  }
  expect(message).toMatch(/^Invalid powers\.list\.v1 result:/)
  return message
}

function expectRequestError(value: unknown): string {
  let message = ''
  try {
    parseListPowersInput(value)
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    message = (error as Error).message
  }
  expect(message).toMatch(/^Invalid powers\.list\.v1 request:/)
  return message
}

describe('Store contract constants', () => {
  it('exposes the exact constants', () => {
    expect(POWER_TYPES).toEqual(['skill', 'plugin', 'mcp', 'agent'])
    expect(POWER_PAGE_SIZE).toBe(20)
    expect(POWERS_LIST_OPERATION_ID).toBe('powers.list.v1')
  })
})

describe('parseListPowersResult', () => {
  it('parses a ready result into a deeply independent clone', () => {
    const source = readyFixture()
    const parsed = parseListPowersResult(source)

    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)

    if (parsed.status === 'ready') {
      // Exercises the ReadyListPowersResult alias as a real type annotation.
      const ready: ReadyListPowersResult = parsed
      expect(ready.snapshot).toBe('catalog-1')

      // Mutating the source after parsing must not mutate the parsed result.
      source.items[0].versions[0].tags.push('mutated')
      source.facets.tags.push('mutated')
      source.items[0].versions[0].description = 'changed'

      expect(ready.items[0].versions[0].tags).toEqual(['quality'])
      expect(ready.facets.tags).toEqual(['quality'])
      expect(ready.items[0].versions[0].description).toBe('new')
    }
  })

  it('accepts a reset_required result', () => {
    expect(parseListPowersResult({ status: 'reset_required', reason: 'snapshot_changed' })).toEqual({
      status: 'reset_required',
      reason: 'snapshot_changed',
    })
  })

  it('rejects an unknown top-level result field', () => {
    expectResultError({ ...readyFixture(), extra: true })
  })

  it('rejects an unknown nested version field', () => {
    const bad: unknown = {
      ...readyFixture(),
      items: [
        {
          type: 'skill',
          name: 'demo',
          versions: [{ version: 'v1.0.0', description: 'a', tags: [], extra: true }],
        },
      ],
    }
    expectResultError(bad)
  })

  it('rejects an empty versions list', () => {
    const bad: unknown = {
      ...readyFixture(),
      items: [{ type: 'skill', name: 'demo', versions: [] }],
    }
    expectResultError(bad)
  })

  it('rejects versions in ascending order', () => {
    const bad: unknown = {
      ...readyFixture(),
      items: [
        {
          type: 'skill',
          name: 'demo',
          versions: [
            { version: 'v1.0.0', description: 'old', tags: [] },
            { version: 'v2.0.0', description: 'new', tags: [] },
          ],
        },
      ],
    }
    expectResultError(bad)
  })

  it('rejects items not sorted by type then name', () => {
    const bad: unknown = {
      ...readyFixture(),
      items: [
        {
          type: 'skill',
          name: 'zebra',
          versions: [{ version: 'v1.0.0', description: 'a', tags: [] }],
        },
        {
          type: 'skill',
          name: 'alpha',
          versions: [{ version: 'v1.0.0', description: 'a', tags: [] }],
        },
      ],
    }
    expectResultError(bad)
  })

  it('rejects items not sorted by type', () => {
    const bad: unknown = {
      ...readyFixture(),
      items: [
        {
          type: 'skill',
          name: 'demo',
          versions: [{ version: 'v1.0.0', description: 'a', tags: [] }],
        },
        {
          type: 'agent',
          name: 'demo',
          versions: [{ version: 'v1.0.0', description: 'a', tags: [] }],
        },
      ],
    }
    expectResultError(bad)
  })

  it('rejects an invalid power type', () => {
    const bad: unknown = {
      ...readyFixture(),
      items: [{ type: 'tool', name: 'demo', versions: [{ version: 'v1.0.0', description: 'a', tags: [] }] }],
    }
    expectResultError(bad)
  })

  it('rejects a pageSize other than 20', () => {
    expectResultError({ ...readyFixture(), pageSize: 21 })
  })

  it('rejects duplicated tags', () => {
    const bad: unknown = {
      ...readyFixture(),
      items: [
        {
          type: 'skill',
          name: 'demo',
          versions: [{ version: 'v1.0.0', description: 'a', tags: ['a', 'a'] }],
        },
      ],
    }
    expectResultError(bad)
  })

  it('rejects unsorted tags', () => {
    const bad: unknown = {
      ...readyFixture(),
      items: [
        {
          type: 'skill',
          name: 'demo',
          versions: [{ version: 'v1.0.0', description: 'a', tags: ['z', 'a'] }],
        },
      ],
    }
    expectResultError(bad)
  })

  it('rejects a reset_required result with an extra field', () => {
    expectResultError({ status: 'reset_required', reason: 'snapshot_changed', extra: true })
  })

  it('rejects a malformed version string', () => {
    const bad: unknown = {
      ...readyFixture(),
      items: [
        {
          type: 'skill',
          name: 'demo',
          versions: [{ version: '1.0.0', description: 'a', tags: [] }],
        },
      ],
    }
    expectResultError(bad)
  })

  it('rejects a non-integer page', () => {
    expectResultError({ ...readyFixture(), page: 1.5 })
  })

  it('rejects a non-integer total', () => {
    expectResultError({ ...readyFixture(), total: 1.5 })
  })

  it('rejects a non-integer nextPage', () => {
    expectResultError({ ...readyFixture(), nextPage: 2.5 })
  })

  it('never embeds server payload in the validation error', () => {
    const message = expectResultError({ ...readyFixture(), extra: 'SENSITIVE_MARKER' })
    expect(message).not.toContain('SENSITIVE_MARKER')
    expect(message).not.toContain('extra')
  })
})

describe('parseListPowersInput', () => {
  it('rejects an unknown request field', () => {
    expectRequestError({
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      tags: [],
      page: 1,
      pageSize: 20,
      extra: true,
    })
  })

  it('rejects installed scope without an agent', () => {
    expectRequestError({ scope: 'installed', type: 'skill', tags: [], page: 1, pageSize: 20 })
  })

  it('rejects market scope with an agent', () => {
    expectRequestError({ scope: 'market', agent: 'bibit', type: 'skill', tags: [], page: 1, pageSize: 20 })
  })

  it('rejects page 1 with a snapshot', () => {
    expectRequestError({
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      tags: [],
      page: 1,
      pageSize: 20,
      snapshot: 'catalog-1',
    })
  })

  it('rejects page 2 without a snapshot', () => {
    expectRequestError({ scope: 'installed', agent: 'bibit', type: 'skill', tags: [], page: 2, pageSize: 20 })
  })

  it('rejects a pageSize other than 20', () => {
    expectRequestError({
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      tags: [],
      page: 1,
      pageSize: 21,
    })
  })

  it('rejects unsorted tags', () => {
    expectRequestError({
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      tags: ['z', 'a'],
      page: 1,
      pageSize: 20,
    })
  })

  it('rejects duplicated tags', () => {
    expectRequestError({
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      tags: ['a', 'a'],
      page: 1,
      pageSize: 20,
    })
  })
})

function expectWireRequestError(value: unknown): string {
  let message = ''
  try {
    parsePowersWireInput(value)
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    message = (error as Error).message
  }
  expect(message).toMatch(/^Invalid powers\.list\.v1 wire request:/)
  return message
}

function expectWireResultError(value: unknown): string {
  let message = ''
  try {
    parsePowersWireResult(value)
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    message = (error as Error).message
  }
  expect(message).toMatch(/^Invalid powers\.list\.v1 wire result:/)
  return message
}

describe('parsePowersWireInput', () => {
  it('accepts a market input with a knownSnapshot', () => {
    expect(parsePowersWireInput({ scope: 'market', knownSnapshot: 'abc' })).toEqual({
      scope: 'market',
      knownSnapshot: 'abc',
    })
  })

  it('accepts a market input without a knownSnapshot', () => {
    expect(parsePowersWireInput({ scope: 'market' })).toEqual({ scope: 'market' })
  })

  it('accepts an installed input with a non-empty agent', () => {
    expect(parsePowersWireInput({ scope: 'installed', agent: 'bibit' })).toEqual({
      scope: 'installed',
      agent: 'bibit',
    })
  })

  it('rejects legacy page projection fields on the wire', () => {
    expect(() => parsePowersWireInput({ scope: 'market', page: 2 })).toThrow()
  })

  it('rejects an empty agent for installed scope', () => {
    expect(() => parsePowersWireInput({ scope: 'installed', agent: '' })).toThrow()
  })

  it('rejects an agent field on market scope', () => {
    expect(() => parsePowersWireInput({ scope: 'market', agent: 'bibit' })).toThrow()
  })

  it('rejects a knownSnapshot field on installed scope', () => {
    expect(() => parsePowersWireInput({ scope: 'installed', agent: 'bibit', knownSnapshot: 'abc' })).toThrow()
  })

  it('rejects an empty knownSnapshot when present', () => {
    expect(() => parsePowersWireInput({ scope: 'market', knownSnapshot: '' })).toThrow()
  })

  it('rejects an unknown scope', () => {
    expect(() => parsePowersWireInput({ scope: 'nope' })).toThrow()
  })

  it('rejects null, arrays and primitives', () => {
    expectWireRequestError(null)
    expectWireRequestError([{ scope: 'market' }])
    expectWireRequestError('market')
  })
})

describe('parsePowersWireResult', () => {
  it('parses an installed data result', () => {
    expect(parsePowersWireResult({ scope: 'installed', status: 'data', listJson: '[]' })).toEqual({
      scope: 'installed',
      status: 'data',
      listJson: '[]',
    })
  })

  it('parses a market data result with raw JSON text', () => {
    expect(
      parsePowersWireResult({
        scope: 'market',
        status: 'data',
        snapshot: 'abc',
        catalogJson: '{"skills":{"items":[]}}',
      })
    ).toEqual({
      scope: 'market',
      status: 'data',
      snapshot: 'abc',
      catalogJson: '{"skills":{"items":[]}}',
    })
  })

  it('parses a market not_modified result', () => {
    expect(parsePowersWireResult({ scope: 'market', status: 'not_modified', snapshot: 'abc' })).toEqual({
      scope: 'market',
      status: 'not_modified',
      snapshot: 'abc',
    })
  })

  it('rejects the legacy rich result shape', () => {
    expect(() => parsePowersWireResult({ status: 'ready', items: [] })).toThrow()
  })

  it('rejects not_modified with a catalogJson field', () => {
    expect(() =>
      parsePowersWireResult({ scope: 'market', status: 'not_modified', snapshot: 'abc', catalogJson: '{}' })
    ).toThrow()
  })

  it('rejects data with a missing or empty snapshot', () => {
    expect(() => parsePowersWireResult({ scope: 'market', status: 'data', catalogJson: '{}' })).toThrow()
    expect(() =>
      parsePowersWireResult({ scope: 'market', status: 'data', snapshot: '', catalogJson: '{}' })
    ).toThrow()
  })

  it('rejects an installed result with an unexpected snapshot field', () => {
    expect(() =>
      parsePowersWireResult({ scope: 'installed', status: 'data', listJson: '[]', snapshot: 'abc' })
    ).toThrow()
  })

  it('rejects a non-string JSON text field', () => {
    expect(() => parsePowersWireResult({ scope: 'installed', status: 'data', listJson: 42 })).toThrow()
    expect(() =>
      parsePowersWireResult({ scope: 'market', status: 'data', snapshot: 'abc', catalogJson: {} })
    ).toThrow()
  })

  it('rejects an unknown scope or status', () => {
    expect(() => parsePowersWireResult({ scope: 'nope', status: 'data', listJson: '[]' })).toThrow()
    expect(() => parsePowersWireResult({ scope: 'market', status: 'reset_required' })).toThrow()
  })

  it('rejects null, arrays and primitives', () => {
    expectWireResultError(null)
    expectWireResultError([])
    expectWireResultError('ready')
  })
})
