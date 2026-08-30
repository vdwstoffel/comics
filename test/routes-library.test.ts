import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import editionRoutes from '../server/routes/editions.js'
import booksRoutes from '../server/routes/books.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
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
  await app.register(editionRoutes)
  await app.register(booksRoutes)
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
