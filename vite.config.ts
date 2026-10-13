import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import { handleStoreRequest, StoreError } from './dev/store'
import { inspectSource, mutateSource, readInstalled, readMarket, upgradeSource } from './dev/sources'
import { deleteSource, readCustom, uploadSource } from './dev/custom'

const MAX_BODY_BYTES = 1024 * 1024

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        request.destroy(new Error('request body too large'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) {
        reject(new Error('request body too large'))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
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

        // Cancel downstream work only when the client aborts or the connection
        // closes before the response is finished; a normal request-body end must
        // not cancel the in-flight source.
        const controller = new AbortController()
        request.on('aborted', () => controller.abort())
        request.on('close', () => {
          if (!response.writableEnded) controller.abort()
        })

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
            {
              readInstalled,
              readMarket,
              inspect: inspectSource,
              mutate: mutateSource,
              readCustom: (agent) => Promise.resolve(readCustom(agent)),
              upload: uploadSource,
              removeCustom: async (target) => deleteSource(target),
              upgrade: upgradeSource,
            },
            controller.signal
          )
          sendJson(response, { protocolVersion: 1, requestId, ok: true, result })
        } catch (error) {
          if (response.writableEnded || response.destroyed) return
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
