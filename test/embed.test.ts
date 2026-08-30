import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import booksRoutes from '../server/routes/books.js'
import { scanLibrary } from '../server/services/indexer.js'
import { embedComicInfo } from '../server/lib/embed.js'
import { makeCbz } from './helpers/makeCbz.js'
import { readZipEntry } from './helpers/readZipEntry.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance, bookId: number
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'emb-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(join(config.comicsDir, 'Batman'), { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  await makeCbz(join(config.comicsDir, 'Batman'), ['p1.png', 'p2.png'], '001.cbz')
  app = Fastify(); app.decorate('db', openDb(':memory:')); app.decorate('config', config)
  await app.register(booksRoutes)
  await scanLibrary({ db: app.db, config })
  bookId = (app.db.prepare('SELECT id FROM book').get() as { id: number }).id
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('embedComicInfo adds ComicInfo.xml while preserving pages', async () => {
  const cbz = join(dir, 'comics', 'Batman', '001.cbz')
  await embedComicInfo(cbz, '<?xml version="1.0"?>\n<ComicInfo><Title>Hi</Title></ComicInfo>')
  const xml = await readZipEntry(cbz, 'ComicInfo.xml')
  expect(xml).toContain('<Title>Hi</Title>')
  const p1 = await readZipEntry(cbz, 'p1.png')
  expect(p1).not.toBeNull()
})

test('saving metadata writes it into the file and marks it synced', async () => {
  const res = await app.inject({
    method: 'PATCH', url: `/api/books/${bookId}/metadata`, payload: { title: 'Year One', number: '1' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().book.comicinfoSynced).toBe(true)
  const cbz = join(dir, 'comics', 'Batman', '001.cbz')
  const xml = await readZipEntry(cbz, 'ComicInfo.xml')
  expect(xml).toContain('<Title>Year One</Title>')
})

test('there is no manual embed endpoint any more', async () => {
  const res = await app.inject({ method: 'POST', url: `/api/books/${bookId}/embed` })
  expect(res.statusCode).toBe(404)
})

test('a save whose file cannot be written still saves, leaving it unsynced', async () => {
  rmSync(join(dir, 'comics', 'Batman', '001.cbz'))
  const res = await app.inject({
    method: 'PATCH', url: `/api/books/${bookId}/metadata`, payload: { title: 'Year One' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().book.title).toBe('Year One')
  expect(res.json().book.comicinfoSynced).toBe(false)
})
