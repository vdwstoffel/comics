import { test, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import comicvineRoutes from '../server/routes/comicvine.js'
import { openDb } from '../server/db.js'
import type { Db } from '../server/types.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setComicVineKey } from '../server/models/settings.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import type { Config } from '../server/config.js'

const VOLUME_ID = 42
const VOLUME = { id: VOLUME_ID, name: 'Avengers', start_year: '2013', publisher: { name: 'Marvel' } }
const CV_ISSUES = [
  { id: 1001, issue_number: '20', name: 'Infinity', cover_date: '2013-08-01' },
  { id: 1002, issue_number: '21', name: null, cover_date: '2013-09-01' },
]

let db: Db
let server: ReturnType<typeof Fastify>
let origFetch: typeof fetch
let failVolumeIssues = false
let startYear = '2013'

function seedEdition(name: string, comicvineId?: number) {
  const ed = upsertEdition(db, { name, folder: `zz-test/${name}`, seriesName: name })
  if (comicvineId != null) updateEdition(db, ed.id, { comicvineId })
  return ed
}

function seedBook(editionId: number, file: string, cvId?: number) {
  const book = insertBook(db, {
    editionId, filePath: `zz-test/${file}`, pageCount: 1, fileSize: 1,
  })!
  if (cvId != null) updateBook(db, book.id, { comicvineId: cvId })
  return book
}

beforeEach(async () => {
  db = openDb(':memory:')
  setComicVineKey(db, 'k')
  failVolumeIssues = false
  startYear = '2013'
  origFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    const u = String(url)
    if (u.includes('/issues/')) {
      if (failVolumeIssues) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => ({ status_code: 1, number_of_total_results: CV_ISSUES.length, results: CV_ISSUES }) }
    }
    return { ok: true, json: async () => ({ status_code: 1, results: { ...VOLUME, start_year: startYear } }) }
  }) as unknown as typeof fetch

  server = Fastify()
  server.decorate('db', db)
  server.decorate('config', {} as Config)
  await server.register(comicvineRoutes)
})

afterEach(async () => {
  globalThis.fetch = origFetch
  await server.close()
  db.close()
})

const get = (id: number | string = VOLUME_ID) =>
  server.inject({ method: 'GET', url: `/api/comicvine/volumes/${id}/issues` })

test('a fresh list is read from Comic Vine and reported in order', async () => {
  const res = await get()
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.volumeId).toBe(VOLUME_ID)
  expect(body.issues.map((i: { id: number }) => i.id)).toEqual([1001, 1002])
  expect(body.issues[0]).toMatchObject({ number: '20', name: 'Infinity', owned: false })
})

test('a cached list is served without asking Comic Vine again', async () => {
  await get()
  let calls = 0
  globalThis.fetch = (async () => { calls++; throw new Error('should not be called') }) as unknown as typeof fetch
  const res = await get()
  expect(res.statusCode).toBe(200)
  expect(res.json().issues).toHaveLength(2)
  expect(calls).toBe(0)
})

test('a stale list is served with stale:true when Comic Vine will not answer', async () => {
  await get()
  db.prepare("UPDATE volume_cache SET fetched_at = '2020-01-01T00:00:00.000Z'").run()
  failVolumeIssues = true
  const res = await get()
  expect(res.json().stale).toBe(true)
  expect(res.json().issues).toHaveLength(2)
})

test('unavailable:true when Comic Vine will not answer and nothing is held', async () => {
  failVolumeIssues = true
  const res = await get()
  expect(res.statusCode).toBe(200)
  expect(res.json().unavailable).toBe(true)
  expect(res.json().issues).toEqual([])
})

test('an empty issue list is a 200 with no issues, not an error', async () => {
  cacheVolumeIssues(db, VOLUME_ID, [])
  const res = await get()
  expect(res.statusCode).toBe(200)
  expect(res.json().issues).toEqual([])
})

// Owned is library-wide: before a bulk add there may be no edition for this volume at
// all, and the user may hold issues of it filed anywhere.
test('owned is resolved across the whole library, not one edition', async () => {
  const other = seedEdition('Unsorted')
  seedBook(other.id, 'stray.cbz', 1001)

  const body = (await get()).json()
  expect(body.issues[0]).toMatchObject({ owned: true })
  expect(body.issues[1].owned).toBe(false)
})

test('ownedIn names the edition the copy actually lives in', async () => {
  const other = seedEdition('Unsorted')
  const book = seedBook(other.id, 'stray.cbz', 1001)

  const body = (await get()).json()
  expect(body.issues[0].bookId).toBe(book.id)
  expect(body.issues[0].ownedIn).toEqual({ editionId: other.id, editionName: 'Unsorted' })
})

test('a copy of a different volume\'s issue does not mark this one owned', async () => {
  const other = seedEdition('Unsorted')
  seedBook(other.id, 'stray.cbz', 999999)
  const body = (await get()).json()
  expect(body.issues.every((i: { owned: boolean }) => !i.owned)).toBe(true)
})

test('editionName reuses an existing edition for this volume, under its own name', async () => {
  const ed = seedEdition('The Avengers', VOLUME_ID)
  const body = (await get()).json()
  expect(body.edition).toEqual({ id: ed.id, name: 'The Avengers' })
  expect(body.editionName).toBe('The Avengers')
})

test('editionName composes "name (year)" when the library has no edition for it', async () => {
  const body = (await get()).json()
  expect(body.edition).toBe(null)
  expect(body.editionName).toBe('Avengers (2013)')
})

// The live library's Halloween Special shape: cv_start_year 0 would compose "… (0)" and
// file a batch into a second edition beside the one that already holds it.
test('editionName is the bare name when the volume has no usable start year', async () => {
  startYear = '0'
  const body = (await get()).json()
  expect(body.editionName).toBe('Avengers')
  expect(body.volume).toEqual({ name: 'Avengers', startYear: 0 })
})

test('no Comic Vine key is a 400', async () => {
  setComicVineKey(db, '')
  expect((await get()).statusCode).toBe(400)
})

test('a volume id that is not a number is a 404', async () => {
  expect((await get('nonsense')).statusCode).toBe(404)
})
