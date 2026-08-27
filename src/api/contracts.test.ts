import { describe, expect, it } from 'vitest'
import {
  POWERS_LIST_OPERATION_ID,
  POWER_PAGE_SIZE,
  POWER_TYPES,
  parseListPowersInput,
  parseListPowersResult,
  toListPowersParams,
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

describe('toListPowersParams', () => {
  it('projects a market input to JSON-safe params and omits agent/snapshot', () => {
    const params = toListPowersParams({
      scope: 'market',
      type: 'skill',
      tags: ['quality'],
      page: 1,
      pageSize: 20,
    })
    expect(params).toEqual({
      scope: 'market',
      type: 'skill',
      tags: ['quality'],
      page: 1,
      pageSize: 20,
    })
    expect(Object.keys(params).sort()).toEqual(['page', 'pageSize', 'scope', 'tags', 'type'])
  })

  it('projects an installed page-2 input with agent and snapshot', () => {
    const params = toListPowersParams({
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      tags: ['quality'],
      page: 2,
      pageSize: 20,
      snapshot: 'catalog-1',
    })
    expect(params).toEqual({
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      tags: ['quality'],
      page: 2,
      pageSize: 20,
      snapshot: 'catalog-1',
    })
  })

  it('clones tags so later input mutation does not affect params', () => {
    const input: ListPowersInput = {
      scope: 'market',
      type: 'skill',
      tags: ['a'],
      page: 1,
      pageSize: 20,
    }
    const params = toListPowersParams(input)
    input.tags.push('b')
    expect(params.tags).toEqual(['a'])
  })
})
