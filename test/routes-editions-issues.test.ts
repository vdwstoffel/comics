import { test, expect } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

// Venom (2025) as Comic Vine actually lists it: legacy numbering, #250 up.
const VOLUME_ISSUES = [
  { id: 1136140, issue_number: '250', name: 'Naked and Afraid', cover_date: '2025-12-01', site_detail_url: 'https://cv/250' },
  { id: 1143327, issue_number: '251', name: null, cover_date: '2026-01-01', site_detail_url: 'https://cv/251' },
  { id: 1159231, issue_number: '255', name: 'Death Spiral, Part 3 of 9', cover_date: '2026-05-01', site_detail_url: 'https://cv/255' },
]

/** Reads of the issue list. Counted apart from volume reads, which are a separate
 *  question: the issue list is the expensive, paged one these tests are about. */
let cvCalls = 0
/** Reads of the volume record, which the route makes once to learn its Comic Vine link. */
let cvVolumeCalls = 0

const VOLUME_RECORD = {
  name: 'Venom', start_year: '2025',
  site_detail_url: 'https://comicvine.gamespot.com/venom/4050-167333/',
}

function stubCv(issues: unknown[] = VOLUME_ISSUES, ok = true) {
  cvCalls = 0
  cvVolumeCalls = 0
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/volume/')) {
      cvVolumeCalls++
      return { ok: true, json: async () => ({ results: VOLUME_RECORD }) }
    }
    cvCalls++
    if (!ok) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, json: async () => ({ number_of_total_results: issues.length, results: issues }) }
  }) as never
}

async function app(db: ReturnType<typeof openDb>, opts: { apiKey?: string } = {}) {
  const { apiKey = 'k' } = opts
  const server = Fastify()
  server.decorate('db', db)
  server.decorate('config', { comicsDir: '/tmp/comics', thumbsDir: '/tmp/thumbs' } as Config)
  if (apiKey) setComicVineKey(db, apiKey)
  await server.register(editionRoutes)
  return server
}

function seedVenom(db: ReturnType<typeof openDb>) {
  const edition = upsertEdition(db, { name: 'Venom (2025)', folder: 'Venom/Venom (2025)', seriesName: 'Venom' })
  updateEdition(db, edition.id, { comicvineId: 167333 })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Venom/Venom (2025)/255.cbz', pageCount: 20, fileSize: 100 })!
  updateBook(db, book.id, { comicvineId: 1159231, number: '255' })
  return { edition, book }
}

test('an edition reports which of its volume issues it has and which it is missing', async () => {
  const db = openDb(':memory:')
  const { edition, book } = seedVenom(db)
  stubCv()
  const server = await app(db)

  const res = await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.issues.map((i: { number: string; owned: boolean }) => [i.number, i.owned]))
    .toEqual([['250', false], ['251', false], ['255', true]])
  expect(body.issues.find((i: { number: string }) => i.number === '255').bookId).toBe(book.id)
  expect(body).toMatchObject({ owned: 1, total: 3 })
  await server.close(); db.close()
})

// A comic you own must never vanish because Comic Vine has not heard of it.
test('a book with no Comic Vine match still appears, as an extra', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  const loose = insertBook(db, { editionId: edition.id, filePath: 'Venom/Venom (2025)/annual.cbz', pageCount: 5, fileSize: 50 })!
  updateBook(db, loose.id, { number: 'Annual 1' })
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(body.extras.map((b: { bookId: number }) => b.bookId)).toEqual([loose.id])
  expect(body.owned).toBe(1)
  await server.close(); db.close()
})

// The other half of the guard at editions.ts:122 - a volume is matched, but no key is
// configured. Every other suite here seeds a key unconditionally, so this half never
// fired without a test that withholds one on purpose.
//
// `unavailable` is what makes this test bite. Deleting the key clause leaves the shape
// almost identical: the client throws before it fetches, so nothing is requested either
// way and the route's own catch answers with the same empty list. The difference is that
// the catch flags the day unavailable - Comic Vine was asked and could not answer -
// where the guard says only that there is nothing to show.
test('an edition with a Comic Vine volume but no key configured degrades quietly', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  let called = false
  globalThis.fetch = (async () => { called = true; return { ok: true, json: async () => ({}) } }) as never
  const server = await app(db, { apiKey: '' })

  const res = await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })

  expect(res.statusCode).toBe(200)
  expect(called).toBe(false)
  expect(res.json()).toMatchObject({ issues: [], owned: 0, total: 0 })
  expect(res.json().unavailable).toBeUndefined()
  await server.close(); db.close()
})

// The guard short-circuits before the cache is consulted, so an unconfigured install
// shows nothing even where it holds a perfectly good list. Recorded as a test because it
// is the behaviour, not because it is obviously the right one: serving what we already
// hold would arguably be kinder, and that choice should be made deliberately rather than
// discovered by deleting a clause.
test('no key configured shows nothing even when a fresh issue list is cached', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  cacheVolumeIssues(db, 167333, [{ id: 1136140, number: '250' }], new Date().toISOString())
  const server = await app(db, { apiKey: '' })

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(body.issues).toEqual([])
  await server.close(); db.close()
})

test('an edition with no Comic Vine volume asks Comic Vine nothing', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Unsorted', folder: 'Unsorted' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Unsorted/x.cbz', pageCount: 1, fileSize: 1 })!
  let called = false
  globalThis.fetch = (async () => { called = true; return { ok: true, json: async () => ({}) } }) as never
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(called).toBe(false)
  expect(body.issues).toEqual([])
  expect(body.extras.map((b: { bookId: number }) => b.bookId)).toEqual([book.id])
  await server.close(); db.close()
})

// A missing-issues feature must never stop you reading what you already have.
test('a Comic Vine failure still reports the books you own', async () => {
  const db = openDb(':memory:')
  const { edition, book } = seedVenom(db)
  stubCv([], false)
  const server = await app(db)

  const res = await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.issues).toEqual([])
  expect(body.unavailable).toBe(true)
  expect(body.extras.map((b: { bookId: number }) => b.bookId)).toEqual([book.id])
  await server.close(); db.close()
})

// ---- caching ----

test('a second view of the same edition asks Comic Vine nothing', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  stubCv()
  const server = await app(db)

  const first = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()
  const second = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(cvCalls).toBe(1)
  expect(cvVolumeCalls).toBe(1)
  expect(second.issues.map((i: { number: string }) => i.number)).toEqual(first.issues.map((i: { number: string }) => i.number))
  expect(second.fetchedAt).toBe(first.fetchedAt)
  await server.close(); db.close()
})

test('refresh=1 reads Comic Vine again even when the cache is fresh', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  stubCv()
  const server = await app(db)

  await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })
  await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues?refresh=1` })

  expect(cvCalls).toBe(2)
  await server.close(); db.close()
})

test('a cache older than a day is read again', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  cacheVolumeIssues(db, 167333, [{ id: 1136140, number: '250' }], '2020-01-01T00:00:00.000Z')
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(cvCalls).toBe(1)
  expect(body.issues).toHaveLength(3)
  await server.close(); db.close()
})

// A day-old list beats no list at all, and we already hold it.
test('a Comic Vine failure serves the stale cache rather than nothing', async () => {
  const db = openDb(':memory:')
  const { edition, book } = seedVenom(db)
  cacheVolumeIssues(db, 167333, [
    { id: 1136140, number: '250', siteUrl: 'https://cv/250' },
    { id: 1159231, number: '255', siteUrl: 'https://cv/255' },
  ], '2020-01-01T00:00:00.000Z')
  stubCv([], false)
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(body.issues.map((i: { number: string; owned: boolean }) => [i.number, i.owned]))
    .toEqual([['250', false], ['255', true]])
  expect(body.stale).toBe(true)
  expect(body.fetchedAt).toBe('2020-01-01T00:00:00.000Z')
  expect(body.issues.find((i: { number: string }) => i.number === '255').bookId).toBe(book.id)
  await server.close(); db.close()
})

/* ── The link to the volume on Comic Vine ──────────────────────────────────── */

/** Comic Vine answering both the issue list and the volume record behind it. */
function stubCvWithVolume(siteUrl: string | null = 'https://comicvine.gamespot.com/venom/4050-167333/') {
  cvCalls = 0
  let volumeCalls = 0
  globalThis.fetch = (async (url: string) => {
    cvCalls++
    if (String(url).includes('/volume/')) {
      volumeCalls++
      return { ok: true, json: async () => ({ results: {
        name: 'Venom', start_year: '2025',
        ...(siteUrl === null ? {} : { site_detail_url: siteUrl }),
      } }) }
    }
    return { ok: true, json: async () => ({ number_of_total_results: VOLUME_ISSUES.length, results: VOLUME_ISSUES }) }
  }) as never
  return { volumeCalls: () => volumeCalls }
}

test('an edition matched before the link was recorded picks it up on first view', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  stubCvWithVolume()
  const server = await app(db)

  const res = await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })

  expect(res.json().siteUrl).toBe('https://comicvine.gamespot.com/venom/4050-167333/')
  await server.close()
  db.close()
})

test('the link is remembered, so a second view does not ask Comic Vine for it again', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  const cv = stubCvWithVolume()
  const server = await app(db)

  await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })
  const before = cv.volumeCalls()
  const second = await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })

  expect(before).toBe(1)
  expect(cv.volumeCalls()).toBe(1)
  expect(second.json().siteUrl).toBe('https://comicvine.gamespot.com/venom/4050-167333/')
  await server.close()
  db.close()
})

test('a link already held is served without asking Comic Vine for the volume at all', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { cvSiteUrl: 'https://comicvine.gamespot.com/venom/4050-167333/' })
  const cv = stubCvWithVolume()
  const server = await app(db)

  const res = await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })

  expect(cv.volumeCalls()).toBe(0)
  expect(res.json().siteUrl).toBe('https://comicvine.gamespot.com/venom/4050-167333/')
  await server.close()
  db.close()
})

test('a volume lookup that fails does not take the issue list down with it', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  cvCalls = 0
  globalThis.fetch = (async (url: string) => {
    cvCalls++
    if (String(url).includes('/volume/')) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, json: async () => ({ number_of_total_results: VOLUME_ISSUES.length, results: VOLUME_ISSUES }) }
  }) as never
  const server = await app(db)

  const res = await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })

  expect(res.statusCode).toBe(200)
  expect(res.json().total).toBe(3)
  expect(res.json().siteUrl).toBeNull()
  await server.close()
  db.close()
})

test('an edition with no volume has no link to offer', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Loose ends', folder: 'Loose ends' })
  stubCvWithVolume()
  const server = await app(db)

  const res = await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })

  expect(res.json().siteUrl).toBeNull()
  await server.close()
  db.close()
})

test('resolving an edition volume records the link to it', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { comicvineId: null })
  cvCalls = 0
  globalThis.fetch = (async (url: string) => {
    cvCalls++
    if (String(url).includes('/volume/')) {
      return { ok: true, json: async () => ({ results: {
        name: 'Venom', start_year: '2025',
        site_detail_url: 'https://comicvine.gamespot.com/venom/4050-167333/',
      } }) }
    }
    return { ok: true, json: async () => ({ results: { name: 'Naked and Afraid', volume: { id: 167333 } } }) }
  }) as never
  const server = await app(db)

  await server.inject({ method: 'POST', url: `/api/editions/${edition.id}/comicvine-volume` })

  const { getEdition } = await import('../server/models/editions.js')
  expect(getEdition(db, edition.id)?.cvSiteUrl).toBe('https://comicvine.gamespot.com/venom/4050-167333/')
  await server.close()
  db.close()
})

/* ── matching missing issues to the scraped index ──────────────────────────── */

/** Put a scraped row in the index. Titles are what the rule reads, so they are real ones. */
function indexRow(db: ReturnType<typeof openDb>, title: string, number: string | null, year: number | null) {
  return db.prepare(
    "INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)"
  ).run(title, `https://x.test/${title}`, 'Marvel Comics', number, year, '2026-09-13T00:00:00.000Z').lastInsertRowid as number
}

test('a missing issue with one possible scraped row carries that match', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { cvName: 'Venom' })
  const rowId = indexRow(db, 'Venom #250 (2025)', '250', 2025)
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  const issue = body.issues.find((i: { number: string }) => i.number === '250')
  expect(issue.match).toEqual({ indexId: rowId, title: 'Venom #250 (2025)' })
  await server.close(); db.close()
})

test('a missing issue with two possible rows carries no match', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { cvName: 'Venom' })
  indexRow(db, 'Venom #250 (2025)', '250', 2025)
  indexRow(db, 'Venom #250 (2026)', '250', 2026)
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(body.issues.find((i: { number: string }) => i.number === '250').match).toBeNull()
  await server.close(); db.close()
})

test('an issue you own is not matched against the index', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { cvName: 'Venom' })
  indexRow(db, 'Venom #255 (2026)', '255', 2026)
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  const owned = body.issues.find((i: { number: string }) => i.number === '255')
  expect(owned.owned).toBe(true)
  expect(owned.match).toBeUndefined()
  await server.close(); db.close()
})

// cvName is Comic Vine's name for the volume. Without it there is nothing trustworthy
// to key on - the edition's own name may be "Vol 7" or "Unsorted".
test('an edition with no Comic Vine name matches nothing', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { cvName: null })
  indexRow(db, 'Venom #250 (2025)', '250', 2025)
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(body.issues.find((i: { number: string }) => i.number === '250').match).toBeNull()
  await server.close(); db.close()
})
