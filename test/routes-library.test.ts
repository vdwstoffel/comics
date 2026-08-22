import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import seriesRoutes from '../server/routes/series.js'
import booksRoutes from '../server/routes/books.js'
import { upsertSeries, updateSeries } from '../server/models/series.js'
import { insertBook } from '../server/models/books.js'
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
  await app.register(seriesRoutes)
  await app.register(booksRoutes)
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('PATCH /api/series/:id renames series', async () => {
  // Set up series with a book on disk
  const srcDir = join(app.config.comicsDir, 'OldName')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(app.db, { name: 'OldName', folder: 'OldName' })
  insertBook(app.db, { seriesId: series.id, filePath: 'OldName/issue.cbz', pageCount: 1, fileSize: 100 })

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/series/${series.id}`,
    payload: { name: 'NewName' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().series.name).toBe('NewName')
})

test('PATCH /api/series/:id 400 on blank name', async () => {
  const series = upsertSeries(app.db, { name: 'Test', folder: 'Test' })
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/series/${series.id}`,
    payload: { name: '   ' },
  })
  expect(res.statusCode).toBe(400)
})

test('PATCH /api/series/:id 404 on missing series', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/series/99999',
    payload: { name: 'Something' },
  })
  expect(res.statusCode).toBe(404)
})

test('PUT /api/books/:id/series moves book to named series', async () => {
  const srcDir = join(app.config.comicsDir, 'Source')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(app.db, { name: 'Source', folder: 'Source' })
  const book = insertBook(app.db, { seriesId: series.id, filePath: 'Source/issue.cbz', pageCount: 1, fileSize: 100 })!

  const res = await app.inject({
    method: 'PUT',
    url: `/api/books/${book.id}/series`,
    payload: { name: 'Target' },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.book.filePath).toBe('Target/issue.cbz')
  expect(body.series.name).toBe('Target')
})

test('PUT /api/books/:id/series 400 on blank name', async () => {
  const series = upsertSeries(app.db, { name: 'S', folder: 'S' })
  const book = insertBook(app.db, { seriesId: series.id, filePath: 'S/a.cbz', pageCount: 1, fileSize: 100 })!
  const res = await app.inject({
    method: 'PUT',
    url: `/api/books/${book.id}/series`,
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
  const marvel1 = upsertSeries(app.db, { name: 'X-Men', folder: 'X-Men' })
  const marvel2 = upsertSeries(app.db, { name: 'Spider-Man', folder: 'Spider-Man' })
  const dc = upsertSeries(app.db, { name: 'Batman', folder: 'Batman' })
  upsertSeries(app.db, { name: 'Unknown', folder: 'Unknown' })
  updateSeries(app.db, marvel1.id, { publisher: 'Marvel' })
  updateSeries(app.db, marvel2.id, { publisher: 'Marvel' })
  updateSeries(app.db, dc.id, { publisher: 'DC' })
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

test('GET /api/series?publisher=X filters by publisher', async () => {
  const marvel = upsertSeries(app.db, { name: 'X-Men', folder: 'X-Men' })
  const dc = upsertSeries(app.db, { name: 'Batman', folder: 'Batman' })
  updateSeries(app.db, marvel.id, { publisher: 'Marvel' })
  updateSeries(app.db, dc.id, { publisher: 'DC' })

  const res = await app.inject({ url: '/api/series?publisher=Marvel' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { series: Array<{ name: string }> }
  expect(body.series).toHaveLength(1)
  expect(body.series[0].name).toBe('X-Men')
})

test('GET /api/series?publisher=__unknown__ returns null-publisher series', async () => {
  const marvel = upsertSeries(app.db, { name: 'X-Men', folder: 'X-Men' })
  upsertSeries(app.db, { name: 'Mystery', folder: 'Mystery' })
  updateSeries(app.db, marvel.id, { publisher: 'Marvel' })
  // 'Mystery' series intentionally left without publisher

  const res = await app.inject({ url: '/api/series?publisher=__unknown__' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { series: Array<{ name: string }> }
  expect(body.series).toHaveLength(1)
  expect(body.series[0].name).toBe('Mystery')
})

test('GET /api/series (no param) returns all series', async () => {
  const marvel = upsertSeries(app.db, { name: 'X-Men', folder: 'X-Men' })
  const dc = upsertSeries(app.db, { name: 'Batman', folder: 'Batman' })
  updateSeries(app.db, marvel.id, { publisher: 'Marvel' })
  updateSeries(app.db, dc.id, { publisher: 'DC' })

  const res = await app.inject({ url: '/api/series' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { series: Array<{ name: string }> }
  expect(body.series).toHaveLength(2)
})

/** Pin a book's read timestamp so ordering assertions are deterministic. */
function setReadAt(bookId: number, iso: string) {
  app.db.prepare('UPDATE read_progress SET updated_at = ? WHERE book_id = ?').run(iso, bookId)
}

test('GET /api/continue-reading returns started books, most recently read first', async () => {
  const series = upsertSeries(app.db, { name: 'Avengers', folder: 'Avengers' })
  const first = insertBook(app.db, { seriesId: series.id, filePath: 'Avengers/1.cbz', pageCount: 10, fileSize: 1, title: 'Vol. 1' })!
  const second = insertBook(app.db, { seriesId: series.id, filePath: 'Avengers/2.cbz', pageCount: 10, fileSize: 1, title: 'Vol. 2' })!
  setProgress(app.db, first.id, { lastPage: 3 })
  setProgress(app.db, second.id, { lastPage: 5 })
  setReadAt(first.id, '2026-01-01T00:00:00.000Z')
  setReadAt(second.id, '2026-02-01T00:00:00.000Z')

  const res = await app.inject({ url: '/api/continue-reading' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { books: Array<{ title: string; readState: string; percent: number; seriesName: string }> }
  expect(body.books.map((b) => b.title)).toEqual(['Vol. 2', 'Vol. 1'])
  expect(body.books[0]).toMatchObject({ readState: 'reading', percent: 56, seriesName: 'Avengers' })
})

test('GET /api/continue-reading excludes finished and never-opened books', async () => {
  const series = upsertSeries(app.db, { name: 'Batman', folder: 'Batman' })
  const reading = insertBook(app.db, { seriesId: series.id, filePath: 'Batman/1.cbz', pageCount: 10, fileSize: 1, title: 'Reading' })!
  const finished = insertBook(app.db, { seriesId: series.id, filePath: 'Batman/2.cbz', pageCount: 10, fileSize: 1, title: 'Finished' })!
  insertBook(app.db, { seriesId: series.id, filePath: 'Batman/3.cbz', pageCount: 10, fileSize: 1, title: 'Untouched' })
  setProgress(app.db, reading.id, { lastPage: 2 })
  setProgress(app.db, finished.id, { lastPage: 9, completed: true })

  const res = await app.inject({ url: '/api/continue-reading' })
  const body = res.json() as { books: Array<{ title: string }> }
  expect(body.books.map((b) => b.title)).toEqual(['Reading'])
})

test('GET /api/continue-reading caps results at the requested limit', async () => {
  const series = upsertSeries(app.db, { name: 'X-Men', folder: 'X-Men' })
  for (let i = 1; i <= 3; i++) {
    const b = insertBook(app.db, { seriesId: series.id, filePath: `X-Men/${i}.cbz`, pageCount: 10, fileSize: 1, title: `#${i}` })!
    setProgress(app.db, b.id, { lastPage: i })
    setReadAt(b.id, `2026-0${i}-01T00:00:00.000Z`)
  }

  const res = await app.inject({ url: '/api/continue-reading?limit=2' })
  const body = res.json() as { books: Array<{ title: string }> }
  expect(body.books.map((b) => b.title)).toEqual(['#3', '#2'])
})

test('GET /api/continue-reading?publisher=X only returns that publisher', async () => {
  const marvel = upsertSeries(app.db, { name: 'Avengers', folder: 'Avengers' })
  const dc = upsertSeries(app.db, { name: 'Batman', folder: 'Batman' })
  updateSeries(app.db, marvel.id, { publisher: 'Marvel' })
  updateSeries(app.db, dc.id, { publisher: 'DC' })
  const marvelBook = insertBook(app.db, { seriesId: marvel.id, filePath: 'Avengers/1.cbz', pageCount: 10, fileSize: 1, title: 'Avengers 1' })!
  const dcBook = insertBook(app.db, { seriesId: dc.id, filePath: 'Batman/1.cbz', pageCount: 10, fileSize: 1, title: 'Batman 1' })!
  setProgress(app.db, marvelBook.id, { lastPage: 2 })
  setProgress(app.db, dcBook.id, { lastPage: 2 })

  const res = await app.inject({ url: '/api/continue-reading?publisher=DC' })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { books: Array<{ title: string }> }
  expect(body.books.map((b) => b.title)).toEqual(['Batman 1'])
})

test('GET /api/continue-reading?publisher=__unknown__ returns books from series with no publisher', async () => {
  const marvel = upsertSeries(app.db, { name: 'Avengers', folder: 'Avengers' })
  const mystery = upsertSeries(app.db, { name: 'Mystery', folder: 'Mystery' })
  updateSeries(app.db, marvel.id, { publisher: 'Marvel' })
  // 'Mystery' intentionally left without a publisher
  const marvelBook = insertBook(app.db, { seriesId: marvel.id, filePath: 'Avengers/1.cbz', pageCount: 10, fileSize: 1, title: 'Avengers 1' })!
  const mysteryBook = insertBook(app.db, { seriesId: mystery.id, filePath: 'Mystery/1.cbz', pageCount: 10, fileSize: 1, title: 'Mystery 1' })!
  setProgress(app.db, marvelBook.id, { lastPage: 2 })
  setProgress(app.db, mysteryBook.id, { lastPage: 2 })

  const res = await app.inject({ url: '/api/continue-reading?publisher=__unknown__' })
  const body = res.json() as { books: Array<{ title: string }> }
  expect(body.books.map((b) => b.title)).toEqual(['Mystery 1'])
})
