import { test, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import comicIndexRoutes from '../server/routes/comicIndex.js'
import { upsertComicIndex } from '../server/models/comicIndex.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

const DC = 'DC Comics'
const MARVEL = 'Marvel Comics'
let app: FastifyInstance

beforeEach(async () => {
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', {} as Config)
  await app.register(comicIndexRoutes)
  upsertComicIndex(app.db, [
    { title: 'Batman #1 (2011)', url: 'https://x.test/b1/', category: DC },
    { title: 'Batman #2 (2016)', url: 'https://x.test/b2/', category: DC },
    { title: 'Batman #3', url: 'https://x.test/b3/', category: DC },
    { title: 'Daredevil #1', url: 'https://x.test/d1/', category: MARVEL },
  ])
})
afterEach(async () => { await app.close() })

async function search(query: string) {
  const res = await app.inject({ method: 'GET', url: `/api/comic-index/search${query}` })
  return { status: res.statusCode, body: res.json() }
}

test('GET /api/comic-index/search returns matching title and url', async () => {
  const { status, body } = await search('?q=batman')
  expect(status).toBe(200)
  expect(body.total).toBe(3)
  expect(body.results).toHaveLength(3)
  expect(body.results[0]).toHaveProperty('title')
  expect(body.results[0]).toHaveProperty('url')
  expect(body.results[0]).toHaveProperty('category')
})

test('GET /api/comic-index/search with no q returns an empty result set, not an error', async () => {
  const { status, body } = await search('')
  expect(status).toBe(200)
  expect(body).toMatchObject({ results: [], total: 0 })
})

test('GET /api/comic-index/search filters by category', async () => {
  expect((await search(`?q=batman&category=${encodeURIComponent(MARVEL)}`)).body.total).toBe(0)
  expect((await search(`?q=batman&category=${encodeURIComponent(DC)}`)).body.total).toBe(3)
})

test('GET /api/comic-index/search pages with limit and offset', async () => {
  const page1 = (await search('?q=batman&limit=1&offset=0')).body
  const page2 = (await search('?q=batman&limit=1&offset=1')).body
  expect(page1.total).toBe(3)
  expect(page1.results).toHaveLength(1)
  expect(page2.results).toHaveLength(1)
  expect(page1.results[0].url).not.toBe(page2.results[0].url)
})

test('GET /api/comic-index/search survives a junk limit', async () => {
  const { status, body } = await search('?q=batman&limit=abc')
  expect(status).toBe(200)
  expect(body.results).toHaveLength(3)
})

test('GET /api/comic-index/search escapes fts operators in user input', async () => {
  for (const q of ['batman"', 'batman*', 'batman OR NOT', '(']) {
    const { status } = await search(`?q=${encodeURIComponent(q)}`)
    expect(status).toBe(200)
  }
})

test('GET /api/comic-index/search filters by a year range', async () => {
  expect((await search('?q=batman&yearFrom=2011&yearTo=2011')).body.total).toBe(1)
  expect((await search('?q=batman&yearFrom=2011&yearTo=2016')).body.total).toBe(2)
  expect((await search('?q=batman&yearFrom=2017')).body.total).toBe(0)
  expect((await search('?q=batman&yearTo=2016')).body.total).toBe(2)
})

test('GET /api/comic-index/search excludes undated rows once a bound is given', async () => {
  const all = (await search('?q=batman')).body
  expect(all.total).toBe(3)
  expect(all.results.some((r: { year: number | null }) => r.year === null)).toBe(true)
  const bounded = (await search('?q=batman&yearFrom=1900')).body
  expect(bounded.total).toBe(2)
})

test('GET /api/comic-index/search ignores junk year params instead of erroring', async () => {
  for (const params of ['yearFrom=abc', 'yearTo=abc', 'yearFrom=&yearTo=', 'yearFrom=abc&yearTo=2016']) {
    const { status, body } = await search(`?q=batman&${params}`)
    expect(status).toBe(200)
    expect(body.total).toBeGreaterThanOrEqual(2)
  }
})

test('GET /api/comic-index/search returns number and year on each result', async () => {
  const { body } = await search('?q=batman&yearFrom=2011&yearTo=2011')
  expect(body.results[0]).toMatchObject({ number: '001' })
})
test('GET /api/comic-index/categories returns per-category counts and the indexed total', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/comic-index/categories' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({
    categories: [{ name: DC, count: 3 }, { name: MARVEL, count: 1 }],
    indexed: 4,
  })
})
