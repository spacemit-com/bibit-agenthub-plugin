import { describe, expect, it } from 'vitest'
import type { ListPowersInput, PowerType } from './contracts'
import {
  buildInstalledPowersResult,
  parseApmInstalledList,
  type APMPowerRecord,
} from './apm'

function record(
  overrides: Partial<APMPowerRecord> & { agent: string; type: PowerType; name: string; version: string }
): APMPowerRecord {
  return { description: '', tags: [], ...overrides }
}

function query(overrides: Partial<ListPowersInput> = {}): ListPowersInput {
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

describe('parseApmInstalledList', () => {
  it('parses an identity-only record and tolerates unknown fields', () => {
    const parsed = parseApmInstalledList([
      { agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', extra: true },
    ])
    expect(parsed).toEqual([{ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0' }])
  })

  it('tolerates optional metadata fields that the current apm list no longer emits', () => {
    const parsed = parseApmInstalledList([
      { agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 'd', tags: ['x', 'y'] },
      { agent: 'bibit', type: 'skill', name: 'b', version: 'v1.0.0' },
    ])
    expect(parsed[0]).toEqual({
      agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 'd', tags: ['x', 'y'],
    })
    expect(parsed[1].description).toBeUndefined()
    expect(parsed[1].tags).toBeUndefined()
  })

  it('rejects a non-array', () => {
    expect(() => parseApmInstalledList({})).toThrow(/array/)
  })

  it.each([
    [null, /object/],
    [{ type: 'skill', name: 'a', version: 'v1.0.0' }, /agent/],
    [{ agent: 'bibit', name: 'a', version: 'v1.0.0' }, /type/],
    [{ agent: 'bibit', type: 'skill', version: 'v1.0.0' }, /name/],
    [{ agent: 'bibit', type: 'skill', name: 'a', version: '1.0.0' }, /version/],
    [{ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 1 }, /description/],
    [{ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', tags: [1] }, /tags/],
  ])('rejects an invalid record %#', (bad, pattern) => {
    expect(() => parseApmInstalledList([bad])).toThrow(pattern)
  })

  it('rejects a non-canonical type and malformed version', () => {
    expect(() => parseApmInstalledList([{ agent: 'b', type: 'skillz', name: 'a', version: 'v1.0.0' }])).toThrow(/type/)
    expect(() => parseApmInstalledList([{ agent: 'b', type: 'skill', name: 'a', version: 'v01.0.0' }])).toThrow(/version/)
  })
})

describe('buildInstalledPowersResult', () => {
  it('filters to the selected agent', () => {
    const result = buildInstalledPowersResult(query(), [
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0' }),
      record({ agent: 'codex', type: 'skill', name: 'b', version: 'v1.0.0' }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((s) => s.name)).toEqual(['a'])
  })

  it('deduplicates exact type/name/version and sorts versions descending', () => {
    const result = buildInstalledPowersResult(query(), [
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0' }),
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v2.0.0' }),
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.5.0' }),
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v2.0.0' }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.total).toBe(1)
    expect(result.items[0].versions.map((v) => v.version)).toEqual(['v2.0.0', 'v1.5.0', 'v1.0.0'])
  })

  it('normalizes identity-only records to empty description/tags and empty facets', () => {
    const result = buildInstalledPowersResult(query(), [
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0' }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items[0].versions[0]).toEqual({ version: 'v1.0.0', description: '', tags: [] })
    expect(result.facets).toEqual({ agents: [], tags: [] })
  })

  it('normalizes description and tags, and keeps facets.agents empty', () => {
    const result = buildInstalledPowersResult(query(), [
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', tags: ['z', 'a', 'z'] }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items[0].versions[0].description).toBe('')
    expect(result.items[0].versions[0].tags).toEqual(['a', 'z'])
    expect(result.facets.agents).toEqual([])
  })

  it('derives facets.tags from the selected type ignoring tag selection', () => {
    const result = buildInstalledPowersResult(query({ tags: ['keep'] }), [
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', tags: ['keep', 'drop'] }),
      record({ agent: 'bibit', type: 'skill', name: 'b', version: 'v1.0.0', tags: ['other'] }),
      record({ agent: 'bibit', type: 'plugin', name: 'c', version: 'v1.0.0', tags: ['ignored'] }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.facets.tags).toEqual(['drop', 'keep', 'other'])
    // tag OR filter applies to items, not facets: only 'a' carries the selected tag
    expect(result.items.map((s) => s.name)).toEqual(['a'])
  })

  it('paginates 20 series per page', () => {
    const records = Array.from({ length: 25 }, (_, index) =>
      record({
        agent: 'bibit',
        type: 'skill',
        name: 'skill-' + String(index + 1).padStart(2, '0'),
        version: 'v1.0.0',
      })
    )
    const page1 = buildInstalledPowersResult(query(), records)
    expect(page1.status).toBe('ready')
    if (page1.status !== 'ready') return
    expect(page1.items).toHaveLength(20)
    expect(page1.total).toBe(25)
    expect(page1.nextPage).toBe(2)

    const page2 = buildInstalledPowersResult(query({ page: 2, snapshot: page1.snapshot }), records)
    expect(page2.status).toBe('ready')
    if (page2.status !== 'ready') return
    expect(page2.items).toHaveLength(5)
    expect(page2.nextPage).toBeUndefined()
  })

  it('returns reset_required on page>1 snapshot mismatch', () => {
    const records = [record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0' })]
    const result = buildInstalledPowersResult(query({ page: 2, snapshot: 'stale' }), records)
    expect(result).toEqual({ status: 'reset_required', reason: 'snapshot_changed' })
  })

  it('renders empty content for an empty installed set', () => {
    const result = buildInstalledPowersResult(query(), [])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.facets).toEqual({ agents: [], tags: [] })
    expect(result.warnings).toEqual([])
  })

  it('throws when the installed query has no agent', () => {
    expect(() => buildInstalledPowersResult({ ...query(), agent: undefined }, [])).toThrow(/agent/)
  })

  it('produces a stable snapshot for identical content', () => {
    const records = [record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0' })]
    const one = buildInstalledPowersResult(query(), records)
    const two = buildInstalledPowersResult(query(), records)
    expect(one.status).toBe('ready')
    expect(two.status).toBe('ready')
    if (one.status !== 'ready' || two.status !== 'ready') return
    expect(one.snapshot).toBe(two.snapshot)
    expect(one.snapshot).toMatch(/^apm-installed-/)
  })
})