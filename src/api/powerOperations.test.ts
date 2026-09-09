import { describe, expect, it } from 'vitest'
import type {
  FeatureServiceApiV1,
  FeatureServiceErrorV1,
  FeatureServiceRequestV1,
} from '@bibit/feature-sdk'
import {
  inspectPower,
  mutatePower,
  parseInstallInput,
  parseInspectResult,
  parseMutationResult,
  parsePowerTarget,
  type PowerTarget,
} from './powerOperations'

const target: PowerTarget = { agent: 'bibit', type: 'skill', name: 'demo' }

function makeService(respond: (callIndex: number) => unknown): {
  service: FeatureServiceApiV1<'store'>
  calls: FeatureServiceRequestV1<'store'>[]
} {
  const calls: FeatureServiceRequestV1<'store'>[] = []
  const service: FeatureServiceApiV1<'store'> = {
    async request<TResult>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
      calls.push(input)
      return respond(calls.length - 1) as TResult
    },
  }
  return { service, calls }
}

const signal = () => new AbortController().signal

describe('parseMutationResult', () => {
  it('accepts a normal exit code', () => {
    expect(parseMutationResult({ status: 'exited', exitCode: 1 })).toEqual({
      status: 'exited',
      exitCode: 1,
    })
  })

  it('accepts exit code 0 and 255', () => {
    expect(parseMutationResult({ status: 'exited', exitCode: 0 }).exitCode).toBe(0)
    expect(parseMutationResult({ status: 'exited', exitCode: 255 }).exitCode).toBe(255)
  })

  it('rejects a negative exit code (signals are not masqueraded)', () => {
    expect(() => parseMutationResult({ status: 'exited', exitCode: -1 })).toThrow()
  })

  it('rejects an out-of-range exit code', () => {
    expect(() => parseMutationResult({ status: 'exited', exitCode: 256 })).toThrow()
  })

  it('rejects a non-integer exit code', () => {
    expect(() => parseMutationResult({ status: 'exited', exitCode: 1.5 })).toThrow()
  })

  it('rejects an unknown status and extra fields', () => {
    expect(() => parseMutationResult({ status: 'killed', exitCode: 1 })).toThrow()
    expect(() => parseMutationResult({ status: 'exited', exitCode: 0, stderr: 'x' })).toThrow()
  })
})

describe('parsePowerTarget', () => {
  it.each(['skill', 'plugin', 'mcp'])('accepts Hermes %s targets and installs', (type) => {
    const hermes = { agent: 'hermes-agent', type, name: 'demo' }
    expect(parsePowerTarget(hermes)).toEqual(hermes)
    expect(parseInstallInput({ ...hermes, version: 'v1.0.0' })).toEqual({ ...hermes, version: 'v1.0.0' })
  })

  it('rejects Hermes agent-type powers and the CLI executable alias', () => {
    expect(() => parsePowerTarget({ agent: 'hermes-agent', type: 'agent', name: 'demo' })).toThrow(/only available for the bibit agent/)
    expect(() => parsePowerTarget({ agent: 'hermes', type: 'skill', name: 'demo' })).toThrow()
  })

  it('parses a valid target', () => {
    expect(parsePowerTarget(target)).toEqual(target)
  })

  it('rejects type=agent for a non-bibit agent', () => {
    expect(() => parsePowerTarget({ agent: 'codex', type: 'agent', name: 'demo' })).toThrow()
  })

  it('accepts type=agent for bibit', () => {
    expect(parsePowerTarget({ agent: 'bibit', type: 'agent', name: 'demo' })).toEqual({
      agent: 'bibit',
      type: 'agent',
      name: 'demo',
    })
  })

  it('rejects an agent outside the fixed list (no all)', () => {
    expect(() => parsePowerTarget({ agent: 'all', type: 'skill', name: 'demo' })).toThrow()
    expect(() => parsePowerTarget({ agent: '', type: 'skill', name: 'demo' })).toThrow()
  })

  it('rejects extra fields (uninstall must not carry a version)', () => {
    expect(() =>
      parsePowerTarget({ agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0' })
    ).toThrow()
  })

  it('rejects an invalid power type', () => {
    expect(() => parsePowerTarget({ agent: 'bibit', type: 'package', name: 'demo' })).toThrow()
  })

  it.each([
    'Demo',
    'a--b',
    '-demo',
    'demo-',
    'a:b',
    'a_b',
    '',
    'a'.repeat(65),
    'demo=v1.0.0',
    'demo/../x',
    '--help',
    'demo --help',
    'demo;rm',
    'demo@1.0',
  ])('rejects non-canonical name %j', (name) => {
    expect(() => parsePowerTarget({ agent: 'bibit', type: 'skill', name })).toThrow()
  })

  it.each(['a', 'demo-plugin-2', '123demo', 'a'.repeat(64)])('accepts canonical name %j', (name) => {
    expect(parsePowerTarget({ agent: 'bibit', type: 'skill', name })).toEqual({
      agent: 'bibit',
      type: 'skill',
      name,
    })
  })
})

describe('parseInstallInput', () => {
  it('parses a target with a canonical version', () => {
    expect(parseInstallInput({ agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0' })).toEqual({
      agent: 'bibit',
      type: 'skill',
      name: 'demo',
      version: 'v1.0.0',
    })
  })

  it('requires a version', () => {
    expect(() => parseInstallInput({ agent: 'bibit', type: 'skill', name: 'demo' })).toThrow()
  })

  it.each(['1.0.0', 'v1.0', 'v1.0.0-rc1', 'v1.0.0+build', 'latest'])(
    'rejects non-canonical version %j',
    (version) => {
      expect(() =>
        parseInstallInput({ agent: 'bibit', type: 'skill', name: 'demo', version })
      ).toThrow()
    }
  )
})

describe('parseInspectResult', () => {
  it('parses a listJson payload', () => {
    expect(parseInspectResult({ listJson: '[]' })).toEqual({ listJson: '[]' })
  })

  it('rejects non-string or extra fields', () => {
    expect(() => parseInspectResult({ listJson: 1 })).toThrow()
    expect(() => parseInspectResult({ listJson: '[]', status: 'data' })).toThrow()
  })
})

describe('inspectPower', () => {
  it('sends the fixed inspect operation with the target and read timeout', async () => {
    const { service, calls } = makeService(() => ({ listJson: '[]' }))

    await inspectPower(service, target, signal())

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      serviceId: 'store',
      operationId: 'powers.inspect.v1',
      timeoutMs: 30_000,
    })
    expect(calls[0].params).toEqual({ agent: 'bibit', type: 'skill', name: 'demo' })
  })

  it('passes the caller signal through', async () => {
    const controller = new AbortController()
    const { service, calls } = makeService(() => ({ listJson: '[]' }))

    await inspectPower(service, target, controller.signal)

    expect(calls[0].signal).toBe(controller.signal)
  })

  it('parses the installed list and returns records', async () => {
    const listJson = JSON.stringify([
      { agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0', description: 'd', tags: [] },
    ])
    const { service } = makeService(() => ({ listJson }))

    const records = await inspectPower(service, target, signal())

    expect(records).toEqual([
      { agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0', description: 'd', tags: [] },
    ])
  })

  it('rejects a record that does not belong to the requested target', async () => {
    const listJson = JSON.stringify([
      { agent: 'bibit', type: 'skill', name: 'other', version: 'v1.0.0', description: 'd', tags: [] },
    ])
    const { service } = makeService(() => ({ listJson }))

    await expect(inspectPower(service, target, signal())).rejects.toMatchObject({
      code: 'incompatible',
    })
  })

  it('preserves a FeatureServiceError as-is', async () => {
    const error: FeatureServiceErrorV1 = {
      version: 1,
      code: 'unavailable',
      message: 'store is down',
      retryable: true,
      diagnosticId: 'diag-1',
    }
    const { service } = makeService(() => {
      throw error
    })

    const caught = await inspectPower(service, target, signal()).catch((reason: unknown) => reason)
    expect(caught).toBe(error)
  })
})

describe('mutatePower', () => {
  it('sends the install operation with version and write timeout', async () => {
    const { service, calls } = makeService(() => ({ status: 'exited', exitCode: 0 }))

    await mutatePower(service, { kind: 'install', input: { ...target, version: 'v1.0.0' } }, signal())

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      serviceId: 'store',
      operationId: 'powers.install.v1',
      timeoutMs: 120_000,
    })
    expect(calls[0].params).toEqual({ agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0' })
  })

  it('sends the uninstall operation without a version', async () => {
    const { service, calls } = makeService(() => ({ status: 'exited', exitCode: 0 }))

    await mutatePower(service, { kind: 'uninstall', input: target }, signal())

    expect(calls[0]).toMatchObject({
      serviceId: 'store',
      operationId: 'powers.uninstall.v1',
      timeoutMs: 120_000,
    })
    expect(calls[0].params).toEqual({ agent: 'bibit', type: 'skill', name: 'demo' })
  })

  it('returns a non-zero exit code as a normal result, not an error', async () => {
    const { service } = makeService(() => ({ status: 'exited', exitCode: 1 }))

    await expect(mutatePower(service, { kind: 'uninstall', input: target }, signal())).resolves.toEqual({
      status: 'exited',
      exitCode: 1,
    })
  })

  it('passes the caller signal through', async () => {
    const controller = new AbortController()
    const { service, calls } = makeService(() => ({ status: 'exited', exitCode: 0 }))

    await mutatePower(service, { kind: 'install', input: { ...target, version: 'v1.0.0' } }, controller.signal)

    expect(calls[0].signal).toBe(controller.signal)
  })

  it('preserves a FeatureServiceError as-is', async () => {
    const error: FeatureServiceErrorV1 = {
      version: 1,
      code: 'unauthorized',
      message: 'not granted',
      retryable: false,
    }
    const { service } = makeService(() => {
      throw error
    })

    const caught = await mutatePower(service, { kind: 'uninstall', input: target }, signal()).catch(
      (reason: unknown) => reason
    )
    expect(caught).toBe(error)
  })
})
