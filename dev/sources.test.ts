import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInstalled, readMarket, withDeadline } from './sources'

function writeExecutable(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'agenthub-sources-'))
  const file = join(dir, name)
  writeFileSync(file, content, { mode: 0o755 })
  return file
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') resolve(address.port)
      else resolve(0)
    })
  })
}

function freshSignal(): AbortSignal {
  return new AbortController().signal
}

const originalApmPath = process.env.APM_PATH
const originalApcBaseUrl = process.env.APC_BASE_URL

afterEach(() => {
  if (originalApmPath === undefined) delete process.env.APM_PATH
  else process.env.APM_PATH = originalApmPath
  if (originalApcBaseUrl === undefined) delete process.env.APC_BASE_URL
  else process.env.APC_BASE_URL = originalApcBaseUrl
})

describe('readInstalled', () => {
  it('passes the raw list text through without parsing', async () => {
    const apm = writeExecutable('apm', "#!/bin/sh\nprintf '%s' '[{\"name\":\"démo\"}]'\n")
    process.env.APM_PATH = apm

    const result = await readInstalled('bibit', freshSignal())

    expect(result).toEqual({ scope: 'installed', status: 'data', listJson: '[{"name":"démo"}]' })
  })

  it('maps a non-zero exit to the fixed unavailable error', async () => {
    const apm = writeExecutable('apm', '#!/bin/sh\nexit 1\n')
    process.env.APM_PATH = apm

    await expect(readInstalled('bibit', freshSignal())).rejects.toMatchObject({
      code: 'unavailable',
      message: 'apm CLI is unavailable',
    })
  })

  it('maps a missing executable to the fixed unavailable error', async () => {
    process.env.APM_PATH = join(tmpdir(), 'definitely-missing-apm')
    await expect(readInstalled('bibit', freshSignal())).rejects.toMatchObject({
      code: 'unavailable',
      message: 'apm CLI is unavailable',
    })
  })

  it('rejects output beyond the 4 MiB budget', async () => {
    const apm = writeExecutable('apm', '#!/bin/sh\nhead -c 4194305 /dev/zero; echo\n')
    process.env.APM_PATH = apm

    await expect(readInstalled('bibit', freshSignal())).rejects.toMatchObject({
      code: 'unavailable',
      message: 'apm CLI is unavailable',
    })
  })

  it('rejects when the caller signal aborts a slow process', async () => {
    const apm = writeExecutable('apm', "#!/bin/sh\nsleep 10\nprintf '%s' '[]'\n")
    process.env.APM_PATH = apm

    const controller = new AbortController()
    const pending = readInstalled('bibit', controller.signal)
    setTimeout(() => controller.abort(), 50)

    await expect(pending).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('readMarket', () => {
  it('downloads the catalog once and returns the raw text', async () => {
    let versionCalls = 0
    let catalogCalls = 0
    const server = createServer((request, response) => {
      if (request.url === '/resources/version') {
        versionCalls += 1
        response.setHeader('Content-Type', 'application/json')
        response.end('{"catalog_sha256":"sha-1"}')
      } else if (request.url === '/resources') {
        catalogCalls += 1
        response.setHeader('Content-Type', 'application/json')
        response.end('{"skills":{"items":[]}}')
      } else {
        response.statusCode = 404
        response.end()
      }
    })
    const port = await listen(server)
    process.env.APC_BASE_URL = `http://127.0.0.1:${port}`

    const result = await readMarket(undefined, freshSignal())

    expect(result).toEqual({
      scope: 'market',
      status: 'data',
      snapshot: 'sha-1',
      catalogJson: '{"skills":{"items":[]}}',
    })
    expect(versionCalls).toBe(1)
    expect(catalogCalls).toBe(1)
    await new Promise((resolve) => server.close(resolve))
  })

  it('returns not_modified without downloading the catalog', async () => {
    let versionCalls = 0
    let catalogCalls = 0
    const server = createServer((request, response) => {
      if (request.url === '/resources/version') {
        versionCalls += 1
        response.setHeader('Content-Type', 'application/json')
        response.end('{"catalog_sha256":"sha-1"}')
      } else if (request.url === '/resources') {
        catalogCalls += 1
        response.setHeader('Content-Type', 'application/json')
        response.end('{}')
      } else {
        response.statusCode = 404
        response.end()
      }
    })
    const port = await listen(server)
    process.env.APC_BASE_URL = `http://127.0.0.1:${port}`

    const result = await readMarket('sha-1', freshSignal())

    expect(result).toEqual({ scope: 'market', status: 'not_modified', snapshot: 'sha-1' })
    expect(versionCalls).toBe(1)
    expect(catalogCalls).toBe(0)
    await new Promise((resolve) => server.close(resolve))
  })

  it('maps a non-2xx version response to the fixed unavailable error', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 500
      response.end()
    })
    const port = await listen(server)
    process.env.APC_BASE_URL = `http://127.0.0.1:${port}`

    await expect(readMarket(undefined, freshSignal())).rejects.toMatchObject({
      code: 'unavailable',
      message: 'APC catalog is unavailable',
    })
    await new Promise((resolve) => server.close(resolve))
  })
})

describe('withDeadline', () => {
  it('aborts the derived signal when the deadline elapses', async () => {
    const deadline = withDeadline(new AbortController().signal, 20)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(deadline.signal.aborted).toBe(true)
    deadline.cleanup()
  })

  it('propagates the caller signal without waiting for the deadline', async () => {
    const caller = new AbortController()
    const deadline = withDeadline(caller.signal, 60_000)
    caller.abort()
    expect(deadline.signal.aborted).toBe(true)
    deadline.cleanup()
  })

  it('does not fire the deadline after cleanup', async () => {
    const deadline = withDeadline(new AbortController().signal, 20)
    deadline.cleanup()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(deadline.signal.aborted).toBe(false)
  })
})
