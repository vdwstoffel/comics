import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import scanRoutes from '../server/routes/scan.js'
import { upsertEdition, updateEdition, getEdition } from '../server/models/editions.js'
import { insertBook, getBook, findBookByPath } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'scan-'))
  const config = {
    comicsDir: join(dir, 'comics'),
    thumbsDir: join(dir, 'thumbs'),
    tmpDir: join(dir, 'tmp'),
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(scanRoutes)
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

const NESTED = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'

/**
 * The state a crash between moveBookToEdition's rename() and its setBookEdition()
 * leaves behind: the file already sits at its nested target, the row still names the
 * old flat path, and nothing on disk is at that old path any more.
 */
async function seedInterruptedMove() {
  const edition = upsertEdition(app.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(app.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  const nestedDir = join(app.config.comicsDir, NESTED)
  mkdirSync(nestedDir, { recursive: true })
  const file = await makeCbz(nestedDir, ['p1.png'], '001.cbz')
  // The size must match the file for the self-heal to accept it as the same book.
  const book = insertBook(app.db, {
    editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: statSync(file).size,
  })!
  return { edition, book, file }
}

// The scan is the one endpoint that migrates a real library, and it composes two
// operations that can fight each other: the scanner adopts any file it finds that no row
// claims, and the reorganizer heals rows whose file already moved. Scanning first lets
// the scanner index the healed-but-not-yet-repointed file as a SECOND book, after which
// the self-heal can only fail on the file_path UNIQUE constraint - forever.
test('POST /api/scan heals an interrupted move instead of indexing the file twice', async () => {
  const { book, file } = await seedInterruptedMove()
  // Progress a duplicate row would not carry, standing in for everything else a second
  // row loses: read state, Comic Vine ids, credits, tags.
  setProgress(app.db, book.id, { lastPage: 7 })

  const res = await app.inject({ method: 'POST', url: '/api/scan' })

  expect(res.statusCode).toBe(200)
  // Exactly one row, the original, now naming where the file actually is.
  const rows = app.db.prepare('SELECT id, file_path FROM book ORDER BY id').all()
  expect(rows).toEqual([{ id: book.id, file_path: `${NESTED}/001.cbz` }])
  expect(res.json()).toMatchObject({ added: 0, skipped: 0 })
  // The file itself is untouched, and the row still owns its read progress.
  expect(existsSync(file)).toBe(true)
  expect(app.db.prepare('SELECT last_page FROM read_progress WHERE book_id = ?').get(book.id))
    .toEqual({ last_page: 7 })
})

// Same interrupted state, run twice: the endpoint has to be safe to hammer.
test('POST /api/scan run twice over an interrupted move still leaves one row', async () => {
  const { book } = await seedInterruptedMove()

  await app.inject({ method: 'POST', url: '/api/scan' })
  const res = await app.inject({ method: 'POST', url: '/api/scan' })

  expect(res.statusCode).toBe(200)
  expect(app.db.prepare('SELECT COUNT(*) AS n FROM book').get()).toEqual({ n: 1 })
  expect(getBook(app.db, book.id)!.filePath).toBe(`${NESTED}/001.cbz`)
  expect(res.json()).toMatchObject({ added: 0, reorganized: 0, skipped: 0 })
})

// A file dropped into the library by hand must be indexed AND filed in the same request -
// the property the trailing reorganize exists to keep.
test('POST /api/scan files a newly discovered issue under its series in the same request', async () => {
  const flat = join(app.config.comicsDir, 'The Amazing Spider-Man (2025)')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '002.cbz')

  const res = await app.inject({ method: 'POST', url: '/api/scan' })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ added: 1, total: 1, reorganized: 1 })
  expect(existsSync(join(app.config.comicsDir, NESTED, '002.cbz'))).toBe(true)
  expect(findBookByPath(app.db, `${NESTED}/002.cbz`)).toBeDefined()
})

// A migration that could not move everything is not a success, and the caller has no
// other way to find that out.
test('POST /api/scan reports the issues its migration could not move', async () => {
  const ghost = upsertEdition(app.db, { name: 'Ghost Rider (2025)', folder: 'Vol 3' })
  updateEdition(app.db, ghost.id, { seriesName: 'Ghost Rider' })
  // Names a file that is not on disk, so its move fails the way a deleted file does.
  insertBook(app.db, { editionId: ghost.id, filePath: 'Vol 3/001.cbz', pageCount: 1, fileSize: 100 })

  const res = await app.inject({ method: 'POST', url: '/api/scan' })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ added: 0, reorganized: 0, skipped: 1 })
  // Nothing moved, so the edition still points at the folder its files are in.
  expect(getEdition(app.db, ghost.id)!.folder).toBe('Vol 3')
})
