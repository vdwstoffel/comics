import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import seriesRoutes from '../server/routes/series.js'
import booksRoutes from '../server/routes/books.js'
import { upsertSeries } from '../server/models/series.js'
import { insertBook } from '../server/models/books.js'
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
