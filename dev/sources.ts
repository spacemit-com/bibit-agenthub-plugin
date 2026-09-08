import { spawn } from 'node:child_process'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { PowersWireResult } from '../src/api/contracts'
import type { InspectResult, MutationIntent, MutationResult, PowerTarget } from '../src/api/powerOperations'
import { StoreError } from './store'

/**
 * Dev-only Node transport with the same semantics as the Go provider: it never
 * parses business fields, carries the raw UTF-8 JSON text through, applies the
 * per-operation deadline (read 30 s / write 120 s) and a 4 MiB response budget,
 * and trusts only the platform CA. This file is consumed by vite.config.ts and
 * never reaches the plugin bundle.
 */

const DEFAULT_APC_BASE_URL = 'https://developer.bianbu.xyz/api-server/apc/api/v1'
const MAX_BYTES = 4 * 1024 * 1024
const READ_TIMEOUT_MS = 30_000
const WRITE_TIMEOUT_MS = 120_000

// Read at call time so tests can override the endpoints without racing module load.
function apcBaseUrl(): string {
  return process.env.APC_BASE_URL ?? DEFAULT_APC_BASE_URL
}

function apmPath(): string {
  return process.env.APM_PATH ?? 'apm'
}

const APM_UNAVAILABLE = 'apm CLI is unavailable'
const APC_UNAVAILABLE = 'APC catalog is unavailable'

/**
 * Joins a caller signal with a fixed deadline. Both the timeout and the caller
 * abort trigger the same downstream cancellation; the transport maps the resulting
 * failure to a fixed unavailable message.
 */
export function withDeadline(signal: AbortSignal, timeoutMs: number): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort)
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    },
  }
}

function apmUnavailable(): StoreError {
  return new StoreError('unavailable', true, APM_UNAVAILABLE)
}

function apcUnavailable(): StoreError {
  return new StoreError('unavailable', true, APC_UNAVAILABLE)
}

function runApmProcess(argv: string[], signal: AbortSignal): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(apmUnavailable())
      return
    }
    // Since apm ADR-029, `list --json` always carries description/tags, and `--all`
    // means "expand all versions of a NAMED power", so it is dropped. A non-zero
    // exit is returned to the caller so read operations can reject and write
    // operations can report it as a normal result.
    const child = spawn(apmPath(), argv, {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
    })

    let settled = false
    let failed = false
    let stdout = ''
    const decoder = new TextDecoder('utf-8', { fatal: true })

    const killGroup = () => {
      if (child.pid === undefined) {
        child.kill('SIGKILL')
        return
      }
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }

    const onAbort = () => killGroup()
    signal.addEventListener('abort', onAbort)

    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      run()
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (failed) return
      try {
        stdout += decoder.decode(chunk, { stream: true })
      } catch {
        failed = true
        killGroup()
        return
      }
      if (Buffer.byteLength(stdout, 'utf8') > MAX_BYTES) {
        failed = true
        killGroup()
      }
    })

    child.on('error', () => finish(() => reject(apmUnavailable())))

    child.on('close', (code) => {
      finish(() => {
        if (failed) {
          reject(apmUnavailable())
          return
        }
        try {
          stdout += decoder.decode()
        } catch {
          reject(apmUnavailable())
          return
        }
        resolve({ stdout, exitCode: code ?? -1 })
      })
    })
  })
}

export async function readInstalled(agent: string, signal: AbortSignal): Promise<PowersWireResult> {
  const deadline = withDeadline(signal, READ_TIMEOUT_MS)
  try {
    const { stdout, exitCode } = await runApmProcess(
      ['list', '--installed', '--agent=' + agent, '--json'],
      deadline.signal
    )
    if (exitCode !== 0) {
      throw apmUnavailable()
    }
    return { scope: 'installed', status: 'data', listJson: stdout }
  } finally {
    deadline.cleanup()
  }
}

export async function inspectSource(target: PowerTarget, signal: AbortSignal): Promise<InspectResult> {
  const deadline = withDeadline(signal, READ_TIMEOUT_MS)
  try {
    const { stdout, exitCode } = await runApmProcess(
      ['list', target.name, '--installed', '--json', '--agent=' + target.agent, '--type=' + target.type],
      deadline.signal
    )
    if (exitCode !== 0) {
      throw apmUnavailable()
    }
    return { listJson: stdout }
  } finally {
    deadline.cleanup()
  }
}

export async function mutateSource(intent: MutationIntent, signal: AbortSignal): Promise<MutationResult> {
  const deadline = withDeadline(signal, WRITE_TIMEOUT_MS)
  try {
    const argv =
      intent.kind === 'install'
        ? ['install', intent.input.name + '=' + intent.input.version, '--agent=' + intent.input.agent, '--type=' + intent.input.type]
        : ['uninstall', intent.input.name, '--agent=' + intent.input.agent, '--type=' + intent.input.type]
    const { exitCode } = await runApmProcess(argv, deadline.signal)
    return { status: 'exited', exitCode }
  } finally {
    deadline.cleanup()
  }
}

function fetchText(url: string, signal: AbortSignal, maxBytes: number, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(apcUnavailable())
      return
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(apcUnavailable())
      return
    }
    const get = parsed.protocol === 'https:' ? httpsGet : httpGet

    const request = get(parsed, { headers: { accept: 'application/json' } }, (response: IncomingMessage) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsLeft <= 0) {
          reject(apcUnavailable())
          return
        }
        const next = new URL(response.headers.location, parsed)
        if (parsed.protocol === 'https:' && next.protocol === 'http:') {
          reject(apcUnavailable())
          return
        }
        fetchText(next.toString(), signal, maxBytes, redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        reject(apcUnavailable())
        return
      }
      let body = ''
      let failed = false
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        if (failed) return
        body += chunk
        if (Buffer.byteLength(body, 'utf8') > maxBytes) {
          failed = true
          request.destroy()
        }
      })
      response.on('end', () => {
        if (failed) {
          reject(apcUnavailable())
          return
        }
        resolve(body)
      })
    })

    request.on('error', () => reject(apcUnavailable()))
    const onAbort = () => request.destroy()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function fetchVersion(signal: AbortSignal): Promise<string> {
  const text = await fetchText(`${apcBaseUrl()}/resources/version`, signal, 64 * 1024)
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw apcUnavailable()
  }
  if (typeof value !== 'object' || value === null) {
    throw apcUnavailable()
  }
  const snapshot = (value as Record<string, unknown>).catalog_sha256
  if (typeof snapshot !== 'string' || snapshot.length === 0) {
    throw apcUnavailable()
  }
  return snapshot
}

export async function readMarket(
  knownSnapshot: string | undefined,
  signal: AbortSignal
): Promise<PowersWireResult> {
  const deadline = withDeadline(signal, READ_TIMEOUT_MS)
  try {
    const snapshot = await fetchVersion(deadline.signal)
    if (snapshot === knownSnapshot) {
      return { scope: 'market', status: 'not_modified', snapshot }
    }
    const catalogJson = await fetchText(`${apcBaseUrl()}/resources`, deadline.signal, MAX_BYTES)
    return { scope: 'market', status: 'data', snapshot, catalogJson }
  } finally {
    deadline.cleanup()
  }
}
