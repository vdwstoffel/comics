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
import { setProgress } from '../server/models/progress.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'read-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
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
  const id = (app.db.prepare('SELECT id FROM series').get() as { id: number }).id
  const res = await app.inject({ url: `/api/series/${id}` })
  expect(res.json().books).toHaveLength(1)
  expect(res.json().books[0].pageCount).toBe(2)
})

test('GET /api/books/:id includes progress', async () => {
  const id = (app.db.prepare('SELECT id FROM book').get() as { id: number }).id
  const res = await app.inject({ url: `/api/books/${id}` })
  expect(res.statusCode).toBe(200)
  expect(res.json().progress).toMatchObject({ lastPage: 0, completed: false })
})

test('missing series 404s', async () => {
  const res = await app.inject({ url: '/api/series/9999' })
  expect(res.statusCode).toBe(404)
})

test('GET /api/series/:id books include readState and percent', async () => {
  const seriesId = (app.db.prepare('SELECT id FROM series').get() as { id: number }).id
  // Create a second book in the same series so we can test multiple states
  await makeCbz(join(app.config.comicsDir, 'Batman'), ['p1.png', 'p2.png', 'p3.png', 'p4.png', 'p5.png'], '002.cbz')
  await makeCbz(join(app.config.comicsDir, 'Batman'), ['p1.png', 'p2.png', 'p3.png'], '003.cbz')
  await scanLibrary({ db: app.db, config: app.config })

  const books = (app.db.prepare('SELECT id FROM book ORDER BY id').all() as { id: number }[])
  expect(books.length).toBeGreaterThanOrEqual(3)

  const [book1, book2, book3] = books
  // book1: unread (no progress)
  // book2: in-progress at page 2 out of 5 pages → percent = round(2/4*100) = 50
  setProgress(app.db, book2.id, { lastPage: 2, completed: false })
  // book3: completed
  setProgress(app.db, book3.id, { lastPage: 2, completed: true })

  const res = await app.inject({ url: `/api/series/${seriesId}` })
  expect(res.statusCode).toBe(200)
  const booksRes = res.json().books as Array<{ id: number; readState: string; percent: number }>

  const b1 = booksRes.find((b) => b.id === book1.id)
  const b2 = booksRes.find((b) => b.id === book2.id)
  const b3 = booksRes.find((b) => b.id === book3.id)

  expect(b1).toMatchObject({ readState: 'unread', percent: 0 })
  expect(b2).toMatchObject({ readState: 'reading' })
  expect(b2!.percent).toBeGreaterThanOrEqual(1)
  expect(b2!.percent).toBeLessThanOrEqual(99)
  expect(b3).toMatchObject({ readState: 'read', percent: 100 })
})
