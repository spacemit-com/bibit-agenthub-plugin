import type { FeatureHostActionApiV1 } from '@bibit/feature-sdk'
import type {
  FeatureHostActionErrorCodeV1,
  FeatureHostActionErrorV1,
} from '@bibit/feature-contracts'
import type { AgentHubTranslate } from '../agentHubI18n'

/**
 * The draft this entry stages into the new session, one translatable line each.
 * The page renders it through the plugin translator and joins the lines with
 * newlines, so each line is also a key in the Chinese dictionary.
 *
 * Three lines: the request, then the two blanks the user is meant to fill in.
 * The draft deliberately does not ask the model to confirm the details back
 * before starting, nor for a target Agent and version -- both were dropped to
 * keep the draft to what the user has to answer for the task to begin, and the
 * type list names the Expert type the resource vocabulary settled on, not the
 * `Agent` value it used to carry.
 *
 * The draft names the skill the platform ships for this job instead of staging
 * the skill itself: `using-apm` is a preset skill on every expert, so staging it
 * would duplicate a chip the composer already counts as active, and on a device
 * that does not ship it the whole call would be rejected as `INVALID_INPUT`.
 */
export const CREATE_RESOURCE_PROMPT_LINES = [
  'Use the using-apm skill to create a new Power resource.',
  'Resource type (Skill/Plugin/MCP/Expert):',
  'What the resource should do:',
] as const

/** The registered host action this entry asks for. */
export const CREATE_RESOURCE_ACTION = 'conversation.compose' as const

/**
 * What to tell the user when the host refuses with `retryable: true`. The plugin
 * only names the fix; it never retries by itself, because every retryable
 * refusal so far (an unsent draft on the home page, a Runtime target switch)
 * needs the user to act first.
 */
export const COMPOSE_RETRY_HINT = 'Clear the input box, then click again.'

/** Builds the draft in the host language: one translated line per sentence. */
export function composePrompt(translate: AgentHubTranslate): string {
  return CREATE_RESOURCE_PROMPT_LINES.map((line) => translate(line)).join('\n')
}

/** `host:actions` is missing, so the entry stays disabled: no action can be sent. */
export const ACTIONS_UNAVAILABLE_TEXT =
  'Opening a new conversation is unavailable because this host does not provide it.'

/** The host has `host:actions` but does not know this action. */
export const COMPOSE_UNSUPPORTED_TEXT =
  'This host version does not support opening a new conversation.'

const REJECTED_FALLBACK_TEXT = 'The host rejected the request to open a new conversation.'

/**
 * A message to render for a refused call.
 *
 * `origin` says who wrote the text: the plugin's own English source (the page
 * translates it) or the host (the page renders it as-is, because the host
 * already localized it — for example the occupied-draft message). Keeping the
 * two apart is what stops a host-internal string like `Unknown host action: …`
 * from reaching the user.
 */
export interface ComposeNotice {
  origin: 'plugin' | 'host'
  text: string
  retryable: boolean
}

/**
 * The three outcomes of `conversation.compose`, plus which one the page should
 * report. `completed` and `cancelled` carry no copy on purpose: the host opens
 * the new session on success, so the page that asked is gone, and a cancellation
 * is the user's own decision rather than an error.
 */
export type ComposeOutcome =
  | { status: 'completed' }
  | { status: 'cancelled' }
  | { status: 'rejected'; code: FeatureHostActionErrorCodeV1; notice: ComposeNotice }

function noticeFor(error: FeatureHostActionErrorV1): ComposeNotice {
  // `UNSUPPORTED` means this host never registered the action, so its message is
  // a developer string and the entry is dead for this process. Everything else
  // is the host's own wording about the request the user just made.
  if (error.code === 'UNSUPPORTED') {
    return { origin: 'plugin', text: COMPOSE_UNSUPPORTED_TEXT, retryable: false }
  }
  const message = typeof error.message === 'string' ? error.message.trim() : ''
  const retryable = error.retryable === true
  return message
    ? { origin: 'host', text: message, retryable }
    : { origin: 'plugin', text: REJECTED_FALLBACK_TEXT, retryable }
}

/**
 * Asks the host to open a new conversation with `prompt` already in the input
 * box. The action never sends anything, so this function never sends either: the
 * draft waits for the user.
 *
 * The host answers with a structured result for every refusal (see
 * `FeatureHostActionResultV1`); a throw is treated as a retryable host failure
 * so a transport error cannot escape the click handler as an unhandled rejection.
 * The caller must not retry on its own — a retryable refusal means the user has
 * something to fix first, such as an unsent draft on the home page.
 */
export async function composeResource(
  actions: FeatureHostActionApiV1,
  prompt: string
): Promise<ComposeOutcome> {
  try {
    const result = await actions.invoke(CREATE_RESOURCE_ACTION, { prompt })
    if (result.status === 'completed') return { status: 'completed' }
    if (result.status === 'cancelled') return { status: 'cancelled' }
    return { status: 'rejected', code: result.error.code, notice: noticeFor(result.error) }
  } catch (cause) {
    return {
      status: 'rejected',
      code: 'FAILED',
      notice: {
        origin: 'host',
        // The host contract reports failures as results, so a throw is unexpected;
        // show what it said rather than inventing a reason for it.
        text: cause instanceof Error ? cause.message : String(cause),
        retryable: true,
      },
    }
  }
}
