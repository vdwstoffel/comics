import { test, expect } from 'vitest'
import { createComicVine } from '../server/lib/comicvine.js'

function mockFetch(routes: Array<[string, unknown]>) {
  return async (url: string) => {
    for (const [needle, body] of routes) {
      if (url.includes(needle)) return { ok: true, json: async () => body }
    }
    throw new Error(`unexpected url ${url}`)
  }
}

test('search maps issue results', async () => {
  const cv = createComicVine({
    apiKey: 'k',
    now: () => 0,
    fetchImpl: mockFetch([
      ['/search/', { results: [{ id: 42, name: 'Batman', issue_number: '1',
        cover_date: '2011-11-01', image: { thumb_url: 't.jpg' },
        volume: { name: 'Batman' } }] }],
    ]),
  })
  const results = await cv.search('batman', 'issue')
  expect(results[0]).toMatchObject({ id: 42, name: 'Batman', issueNumber: '1', year: '2011' })
})

test('getIssue maps fields and strips html', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([
      ['/issue/', { results: {
        name: 'Year One', issue_number: '1', cover_date: '2011-11-01',
        description: '<p>Bruce returns.</p>',
        person_credits: [{ name: 'Scott Snyder', role: 'writer' }, { name: 'Greg Capullo', role: 'penciler' }],
        image: { original_url: 'cover.jpg' },
      } }],
    ]),
  })
  const issue = await cv.getIssue(42)
  expect(issue).toMatchObject({
    title: 'Year One', number: '1', date: '2011-11',
    summary: 'Bruce returns.', writer: 'Scott Snyder', penciller: 'Greg Capullo', coverUrl: 'cover.jpg',
  })
})

import Fastify from 'fastify'
import comicvineRoutes from '../server/routes/comicvine.js'
import { openDb } from '../server/db.js'
import type { Config } from '../server/config.js'

test('search route 400s when no API key configured', async () => {
  const app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', { comicVineApiKey: '' } as Config)
  await app.register(comicvineRoutes)
  const res = await app.inject({ url: '/api/comicvine/search?q=batman' })
  expect(res.statusCode).toBe(400)
  await app.close()
})
