import { describe, expect, it } from 'vitest'
import { parseListPowersResult, type ReadyListPowersResult } from '../src/api/contracts'
import { handlePowerCatalogMock } from './powerCatalogMock'

function readyResult(input: Parameters<typeof handlePowerCatalogMock>[0]): ReadyListPowersResult {
  const result = handlePowerCatalogMock(input)
  if (result.status !== 'ready') throw new Error('expected ready result')
  return result
}

function bibitSkillParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: 'installed',
    agent: 'bibit',
    type: 'skill',
    tags: [],
    page: 1,
    pageSize: 20,
    ...overrides,
  }
}

describe('handlePowerCatalogMock', () => {
  it('returns ready grouped results for the installed Bibit skill query', () => {
    const result = readyResult({
      operationId: 'powers.list.v1',
      params: bibitSkillParams(),
    })

    // agents facet only includes installed fixtures
    expect(result.facets.agents).toEqual(['atlas', 'bibit', 'nova'])

    // facets.tags contains every tag across Bibit skills, unfiltered
    expect(result.facets.tags).toEqual([
      'code-review',
      'incident',
      'quality',
      'release',
      'safety',
      'utility',
      'writing',
    ])

    // results are grouped by type/name and sorted by name
    expect(result.items.map((item) => item.name)).toEqual([...result.items.map((item) => item.name)].sort())
    for (const item of result.items) {
      expect(item.type).toBe('skill')
    }

    // versions are sorted numerically descending
    const codeReview = result.items.find((item) => item.name === 'code-review')
    expect(codeReview?.versions.map((version) => version.version)).toEqual(['v2.0.0', 'v1.0.0'])
    const incident = result.items.find((item) => item.name === 'incident-helper')
    expect(incident?.versions.map((version) => version.version)).toEqual(['v2.0.0', 'v1.0.0'])

    // the mock result round-trips through the closed result parser (no unknown fields)
    expect(parseListPowersResult(result)).toEqual(result)
  })

  it('sorts a series versions in descending SemVer order even when fixtures are authored out of order', () => {
    const result = readyResult({
      operationId: 'powers.list.v1',
      params: bibitSkillParams(),
    })

    // incident-helper is authored ascending (v1.0.0 before v2.0.0); the mock must sort it
    const incident = result.items.find((item) => item.name === 'incident-helper')
    expect(incident?.versions.map((version) => version.version)).toEqual(['v2.0.0', 'v1.0.0'])
  })

  it('returns an empty agents facet for market scope', () => {
    const result = readyResult({
      operationId: 'powers.list.v1',
      params: { scope: 'market', type: 'skill', tags: [], page: 1, pageSize: 20 },
    })

    expect(result.facets.agents).toEqual([])
    expect(result.items.map((item) => item.name)).toEqual(['transcribe', 'translate'])
  })

  it('includes a version matching either of two selected tags', () => {
    const result = readyResult({
      operationId: 'powers.list.v1',
      params: bibitSkillParams({ tags: ['code-review', 'quality'] }),
    })

    expect(result.items.map((item) => item.name)).toEqual(['code-review'])
    // v2.0.0 matches only "quality", v1.0.0 matches only "code-review"
    expect(result.items[0].versions.map((version) => version.version)).toEqual(['v2.0.0', 'v1.0.0'])
    expect(result.items[0].versions.map((version) => version.tags)).toEqual([['quality'], ['code-review']])
  })

  it('removes non-matching versions and then empty series', () => {
    const result = readyResult({
      operationId: 'powers.list.v1',
      params: bibitSkillParams({ tags: ['code-review'] }),
    })

    expect(result.items.map((item) => item.name)).toEqual(['code-review'])
    // v2.0.0 (tag quality) is filtered out, leaving only v1.0.0
    expect(result.items[0].versions.map((version) => version.version)).toEqual(['v1.0.0'])
  })

  it('slices 21 distinct series into 20 items with total 21 and nextPage 2', () => {
    const result = readyResult({
      operationId: 'powers.list.v1',
      params: bibitSkillParams(),
    })

    expect(result.items).toHaveLength(20)
    expect(result.total).toBe(21)
    expect(result.nextPage).toBe(2)
    expect(result.snapshot).toBe('local-preview-v1')
  })

  it('returns the remaining item on page 2 with the returned snapshot', () => {
    const result = readyResult({
      operationId: 'powers.list.v1',
      params: bibitSkillParams({ page: 2, snapshot: 'local-preview-v1' }),
    })

    expect(result.items.map((item) => item.name)).toEqual(['release-notes'])
    expect(result.total).toBe(21)
    expect(result.page).toBe(2)
    expect(result.nextPage).toBeUndefined()
  })

  it('returns reset_required when the page-2 snapshot differs', () => {
    const result = handlePowerCatalogMock({
      operationId: 'powers.list.v1',
      params: bibitSkillParams({ page: 2, snapshot: 'other-catalog' }),
    })

    expect(result).toEqual({ status: 'reset_required', reason: 'snapshot_changed' })
  })

  it('returns a partial-agent warning alongside available records for the nova agent', () => {
    const result = readyResult({
      operationId: 'powers.list.v1',
      params: {
        scope: 'installed',
        agent: 'nova',
        type: 'skill',
        tags: [],
        page: 1,
        pageSize: 20,
      },
    })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toEqual({
      code: 'installed-agent-unavailable',
      agent: 'nova',
      message: 'Some installed Powers for this agent are temporarily unavailable.',
    })
    expect(result.items).not.toHaveLength(0)
    expect(result.facets.agents).toContain('nova')
    expect(parseListPowersResult(result)).toEqual(result)
  })

  it('rejects an unknown operation', () => {
    expect(() => handlePowerCatalogMock({ operationId: 'agents.list.v1', params: {} })).toThrow(
      'Unknown operation: agents.list.v1'
    )
  })
})
