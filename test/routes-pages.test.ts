import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import booksRoutes from '../server/routes/books.js'
import { scanLibrary } from '../server/services/indexer.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance, bookId: number
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pg-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(join(config.comicsDir, 'Batman'), { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  await makeCbz(join(config.comicsDir, 'Batman'), ['p1.png', 'p2.png'], '001.cbz')
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(booksRoutes)
  await scanLibrary({ db: app.db, config })
  bookId = (app.db.prepare('SELECT id FROM book').get() as { id: number }).id
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('GET page returns PNG bytes', async () => {
  const res = await app.inject({ url: `/api/books/${bookId}/pages/0` })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toContain('image/png')
  expect(res.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})

test('page out of range 404s', async () => {
  const res = await app.inject({ url: `/api/books/${bookId}/pages/99` })
  expect(res.statusCode).toBe(404)
})

test('PUT progress persists and is returned by GET book', async () => {
  const put = await app.inject({
    method: 'PUT', url: `/api/books/${bookId}/progress`,
    payload: { lastPage: 1, completed: false },
  })
  expect(put.statusCode).toBe(200)
  expect(put.json().progress.lastPage).toBe(1)
  const get = await app.inject({ url: `/api/books/${bookId}` })
  expect(get.json().progress.lastPage).toBe(1)
})
