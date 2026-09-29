import type { PowerType } from './contracts'
import { normalizeDisplayField, type PowerRecord } from './apm'

/**
 * Parser for the APC public catalog (`GET /resources`, after following the CDN
 * redirect). APC owns its output schema, so unknown fields are tolerated; only the
 * fields the plugin consumes are required and normalized into `PowerRecord`s. This
 * module is pure (no network): it parses the raw catalog text carried by the
 * `powers.list.v1` wire result in `powerCatalogClient`.
 */

const GROUP_TO_TYPE: Record<string, PowerType> = {
  skills: 'skill',
  plugins: 'plugin',
  mcps: 'mcp',
  agents: 'agent',
}

const VERSION_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

function fail(reason: string): never {
  throw new Error(`Invalid APC catalog: ${reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function parseItem(value: unknown, type: PowerType): PowerRecord {
  if (!isRecord(value)) {
    fail('each catalog item must be an object')
  }
  const { name, version, description, tags, name_zh, name_en, description_zh } = value

  if (typeof name !== 'string' || name.length === 0) {
    fail('name must be a non-empty string')
  }
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    fail('version must be a canonical vMAJOR.MINOR.PATCH string')
  }
  if (description !== undefined && typeof description !== 'string') {
    fail('description must be a string')
  }
  if (
    tags !== undefined &&
    (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))
  ) {
    fail('tags must be an array of strings')
  }

  const displayNameZH = normalizeDisplayField(name_zh, 'name_zh', fail)
  const displayNameEN = normalizeDisplayField(name_en, 'name_en', fail)
  const displayDescriptionZH = normalizeDisplayField(description_zh, 'description_zh', fail)

  return {
    type,
    name,
    version,
    description: description ?? '',
    tags: sortedUnique(tags ?? []),
    ...(displayNameZH !== undefined ? { name_zh: displayNameZH } : {}),
    ...(displayNameEN !== undefined ? { name_en: displayNameEN } : {}),
    ...(displayDescriptionZH !== undefined ? { description_zh: displayDescriptionZH } : {}),
  }
}

/**
 * Parses the APC catalog JSON into normalized, de-duplicated `PowerRecord`s.
 * Group keys (`skills`/`plugins`/`mcps`/`agents`) map to singular `PowerType`s,
 * missing groups are treated as empty, and exact `(type,name,version)` duplicates
 * are removed. APC-owned fields (schema_version, content_*, message,
 * published_at, download_url) are intentionally ignored.
 *
 * The v2 display fields (`name_zh`/`name_en`/`description_zh`) are carried when the
 * catalog emits them (APC item fields, per apm ADR-040). They are optional: a catalog
 * published before the fields existed omits them, which is the normal V1 case and the
 * UI falls back to `name`/`description`.
 */
export function parseApcCatalog(value: unknown): PowerRecord[] {
  if (!isRecord(value)) {
    fail('catalog must be a plain object')
  }

  const records: PowerRecord[] = []
  const seen = new Set<string>()

  for (const [group, type] of Object.entries(GROUP_TO_TYPE)) {
    const raw = value[group]
    if (raw === undefined) continue
    if (!isRecord(raw)) {
      fail(`${group} must be an object`)
    }
    const items = raw.items
    if (items === undefined) continue
    if (!Array.isArray(items)) {
      fail(`${group}.items must be an array`)
    }
    for (const item of items) {
      const record = parseItem(item, type)
      const key = `${record.type}\u0000${record.name}\u0000${record.version}`
      if (seen.has(key)) continue
      seen.add(key)
      records.push(record)
    }
  }

  return records
}
