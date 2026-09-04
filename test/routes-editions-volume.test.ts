import { test, expect } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { openDb } from '../server/db.js'
import { upsertEdition, getEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import type { Config } from '../server/config.js'

const VOLUME = { name: 'The Amazing Spider-Man', start_year: '2025', publisher: { name: 'Marvel' } }
const ISSUE = { name: 'x', issue_number: '1', volume: { id: 163325, name: 'The Amazing Spider-Man' } }

function server(db: ReturnType<typeof openDb>, comicsDir: string) {
  globalThis.fetch = (async (url: string) =>
    url.includes('/volume/')
      ? { ok: true, json: async () => ({ results: VOLUME }) }
      : { ok: true, json: async () => ({ results: ISSUE }) }) as never
  const app = Fastify()
  app.decorate('db', db)
  app.decorate('config', { comicsDir, comicVineApiKey: 'k' } as Config)
  return app
}

test('an edition resolves its volume from a book that is already matched', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Vol 7', folder: 'Vol 7' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 1 })!
  updateBook(db, book.id, { comicvineId: 1102459 })
  const app = server(db, '/tmp/comics')
  await app.register(editionRoutes)

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/comicvine-volume` })

  expect(res.statusCode).toBe(200)
  expect(getEdition(db, edition.id)).toMatchObject({ cvName: 'The Amazing Spider-Man', cvStartYear: 2025 })
  await app.close()
  db.close()
})

test('an edition with nothing matched yet reports that, rather than failing', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Unsorted', folder: 'Unsorted' })
  insertBook(db, { editionId: edition.id, filePath: 'Unsorted/loose.cbz', pageCount: 1, fileSize: 1 })
  const app = server(db, '/tmp/comics')
  await app.register(editionRoutes)

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/comicvine-volume` })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ matched: false })
  expect(getEdition(db, edition.id)).toMatchObject({ cvName: null })
  await app.close()
  db.close()
})
