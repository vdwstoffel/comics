import { test, expect } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import type { Config } from '../server/config.js'

// Venom (2025) as Comic Vine actually lists it: legacy numbering, #250 up.
const VOLUME_ISSUES = [
  { id: 1136140, issue_number: '250', name: 'Naked and Afraid', cover_date: '2025-12-01', site_detail_url: 'https://cv/250' },
  { id: 1143327, issue_number: '251', name: null, cover_date: '2026-01-01', site_detail_url: 'https://cv/251' },
  { id: 1159231, issue_number: '255', name: 'Death Spiral, Part 3 of 9', cover_date: '2026-05-01', site_detail_url: 'https://cv/255' },
]

let cvCalls = 0

function stubCv(issues: unknown[] = VOLUME_ISSUES, ok = true) {
  cvCalls = 0
  globalThis.fetch = (async () => {
    cvCalls++
    if (!ok) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, json: async () => ({ number_of_total_results: issues.length, results: issues }) }
  }) as never
}

async function app(db: ReturnType<typeof openDb>) {
  const server = Fastify()
  server.decorate('db', db)
  server.decorate('config', { comicsDir: '/tmp/comics', thumbsDir: '/tmp/thumbs', comicVineApiKey: 'k' } as Config)
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
