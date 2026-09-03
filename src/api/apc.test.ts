import { describe, expect, it } from 'vitest'
import { parseApcCatalog } from './apc'

function fullCatalog() {
  return {
    skills: {
      items: [
        {
          name: 'code-review-helper',
          version: 'v1.0.0',
          description: '代码审查助手',
          tags: ['quality', 'review'],
          schema_version: 1,
          content_type: 'application/gzip',
          content_size: 160,
          content_md5: '0274020ce87b4b9c067786d8fdf342ef',
          message: '首次发布',
          published_at: '2026-09-01T17:48:14',
          download_url: 'https://cdn-resource.spacemit.com/file/apc/resource/code-review-helper.tar.gz',
        },
      ],
    },
    plugins: { items: [] },
    mcps: { items: [] },
    agents: { items: [] },
  }
}

describe('parseApcCatalog', () => {
  it('maps group keys to singular types and drops APC-only fields', () => {
    const parsed = parseApcCatalog(fullCatalog())
    expect(parsed).toEqual([
      {
        type: 'skill',
        name: 'code-review-helper',
        version: 'v1.0.0',
        description: '代码审查助手',
        tags: ['quality', 'review'],
      },
    ])
  })

  it('treats missing groups as empty', () => {
    expect(parseApcCatalog({ skills: { items: [] } })).toEqual([])
  })

  it('normalizes missing description and tags to empty defaults', () => {
    const parsed = parseApcCatalog({
      skills: { items: [{ name: 'a', version: 'v1.0.0' }] },
    })
    expect(parsed).toEqual([
      { type: 'skill', name: 'a', version: 'v1.0.0', description: '', tags: [] },
    ])
  })

  it('sorts and deduplicates tags', () => {
    const parsed = parseApcCatalog({
      mcps: { items: [{ name: 'm', version: 'v1.0.0', tags: ['z', 'a', 'z', 'm'] }] },
    })
    expect(parsed[0].type).toBe('mcp')
    expect(parsed[0].tags).toEqual(['a', 'm', 'z'])
  })

  it('deduplicates exact type/name/version entries', () => {
    const parsed = parseApcCatalog({
      agents: {
        items: [
          { name: 'a', version: 'v1.0.0' },
          { name: 'a', version: 'v1.0.0' },
          { name: 'a', version: 'v2.0.0' },
        ],
      },
    })
    expect(parsed).toEqual([
      { type: 'agent', name: 'a', version: 'v1.0.0', description: '', tags: [] },
      { type: 'agent', name: 'a', version: 'v2.0.0', description: '', tags: [] },
    ])
  })

  it('rejects a non-object top-level catalog', () => {
    expect(() => parseApcCatalog([])).toThrow(/catalog must be a plain object/)
    expect(() => parseApcCatalog(null)).toThrow(/catalog must be a plain object/)
  })

  it('rejects a non-object group and non-array items', () => {
    expect(() => parseApcCatalog({ skills: 'nope' })).toThrow(/skills must be an object/)
    expect(() => parseApcCatalog({ skills: { items: 'nope' } })).toThrow(/skills\.items must be an array/)
  })

  it.each([
    [null, /each catalog item must be an object/],
    [{ version: 'v1.0.0' }, /name/],
    [{ name: 'a' }, /version/],
    [{ name: 'a', version: '1.0.0' }, /version/],
    [{ name: 'a', version: 'v01.0.0' }, /version/],
    [{ name: 'a', version: 'v1.0.0', description: 1 }, /description/],
    [{ name: 'a', version: 'v1.0.0', tags: [1] }, /tags/],
  ])('rejects an invalid catalog item %#', (bad, pattern) => {
    expect(() => parseApcCatalog({ skills: { items: [bad] } })).toThrow(pattern)
  })
})
