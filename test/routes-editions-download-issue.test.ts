import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import type { Config } from '../server/config.js'

const POST_HTML = '<div class="aio-button-center"><a href="https://dl.test/venom-250.cbz">DOWNLOAD NOW</a></div>'

/** Every Comic Vine url the server asks for, so the no-search invariant is testable. */
let cvUrls: string[] = []

function server(db: ReturnType<typeof openDb>, html: string | null = POST_HTML, alreadyQueued = false) {
  cvUrls = []
  globalThis.fetch = (async (url: string) => {
    cvUrls.push(String(url))
    return { ok: true, json: async () => ({ results: [] }) }
  }) as never

  const started: unknown[] = []
  const app = Fastify()
  app.decorate('db', db)
  app.decorate('config', { comicsDir: '/tmp/comics', thumbsDir: '/tmp/thumbs', comicVineApiKey: 'k' } as Config)
  app.decorate('downloader', {
    enqueue(req: unknown) {
      started.push(req)
      const { url } = req as { url: string }
      const entry = { id: 1, position: 0, state: 'queued', url, attempts: 0, queuedAt: new Date().toISOString() }
      return alreadyQueued ? { queued: false, duplicate: entry } : { queued: true, entry }
    },
    status() { return { active: [], queue: [], history: [] } },
    // Nothing calls these yet - Task 4/5 add the routes that do. A stub missing a method
    // fails with a confusing "is not a function" rather than a useful assertion.
    cancel: vi.fn(),
    wake: vi.fn(),
  } as never)
  return { app, started, fetchPage: async () => { if (html === null) throw new Error('nope'); return html } }
}

function seed(db: ReturnType<typeof openDb>) {
  const edition = upsertEdition(db, { name: 'Venom (2025)', folder: 'Venom/Venom (2025)', seriesName: 'Venom' })
  updateEdition(db, edition.id, { comicvineId: 167333, cvName: 'Venom' })
  cacheVolumeIssues(db, 167333, [{ id: 1136140, number: '250', coverDate: '2025-12-01' }], '2026-09-13T00:00:00.000Z')
  const indexId = db.prepare(
    "INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)"
  ).run('Venom #250 (2025)', 'https://x.test/post/250', 'Marvel Comics', '250', 2025, '2026-09-13T00:00:00.000Z').lastInsertRowid as number
  return { edition, indexId }
}

test('pressing get starts the download in this edition, for this issue', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(res.statusCode).toBe(202)
  expect(started).toEqual([
    { url: 'https://dl.test/venom-250.cbz', edition: 'Venom (2025)', issueId: 1136140, label: 'Venom #250' },
  ])
  await app.close(); db.close()
})

// The invariant from spec §4.3.1. A name-based search cannot identify an issue of a
// relaunched title; searching Comic Vine for "Captain America #4" does not return the
// 2025 issue at all. This path knows the id, and must never fall back to searching.
test('pressing get never searches Comic Vine by name', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(cvUrls.filter((u) => u.includes('/search/'))).toEqual([])
  await app.close(); db.close()
})

test('a match that has become ambiguous refuses rather than guessing', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  db.prepare("INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)")
    .run('Venom #250 (2026)', 'https://x.test/post/250b', 'Marvel Comics', '250', 2026, '2026-09-13T00:00:00.000Z')
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(res.statusCode).toBe(409)
  // Two different things are 409 here. Only `reason` tells them apart.
  expect(res.json().reason).toBe('no-match')
  expect(started).toEqual([])
  await app.close(); db.close()
})

// Spec §4.4: the queue refuses a second copy of an issue it already holds, and says which
// kind of 409 that is - the same status an ambiguous match returns.
test('an issue already in the queue is refused as a duplicate, and says so', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, fetchPage } = server(db, POST_HTML, true)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(res.statusCode).toBe(409)
  expect(res.json().reason).toBe('duplicate')
  expect(res.json().entry.id).toBe(1)
  await app.close(); db.close()
})

test('an issue that is not in this volume is not downloadable from it', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/999999/download` })

  expect(res.statusCode).toBe(404)
  expect(started).toEqual([])
  await app.close(); db.close()
})

test('a post with no direct link says so rather than starting nothing', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db, '<p>mirrors only</p>')
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(res.statusCode).toBe(404)
  expect(started).toEqual([])
  await app.close(); db.close()
})

test('an edition with no volume has nothing to download against', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Unsorted', folder: 'Unsorted' })
  const { app, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(res.statusCode).toBe(404)
  await app.close(); db.close()
})
