import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import booksRoutes from '../server/routes/books.js'
import { scanLibrary } from '../server/services/indexer.js'
import { embedComicInfo } from '../server/lib/embed.js'
import { updateBook } from '../server/models/books.js'
import { syncComicInfoFile } from '../server/services/comicinfoSync.js'
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

// What a match does once Comic Vine's record is on the book: the file carries it too.
test('syncing writes the book\'s metadata into the file and marks it synced', async () => {
  updateBook(app.db, bookId, { title: 'Year One', number: '1' })
  const synced = await syncComicInfoFile({ db: app.db, config: app.config }, bookId)
  expect(synced?.comicinfoSynced).toBe(true)
  const cbz = join(dir, 'comics', 'Batman', '001.cbz')
  const xml = await readZipEntry(cbz, 'ComicInfo.xml')
  expect(xml).toContain('<Title>Year One</Title>')
})

// What the library knows about a comic is Comic Vine's record of it. A title typed over
// that record drifts from it, and the run, its annuals and the follows all read Comic Vine.
test('there is no route to type metadata in by hand', async () => {
  const res = await app.inject({
    method: 'PATCH', url: `/api/books/${bookId}/metadata`, payload: { title: 'Year One' },
  })
  expect(res.statusCode).toBe(404)
})

test('there is no manual embed endpoint any more', async () => {
  const res = await app.inject({ method: 'POST', url: `/api/books/${bookId}/embed` })
  expect(res.statusCode).toBe(404)
})

test('a file that cannot be written keeps the metadata, leaving the book unsynced', async () => {
  rmSync(join(dir, 'comics', 'Batman', '001.cbz'))
  updateBook(app.db, bookId, { title: 'Year One' })
  const synced = await syncComicInfoFile({ db: app.db, config: app.config }, bookId)
  expect(synced?.title).toBe('Year One')
  expect(synced?.comicinfoSynced).toBe(false)
})
