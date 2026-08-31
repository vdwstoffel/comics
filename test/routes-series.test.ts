import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import editionRoutes from '../server/routes/editions.js'
import seriesRoutes from '../server/routes/series.js'
import { upsertEdition, updateEdition, getEdition } from '../server/models/editions.js'
import { insertBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance

function seed(name: string, books: number, publisher: string) {
  const edition = upsertEdition(app.db, { name, folder: name })
  updateEdition(app.db, edition.id, { publisher })
  for (let i = 0; i < books; i++) {
    insertBook(app.db, { editionId: edition.id, filePath: `${name}/${i}.cbz`, pageCount: 10, fileSize: 100 })
  }
  return edition
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sg-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(config.comicsDir, { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(editionRoutes)
  await app.register(seriesRoutes)

  seed('Amazing Spider-Man (2025)', 3, 'Marvel')
  seed('Amazing Spider-Man by Nick Spencer Omnibus', 2, 'Marvel')
  seed('Batman Vol. 2 (New 52 TPB)', 10, 'DC Comics')
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

const get = (url: string) => app.inject({ method: 'GET', url })

test('GET /api/series groups the editions of one series together', async () => {
  const res = await get('/api/series')
  expect(res.statusCode).toBe(200)
  const { series } = res.json()
  expect(series.map((s: { name: string }) => s.name)).toEqual(['Amazing Spider-Man', 'Batman'])
  const asm = series[0]
  expect(asm.editions).toHaveLength(2)
  expect(asm.bookCount).toBe(5)
})

test('GET /api/series honours the publisher filter', async () => {
  const { series } = (await get('/api/series?publisher=DC%20Comics')).json()
  expect(series.map((s: { name: string }) => s.name)).toEqual(['Batman'])
})

test('GET /api/series/:name returns a single series', async () => {
  const res = await get(`/api/series/${encodeURIComponent('Amazing Spider-Man')}`)
  expect(res.statusCode).toBe(200)
  const { series } = res.json()
  expect(series.name).toBe('Amazing Spider-Man')
  expect(series.editions.map((e: { name: string }) => e.name)).toEqual([
    'Amazing Spider-Man (2025)', 'Amazing Spider-Man by Nick Spencer Omnibus',
  ])
})

test('GET /api/series/:name is case-insensitive', async () => {
  const res = await get(`/api/series/${encodeURIComponent('amazing spider-man')}`)
  expect(res.statusCode).toBe(200)
  expect(res.json().series.name).toBe('Amazing Spider-Man')
})

test('GET /api/series/:name 404s on an unknown series', async () => {
  const res = await get(`/api/series/${encodeURIComponent('Aquaman')}`)
  expect(res.statusCode).toBe(404)
})

test('PATCH /api/editions/:id moves an edition into another series', async () => {
  const joe = seed('Spider-Man By Joe Kelly Omnibus', 1, 'Marvel')
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/editions/${joe.id}`,
    payload: { seriesName: 'Amazing Spider-Man' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().edition.seriesName).toBe('Amazing Spider-Man')
  // the name is untouched, so nothing moved on disk
  expect(getEdition(app.db, joe.id)!.name).toBe('Spider-Man By Joe Kelly Omnibus')
  const { series } = (await get('/api/series')).json()
  expect(series.find((s: { name: string }) => s.name === 'Amazing Spider-Man').editions).toHaveLength(3)
})

test('PATCH /api/editions/:id with an empty body is still a 400', async () => {
  const edition = upsertEdition(app.db, { name: 'Solo', folder: 'Solo' })
  const res = await app.inject({ method: 'PATCH', url: `/api/editions/${edition.id}`, payload: {} })
  expect(res.statusCode).toBe(400)
})

test('PATCH /api/editions/:id clears the series when given an empty string', async () => {
  const edition = upsertEdition(app.db, { name: 'Solo', folder: 'Solo' })
  const res = await app.inject({
    method: 'PATCH', url: `/api/editions/${edition.id}`, payload: { seriesName: '' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().edition.seriesName).toBeNull()
})

function seedRead(name: string, kinds: ('unread' | 'reading' | 'read')[]) {
  const edition = upsertEdition(app.db, { name, folder: name })
  kinds.forEach((kind, i) => {
    const book = insertBook(app.db, {
      editionId: edition.id, filePath: `${name}/${i}.cbz`, pageCount: 10, fileSize: 100,
    })!
    if (kind === 'reading') setProgress(app.db, book.id, { lastPage: 4 })
    if (kind === 'read') setProgress(app.db, book.id, { lastPage: 9, completed: true })
  })
  return edition
}

test('GET /api/series filters by read state', async () => {
  seedRead('Finished Run', ['read', 'read'])
  seedRead('Halfway', ['reading', 'unread'])

  const unread = (await get('/api/series?readState=unread')).json()
  expect(unread.series.map((s: { name: string }) => s.name)).toContain('Halfway')
  expect(unread.series.map((s: { name: string }) => s.name)).not.toContain('Finished Run')

  const read = (await get('/api/series?readState=read')).json()
  expect(read.series.map((s: { name: string }) => s.name)).toEqual(['Finished Run'])
  expect(read.series[0].bookCount).toBe(2)

  const reading = (await get('/api/series?readState=reading')).json()
  expect(reading.series.map((s: { name: string }) => s.name)).toEqual(['Halfway'])
})

test('GET /api/series ignores an unknown read state instead of erroring', async () => {
  const all = (await get('/api/series')).json().series.length
  const res = await get('/api/series?readState=banana')
  expect(res.statusCode).toBe(200)
  expect(res.json().series).toHaveLength(all)
})

test('GET /api/read-states counts issues in each state', async () => {
  seedRead('Finished Run', ['read', 'read'])
  seedRead('Halfway', ['reading', 'unread'])

  const res = await get('/api/read-states')
  expect(res.statusCode).toBe(200)
  const byName = Object.fromEntries(
    res.json().readStates.map((r: { name: string; count: number }) => [r.name, r.count]),
  )
  // 15 issues from the beforeEach fixture have no progress, plus 1 unread here
  expect(byName.unread).toBe(16)
  expect(byName.reading).toBe(1)
  expect(byName.read).toBe(2)
})

test('GET /api/series read filter includes part-read series', async () => {
  seedRead('Part Read', ['read', 'unread'])
  const read = (await get('/api/series?readState=read')).json()
  expect(read.series.map((s: { name: string }) => s.name)).toContain('Part Read')
  const unread = (await get('/api/series?readState=unread')).json()
  expect(unread.series.map((s: { name: string }) => s.name)).toContain('Part Read')
})

test('GET /api/series reports the filtered issue count on each series', async () => {
  seedRead('Part Read', ['read', 'read', 'unread'])
  const read = (await get('/api/series?readState=read')).json()
  const partRead = read.series.find((s: { name: string }) => s.name === 'Part Read')
  expect(partRead.editions[0].bookCount).toBe(2)
  expect(partRead.bookCount).toBe(2)
})

test('GET /api/editions/:id lists only the issues in the requested state', async () => {
  const edition = seedRead('Mixed', ['unread', 'read', 'read', 'reading'])

  const all = (await get(`/api/editions/${edition.id}`)).json()
  expect(all.books).toHaveLength(4)

  const unread = (await get(`/api/editions/${edition.id}?readState=unread`)).json()
  expect(unread.books).toHaveLength(1)
  expect(unread.books[0].readState).toBe('unread')

  const read = (await get(`/api/editions/${edition.id}?readState=read`)).json()
  expect(read.books).toHaveLength(2)
  expect(read.books.every((b: { readState: string }) => b.readState === 'read')).toBe(true)

  const reading = (await get(`/api/editions/${edition.id}?readState=reading`)).json()
  expect(reading.books).toHaveLength(1)
})

test('GET /api/editions/:id ignores a junk read state', async () => {
  const edition = seedRead('Mixed', ['unread', 'read'])
  const res = await get(`/api/editions/${edition.id}?readState=banana`)
  expect(res.statusCode).toBe(200)
  expect(res.json().books).toHaveLength(2)
})

test('DELETE /api/series/:name removes every edition grouped under it', async () => {
  const res = await app.inject({
    method: 'DELETE',
    url: `/api/series/${encodeURIComponent('Amazing Spider-Man')}`,
  })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ deleted: true, editions: 2, books: 5 })

  const after = await get('/api/series')
  expect(after.json().series.map((s: { name: string }) => s.name)).toEqual(['Batman'])
})

test('DELETE /api/series/:name 404s on a series that matches nothing', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/series/Nope' })
  expect(res.statusCode).toBe(404)
  expect(res.json()).toEqual({ error: 'series not found' })
})
