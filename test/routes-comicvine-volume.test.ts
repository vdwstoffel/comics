import { test, expect } from 'vitest'
import Fastify from 'fastify'
import comicvineRoutes from '../server/routes/comicvine.js'
import { openDb } from '../server/db.js'
import { upsertEdition, getEdition } from '../server/models/editions.js'
import { insertBook } from '../server/models/books.js'
import type { Config } from '../server/config.js'

const ISSUE = {
  name: 'Death to the Tyrant',
  issue_number: '1',
  cover_date: '2025-06-01',
  description: null,
  volume: { id: 163325, name: 'The Amazing Spider-Man' },
}
const VOLUME = { name: 'The Amazing Spider-Man', start_year: '2025', publisher: { name: 'Marvel' } }

function app(db: ReturnType<typeof openDb>) {
  const fetchImpl = async (url: string) => {
    if (url.includes('/volume/')) return { ok: true, json: async () => ({ results: VOLUME }) }
    return { ok: true, json: async () => ({ results: ISSUE }) }
  }
  const server = Fastify()
  server.decorate('db', db)
  server.decorate('config', { comicVineApiKey: 'k' } as Config)
  // The route builds its own client from app.config; inject the stub through global fetch.
  globalThis.fetch = fetchImpl as never
  return server
}

test('matching a book records the Comic Vine volume on its edition', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Vol 7', folder: 'Vol 7' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 20, fileSize: 100 })!
  const server = app(db)
  await server.register(comicvineRoutes)

  const res = await server.inject({ method: 'POST', url: `/api/books/${book.id}/comicvine`, payload: { issueId: 1102459 } })
  expect(res.statusCode).toBe(200)

  expect(getEdition(db, edition.id)).toMatchObject({
    cvName: 'The Amazing Spider-Man',
    cvStartYear: 2025,
    comicvineId: 163325,
  })
  await server.close()
  db.close()
})

test('an edition already linked to a volume keeps its own comicvineId', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Vol 7', folder: 'Vol 7' })
  const { updateEdition } = await import('../server/models/editions.js')
  updateEdition(db, edition.id, { comicvineId: 999 })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 20, fileSize: 100 })!
  const server = app(db)
  await server.register(comicvineRoutes)

  await server.inject({ method: 'POST', url: `/api/books/${book.id}/comicvine`, payload: { issueId: 1102459 } })

  expect(getEdition(db, edition.id)).toMatchObject({ comicvineId: 999, cvStartYear: 2025 })
  await server.close()
  db.close()
})
