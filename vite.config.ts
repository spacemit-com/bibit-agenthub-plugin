import { spawn } from 'node:child_process'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import { parseApmInstalledList, type PowerRecord } from './src/api/apm'
import { parseApcCatalog } from './src/api/apc'
import {
  handleStoreRequest,
  StoreError,
  type ApmListResult,
  type ApcCatalogResult,
} from './dev/store'

const APC_BASE_URL =
  process.env.APC_BASE_URL ?? 'https://developer.bianbu.xyz/api-server/apc/api/v1'

// The test environment serves an untrusted TLS certificate. Dev-only transport
// disables verification here; the production bibit-agenthub-cli provider must
// trust the platform CA instead. This file is never part of the plugin bundle.
const APC_INSECURE_TLS = true

function runApmListInstalled(agent: string): Promise<ApmListResult> {
  return new Promise((resolve) => {
    // Since apm ADR-029, `list --json` always carries description/tags, and `--all`
    // now means "expand all versions of a NAMED power" (it errors without a name),
    // so it is dropped. A not-installed agent exits 1 with an empty stdout (mapped
    // to `not-installed` below); an installed-but-empty agent exits 0 with `[]`.
    const argv = ['list', '--installed', '--agent=' + agent, '--json']
    const child = spawn('apm', argv, { shell: false, stdio: ['ignore', 'pipe', 'ignore'] })

    let settled = false
    let stdout = ''
    const settle = (result: ApmListResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', () => settle({ status: 'unavailable' }))
    child.on('close', (code) => {
      if (code === null) {
        settle({ status: 'unavailable' })
        return
      }
      try {
        settle({ status: 'ok', records: parseApmInstalledList(JSON.parse(stdout)) })
      } catch {
        settle(code === 0 ? { status: 'unavailable' } : { status: 'not-installed' })
      }
    })
  })
}

function fetchJson(url: string, redirectsLeft = 5): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const get = parsed.protocol === 'https:' ? httpsGet : httpGet
    const options: Record<string, unknown> = { headers: { accept: 'application/json' } }
    if (parsed.protocol === 'https:' && APC_INSECURE_TLS) {
      options.rejectUnauthorized = false
    }
    const request = get(url, options, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsLeft <= 0) {
          reject(new Error('too many APC redirects'))
          return
        }
        const next = new URL(response.headers.location, parsed).toString()
        resolve(fetchJson(next, redirectsLeft - 1))
        return
      }
      if (status >= 400) {
        response.resume()
        reject(new Error('APC request failed with ' + status))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch {
          reject(new Error('invalid JSON from APC'))
        }
      })
    })
    request.on('error', reject)
  })
}

async function runApcCatalog(): Promise<ApcCatalogResult> {
  try {
    const version = (await fetchJson(`${APC_BASE_URL}/resources/version`)) as Record<string, unknown>
    const snapshot = version.catalog_sha256
    if (typeof snapshot !== 'string' || snapshot.length === 0) {
      return { status: 'unavailable' }
    }
    const catalog = await fetchJson(`${APC_BASE_URL}/resources`)
    const records: PowerRecord[] = parseApcCatalog(catalog)
    return { status: 'ok', snapshot, records }
  } catch {
    return { status: 'unavailable' }
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(response: ServerResponse, value: unknown) {
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(value))
}

function devStorePlugin(): Plugin {
  return {
    name: 'agent-hub-dev-store',
    configureServer(server) {
      server.middlewares.use('/dev-services/store/invoke', async (request, response, next) => {
        if (request.method !== 'POST') {
          next()
          return
        }
        let requestId = ''
        try {
          const body = await readJsonBody(request)
          if (!isRecord(body) || body.protocolVersion !== 1) throw new Error('unsupported gateway protocol')
          if (typeof body.requestId !== 'string') throw new Error('requestId must be a string')
          if (typeof body.operationId !== 'string') throw new Error('operationId must be a string')
          if (body.params === undefined || !isRecord(body.params)) throw new Error('params must be an object')
          requestId = body.requestId
          const result = await handleStoreRequest(
            { operationId: body.operationId, params: body.params },
            runApmListInstalled,
            runApcCatalog,
          )
          sendJson(response, { protocolVersion: 1, requestId, ok: true, result })
        } catch (error) {
          const storeError = error instanceof StoreError ? error : undefined
          sendJson(response, {
            protocolVersion: 1,
            requestId,
            ok: false,
            error: {
              code: storeError?.code ?? 'incompatible',
              message: error instanceof Error ? error.message : 'Store request failed',
              retryable: storeError?.retryable ?? false,
            },
          })
        }
      })
    },
  }
}

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  plugins: [devStorePlugin()],
})
