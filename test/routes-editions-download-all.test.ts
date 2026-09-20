import { test, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { bulkIssueDownloadsIdle } from '../server/services/bulkIssueDownload.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

const link = (n: string) => `<div class="aio-button-center"><a href="https://dl.test/venom-${n}.cbz">DOWNLOAD NOW</a></div>`

/** The whole run as Comic Vine reports it. #253 is deliberately left unmatchable. */
const RUN = [
  { id: 101, number: '249', coverDate: '2025-09-01' },
  { id: 102, number: '250', coverDate: '2025-10-01' },
  { id: 103, number: '251', coverDate: '2025-11-01' },
  { id: 104, number: '252', coverDate: '2025-12-01' },
  { id: 105, number: '253', coverDate: '2026-01-01' },
]

/** A promise the test resolves by hand, to hold the walk still and look at it. */
function gate() {
  let open!: () => void
  const held = new Promise<void>((resolve) => { open = resolve })
  return { held, open }
}

function server(db: ReturnType<typeof openDb>, unreadable: string[] = [], held?: Promise<void>) {
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) })) as never

  const started: Array<{ url: string; issueId?: number }> = []
  const app = Fastify()
  app.decorate('db', db)
  app.decorate('config', { comicsDir: '/tmp/comics', thumbsDir: '/tmp/thumbs' } as Config)
  setComicVineKey(db, 'k')
  app.decorate('downloader', {
    enqueue(req: unknown) {
      const r = req as { url: string; issueId?: number }
      started.push(r)
      return { queued: true, entry: { id: started.length, position: 0, state: 'queued', url: r.url, attempts: 0, queuedAt: 'now' } }
    },
    status() { return { active: [], queue: [], history: [] } },
    cancel: vi.fn(),
    wake: vi.fn(),
  } as never)

  const fetched: string[] = []
  const fetchPage = async (url: string) => {
    fetched.push(url)
    if (held) await held
    const number = url.split('/').pop()!
    if (unreadable.includes(number)) throw new Error('nope')
    return link(number)
  }
  return { app, started, fetched, fetchPage }
}

function seed(db: ReturnType<typeof openDb>) {
  const edition = upsertEdition(db, { name: 'Venom (2025)', folder: 'Venom/Venom (2025)', seriesName: 'Venom' })
  updateEdition(db, edition.id, { comicvineId: 167333, cvName: 'Venom' })
  cacheVolumeIssues(db, 167333, RUN, '2026-09-13T00:00:00.000Z')

  // #249 is already in the library, so it is not missing.
  const owned = insertBook(db, {
    editionId: edition.id, filePath: 'Venom/Venom (2025)/venom_249.cbz', pageCount: 20, fileSize: 1,
  })!
  updateBook(db, owned.id, { number: '249', comicvineId: 101 })

  // A scraped release for #250, #251 and #252. Nothing for #253: a gap the rule cannot
  // close is a gap the button must not guess at.
  const row = db.prepare(
    'INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)',
  )
  for (const number of ['250', '251', '252']) {
    row.run(`Venom #${number} (2025)`, `https://x.test/post/${number}`, 'Marvel Comics', number, 2025, '2026-09-13T00:00:00.000Z')
  }
  return { edition }
}

afterEach(async () => { await bulkIssueDownloadsIdle() })

test('one press queues every missing issue the index can supply', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/download-all` })
  await bulkIssueDownloadsIdle()

  expect(res.statusCode).toBe(202)
  expect(started.map((s) => s.issueId)).toEqual([102, 103, 104])
  await app.close(); db.close()
})

// Pressing 29 must not mean waiting out 29 posts before the page says anything. The walk
// is held on its first post here, so an answer that arrives anyway is an answer that did
// not wait for the work - which is what lets you press it and walk away.
test('the answer counts the issues before the work is done', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const walk = gate()
  const { app, started, fetchPage } = server(db, [], walk.held)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/download-all` })

  expect(res.json()).toEqual({ queued: 3 })
  expect(started).toEqual([])

  walk.open()
  await bulkIssueDownloadsIdle()
  expect(started).toHaveLength(3)
  await app.close(); db.close()
})

test('a comic you already have is not fetched again', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/download-all` })
  await bulkIssueDownloadsIdle()

  expect(started.map((s) => s.issueId)).not.toContain(101)
  await app.close(); db.close()
})

// The same rule that decides whether a tile shows Get or Find. Get all takes the Gets;
// a gap several releases could fill is left for you to choose by eye.
test('an issue no single release can be is left alone', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/download-all` })
  await bulkIssueDownloadsIdle()

  expect(started.map((s) => s.issueId)).not.toContain(105)
  await app.close(); db.close()
})

// Twenty-nine issues is twenty-nine posts on someone else's site, and one of them being
// down is not a reason to abandon the other twenty-eight.
test('a post that cannot be read costs that issue and no other', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db, ['251'])
  await app.register(editionRoutes, { fetchPage })

  await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/download-all` })
  await bulkIssueDownloadsIdle()

  expect(started.map((s) => s.issueId)).toEqual([102, 104])
  await app.close(); db.close()
})

// A double-click must not walk the run twice: the second walk would fetch every post a
// second time to be told each one is already queued.
test('a second press while the first is still walking is refused', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const walk = gate()
  const { app, fetched, fetchPage } = server(db, [], walk.held)
  await app.register(editionRoutes, { fetchPage })

  const first = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/download-all` })
  const second = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/download-all` })

  expect(first.statusCode).toBe(202)
  expect(second.statusCode).toBe(409)

  walk.open()
  await bulkIssueDownloadsIdle()
  // Three posts for three issues: the refused press cost the site nothing.
  expect(fetched).toHaveLength(3)
  await app.close(); db.close()
})

test('a volume with nothing to get queues nothing', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Knull (2026)', folder: 'Knull', seriesName: 'Knull' })
  updateEdition(db, edition.id, { comicvineId: 999, cvName: 'Knull' })
  cacheVolumeIssues(db, 999, [{ id: 501, number: '1', coverDate: '2026-01-01' }], '2026-09-13T00:00:00.000Z')
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/download-all` })
  await bulkIssueDownloadsIdle()

  expect(res.json()).toEqual({ queued: 0 })
  expect(started).toEqual([])
  await app.close(); db.close()
})

test('an edition with no Comic Vine volume has no run to walk', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Loose ends', folder: 'Loose' })
  const { app, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/download-all` })

  expect(res.statusCode).toBe(404)
  await app.close(); db.close()
})
