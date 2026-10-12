import { describe, expect, it, vi } from 'vitest'
import type { FeatureHostActionApiV1 } from '@bibit/feature-sdk'
import type { FeatureHostActionResultV1 } from '@bibit/feature-contracts'
import { agentHubChinese } from '../agentHubI18n'
import {
  ACTIONS_UNAVAILABLE_TEXT,
  COMPOSE_RETRY_HINT,
  COMPOSE_UNSUPPORTED_TEXT,
  CREATE_RESOURCE_ACTION,
  CREATE_RESOURCE_PROMPT_LINES,
  composePrompt,
  composeResource,
} from './conversationCompose'

const invoke = (result: FeatureHostActionResultV1) => {
  const calls: unknown[][] = []
  const actions: FeatureHostActionApiV1 = {
    async invoke(...args) {
      calls.push(args as unknown[])
      return result
    },
  }
  return { actions, calls }
}

describe('composePrompt', () => {
  it('joins the translated draft lines with newlines', () => {
    const translate = (source: string) => `[${source}]`
    expect(composePrompt(translate)).toBe(
      CREATE_RESOURCE_PROMPT_LINES.map((line) => `[${line}]`).join('\n')
    )
  })

  it('names the skill the platform ships for creating Powers', () => {
    expect(CREATE_RESOURCE_PROMPT_LINES.some((line) => line.includes('using-apm'))).toBe(true)
  })

  it('is the three-line draft the entry stages', () => {
    // The copy is the deliverable, so it is asserted rather than described: the
    // request, then the two blanks the user is meant to fill in.
    const chinese = composePrompt((source) => agentHubChinese[source] ?? source)
    expect(chinese).toBe(
      [
        '请使用using-apm技能帮我新建一个能力资源。',
        '资源类型（Skill/Plugin/MCP/Expert）：',
        '资源的要求：',
      ].join('\n')
    )
    expect(CREATE_RESOURCE_PROMPT_LINES).toHaveLength(3)
  })

  it('offers the Expert type, not the retired Agent spelling', () => {
    // `Agent` is the value the type carried before the rename to `expert`; the
    // draft must not reintroduce it as a resource type.
    const draft = CREATE_RESOURCE_PROMPT_LINES.join('\n')
    expect(draft).toContain('Expert')
    expect(draft).not.toContain('Agent')
  })

  it('asks for nothing beyond the type and the requirement', () => {
    // The draft used to ask the model to confirm the details back before
    // starting, and to ask for a target Agent and version. Both were dropped, so
    // guard against a reintroduction that would lengthen the draft again.
    const draft = CREATE_RESOURCE_PROMPT_LINES.join('\n')
    expect(draft).not.toMatch(/confirm/i)
    expect(draft).not.toMatch(/version/i)
  })

  it('stays well inside the host prompt limit and holds no placeholder slots', () => {
    const draft = CREATE_RESOURCE_PROMPT_LINES.join('\n')
    // The host rejects a prompt longer than 16 000 characters.
    expect(draft.length).toBeLessThan(2_000)
    // The translator treats `{name}` as a placeholder and would leave it visible.
    expect(draft).not.toMatch(/[{}]/)
  })
})

describe('composeResource', () => {
  it('invokes conversation.compose once with only the draft', async () => {
    const { actions, calls } = invoke({ status: 'completed' })
    const outcome = await composeResource(actions, 'draft text')

    expect(calls).toEqual([[CREATE_RESOURCE_ACTION, { prompt: 'draft text' }]])
    expect(outcome).toEqual({ status: 'completed' })
    // Staging a draft is the whole job: no second call, no send, no retry.
    expect(calls).toHaveLength(1)
  })

  it('reports a user cancellation as an outcome, not an error', async () => {
    const { actions } = invoke({ status: 'cancelled' })
    await expect(composeResource(actions, 'draft text')).resolves.toEqual({ status: 'cancelled' })
  })

  it('replaces the UNSUPPORTED host message with plugin copy', async () => {
    const { actions } = invoke({
      status: 'rejected',
      error: { code: 'UNSUPPORTED', message: 'Unknown host action: conversation.compose' },
    })
    await expect(composeResource(actions, 'draft text')).resolves.toEqual({
      status: 'rejected',
      code: 'UNSUPPORTED',
      notice: { origin: 'plugin', text: COMPOSE_UNSUPPORTED_TEXT, retryable: false },
    })
  })

  it('passes the host message through for INVALID_INPUT and carries retryability', async () => {
    const { actions } = invoke({
      status: 'rejected',
      error: { code: 'INVALID_INPUT', message: 'Skill is not available', retryable: true },
    })
    const outcome = await composeResource(actions, 'draft text')
    expect(outcome).toEqual({
      status: 'rejected',
      code: 'INVALID_INPUT',
      notice: { origin: 'host', text: 'Skill is not available', retryable: true },
    })
  })

  it('falls back to plugin copy when the host sends an empty message', async () => {
    const { actions } = invoke({
      status: 'rejected',
      error: { code: 'FAILED', message: '   ', retryable: true },
    })
    const outcome = await composeResource(actions, 'draft text')
    expect(outcome.status).toBe('rejected')
    expect(outcome).toMatchObject({ notice: { origin: 'plugin', retryable: true } })
  })

  it('turns a thrown transport error into a retryable host failure', async () => {
    const actions: FeatureHostActionApiV1 = {
      invoke: vi.fn().mockRejectedValue(new Error('capability revoked')),
    }
    await expect(composeResource(actions, 'draft text')).resolves.toEqual({
      status: 'rejected',
      code: 'FAILED',
      notice: { origin: 'host', text: 'capability revoked', retryable: true },
    })
  })
})

describe('plugin copy for the entry', () => {
  it('names the fix for a retryable refusal instead of promising a retry', () => {
    expect(COMPOSE_RETRY_HINT).toMatch(/clear the input box/i)
    expect(ACTIONS_UNAVAILABLE_TEXT).toMatch(/unavailable/i)
  })
})
