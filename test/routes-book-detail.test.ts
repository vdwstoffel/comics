import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import booksRoutes from '../server/routes/books.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook } from '../server/models/books.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bd-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(config.comicsDir, { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(booksRoutes)
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

function aBook(editionName: string) {
  const edition = upsertEdition(app.db, { name: editionName, folder: editionName })
  return insertBook(app.db, {
    editionId: edition.id, filePath: `${editionName}/001.cbz`, number: '141', pageCount: 22, fileSize: 1,
  })!
}

// The reader shows nothing but the comic, so the browser tab is the only place the comic
// is named while you read it - and `editionId` alone cannot name it. This is what the
// difference between "#141" and "Uncanny X-Men #141" in the tab rests on.
test('GET /api/books/:id names the run the comic belongs to', async () => {
  const book = aBook('Uncanny X-Men (1963)')
  const res = await app.inject({ url: `/api/books/${book.id}` })

  expect(res.statusCode).toBe(200)
  expect(res.json().editionName).toBe('Uncanny X-Men (1963)')
})

test('GET /api/books/:id still answers 404 for a book that is not there', async () => {
  expect((await app.inject({ url: '/api/books/999' })).statusCode).toBe(404)
})

// Spec §5.2: every route to a comic funnels through the book payload, so this one field
// is what sends Downloads, Upload, Releases, the arcs and the reader to the right shelf.
test('a collected comic names the volume shelf as its home', async () => {
  const wells = upsertEdition(app.db, { name: 'Wells and Romita Jr. (2022)', folder: 'w' })
  const zeb = upsertEdition(app.db, { name: 'By Zeb Wells (2023)', folder: 'z' })
  updateEdition(app.db, wells.id, { comicvineId: 149382, collectsVolumeId: 142577 })
  updateEdition(app.db, zeb.id, { comicvineId: 150443, collectsVolumeId: 142577 })
  const trade = insertBook(app.db, { editionId: zeb.id, filePath: 'z/1.cbz', pageCount: 10, fileSize: 100 })!

  const { shelfVolumeId } = (await app.inject({ url: `/api/books/${trade.id}` })).json()
  expect(shelfVolumeId).toBe(142577)
})

test('a comic in a stand-alone edition has no volume shelf', async () => {
  const lone = upsertEdition(app.db, { name: 'Lone Run (2024)', folder: 'l' })
  updateEdition(app.db, lone.id, { comicvineId: 555 })
  const only = insertBook(app.db, { editionId: lone.id, filePath: 'l/1.cbz', pageCount: 10, fileSize: 100 })!

  const { shelfVolumeId } = (await app.inject({ url: `/api/books/${only.id}` })).json()
  expect(shelfVolumeId).toBeNull()
})
