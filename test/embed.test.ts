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
import yauzl from 'yauzl'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

function readEntry(cbz: string, name: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(cbz, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      zip.on('entry', (e) => {
        if (e.fileName === name) {
          zip.openReadStream(e, async (er, s) => {
            if (er || !s) { zip.close(); return reject(er) }
            const chunks: Buffer[] = []; for await (const c of s) chunks.push(c as Buffer)
            zip.close(); resolve(Buffer.concat(chunks).toString('utf8'))
          })
        } else zip.readEntry()
      })
      zip.on('end', () => { zip.close(); resolve(null) })
      zip.readEntry()
    })
  })
}

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
  const xml = await readEntry(cbz, 'ComicInfo.xml')
  expect(xml).toContain('<Title>Hi</Title>')
  const p1 = await readEntry(cbz, 'p1.png')
  expect(p1).not.toBeNull()
})

test('PATCH metadata then POST embed sets comicinfoSynced and writes file', async () => {
  await app.inject({ method: 'PATCH', url: `/api/books/${bookId}/metadata`, payload: { title: 'Year One', number: '1' } })
  const res = await app.inject({ method: 'POST', url: `/api/books/${bookId}/embed` })
  expect(res.statusCode).toBe(200)
  expect(res.json().book.comicinfoSynced).toBe(true)
  const cbz = join(dir, 'comics', 'Batman', '001.cbz')
  const xml = await readEntry(cbz, 'ComicInfo.xml')
  expect(xml).toContain('<Title>Year One</Title>')
})
