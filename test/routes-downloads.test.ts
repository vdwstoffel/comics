import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import downloadRoutes from '../server/routes/downloads.js'
import { createDownloadRunner } from '../server/services/downloader.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

const REDIRECTED = 'https://fs3.example/Amazing%20Spider-Man%20031%20%282026%29.cbz'
const OPAQUE = 'https://getcomics.example/dls/VihnoomBUb2Wfcz'

let dir: string, app: FastifyInstance, cbzBytes: Uint8Array

function respond(body: Uint8Array | string | null, url: string, headers: Record<string, string> = {}) {
  const res = new Response(body as BodyInit, { headers })
  Object.defineProperty(res, 'url', { value: url })
  return res
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dlr-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'), tmpDir: join(dir, 'tmp'),
    maxUploadBytes: 5 * 1024 * 1024, comicVineApiKey: '',
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  const src = mkdtempSync(join(tmpdir(), 'src-'))
  cbzBytes = new Uint8Array(readFileSync(await makeCbz(src, ['p1.png'], 'x.cbz')))

  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  app.decorate('downloader', createDownloadRunner({ db: app.db, config }, {
    fetchImpl: async () => respond(cbzBytes, REDIRECTED),
  }))
  await app.register(downloadRoutes)
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('resolving a link reports what the file will be called', async () => {
  globalThis.fetch = (async () => respond(null, REDIRECTED, { 'content-length': '56524265' })) as never

  const res = await app.inject({ method: 'POST', url: '/api/downloads/resolve', payload: { url: OPAQUE } })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ fileName: 'Amazing Spider-Man 031 (2026).cbz', size: 56524265 })
})

test('resolving a link that reveals no name says so rather than guessing', async () => {
  globalThis.fetch = (async () => respond(null, OPAQUE)) as never

  const res = await app.inject({ method: 'POST', url: '/api/downloads/resolve', payload: { url: OPAQUE } })

  expect(res.json().fileName).toBeNull()
})

test('resolving refuses a url that is not http', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/downloads/resolve', payload: { url: 'file:///etc/passwd' },
  })

  expect(res.statusCode).toBe(400)
})

test('starting a download is accepted and reports its status', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/downloads', payload: { url: OPAQUE, edition: 'ASM' } })

  expect(res.statusCode).toBe(202)
  expect(res.json().started).toBe(true)
  expect(res.json().status.url).toBe(OPAQUE)
})

test('a second download while one runs is refused, not queued', async () => {
  await app.inject({ method: 'POST', url: '/api/downloads', payload: { url: OPAQUE, edition: 'ASM' } })
  const res = await app.inject({ method: 'POST', url: '/api/downloads', payload: { url: OPAQUE, edition: 'ASM' } })

  expect(res.statusCode).toBe(409)
  expect(res.json().started).toBe(false)
})

test('a download with no url is refused', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/downloads', payload: {} })
  expect(res.statusCode).toBe(400)
})

test('the status endpoint reports progress the page can poll', async () => {
  const res = await app.inject({ url: '/api/downloads' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ running: false, received: 0 })
})
