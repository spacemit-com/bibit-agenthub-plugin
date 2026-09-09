import { describe, expect, it } from 'vitest'
import type { FeatureServiceApiV1, FeatureServiceRequestV1 } from '@bibit/feature-sdk'
import type { APMPowerRecord } from '../src/api/apm'
import { getInstallationStore } from '../src/api/installationStore'
import { handleStoreRequest, type StoreSources } from './store'

function makeService(sources: StoreSources): FeatureServiceApiV1<'store'> {
  return {
    async request<TResult>(input: FeatureServiceRequestV1<'store'>): Promise<TResult> {
      return handleStoreRequest(
        { operationId: input.operationId, params: input.params },
        sources,
        input.signal ?? new AbortController().signal
      ) as TResult
    },
  }
}

const record = (version: string): APMPowerRecord => ({
  agent: 'bibit',
  type: 'skill',
  name: 'demo',
  version,
  description: '',
  tags: [],
})

const key = JSON.stringify(['bibit', 'skill', 'demo'])

describe('dev transport + installation store end-to-end', () => {
  it.each(['bibit', 'hermes-agent'])('runs inspect → install → refresh → uninstall → refresh for %s', async (agent) => {
    const key = JSON.stringify([agent, 'skill', 'demo'])
    let installed: APMPowerRecord[] = []
    const mutations: string[] = []
    const sources: StoreSources = {
      readInstalled: async () => ({ scope: 'installed', status: 'data', listJson: JSON.stringify(installed) }),
      readMarket: async () => ({ scope: 'market', status: 'data', snapshot: 'sha-1', catalogJson: '{"skills":{"items":[]}}' }),
      inspect: async (target) => ({
        listJson: JSON.stringify(
          installed.filter(
            (item) => item.agent === target.agent && item.type === target.type && item.name === target.name
          )
        ),
      }),
      mutate: async (intent) => {
        if (intent.kind === 'install') {
          mutations.push('install')
          installed = [
            {
              agent: intent.input.agent,
              type: intent.input.type,
              name: intent.input.name,
              version: intent.input.version,
              description: '',
              tags: [],
            },
          ]
        } else {
          mutations.push('uninstall')
          installed = installed.filter(
            (item) =>
              !(item.agent === intent.input.agent && item.type === intent.input.type && item.name === intent.input.name)
          )
        }
        return { status: 'exited', exitCode: 0 }
      },
    }

    const service = makeService(sources)
    const store = getInstallationStore(service)
    const signal = new AbortController().signal

    const before = await store.inspect({ agent, type: 'skill', name: 'demo' }, signal)
    expect(before).toEqual([])

    await store.execute(
      { kind: 'install', input: { agent, type: 'skill', name: 'demo', version: 'v1.0.0' } },
      signal
    )
    const afterInstall = store.getSnapshot()
    expect(afterInstall.fullLists.get(agent)).toEqual([{ ...record('v1.0.0'), agent }])
    expect(afterInstall.notices.get(key)).toBe('安装完成')

    expect(await store.refreshAgent(agent, signal)).toEqual([{ ...record('v1.0.0'), agent }])

    await store.execute({ kind: 'uninstall', input: { agent, type: 'skill', name: 'demo' } }, signal)
    const afterUninstall = store.getSnapshot()
    expect(afterUninstall.notices.get(key)).toBe('卸载完成')

    expect(await store.refreshAgent(agent, signal)).toEqual([])
    expect(mutations).toEqual(['install', 'uninstall'])
  })

  it('propagates a normal non-zero write exit into the mutation notice', async () => {
    const sources: StoreSources = {
      readInstalled: async () => ({ scope: 'installed', status: 'data', listJson: '[]' }),
      readMarket: async () => ({ scope: 'market', status: 'data', snapshot: 'sha-1', catalogJson: '{}' }),
      inspect: async () => ({ listJson: '[]' }),
      mutate: async () => ({ status: 'exited', exitCode: 1 }),
    }

    const service = makeService(sources)
    const store = getInstallationStore(service)
    const signal = new AbortController().signal

    await store.execute(
      { kind: 'install', input: { agent: 'bibit', type: 'skill', name: 'demo', version: 'v1.0.0' } },
      signal
    )

    const notice = store.getSnapshot().notices.get(key)
    expect(notice).toContain('失败')
  })
})
