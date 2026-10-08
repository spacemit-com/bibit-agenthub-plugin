import { describe, expect, it } from 'vitest'
import {
  resolvePowerDescription,
  resolvePowerTitle,
} from './displayFields'
import type { PowerSeries, PowerVersion } from './api/contracts'

function series(overrides: Partial<PowerSeries> = {}): PowerSeries {
  return {
    type: 'skill',
    name: 'code-review',
    versions: [{ version: 'v1.0.0', description: 'Peer review.', tags: [] }],
    ...overrides,
  }
}

function version(overrides: Partial<PowerVersion> = {}): PowerVersion {
  return { version: 'v1.0.0', description: 'Peer review.', tags: [], ...overrides }
}

describe('resolvePowerTitle', () => {
  it('prefers the Chinese display name for a Chinese host', () => {
    expect(resolvePowerTitle(series({ name_zh: '代码审查', name_en: 'Code Review' }), 'zh')).toBe(
      '代码审查'
    )
  })

  it('falls back to the English display name for a Chinese host', () => {
    expect(resolvePowerTitle(series({ name_en: 'Code Review' }), 'zh')).toBe('Code Review')
  })

  it('never shows Chinese to an English host', () => {
    expect(resolvePowerTitle(series({ name_zh: '代码审查' }), 'en')).toBe('code-review')
    expect(resolvePowerTitle(series({ name_zh: '代码审查', name_en: 'Code Review' }), 'en')).toBe(
      'Code Review'
    )
  })

  it.each([
    ['zh' as const, series()],
    ['en' as const, series()],
    ['zh' as const, series({ name_zh: '', name_en: '   ' })],
    ['en' as const, series({ name_en: '  ' })],
  ])('falls back to the canonical name for a V1 series (%s)', (language, input) => {
    expect(resolvePowerTitle(input, language)).toBe('code-review')
  })
})

describe('resolvePowerDescription', () => {
  it('prefers the Chinese description for a Chinese host', () => {
    expect(resolvePowerDescription(version({ description_zh: '代码审查说明' }), 'zh')).toBe(
      '代码审查说明'
    )
  })

  it('uses the source description for an English host even when description_zh exists', () => {
    expect(
      resolvePowerDescription(version({ description_zh: '代码审查说明' }), 'en')
    ).toBe('Peer review.')
  })

  it.each([
    ['zh' as const, version()],
    ['zh' as const, version({ description_zh: '   ' })],
    ['en' as const, version()],
  ])('falls back to the source description for a V1 version (%s)', (language, input) => {
    expect(resolvePowerDescription(input, language)).toBe('Peer review.')
  })
})
