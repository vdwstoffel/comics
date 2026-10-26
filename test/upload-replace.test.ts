import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { openDb } from '../server/db.js'
import uploadRoutes from '../server/routes/upload.js'
import { getBook, listBooksByEdition } from '../server/models/books.js'
import { getEditionByName } from '../server/models/editions.js'
import { setComicVineKey } from '../server/models/settings.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

const ISSUE = {
  id: 1001, name: 'Infinity', issue_number: '20', cover_date: '2013-08-01',
  description: null, volume: { id: 42, name: 'Avengers' },
}
const VOLUME = { id: 42, name: 'Avengers', start_year: '2013', publisher: { name: 'Marvel' } }
const EDITION = 'Avengers (2013)'
const DIRPATH = ['Avengers', 'Avengers (2013)']

let dir: string, srcDir: string, app: FastifyInstance, origFetch: typeof fetch

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'replace-'))
  srcDir = mkdtempSync(join(tmpdir(), 'src-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'),
    tmpDir: join(dir, 'tmp'), maxUploadBytes: 5 * 1024 * 1024,
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })

  origFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => ({
    ok: true,
    json: async () => ({ status_code: 1, results: String(url).includes('/volume/') ? VOLUME : ISSUE }),
  })) as unknown as typeof fetch

  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  setComicVineKey(app.db, 'k')
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } })
  await app.register(uploadRoutes)
})

afterEach(async () => {
  globalThis.fetch = origFetch
  await app.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})

async function upload(fields: Record<string, string>, fileName: string, pages = ['p1.png']) {
  const cbz = await makeCbz(srcDir, pages, fileName)
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  form.set('file', new Blob([readFileSync(cbz)]), fileName)
  return app.inject({ method: 'POST', url: '/api/upload', payload: form })
}

const NAME_PARTS = { edition: EDITION, issueId: '1001', volumeName: 'Avengers', issueNumber: '20' }

/** The comic already on the shelf, with a thumbnail beside it. */
async function seedExisting() {
  const res = await upload(NAME_PARTS, 'old.cbz', ['a.png', 'b.png'])
  const bookId: number = res.json().book.id
  writeFileSync(join(app.config.thumbsDir, `${bookId}.webp`), 'thumb')
  return bookId
}

test('the old file, thumbnail and row are gone and the new comic is in its place', async () => {
  const oldId = await seedExisting()
  const oldPath = join(app.config.comicsDir, ...DIRPATH, 'avengers_0020.cbz')
  expect(existsSync(oldPath)).toBe(true)

  const res = await upload({ ...NAME_PARTS, replaceBookId: String(oldId) }, 'new.cbz', ['x.png', 'y.png', 'z.png'])
  expect(res.statusCode).toBe(200)
  expect(res.json().replaced).toEqual({ bookId: oldId, editionRemoved: false })

  expect(getBook(app.db, oldId)).toBeUndefined()
  expect(existsSync(join(app.config.thumbsDir, `${oldId}.webp`))).toBe(false)

  const edition = getEditionByName(app.db, EDITION)!
  const books = listBooksByEdition(app.db, edition.id)
  expect(books).toHaveLength(1)
  // The new comic took the name the old one was holding, rather than keeping its deduped one.
  expect(books[0].filePath.endsWith('avengers_0020.cbz')).toBe(true)
  expect(books[0].pageCount).toBe(3)
  expect(existsSync(oldPath)).toBe(true)
})

// The owned-elsewhere case: the stray copy is in another edition, so the replacement
// lands in the run while the delete happens over in Unsorted.
test('a copy filed in another edition is deleted and the new one lands in the run', async () => {
  const stray = await upload(
    { edition: 'Unsorted', issueId: '1001', volumeName: 'Avengers', issueNumber: '20' },
    'stray.cbz',
  )
  const strayId: number = stray.json().book.id
  const strayPath = join(app.config.comicsDir, 'Unsorted', 'avengers_0020.cbz')
  expect(existsSync(strayPath)).toBe(true)

  const res = await upload({ ...NAME_PARTS, replaceBookId: String(strayId) }, 'new.cbz')
  expect(res.statusCode).toBe(200)
  expect(getBook(app.db, strayId)).toBeUndefined()
  expect(existsSync(strayPath)).toBe(false)
  expect(existsSync(join(app.config.comicsDir, ...DIRPATH, 'avengers_0020.cbz'))).toBe(true)
})

// The single most important test here: the ordering means a failed upload can never
// cost you the comic you already had.
test('a failed store leaves the old book and its file untouched', async () => {
  const oldId = await seedExisting()
  const oldPath = join(app.config.comicsDir, ...DIRPATH, 'avengers_0020.cbz')

  const form = new FormData()
  for (const [k, v] of Object.entries({ ...NAME_PARTS, replaceBookId: String(oldId) })) form.set(k, v)
  form.set('file', new Blob([Buffer.from('not a zip at all')]), 'broken.cbz')
  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: form })

  expect(res.statusCode).toBe(400)
  expect(getBook(app.db, oldId)).toBeDefined()
  expect(existsSync(oldPath)).toBe(true)
  expect(existsSync(join(app.config.thumbsDir, `${oldId}.webp`))).toBe(true)
})

test('replaceBookId naming a book that does not exist still stores the upload', async () => {
  const res = await upload({ ...NAME_PARTS, replaceBookId: '99999' }, 'new.cbz')
  expect(res.statusCode).toBe(200)
  expect(res.json().book).toBeDefined()
  expect(res.json().replaced).toBeUndefined()
})

test('replaceBookId that is not a positive integer is a 400', async () => {
  for (const bad of ['0', '-3', 'abc', '1e3', '0x10']) {
    const res = await upload({ ...NAME_PARTS, replaceBookId: bad }, `bad-${bad}.cbz`)
    expect(res.statusCode, `replaceBookId=${bad}`).toBe(400)
  }
})

test('replacing the last issue of an edition prunes that edition', async () => {
  const oldId = await seedExisting()
  // A second edition so the replacement does not land back in the one being emptied.
  const res = await upload(
    { edition: 'Avengers Annual (2014)', issueId: '1001', volumeName: 'Avengers Annual', issueNumber: '1', replaceBookId: String(oldId) },
    'new.cbz',
  )
  expect(res.statusCode).toBe(200)
  expect(res.json().replaced).toEqual({ bookId: oldId, editionRemoved: true })
  expect(getEditionByName(app.db, EDITION)).toBeUndefined()
})

// removeBook deletes the comic file BEFORE the thumbnail, and rethrows anything that is
// not ENOENT. A thumbnail that cannot be unlinked - EACCES on a bind mount, EISDIR here -
// therefore leaves the old file destroyed and the row behind, and an unwrapped throw
// would answer 500 for an upload that in fact succeeded. The client would mark the row
// failed, the user would upload again, and now there are two.
test('a failed removal still reports the upload that succeeded', async () => {
  const oldId = await seedExisting()
  rmSync(join(app.config.thumbsDir, `${oldId}.webp`))
  mkdirSync(join(app.config.thumbsDir, `${oldId}.webp`))

  const res = await upload({ ...NAME_PARTS, replaceBookId: String(oldId) }, 'new.cbz')
  expect(res.statusCode).toBe(200)
  expect(res.json().book).toBeDefined()
  expect(res.json().replaceFailed).toBe(true)
  // The new comic is in the library whatever happened to the old one's housekeeping.
  const edition = getEditionByName(app.db, EDITION)!
  expect(listBooksByEdition(app.db, edition.id).length).toBeGreaterThanOrEqual(1)
})

// The only irreversible operation in the app, so it does not take the client's word for
// which comic to delete: the book named must be the one that holds the issue being
// uploaded. A row mix-up in the browser becomes a no-op instead of a deletion.
test('a replace is refused when the named book does not hold that issue', async () => {
  const other = await upload(
    { edition: 'Unsorted', issueId: '1001', volumeName: 'Avengers', issueNumber: '20' },
    'unrelated.cbz',
  )
  const otherId: number = other.json().book.id
  app.db.prepare('UPDATE book SET comicvine_id = 424242 WHERE id = ?').run(otherId)

  const res = await upload({ ...NAME_PARTS, replaceBookId: String(otherId) }, 'new.cbz')
  expect(res.statusCode).toBe(200)
  expect(res.json().replaced).toBeUndefined()
  expect(getBook(app.db, otherId)).toBeDefined()
})
