import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import volumeRoutes from '../server/routes/volumes.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'
import type { EditionUpdate } from '../server/models/editions.js'

let dir: string, app: FastifyInstance

/** Books as `[title, date]`; a null date is a book nobody has dated. */
function seed(name: string, books: Array<[string, string | null]>, fields: EditionUpdate = {}) {
  const edition = upsertEdition(app.db, { name, folder: name })
  updateEdition(app.db, edition.id, { publisher: 'Marvel', ...fields })
  for (const [title, date] of books) {
    const book = insertBook(app.db, {
      editionId: edition.id, filePath: `${name}/${title}.cbz`, pageCount: 10, fileSize: 100,
    })!
    updateBook(app.db, book.id, { title, date })
  }
  return edition
}

const COLLECTS_2022 = {
  collectsVolumeId: 142577,
  collectsCvName: 'The Amazing Spider-Man',
  collectsCvStartYear: 2022,
  collectsCvSiteUrl: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/',
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vol-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(config.comicsDir, { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(volumeRoutes)

  // The real shelf: three trade lines, one run. Dates interleave across the editions,
  // which is the whole reason the shelf is ordered by date rather than by edition.
  seed('The Amazing Spider-Man by Wells and Romita Jr. (2022)', [
    ['Volume1: World Without Love', '2022-10-01'],
    ['Volume 2: The New Sinister', '2023-02-01'],
  ], { comicvineId: 149382, ...COLLECTS_2022 })
  seed('Amazing Spider-Man By Zeb Wells (2023)', [
    ['Volume 4: Dark Web', '2023-08-01'],
    ['Volume 12: Dead Wrong', '2025-02-01'],
    // Review Focus 2: a real column that is nullable, and real rows that are null.
    ['Volume 13: Undated', null],
  ], { comicvineId: 150443, ...COLLECTS_2022 })
  seed('Amazing Spider-Man: The 8 Deaths Of Spider-Man (2025)', [
    ['TPB', '2025-07-01'],
  ], { comicvineId: 165956, ...COLLECTS_2022 })

  seed('The Amazing Spider-Man Epic Collection', [['Great Power', '2014-01-01']], { comicvineId: 77149 })
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

const get = (url: string) => app.inject({ method: 'GET', url })

test('the shelf gathers every collection of the volume, in date order', async () => {
  const res = await get('/api/volumes/142577')
  expect(res.statusCode).toBe(200)
  const { shelf, books } = res.json()
  expect(shelf.name).toBe('The Amazing Spider-Man (2022)')
  expect(shelf.volumeId).toBe(142577)
  expect(books).toHaveLength(6)
  expect(books[0].title).toBe('Volume1: World Without Love')
  expect(books.map((b: { title: string }) => b.title).slice(0, 5)).toEqual([
    'Volume1: World Without Love',
    'Volume 2: The New Sinister',
    'Volume 4: Dark Web',
    'Volume 12: Dead Wrong',
    'TPB',
  ])
})

// Review Focus 2: undated books go to the end rather than scattering the shelf.
test('an undated book sorts last rather than scattering the shelf', async () => {
  const { books } = (await get('/api/volumes/142577')).json()
  expect(books.at(-1).title).toBe('Volume 13: Undated')
  expect(books.at(-1).date).toBeNull()
})

test('the shelf carries read state, as an edition does', async () => {
  const { books } = (await get('/api/volumes/142577')).json()
  expect(books[0].readState).toBe('unread')
})

// Review Focus 5: a bookmark that outlived its shelf.
test('a volume no edition keys to is a 404, not an empty shelf', async () => {
  expect((await get('/api/volumes/999999')).statusCode).toBe(404)
})

test('a volume held by a single edition still answers, uncollapsed', async () => {
  const { shelf } = (await get('/api/volumes/77149')).json()
  expect(shelf.editions).toHaveLength(1)
  expect(shelf.volumeId).toBeNull()
  expect(shelf.name).toBe('The Amazing Spider-Man Epic Collection')
})

// The home shelf's tile always links /volume/:id?status=unread, and the page forwards
// that as readState - so this is the primary way in, not a corner.
test('a read-state filter narrows the shelf without un-collapsing it', async () => {
  const { shelf, books } = (await get('/api/volumes/142577?readState=unread')).json()
  expect(shelf.name).toBe('The Amazing Spider-Man (2022)')
  expect(shelf.volumeId).toBe(142577)
  expect(shelf.editions).toHaveLength(3)
  expect(books).toHaveLength(6)
})

test('a shelf whose unread books all sit in one collection is still the whole shelf', async () => {
  // Everything read except one Zeb Wells trade: the shelf must not become that trade.
  for (const b of app.db.prepare('SELECT id FROM book').all() as Array<{ id: number }>) {
    app.db.prepare("INSERT INTO read_progress (book_id, last_page, completed, updated_at) VALUES (?,10,1,'x')").run(b.id)
  }
  app.db.prepare('DELETE FROM read_progress WHERE book_id = (SELECT MIN(id) FROM book WHERE edition_id = (SELECT id FROM edition WHERE name LIKE \'%Zeb Wells%\'))').run()

  const { shelf, books } = (await get('/api/volumes/142577?readState=unread')).json()
  expect(shelf.name).toBe('The Amazing Spider-Man (2022)')
  expect(shelf.editions).toHaveLength(3)
  expect(books).toHaveLength(1)
})
