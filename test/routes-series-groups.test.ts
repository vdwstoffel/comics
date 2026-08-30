import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import seriesRoutes from '../server/routes/series.js'
import { upsertSeries, updateSeries, getSeries } from '../server/models/series.js'
import { insertBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance

function seed(name: string, books: number, publisher: string) {
  const series = upsertSeries(app.db, { name, folder: name })
  updateSeries(app.db, series.id, { publisher })
  for (let i = 0; i < books; i++) {
    insertBook(app.db, { seriesId: series.id, filePath: `${name}/${i}.cbz`, pageCount: 10, fileSize: 100 })
  }
  return series
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sg-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(config.comicsDir, { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(seriesRoutes)

  seed('Amazing Spider-Man (2025)', 3, 'Marvel')
  seed('Amazing Spider-Man by Nick Spencer Omnibus', 2, 'Marvel')
  seed('Batman Vol. 2 (New 52 TPB)', 10, 'DC Comics')
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

const get = (url: string) => app.inject({ method: 'GET', url })

test('GET /api/series-groups groups the editions of one franchise together', async () => {
  const res = await get('/api/series-groups')
  expect(res.statusCode).toBe(200)
  const { groups } = res.json()
  expect(groups.map((g: { name: string }) => g.name)).toEqual(['Amazing Spider-Man', 'Batman'])
  const asm = groups[0]
  expect(asm.series).toHaveLength(2)
  expect(asm.bookCount).toBe(5)
})

test('GET /api/series-groups honours the publisher filter', async () => {
  const { groups } = (await get('/api/series-groups?publisher=DC%20Comics')).json()
  expect(groups.map((g: { name: string }) => g.name)).toEqual(['Batman'])
})

test('GET /api/series-groups/:name returns a single group', async () => {
  const res = await get(`/api/series-groups/${encodeURIComponent('Amazing Spider-Man')}`)
  expect(res.statusCode).toBe(200)
  const { group } = res.json()
  expect(group.name).toBe('Amazing Spider-Man')
  expect(group.series.map((s: { name: string }) => s.name)).toEqual([
    'Amazing Spider-Man (2025)', 'Amazing Spider-Man by Nick Spencer Omnibus',
  ])
})

test('GET /api/series-groups/:name is case-insensitive', async () => {
  const res = await get(`/api/series-groups/${encodeURIComponent('amazing spider-man')}`)
  expect(res.statusCode).toBe(200)
  expect(res.json().group.name).toBe('Amazing Spider-Man')
})

test('GET /api/series-groups/:name 404s on an unknown group', async () => {
  const res = await get(`/api/series-groups/${encodeURIComponent('Aquaman')}`)
  expect(res.statusCode).toBe(404)
})

test('PATCH /api/series/:id moves a series into another group', async () => {
  const joe = seed('Spider-Man By Joe Kelly Omnibus', 1, 'Marvel')
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/series/${joe.id}`,
    payload: { groupName: 'Amazing Spider-Man' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().series.groupName).toBe('Amazing Spider-Man')
  // the name is untouched, so nothing moved on disk
  expect(getSeries(app.db, joe.id)!.name).toBe('Spider-Man By Joe Kelly Omnibus')
  const { groups } = (await get('/api/series-groups')).json()
  expect(groups.find((g: { name: string }) => g.name === 'Amazing Spider-Man').series).toHaveLength(3)
})

test('PATCH /api/series/:id with an empty body is still a 400', async () => {
  const series = upsertSeries(app.db, { name: 'Solo', folder: 'Solo' })
  const res = await app.inject({ method: 'PATCH', url: `/api/series/${series.id}`, payload: {} })
  expect(res.statusCode).toBe(400)
})

test('PATCH /api/series/:id clears a group when given an empty string', async () => {
  const series = upsertSeries(app.db, { name: 'Solo', folder: 'Solo' })
  const res = await app.inject({
    method: 'PATCH', url: `/api/series/${series.id}`, payload: { groupName: '' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().series.groupName).toBeNull()
})

function seedRead(name: string, kinds: ('unread' | 'reading' | 'read')[]) {
  const series = upsertSeries(app.db, { name, folder: name })
  kinds.forEach((kind, i) => {
    const book = insertBook(app.db, {
      seriesId: series.id, filePath: `${name}/${i}.cbz`, pageCount: 10, fileSize: 100,
    })!
    if (kind === 'reading') setProgress(app.db, book.id, { lastPage: 4 })
    if (kind === 'read') setProgress(app.db, book.id, { lastPage: 9, completed: true })
  })
  return series
}

test('GET /api/series-groups filters by read state', async () => {
  seedRead('Finished Run', ['read', 'read'])
  seedRead('Halfway', ['reading', 'unread'])

  const unread = (await get('/api/series-groups?readState=unread')).json()
  expect(unread.groups.map((g: { name: string }) => g.name)).toContain('Halfway')
  expect(unread.groups.map((g: { name: string }) => g.name)).not.toContain('Finished Run')

  const read = (await get('/api/series-groups?readState=read')).json()
  expect(read.groups.map((g: { name: string }) => g.name)).toEqual(['Finished Run'])
  expect(read.groups[0].bookCount).toBe(2)

  const reading = (await get('/api/series-groups?readState=reading')).json()
  expect(reading.groups.map((g: { name: string }) => g.name)).toEqual(['Halfway'])
})

test('GET /api/series-groups ignores an unknown read state instead of erroring', async () => {
  const all = (await get('/api/series-groups')).json().groups.length
  const res = await get('/api/series-groups?readState=banana')
  expect(res.statusCode).toBe(200)
  expect(res.json().groups).toHaveLength(all)
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

test('GET /api/series-groups read filter includes part-read series', async () => {
  seedRead('Part Read', ['read', 'unread'])
  const read = (await get('/api/series-groups?readState=read')).json()
  expect(read.groups.map((g: { name: string }) => g.name)).toContain('Part Read')
  const unread = (await get('/api/series-groups?readState=unread')).json()
  expect(unread.groups.map((g: { name: string }) => g.name)).toContain('Part Read')
})

test('GET /api/series-groups reports the filtered issue count on each series', async () => {
  seedRead('Part Read', ['read', 'read', 'unread'])
  const read = (await get('/api/series-groups?readState=read')).json()
  const group = read.groups.find((g: { name: string }) => g.name === 'Part Read')
  expect(group.series[0].bookCount).toBe(2)
  expect(group.bookCount).toBe(2)
})

test('GET /api/series/:id lists only the issues in the requested state', async () => {
  const series = seedRead('Mixed', ['unread', 'read', 'read', 'reading'])

  const all = (await get(`/api/series/${series.id}`)).json()
  expect(all.books).toHaveLength(4)

  const unread = (await get(`/api/series/${series.id}?readState=unread`)).json()
  expect(unread.books).toHaveLength(1)
  expect(unread.books[0].readState).toBe('unread')

  const read = (await get(`/api/series/${series.id}?readState=read`)).json()
  expect(read.books).toHaveLength(2)
  expect(read.books.every((b: { readState: string }) => b.readState === 'read')).toBe(true)

  const reading = (await get(`/api/series/${series.id}?readState=reading`)).json()
  expect(reading.books).toHaveLength(1)
})

test('GET /api/series/:id ignores a junk read state', async () => {
  const series = seedRead('Mixed', ['unread', 'read'])
  const res = await get(`/api/series/${series.id}?readState=banana`)
  expect(res.statusCode).toBe(200)
  expect(res.json().books).toHaveLength(2)
})
