import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import editionRoutes from '../server/routes/editions.js'
import booksRoutes from '../server/routes/books.js'
import libraryRoutes from '../server/routes/library.js'
import { upsertEdition, updateEdition, getEdition } from '../server/models/editions.js'
import { insertBook, getBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rt-'))
  const config = {
    comicsDir: join(dir, 'comics'),
    thumbsDir: join(dir, 'thumbs'),
  } as Config
  mkdirSync(config.comicsDir, { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(editionRoutes)
  await app.register(booksRoutes)
  await app.register(libraryRoutes)
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('PATCH /api/editions/:id renames the edition', async () => {
  // Set up an edition with a book on disk
  const srcDir = join(app.config.comicsDir, 'OldName')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue.cbz')
  const edition = upsertEdition(app.db, { name: 'OldName', folder: 'OldName' })
  insertBook(app.db, { editionId: edition.id, filePath: 'OldName/issue.cbz', pageCount: 1, fileSize: 100 })

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/editions/${edition.id}`,
    payload: { name: 'NewName' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().edition.name).toBe('NewName')
})

test('PATCH /api/editions/:id 400 on blank name', async () => {
  const edition = upsertEdition(app.db, { name: 'Test', folder: 'Test' })
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/editions/${edition.id}`,
    payload: { name: '   ' },
  })
  expect(res.statusCode).toBe(400)
})

test('PATCH /api/editions/:id 404 on a missing edition', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/editions/99999',
    payload: { name: 'Something' },
  })
  expect(res.statusCode).toBe(404)
})

test('PUT /api/books/:id/edition moves the book to the named edition', async () => {
  const srcDir = join(app.config.comicsDir, 'Source')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue.cbz')
  const edition = upsertEdition(app.db, { name: 'Source', folder: 'Source' })
  const book = insertBook(app.db, { editionId: edition.id, filePath: 'Source/issue.cbz', pageCount: 1, fileSize: 100 })!

  const res = await app.inject({
    method: 'PUT',
    url: `/api/books/${book.id}/edition`,
    payload: { name: 'Target' },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.book.filePath).toBe('Target/issue.cbz')
  expect(body.edition.name).toBe('Target')
})

test('PUT /api/books/:id/edition 400 on blank name', async () => {
  const edition = upsertEdition(app.db, { name: 'S', folder: 'S' })
  const book = insertBook(app.db, { editionId: edition.id, filePath: 'S/a.cbz', pageCount: 1, fileSize: 100 })!
  const res = await app.inject({
    method: 'PUT',
    url: `/api/books/${book.id}/edition`,
    payload: { name: '' },
  })
  expect(res.statusCode).toBe(400)
})

test('PUT /api/books/:id/series 404 on missing book', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/books/99999/series',
    payload: { name: 'Target' },
  })
  expect(res.statusCode).toBe(404)
})

test('GET /api/publishers returns distinct publishers with counts', async () => {
  const marvel1 = upsertEdition(app.db, { name: 'X-Men', folder: 'X-Men' })
  const marvel2 = upsertEdition(app.db, { name: 'Spider-Man', folder: 'Spider-Man' })
  const dc = upsertEdition(app.db, { name: 'Batman', folder: 'Batman' })
  upsertEdition(app.db, { name: 'Unknown', folder: 'Unknown' })
  updateEdition(app.db, marvel1.id, { publisher: 'Marvel' })
  updateEdition(app.db, marvel2.id, { publisher: 'Marvel' })
  updateEdition(app.db, dc.id, { publisher: 'DC' })
  // 'Unknown' series left without publisher

  const res = await app.inject({ url: '/api/publishers' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { publishers: Array<{ name: string; count: number }> }
  // Should have exactly 2 publishers (null excluded)
  expect(body.publishers).toHaveLength(2)
  // Ordered by name: DC first, then Marvel
  expect(body.publishers[0]).toMatchObject({ name: 'DC', count: 1 })
  expect(body.publishers[1]).toMatchObject({ name: 'Marvel', count: 2 })
})

test('GET /api/editions?publisher=X filters by publisher', async () => {
  const marvel = upsertEdition(app.db, { name: 'X-Men', folder: 'X-Men' })
  const dc = upsertEdition(app.db, { name: 'Batman', folder: 'Batman' })
  updateEdition(app.db, marvel.id, { publisher: 'Marvel' })
  updateEdition(app.db, dc.id, { publisher: 'DC' })

  const res = await app.inject({ url: '/api/editions?publisher=Marvel' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { editions: Array<{ name: string }> }
  expect(body.editions).toHaveLength(1)
  expect(body.editions[0].name).toBe('X-Men')
})

test('GET /api/editions?publisher=__unknown__ returns null-publisher editions', async () => {
  const marvel = upsertEdition(app.db, { name: 'X-Men', folder: 'X-Men' })
  upsertEdition(app.db, { name: 'Mystery', folder: 'Mystery' })
  updateEdition(app.db, marvel.id, { publisher: 'Marvel' })
  // 'Mystery' intentionally left without a publisher

  const res = await app.inject({ url: '/api/editions?publisher=__unknown__' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { editions: Array<{ name: string }> }
  expect(body.editions).toHaveLength(1)
  expect(body.editions[0].name).toBe('Mystery')
})

test('GET /api/editions (no param) returns all editions', async () => {
  const marvel = upsertEdition(app.db, { name: 'X-Men', folder: 'X-Men' })
  const dc = upsertEdition(app.db, { name: 'Batman', folder: 'Batman' })
  updateEdition(app.db, marvel.id, { publisher: 'Marvel' })
  updateEdition(app.db, dc.id, { publisher: 'DC' })

  const res = await app.inject({ url: '/api/editions' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { editions: Array<{ name: string }> }
  expect(body.editions).toHaveLength(2)
})

/** Pin a book's read timestamp so ordering assertions are deterministic. */

/** An edition folder on disk with `count` real issues in it. */
async function seedOnDisk(name: string, count: number) {
  const folder = join(app.config.comicsDir, name)
  mkdirSync(folder, { recursive: true })
  const edition = upsertEdition(app.db, { name, folder: name })
  const books = []
  for (let i = 1; i <= count; i++) {
    await makeCbz(folder, ['p1.png'], `${i}.cbz`)
    books.push(insertBook(app.db, {
      editionId: edition.id, filePath: `${name}/${i}.cbz`, pageCount: 1, fileSize: 100,
    })!)
  }
  return { edition, books, folder }
}

test('DELETE /api/books/:id removes the issue and its file', async () => {
  const { books, folder } = await seedOnDisk('Saga', 2)

  const res = await app.inject({ method: 'DELETE', url: `/api/books/${books[0].id}` })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ deleted: true, editionRemoved: false })
  expect(existsSync(join(folder, '1.cbz'))).toBe(false)
  expect(existsSync(join(folder, '2.cbz'))).toBe(true)
})

test('DELETE /api/books/:id reports the edition going with its last issue', async () => {
  const { edition, books } = await seedOnDisk('One Shot', 1)

  const res = await app.inject({ method: 'DELETE', url: `/api/books/${books[0].id}` })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ deleted: true, editionId: edition.id, editionRemoved: true })
})

test('DELETE /api/books/:id 404s on an unknown issue', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/books/99999' })
  expect(res.statusCode).toBe(404)
  // Assert the handler's own body - an unregistered route 404s too, and would pass a
  // bare status check without the route existing at all.
  expect(res.json()).toEqual({ error: 'book not found' })
})

test('DELETE /api/editions/:id removes the edition, its issues and its folder', async () => {
  const { edition, books, folder } = await seedOnDisk('Saga', 3)

  const res = await app.inject({ method: 'DELETE', url: `/api/editions/${edition.id}` })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ deleted: true, books: 3 })
  expect(existsSync(folder)).toBe(false)
  expect(getEdition(app.db, edition.id)).toBeUndefined()
  expect(getBook(app.db, books[0].id)).toBeUndefined()
})

test('DELETE /api/editions/:id 404s on an unknown edition', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/editions/99999' })
  expect(res.statusCode).toBe(404)
  expect(res.json()).toEqual({ error: 'edition not found' })
})

/** Seed one flat edition ('Vol 7') that reorganize should nest under its series. */
async function seedFlatEdition() {
  const flat = join(app.config.comicsDir, 'Vol 7')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '001.cbz')
  const edition = upsertEdition(app.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(app.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  insertBook(app.db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 100 })
  return { flat }
}

// Dry-run is the only thing standing between a user's library and an unrequested mass
// move, so every body shape that isn't an explicit dryRun:false must stay a dry run.
test.each([
  ['no body at all', undefined],
  ['an empty body', {}],
  ['an explicit dryRun:true', { dryRun: true }],
])('POST /api/library/reorganize dry-runs by default (%s)', async (_label, payload) => {
  const { flat } = await seedFlatEdition()

  const res = await app.inject({ method: 'POST', url: '/api/library/reorganize', payload })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.dryRun).toBe(true)
  expect(body.planned).toEqual([{
    bookId: expect.any(Number),
    from: 'Vol 7/001.cbz',
    to: 'The Amazing Spider-Man/The Amazing Spider-Man (2025)/001.cbz',
  }])
  expect(body.moved).toBeUndefined()
  // Nothing moved: the file is exactly where it started.
  expect(existsSync(join(flat, '001.cbz'))).toBe(true)
})

test('POST /api/library/reorganize with dryRun:false executes the plan', async () => {
  const { flat } = await seedFlatEdition()

  const res = await app.inject({
    method: 'POST',
    url: '/api/library/reorganize',
    payload: { dryRun: false },
  })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.dryRun).toBe(false)
  expect(body.moved).toBe(1)
  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  expect(existsSync(join(app.config.comicsDir, nested, '001.cbz'))).toBe(true)
  expect(existsSync(flat)).toBe(false)
})
