import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import seriesRoutes from '../server/routes/series.js'
import { upsertSeries, updateSeries, getSeries } from '../server/models/series.js'
import { insertBook } from '../server/models/books.js'
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
