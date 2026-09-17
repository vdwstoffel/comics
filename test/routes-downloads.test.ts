import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import downloadRoutes from '../server/routes/downloads.js'
import { createDownloadRunner } from '../server/services/downloader.js'
import { enqueue, takeNext, fail, listQueue } from '../server/models/downloadQueue.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

// --- Integration coverage against the real runner: resolve, start, and progress polling.
describe('against the real download runner', () => {
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
      maxUploadBytes: 5 * 1024 * 1024,
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

  test('starting a download is accepted and reports its queued entry', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/downloads', payload: { url: OPAQUE, edition: 'ASM' } })

    expect(res.statusCode).toBe(202)
    expect(res.json().queued).toBe(true)
    expect(res.json().entry.url).toBe(OPAQUE)
  })

  test('a download with no url is refused', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/downloads', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  // A page polling this endpoint needs to see a download that is actually in flight, not
  // just the idle shape - so this one drives its own slow fetch rather than the shared
  // instant one, and checks both ends: nothing running before, something running during.
  test('the status endpoint reports progress the page can poll', async () => {
    const idle = await app.inject({ url: '/api/downloads' })
    expect(idle.statusCode).toBe(200)
    expect(idle.json()).toEqual({ active: [], queue: [], history: [] })

    const config = {
      comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'), tmpDir: join(dir, 'tmp'),
      maxUploadBytes: 5 * 1024 * 1024,
    } as Config
    const slowDb = openDb(':memory:')
    const slow = Fastify()
    slow.decorate('db', slowDb)
    slow.decorate('config', config)
    const runner = createDownloadRunner({ db: slowDb, config }, {
      fetchImpl: async () => { await new Promise((r) => setTimeout(r, 20)); return respond(cbzBytes, REDIRECTED) },
    })
    slow.decorate('downloader', runner)
    await slow.register(downloadRoutes)

    await slow.inject({ method: 'POST', url: '/api/downloads', payload: { url: OPAQUE, edition: 'ASM' } })
    const res = await slow.inject({ url: '/api/downloads' })

    expect(res.statusCode).toBe(200)
    expect(res.json().active).toEqual([expect.objectContaining({ fileName: null })])

    // Let the in-flight download actually finish before the db underneath it closes -
    // otherwise its background continuation (wake -> takeNext) races the teardown and
    // throws against a closed connection, an unhandled rejection unrelated to this test.
    await runner.idle()
    await slow.close(); slowDb.close()
  })
})

// --- Route-contract coverage: a stubbed downloader, exercising each route's own logic
// (status shape, enqueue/duplicate mapping, cancel, retry, move, clear) independent of
// the real runner's network and filesystem behavior, which the block above already covers.
async function setup() {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  const cancel = vi.fn(() => true)
  app.decorate('downloader', {
    status: () => ({ active: [], queue: listQueue(db), history: [] }),
    enqueue: (req: { url: string; issueId?: number | string }) =>
      enqueue(db, { url: req.url, cvIssueId: req.issueId == null ? undefined : Number(req.issueId) }),
    cancel,
    wake: vi.fn(),
    idle: async () => {},
  } as never)
  await app.register(downloadRoutes)
  return { app, db, cancel, cleanup: async () => { await app.close() } }
}

test('the status endpoint reports active, queue and history', async () => {
  const t = await setup()
  try {
    const body = (await t.app.inject({ url: '/api/downloads' })).json()
    expect(body).toHaveProperty('active')
    expect(body).toHaveProperty('queue')
    expect(body).toHaveProperty('history')
  } finally { await t.cleanup() }
})

test('a pasted url is queued', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'POST', url: '/api/downloads', payload: { url: 'https://x.test/a' },
    })
    expect(res.statusCode).toBe(202)
    expect(res.json().entry.url).toBe('https://x.test/a')
  } finally { await t.cleanup() }
})

test('a post with no url is refused', async () => {
  const t = await setup()
  try {
    expect((await t.app.inject({ method: 'POST', url: '/api/downloads', payload: {} })).statusCode).toBe(400)
  } finally { await t.cleanup() }
})

test('cancelling asks the runner, which owns the abort', async () => {
  const t = await setup()
  const e = enqueue(t.db, { url: 'https://x.test/a' })
  if (!e.queued) throw new Error('unreachable')
  try {
    const res = await t.app.inject({ method: 'DELETE', url: `/api/downloads/queue/${e.entry.id}` })
    expect(res.statusCode).toBe(200)
    expect(t.cancel).toHaveBeenCalledWith(e.entry.id)
  } finally { await t.cleanup() }
})

test('a failed download can be retried', async () => {
  const t = await setup()
  const e = enqueue(t.db, { url: 'https://x.test/a' })
  if (!e.queued) throw new Error('unreachable')
  takeNext(t.db); fail(t.db, e.entry.id, 'boom')
  try {
    const res = await t.app.inject({ method: 'POST', url: `/api/downloads/queue/${e.entry.id}/retry` })
    expect(res.statusCode).toBe(200)
    expect(listQueue(t.db)).toHaveLength(1)
  } finally { await t.cleanup() }
})

test('moving a row reorders the queue', async () => {
  const t = await setup()
  const a = enqueue(t.db, { url: 'https://x.test/a', label: 'a' })
  enqueue(t.db, { url: 'https://x.test/b', label: 'b' })
  if (!a.queued) throw new Error('unreachable')
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: `/api/downloads/queue/${a.entry.id}`, payload: { index: 1 },
    })
    expect(res.statusCode).toBe(200)
    expect(listQueue(t.db).map((e) => e.label)).toEqual(['b', 'a'])
  } finally { await t.cleanup() }
})

// An index off the end must be refused rather than silently corrupting the order.
test('moving to an index outside the queue is refused', async () => {
  const t = await setup()
  const a = enqueue(t.db, { url: 'https://x.test/a' })
  if (!a.queued) throw new Error('unreachable')
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: `/api/downloads/queue/${a.entry.id}`, payload: { index: 9 },
    })
    expect(res.statusCode).toBe(400)
  } finally { await t.cleanup() }
})

test('clearing history empties the finished rows', async () => {
  const t = await setup()
  const e = enqueue(t.db, { url: 'https://x.test/a' })
  if (!e.queued) throw new Error('unreachable')
  takeNext(t.db); fail(t.db, e.entry.id, 'boom')
  try {
    expect((await t.app.inject({ method: 'DELETE', url: '/api/downloads/history' })).statusCode).toBe(200)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM download_queue').get()).toEqual({ n: 0 })
  } finally { await t.cleanup() }
})

// The model refuses a live duplicate by a partial unique index; the route has to turn that
// into a 409 carrying the entry it collided with, not a 202.
test('queueing the same issue twice is refused with the entry it collided with', async () => {
  const t = await setup()
  try {
    const first = await t.app.inject({
      method: 'POST', url: '/api/downloads',
      payload: { url: 'https://x.test/a', issueId: 4242 },
    })
    expect(first.statusCode).toBe(202)
    const second = await t.app.inject({
      method: 'POST', url: '/api/downloads',
      payload: { url: 'https://x.test/b', issueId: 4242 },
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().entry.id).toBe(first.json().entry.id)
    // Spec §4.4. Without it a client cannot tell this apart from any other 409 without
    // string-matching the message.
    expect(second.json().reason).toBe('duplicate')
  } finally { await t.cleanup() }
})
