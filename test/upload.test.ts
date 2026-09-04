import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { openDb } from '../server/db.js'
import uploadRoutes from '../server/routes/upload.js'
import { upsertEdition, getEditionByName, listEditions } from '../server/models/editions.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'up-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'),
    tmpDir: join(dir, 'tmp'), maxUploadBytes: 5 * 1024 * 1024,
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } })
  await app.register(uploadRoutes)
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('uploading a cbz ingests it into the given edition', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'src-'))
  const cbz = await makeCbz(srcDir, ['p1.png', 'p2.png', 'p3.png'], 'Issue 1.cbz')

  const form = new FormData()
  form.set('edition', 'Spider-Man')
  form.set('file', new Blob([readFileSync(cbz)]), 'Issue 1.cbz')

  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: form })
  expect(res.statusCode).toBe(200)
  const { book } = res.json()
  expect(book.pageCount).toBe(3)

  const edition = app.db.prepare('SELECT * FROM edition').get() as { name: string }
  expect(edition.name).toBe('Spider-Man')
  // One level, not two: 'Spider-Man' is its own series, and editionFolderPath collapses
  // a series equal to the edition name to a single segment. This is the collapse rule
  // holding for uploads, not the old flat layout - see the nesting tests below.
  expect(existsSync(join(app.config.comicsDir, 'Spider-Man', 'Issue 1.cbz'))).toBe(true)
  rmSync(srcDir, { recursive: true, force: true })
})

test('rejecting a non-cbz upload', async () => {
  const form = new FormData()
  form.set('file', new Blob([Buffer.from('not a zip')]), 'bad.cbz')
  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: form })
  expect(res.statusCode).toBe(400)
})

test('path traversal in the edition field is neutralised', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'src-'))
  const cbz = await makeCbz(srcDir, ['p1.png'], 'evil.cbz')

  const form = new FormData()
  form.set('edition', '../../evil')
  form.set('file', new Blob([readFileSync(cbz)]), 'evil.cbz')

  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: form })
  expect(res.statusCode).toBe(200)

  const { book } = res.json()
  // book.filePath is relative to comicsDir; reconstruct absolute path
  const absFilePath = join(app.config.comicsDir, book.filePath)
  // The file must exist inside comicsDir
  expect(absFilePath.startsWith(app.config.comicsDir)).toBe(true)
  expect(existsSync(absFilePath)).toBe(true)
  // No file should exist at the traversal target (two levels above comicsDir)
  const escapedPath = join(app.config.comicsDir, '..', '..', 'evil', 'evil.cbz')
  expect(existsSync(escapedPath)).toBe(false)

  rmSync(srcDir, { recursive: true, force: true })
})

/** Upload one page-bearing .cbz into `edition`, returning the response. */
async function upload(edition: string, filename = 'Issue 1.cbz') {
  const srcDir = mkdtempSync(join(tmpdir(), 'src-'))
  const cbz = await makeCbz(srcDir, ['p1.png'], filename)
  const form = new FormData()
  form.set('edition', edition)
  form.set('file', new Blob([readFileSync(cbz)]), filename)
  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: form })
  rmSync(srcDir, { recursive: true, force: true })
  return res
}

// Upload writes files into the same library every other operation reads, so it has to
// use the same layout: an edition lives under its series.
test('uploading into a new edition files it under its series', async () => {
  const res = await upload('The Amazing Spider-Man (2025)')

  expect(res.statusCode).toBe(200)
  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  expect(res.json().book.filePath).toBe(`${nested}/Issue 1.cbz`)
  expect(existsSync(join(app.config.comicsDir, nested, 'Issue 1.cbz'))).toBe(true)
  const edition = getEditionByName(app.db, 'The Amazing Spider-Man (2025)')!
  // The row is named for the edition and points at where the file actually went.
  expect(edition.name).toBe('The Amazing Spider-Man (2025)')
  expect(edition.folder).toBe(nested)
})

// The edition row - not a recomputation from its name - is the authority on where its
// files live, exactly as moveBookToEdition treats it. 'Vol 7' is chosen so its stored
// folder ('Legacy/Vol 7') diverges from anything derivable from the name.
test('uploading into an existing edition goes where that edition already is', async () => {
  upsertEdition(app.db, { name: 'Vol 7', folder: 'Legacy/Vol 7' })

  const res = await upload('Vol 7')

  expect(res.statusCode).toBe(200)
  expect(res.json().book.filePath).toBe('Legacy/Vol 7/Issue 1.cbz')
  expect(existsSync(join(app.config.comicsDir, 'Legacy/Vol 7', 'Issue 1.cbz'))).toBe(true)
  // No second top-level directory, and no second edition row alongside the first.
  expect(existsSync(join(app.config.comicsDir, 'Vol 7'))).toBe(false)
  expect(listEditions(app.db)).toHaveLength(1)
  expect(getEditionByName(app.db, 'Vol 7')!.folder).toBe('Legacy/Vol 7')
})

// The name is what the user typed; only the folder is sanitised. Passing the sanitised
// string on as the name would rename the user's edition to its own folder name.
test('an edition name that needs sanitising keeps its name and only sanitises the folder', async () => {
  const res = await upload('Hellboy/BPRD')

  expect(res.statusCode).toBe(200)
  const edition = getEditionByName(app.db, 'Hellboy/BPRD')!
  expect(edition.name).toBe('Hellboy/BPRD')
  expect(edition.folder).toBe('Hellboy_BPRD')
  expect(res.json().book.filePath).toBe('Hellboy_BPRD/Issue 1.cbz')
})
