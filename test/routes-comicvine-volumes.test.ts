import { test, expect } from 'vitest'
import Fastify from 'fastify'
import comicvineRoutes from '../server/routes/comicvine.js'
import { openDb } from '../server/db.js'
import { cacheVolumeSearch } from '../server/models/volumeSearch.js'
import type { Config } from '../server/config.js'

const RESULTS = [
  {
    id: 86113, name: 'Mighty Thor', start_year: '2016', publisher: { name: 'Marvel' },
    count_of_issues: 30, deck: 'Jane Foster lifts the hammer.',
    image: { thumb_url: 't.jpg' },
    site_detail_url: 'https://comicvine.gamespot.com/mighty-thor/4050-86113/',
  },
  { id: 39763, name: 'The Mighty Thor', start_year: '2011', publisher: { name: 'Marvel' }, count_of_issues: 23 },
]

/** A server whose Comic Vine calls are counted, so "did it ask again?" is testable. */
function app(db: ReturnType<typeof openDb>, opts: { apiKey?: string; fails?: boolean } = {}) {
  const { apiKey = 'k', fails = false } = opts
  const calls: string[] = []
  globalThis.fetch = (async (url: string) => {
    calls.push(url)
    if (fails) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, json: async () => ({ results: RESULTS }) }
  }) as never
  const server = Fastify()
  server.decorate('db', db)
  server.decorate('config', { comicVineApiKey: apiKey } as Config)
  return { server, calls }
}

test('a series lookup answers with the volumes Comic Vine offers, in its order', async () => {
  const db = openDb(':memory:')
  const { server } = app(db)
  await server.register(comicvineRoutes)

  const res = await server.inject({ method: 'GET', url: '/api/comicvine/volumes?series=The Mighty Thor' })

  expect(res.statusCode).toBe(200)
  expect(res.json().volumes).toEqual([
    {
      id: 86113, name: 'Mighty Thor', startYear: 2016, publisher: 'Marvel',
      issueCount: 30, deck: 'Jane Foster lifts the hammer.', thumbnail: 't.jpg',
      siteUrl: 'https://comicvine.gamespot.com/mighty-thor/4050-86113/',
    },
    { id: 39763, name: 'The Mighty Thor', startYear: 2011, publisher: 'Marvel', issueCount: 23 },
  ])
  expect(res.json().stale).toBe(false)
  await server.close()
  db.close()
})

test('asking for the same series twice reaches Comic Vine once', async () => {
  const db = openDb(':memory:')
  const { server, calls } = app(db)
  await server.register(comicvineRoutes)

  await server.inject({ method: 'GET', url: '/api/comicvine/volumes?series=The Mighty Thor' })
  const second = await server.inject({ method: 'GET', url: '/api/comicvine/volumes?series=the mighty thor' })

  expect(calls).toHaveLength(1)
  expect(second.json().volumes.map((v: { id: number }) => v.id)).toEqual([86113, 39763])
  await server.close()
  db.close()
})

test('a series with no volumes is remembered, so it is not asked a second time', async () => {
  const db = openDb(':memory:')
  const { server, calls } = app(db)
  globalThis.fetch = (async (url: string) => {
    calls.push(url)
    return { ok: true, json: async () => ({ results: [] }) }
  }) as never
  await server.register(comicvineRoutes)

  await server.inject({ method: 'GET', url: '/api/comicvine/volumes?series=Nothing At All' })
  const second = await server.inject({ method: 'GET', url: '/api/comicvine/volumes?series=Nothing At All' })

  expect(calls).toHaveLength(1)
  expect(second.json().volumes).toEqual([])
  await server.close()
  db.close()
})

test('when Comic Vine will not answer, a stale list is served and flagged as stale', async () => {
  const db = openDb(':memory:')
  cacheVolumeSearch(db, 'The Mighty Thor', [{ id: 86113, name: 'Mighty Thor', startYear: 2016 }], '2020-01-01T00:00:00.000Z')
  const { server } = app(db, { fails: true })
  await server.register(comicvineRoutes)

  const res = await server.inject({ method: 'GET', url: '/api/comicvine/volumes?series=The Mighty Thor' })

  expect(res.statusCode).toBe(200)
  expect(res.json().volumes.map((v: { id: number }) => v.id)).toEqual([86113])
  expect(res.json().stale).toBe(true)
  await server.close()
  db.close()
})

test('when Comic Vine will not answer and nothing is held, the lookup fails rather than showing an empty list', async () => {
  const db = openDb(':memory:')
  const { server } = app(db, { fails: true })
  await server.register(comicvineRoutes)

  const res = await server.inject({ method: 'GET', url: '/api/comicvine/volumes?series=The Mighty Thor' })

  expect(res.statusCode).toBe(502)
  await server.close()
  db.close()
})

test('a lookup without a series name is a bad request', async () => {
  const db = openDb(':memory:')
  const { server } = app(db)
  await server.register(comicvineRoutes)

  const res = await server.inject({ method: 'GET', url: '/api/comicvine/volumes?series=   ' })

  expect(res.statusCode).toBe(400)
  await server.close()
  db.close()
})

test('with no API key configured the lookup says so rather than failing obscurely', async () => {
  const db = openDb(':memory:')
  const { server } = app(db, { apiKey: '' })
  await server.register(comicvineRoutes)

  const res = await server.inject({ method: 'GET', url: '/api/comicvine/volumes?series=The Mighty Thor' })

  expect(res.statusCode).toBe(400)
  expect(res.json().error).toMatch(/api key/i)
  await server.close()
  db.close()
})
