import { describe, expect, it } from 'vitest'
import type { CustomResourceRecord, ListPowersInput, PowerType } from './contracts'
import {
  buildInstalledPowersResult,
  buildMergedInstalledPowersResult,
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
  it('parses a record with description and tags, tolerating unknown fields', () => {
    const parsed = parseApmInstalledList([
      { agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 'd', tags: ['x'], extra: true },
    ])
    expect(parsed).toEqual([
      { agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 'd', tags: ['x'] },
    ])
  })

  it('parses description and tags emitted by list --json and normalizes empties at build time', () => {
    const parsed = parseApmInstalledList([
      { agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 'd', tags: ['x', 'y'] },
      { agent: 'bibit', type: 'skill', name: 'b', version: 'v1.0.0', description: '', tags: [] },
    ])
    expect(parsed[0]).toEqual({
      agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 'd', tags: ['x', 'y'],
    })
    expect(parsed[1]).toEqual({
      agent: 'bibit', type: 'skill', name: 'b', version: 'v1.0.0', description: '', tags: [] },
    )
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

  it('tolerates a V1 record without any v2 display field', () => {
    const parsed = parseApmInstalledList([
      { agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 'd', tags: [] },
    ])
    expect(parsed[0]).toEqual({
      agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 'd', tags: [],
    })
    expect('name_zh' in parsed[0]).toBe(false)
    expect('name_en' in parsed[0]).toBe(false)
    expect('description_zh' in parsed[0]).toBe(false)
  })

  it('keeps present v2 display fields and drops blank ones', () => {
    const parsed = parseApmInstalledList([
      {
        agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', description: 'd', tags: [],
        name_zh: '演示', name_en: 'Demo', description_zh: '演示描述',
      },
      {
        agent: 'bibit', type: 'skill', name: 'b', version: 'v1.0.0', description: 'd', tags: [],
        name_zh: '   ', description_zh: '',
      },
    ])
    expect(parsed[0].name_zh).toBe('演示')
    expect(parsed[0].name_en).toBe('Demo')
    expect(parsed[0].description_zh).toBe('演示描述')
    // Blank means "no display value": the key is absent so the UI falls back.
    expect('name_zh' in parsed[1]).toBe(false)
    expect('description_zh' in parsed[1]).toBe(false)
  })

  it.each(['name_zh', 'name_en', 'description_zh'] as const)('rejects a non-string %s', (field) => {
    expect(() =>
      parseApmInstalledList([
        { agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', [field]: 1 },
      ])
    ).toThrow(new RegExp(field))
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

  it('normalizes missing metadata to empty description/tags and empty facets', () => {
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
    // The tag filter applies to items, not facets: only 'a' carries the selected tag
    expect(result.items.map((s) => s.name)).toEqual(['a'])
  })

  it('matches a version only when it carries every selected tag', () => {
    // Intersection, not union: adding a tag narrows the list. A version tagged
    // with just one of the selected tags must drop out.
    const records = [
      record({ agent: 'bibit', type: 'skill', name: 'both', version: 'v1.0.0', tags: ['alpha', 'beta'] }),
      record({ agent: 'bibit', type: 'skill', name: 'alpha-only', version: 'v1.0.0', tags: ['alpha'] }),
      record({ agent: 'bibit', type: 'skill', name: 'beta-only', version: 'v1.0.0', tags: ['beta'] }),
      record({ agent: 'bibit', type: 'skill', name: 'neither', version: 'v1.0.0', tags: ['gamma'] }),
    ]

    const one = buildInstalledPowersResult(query({ tags: ['alpha'] }), records)
    expect(one.status).toBe('ready')
    if (one.status !== 'ready') return
    expect(one.items.map((s) => s.name)).toEqual(['alpha-only', 'both'])

    const two = buildInstalledPowersResult(query({ tags: ['alpha', 'beta'] }), records)
    expect(two.status).toBe('ready')
    if (two.status !== 'ready') return
    expect(two.items.map((s) => s.name)).toEqual(['both'])

    const none = buildInstalledPowersResult(query({ tags: ['alpha', 'beta', 'gamma'] }), records)
    expect(none.status).toBe('ready')
    if (none.status !== 'ready') return
    expect(none.items).toEqual([])
    expect(none.total).toBe(0)
  })

  it('filters versions of one series independently, then keeps the matching ones', () => {
    // Tags live on the version, so the filter runs on exact versions before the
    // series grouping: v2 carries `beta` and survives, v1 carries only `alpha`
    // and does not, and the series stays because at least one version matched.
    const result = buildInstalledPowersResult(query({ tags: ['alpha', 'beta'] }), [
      record({ agent: 'bibit', type: 'skill', name: 'demo', version: 'v2.0.0', tags: ['alpha', 'beta'] }),
      record({ agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0', tags: ['alpha'] }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((s) => s.name)).toEqual(['demo'])
    expect(result.items[0].versions.map((v) => v.version)).toEqual(['v2.0.0'])
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

  it('hoists display names to the series and keeps description_zh per version', () => {
    const result = buildInstalledPowersResult(query(), [
      record({
        agent: 'bibit', type: 'skill', name: 'a', version: 'v2.0.0',
        name_zh: '演示技能', name_en: 'Demo Skill', description_zh: '新版本说明',
      }),
      record({
        agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0',
        description_zh: '旧版本说明',
      }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items[0].name_zh).toBe('演示技能')
    expect(result.items[0].name_en).toBe('Demo Skill')
    // One value per series: the highest version that carries the field wins.
    expect(result.items[0].versions.map((v) => v.description_zh)).toEqual([
      '新版本说明',
      '旧版本说明',
    ])
  })

  it('falls back to an older version display name when the newest record is V1', () => {
    const result = buildInstalledPowersResult(query(), [
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v2.0.0' }),
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0', name_zh: '旧版展示名' }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items[0].name_zh).toBe('旧版展示名')
    expect('name_en' in result.items[0]).toBe(false)
  })

  it('leaves both display names absent for a fully V1 series', () => {
    const result = buildInstalledPowersResult(query(), [
      record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0' }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect('name_zh' in result.items[0]).toBe(false)
    expect('name_en' in result.items[0]).toBe(false)
    expect('description_zh' in result.items[0].versions[0]).toBe(false)
  })

  it('changes the snapshot when only a display field changes', () => {
    const base = record({ agent: 'bibit', type: 'skill', name: 'a', version: 'v1.0.0' })
    const plain = buildInstalledPowersResult(query(), [base])
    const localized = buildInstalledPowersResult(query(), [{ ...base, name_zh: '演示' }])
    expect(plain.status).toBe('ready')
    expect(localized.status).toBe('ready')
    if (plain.status !== 'ready' || localized.status !== 'ready') return
    expect(localized.snapshot).not.toBe(plain.snapshot)
  })
})
/**
 * Cross-repo contract anchor: these two records are verbatim `apm list --installed --json`
 * output from apm 0.1.6 (see apm ADR-040). apm always emits `description`, `tags` and the
 * v2 display fields; a V1 resource leaves the display fields as `""`. Parsing must keep the
 * populated fields, drop the blanks, and let series aggregation hoist the display names.
 */
describe('apm list --json contract (apm 0.1.6, ADR-040)', () => {
  const apmV2Record =
    '{"agent":"bibit","type":"skill","name":"brief-status","version":"v0.0.1",' +
    '"description":"Use when writing a concise progress status update.","tags":[],' +
    '"name_zh":"简报状态","name_en":"Brief Status","description_zh":"用于撰写简洁的进度状态更新。"}'
  const apmV1Record =
    '{"agent":"bibit","type":"skill","name":"legacy-skill","version":"v1.0.0",' +
    '"description":"Legacy skill.","tags":["official"],"name_zh":"","name_en":"","description_zh":""}'

  it('maps the pre-rename agent type onto expert', () => {
    // An apm older than 0.0.2 still reports the Expert category as `agent`. The plugin
    // may be upgraded ahead of the CLI (the plugin's deb pins its own CLI, but
    // agent-power-manager is unpinned), so the legacy spelling is accepted for one
    // release and normalized here rather than leaking into every type comparison.
    const legacy = JSON.parse(apmV2Record.replace('"type":"skill"', '"type":"agent"'))
    expect(parseApmInstalledList([legacy])[0].type).toBe('expert')

    const unknown = JSON.parse(apmV2Record.replace('"type":"skill"', '"type":"widget"'))
    expect(() => parseApmInstalledList([unknown])).toThrow(/type must be one of skill, plugin, mcp, expert/)
  })

  it('keeps populated display fields and drops the empty ones a V1 record carries', () => {
    const parsed = parseApmInstalledList(JSON.parse(`[${apmV2Record},${apmV1Record}]`))
    expect(parsed[0]).toEqual({
      agent: 'bibit',
      type: 'skill',
      name: 'brief-status',
      version: 'v0.0.1',
      description: 'Use when writing a concise progress status update.',
      tags: [],
      name_zh: '简报状态',
      name_en: 'Brief Status',
      description_zh: '用于撰写简洁的进度状态更新。',
    })
    expect('name_zh' in parsed[1]).toBe(false)
    expect('description_zh' in parsed[1]).toBe(false)
  })

  it('hoists the display names to the series and keeps description_zh per version', () => {
    const result = buildInstalledPowersResult(
      query(),
      parseApmInstalledList(JSON.parse(`[${apmV2Record},${apmV1Record}]`))
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items).toHaveLength(2)
    const localized = result.items.find((item) => item.name === 'brief-status')
    const legacy = result.items.find((item) => item.name === 'legacy-skill')
    expect(localized?.name_zh).toBe('简报状态')
    expect(localized?.name_en).toBe('Brief Status')
    expect(localized?.versions[0].description_zh).toBe('用于撰写简洁的进度状态更新。')
    // A V1 record stays on the fallback path: no display fields reach the series or version.
    expect(legacy).toBeDefined()
    expect(legacy && 'name_zh' in legacy).toBe(false)
    expect(legacy && 'name_en' in legacy).toBe(false)
    expect(legacy && 'description_zh' in legacy.versions[0]).toBe(false)
  })
})

describe('buildMergedInstalledPowersResult', () => {
  const customRecord = (overrides: Partial<CustomResourceRecord> = {}): CustomResourceRecord => ({
    type: 'skill',
    name: 'hand-written',
    version: '',
    description: 'Hand made.',
    tags: [],
    source: 'custom',
    ...overrides,
  })

  it('keeps a versionless custom resource as a single-entry series', () => {
    const result = buildMergedInstalledPowersResult(query(), [], [customRecord()])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items).toHaveLength(1)
    expect(result.items[0].name).toBe('hand-written')
    expect(result.items[0].source).toBe('custom')
    expect(result.items[0].versions).toEqual([{ version: '', description: 'Hand made.', tags: [] }])
    expect(result.facets.tags).toEqual([])
  })

  it('drops a custom resource whose series is already in the APM manifest', () => {
    const result = buildMergedInstalledPowersResult(
      query(),
      [record({ agent: 'bibit', type: 'skill', name: 'hand-written', version: 'v1.0.0', description: 'hub' })],
      [customRecord()]
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items).toHaveLength(1)
    expect(result.items[0].source).toBeUndefined()
    expect(result.items[0].versions[0].description).toBe('hub')
  })

  it('merges Hub and custom resources into one sorted list', () => {
    const result = buildMergedInstalledPowersResult(
      query(),
      [record({ agent: 'bibit', type: 'skill', name: 'alpha', version: 'v1.0.0', description: 'hub' })],
      [customRecord({ name: 'zeta' }), customRecord({ name: 'mid' })]
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((item) => item.name)).toEqual(['alpha', 'mid', 'zeta'])
    expect(result.items[0].source).toBeUndefined()
    expect(result.items[1].source).toBe('custom')
    expect(result.items[2].source).toBe('custom')
  })

  it('carries the custom source into the snapshot so a change invalidates page 2', () => {
    const withCustom = buildMergedInstalledPowersResult(query(), [], [customRecord()])
    const withoutCustom = buildMergedInstalledPowersResult(query(), [], [])
    expect(withCustom.status).toBe('ready')
    expect(withoutCustom.status).toBe('ready')
    if (withCustom.status !== 'ready' || withoutCustom.status !== 'ready') return
    expect(withCustom.snapshot).not.toBe(withoutCustom.snapshot)

    const secondPage = buildMergedInstalledPowersResult(query({ page: 2, snapshot: 'stale' }), [], [customRecord()])
    expect(secondPage).toEqual({ status: 'reset_required', reason: 'snapshot_changed' })
  })

  it('ignores a custom record of another type and keeps display fields', () => {
    const result = buildMergedInstalledPowersResult(query(), [], [
      customRecord({ type: 'plugin', name: 'p' }),
      customRecord({ name_zh: '手写', name_en: 'Hand Written', description_zh: '手写资源。' }),
    ])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items).toHaveLength(1)
    expect(result.items[0].name_zh).toBe('手写')
    expect(result.items[0].name_en).toBe('Hand Written')
    expect(result.items[0].versions[0].description_zh).toBe('手写资源。')
  })

  it('searches before pagination and keeps every version of a matching series', () => {
    const records = Array.from({ length: 25 }, (_, index) => record({
      agent: 'bibit', type: 'skill', name: `a-${index.toString().padStart(2, '0')}`,
      version: 'v1.0.0', tags: ['other'],
    }))
    records.push(
      record({ agent: 'bibit', type: 'skill', name: 'z-report', version: 'v2.0.0', description: 'Current report', tags: ['reports'] }),
      record({ agent: 'bibit', type: 'skill', name: 'z-report', version: 'v1.0.0', description: 'Legacy analysis', tags: ['reports'] }),
    )
    const unfiltered = buildMergedInstalledPowersResult(query(), records, [])
    expect(unfiltered.status).toBe('ready')
    if (unfiltered.status !== 'ready') return
    expect(unfiltered.items.some((item) => item.name === 'z-report')).toBe(false)

    const result = buildMergedInstalledPowersResult(query(), records, [], '  LEGACY ANALYSIS  ')
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((item) => item.name)).toEqual(['z-report'])
    expect(result.items[0].versions.map((version) => version.version)).toEqual(['v2.0.0', 'v1.0.0'])
    expect(result.total).toBe(1)
    expect(result.nextPage).toBeUndefined()
    expect(result.facets.tags).toEqual(['other', 'reports'])
    expect(result.snapshot).toBe(unfiltered.snapshot)
    expect(buildMergedInstalledPowersResult(query(), records, [], '  ')).toEqual(unfiltered)
  })

  it.each(['hand-written', '手写', 'HAND WRITTEN', '手写资源', 'hand made', 'drafting'])(
    'searches custom resources by localized names, descriptions and tags: %s',
    (search) => {
      const result = buildMergedInstalledPowersResult(query(), [], [
        customRecord({ name_zh: '手写', name_en: 'Hand Written', description_zh: '手写资源。', tags: ['drafting'] }),
        customRecord({ name: 'unrelated', description: 'Other resource', tags: [] }),
      ], search)
      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return
      expect(result.items.map((item) => item.name)).toEqual(['hand-written'])
      expect(result.items[0].source).toBe('custom')
    }
  )

  it('paginates the searched set and still rejects a stale catalog snapshot', () => {
    const records = Array.from({ length: 45 }, (_, index) => record({
      agent: 'bibit', type: 'skill', name: `resource-${index.toString().padStart(2, '0')}`,
      version: 'v1.0.0', description: index % 2 === 0 ? 'Match' : 'Other',
    }))
    const first = buildMergedInstalledPowersResult(query(), records, [], 'match')
    expect(first.status).toBe('ready')
    if (first.status !== 'ready') return
    expect(first.items).toHaveLength(20)
    expect(first.total).toBe(23)
    expect(first.nextPage).toBe(2)
    const second = buildMergedInstalledPowersResult(query({ page: 2, snapshot: first.snapshot }), records, [], 'match')
    expect(second.status).toBe('ready')
    if (second.status !== 'ready') return
    expect(second.items.map((item) => item.name)).toEqual(['resource-40', 'resource-42', 'resource-44'])
    expect(second.nextPage).toBeUndefined()
    expect(buildMergedInstalledPowersResult(query({ page: 2, snapshot: 'stale' }), records, [], 'match'))
      .toEqual({ status: 'reset_required', reason: 'snapshot_changed' })
  })
})
