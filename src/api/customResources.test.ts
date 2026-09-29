import { describe, expect, it } from 'vitest'
import type { FeatureServiceApiV1, FeatureServiceRequestV1 } from '@bibit/feature-sdk'
import {
  parseCustomListInput,
  parseCustomListResult,
  parseCustomResourceList,
  parseDeleteResult,
  parseDeleteTarget,
  parseSettingsUpdate,
  parseSettingsView,
  parseUploadInput,
  parseUploadResult,
} from './contracts'
import {
  deleteCustomResource,
  listCustomResources,
  submissionIdFrom,
  uploadCustomResource,
} from './customResources'

function makeService(respond: (input: FeatureServiceRequestV1<'store'>) => unknown): {
  service: FeatureServiceApiV1<'store'>
  calls: FeatureServiceRequestV1<'store'>[]
} {
  const calls: FeatureServiceRequestV1<'store'>[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
      calls.push(input)
      return respond(input) as TResult
    },
  }
  return { service, calls }
}

const signal = () => new AbortController().signal

const customItem = {
  type: 'skill',
  name: 'hand-written',
  version: '',
  description: 'Hand made.',
  tags: [],
  source: 'custom',
}

describe('parseCustomListInput', () => {
  it('accepts a fixed installed agent and rejects everything else', () => {
    expect(parseCustomListInput({ agent: 'hermes-agent' })).toEqual({ agent: 'hermes-agent' })
    for (const value of [{}, { agent: '' }, { agent: 'all' }, { agent: 'gpt' }, { agent: 'codex', extra: 1 }]) {
      expect(() => parseCustomListInput(value)).toThrow(/Invalid powers\.custom\.list\.v1 request/)
    }
  })
})

describe('parseCustomListResult / parseCustomResourceList', () => {
  it('accepts the closed scanner document', () => {
    const result = parseCustomListResult({
      scope: 'custom',
      status: 'data',
      itemsJson: JSON.stringify({ items: [customItem], skipped: [] }),
    })
    expect(result.scope).toBe('custom')
    const document = parseCustomResourceList(JSON.parse(result.itemsJson))
    expect(document.items).toEqual([customItem])
    expect(document.skipped).toEqual([])
  })

  it('rejects a wrong envelope', () => {
    for (const value of [
      { scope: 'installed', status: 'data', itemsJson: '{}' },
      { scope: 'custom', status: 'not_modified', itemsJson: '{}' },
      { scope: 'custom', status: 'data' },
      { scope: 'custom', status: 'data', itemsJson: '{}', extra: 1 },
    ]) {
      expect(() => parseCustomListResult(value)).toThrow(/Invalid powers\.custom\.list\.v1 result/)
    }
  })

  it('requires a canonical version or an empty one, and empty tags', () => {
    const document = (overrides: Record<string, unknown>) => ({
      items: [{ ...customItem, ...overrides }],
      skipped: [],
    })
    expect(parseCustomResourceList(document({ version: 'v1.2.3' })).items[0].version).toBe('v1.2.3')
    for (const overrides of [
      { version: '1.2.3' },
      { version: 'latest' },
      { source: 'hub' },
      { tags: ['x'] },
      { type: 'package' },
      { name: '' },
      { description: undefined },
    ]) {
      expect(() => parseCustomResourceList(document(overrides))).toThrow(
        /Invalid powers\.custom\.list\.v1 result/
      )
    }
  })

  it('enforces a stable type/name order and the skip reason set', () => {
    const skipped = { type: 'skill', name: 'partial', expected: 'SKILL.md', reason: 'invalid-authority-file' }
    expect(parseCustomResourceList({ items: [], skipped: [skipped] }).skipped).toEqual([skipped])
    expect(() =>
      parseCustomResourceList({
        items: [
          { ...customItem, name: 'b' },
          { ...customItem, name: 'a' },
        ],
        skipped: [],
      })
    ).toThrow(/sorted/)
    expect(() =>
      parseCustomResourceList({
        items: [],
        skipped: [{ ...skipped, reason: 'whatever' }],
      })
    ).toThrow(/skip reason/)
    expect(() => parseCustomResourceList({ items: [], skipped: [{ type: 'skill' }] })).toThrow()
  })
})

describe('parseUploadInput / parseUploadResult / parseDeleteTarget / parseDeleteResult', () => {
  it('accepts a valid cancel-free input and rejects unsafe names and messages', () => {
    expect(
      parseUploadInput({ agent: 'bibit', type: 'skill', name: 'demo', message: 'publish it' })
    ).toEqual({ agent: 'bibit', type: 'skill', name: 'demo', message: 'publish it' })
    for (const value of [
      { agent: 'bibit', type: 'skill', name: 'demo' },
      { agent: 'bibit', type: 'skill', name: 'demo', message: '   ' },
      { agent: 'bibit', type: 'skill', name: 'demo', message: 'a\nb' },
      { agent: 'bibit', type: 'skill', name: 'demo', message: 'x'.repeat(201) },
      { agent: 'bibit', type: 'skill', name: '../escape', message: 'ok' },
      { agent: 'codex', type: 'agent', name: 'demo', message: 'ok' },
      { agent: 'bibit', type: 'skill', name: 'demo', message: 'ok', extra: 1 },
    ]) {
      expect(() => parseUploadInput(value)).toThrow(/Invalid powers\.upload\.v1 input/)
    }
  })

  it('parses the upload result union', () => {
    expect(parseUploadResult({ status: 'exited', exitCode: 0, stage: 'submit', stdout: 'submission_id: s1' })).toEqual({
      status: 'exited',
      exitCode: 0,
      stage: 'submit',
      stdout: 'submission_id: s1',
    })
    expect(parseUploadResult({ status: 'exited', exitCode: 1, stage: 'validate', reason: 'bad' }).reason).toBe('bad')
    for (const value of [
      { status: 'failed', exitCode: 0, stage: 'submit' },
      { status: 'exited', exitCode: -1, stage: 'submit' },
      { status: 'exited', exitCode: 0, stage: 'other' },
      { status: 'exited', exitCode: 0 },
    ]) {
      expect(() => parseUploadResult(value)).toThrow(/Invalid powers\.upload\.v1 result/)
    }
  })

  it('parses the delete target and result', () => {
    expect(parseDeleteTarget({ agent: 'bibit', type: 'plugin', name: 'demo' })).toEqual({
      agent: 'bibit',
      type: 'plugin',
      name: 'demo',
    })
    expect(() => parseDeleteTarget({ agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0' })).toThrow(
      /Invalid powers\.delete\.v1 input/
    )
    expect(parseDeleteResult({ status: 'deleted' })).toEqual({ status: 'deleted' })
    expect(() => parseDeleteResult({ status: 'gone' })).toThrow(/Invalid powers\.delete\.v1 result/)
  })
})

describe('parseSettingsView / parseSettingsUpdate', () => {
  it('never accepts a credential in the view', () => {
    expect(parseSettingsView({ showExperimental: true, refreshMinutes: 30, hasApiKey: true }, 'x:')).toEqual({
      showExperimental: true,
      refreshMinutes: 30,
      hasApiKey: true,
    })
    for (const value of [
      { showExperimental: true, refreshMinutes: 30, hasApiKey: true, apiKey: 'leak' },
      { showExperimental: true, refreshMinutes: 1, hasApiKey: false },
      { showExperimental: 'yes', refreshMinutes: 30, hasApiKey: false },
    ]) {
      expect(() => parseSettingsView(value, 'x:')).toThrow(/^x:/)
    }
  })

  it('validates the update payload and keeps apiKey optional', () => {
    expect(parseSettingsUpdate({ showExperimental: false, refreshMinutes: 15 })).toEqual({
      showExperimental: false,
      refreshMinutes: 15,
    })
    expect(parseSettingsUpdate({ showExperimental: false, refreshMinutes: 15, apiKey: '' }).apiKey).toBe('')
    for (const value of [
      { showExperimental: false, refreshMinutes: 4 },
      { showExperimental: false, refreshMinutes: 121 },
      { showExperimental: false, refreshMinutes: 15, apiKey: 'has space' },
      { showExperimental: false, refreshMinutes: 15, apiKey: 'x'.repeat(513) },
      { showExperimental: false, refreshMinutes: 15, unknown: true },
    ]) {
      expect(() => parseSettingsUpdate(value)).toThrow(/Invalid settings\.update\.v1 input/)
    }
  })
})

describe('custom resource clients', () => {
  it('validates the request and the scan document over the wire', async () => {
    const { service, calls } = makeService(() => ({
      scope: 'custom',
      status: 'data',
      itemsJson: JSON.stringify({ items: [customItem], skipped: [] }),
    }))
    const document = await listCustomResources(service, 'bibit', signal())
    expect(document.items).toHaveLength(1)
    expect(calls[0].operationId).toBe('powers.custom.list.v1')
    expect(calls[0].params).toEqual({ agent: 'bibit' })
    expect(calls[0].timeoutMs).toBe(30_000)
  })

  it('maps an unparsable scan document to incompatible', async () => {
    const { service } = makeService(() => ({ scope: 'custom', status: 'data', itemsJson: 'not json' }))
    await expect(listCustomResources(service, 'bibit', signal())).rejects.toMatchObject({ code: 'incompatible' })
  })

  it('sends the closed upload request and returns the parsed result', async () => {
    const { service, calls } = makeService(() => ({
      status: 'exited',
      exitCode: 0,
      stage: 'submit',
      stdout: 'outcome: accepted\nsubmission_id: sub_7\nstatus: received',
    }))
    const result = await uploadCustomResource(
      service,
      { agent: 'bibit', type: 'skill', name: 'demo', message: 'publish it' },
      signal()
    )
    expect(calls[0].operationId).toBe('powers.upload.v1')
    expect(calls[0].params).toEqual({ agent: 'bibit', type: 'skill', name: 'demo', message: 'publish it' })
    expect(calls[0].timeoutMs).toBe(120_000)
    expect(submissionIdFrom(result.stdout)).toBe('sub_7')
  })

  it('sends the closed delete request', async () => {
    const { service, calls } = makeService(() => ({ status: 'deleted' }))
    await deleteCustomResource(service, { agent: 'codex', type: 'skill', name: 'demo' }, signal())
    expect(calls[0].operationId).toBe('powers.delete.v1')
    expect(calls[0].params).toEqual({ agent: 'codex', type: 'skill', name: 'demo' })
  })

  it('reports a cancelled request even when the service answers late', async () => {
    const controller = new AbortController()
    const { service } = makeService(() => ({ status: 'deleted' }))
    controller.abort()
    await expect(
      deleteCustomResource(service, { agent: 'codex', type: 'skill', name: 'demo' }, controller.signal)
    ).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('extracts the submission id only when apm printed one', () => {
    expect(submissionIdFrom(undefined)).toBeUndefined()
    expect(submissionIdFrom('submission_id: sub_9')).toBe('sub_9')
    expect(submissionIdFrom('outcome: accepted')).toBeUndefined()
  })
})
