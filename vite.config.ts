import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import { parseApmInstalledList } from './src/api/apm'
import { handleStoreRequest, StoreError, type ApmListResult } from './dev/store'

function runApmListInstalled(agent: string): Promise<ApmListResult> {
  return new Promise((resolve) => {
    const argv = ['list', '--installed', '--agent=' + agent, '--json', '--all']
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