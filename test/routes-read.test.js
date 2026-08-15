import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import seriesRoutes from '../server/routes/series.js'
import booksRoutes from '../server/routes/books.js'
import { scanLibrary } from '../server/services/indexer.js'
import { makeCbz } from './helpers/makeCbz.js'

let dir, app
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'read-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') }
  mkdirSync(join(config.comicsDir, 'Batman'), { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  await makeCbz(join(config.comicsDir, 'Batman'), ['p1.png', 'p2.png'], '001.cbz')
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(seriesRoutes)
  await app.register(booksRoutes)
  await scanLibrary({ db: app.db, config })
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('GET /api/series lists series with bookCount', async () => {
  const res = await app.inject({ url: '/api/series' })
  expect(res.statusCode).toBe(200)
  expect(res.json().series[0]).toMatchObject({ name: 'Batman', bookCount: 1 })
})

test('GET /api/series/:id returns books', async () => {
  const id = app.db.prepare('SELECT id FROM series').get().id
  const res = await app.inject({ url: `/api/series/${id}` })
  expect(res.json().books).toHaveLength(1)
  expect(res.json().books[0].pageCount).toBe(2)
})

test('GET /api/books/:id includes progress', async () => {
  const id = app.db.prepare('SELECT id FROM book').get().id
  const res = await app.inject({ url: `/api/books/${id}` })
  expect(res.statusCode).toBe(200)
  expect(res.json().progress).toMatchObject({ lastPage: 0, completed: false })
})

test('missing series 404s', async () => {
  const res = await app.inject({ url: '/api/series/9999' })
  expect(res.statusCode).toBe(404)
})
