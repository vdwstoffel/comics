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

test('getIssue maps rich fields: multi-role credits, characters, teams, arcs, year, siteUrl', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([
      ['/issue/', { results: {
        name: 'Year One', issue_number: '1', cover_date: '2011-11-01',
        description: '<p>Bruce returns.</p>',
        person_credits: [
          { name: 'Scott Snyder', role: 'writer, cover' },
          { name: 'Greg Capullo', role: 'penciler' },
          { name: 'Jonathan Glapion', role: 'inker' },
        ],
        character_credits: [{ name: 'Batman' }, { name: 'The Joker' }],
        team_credits: [{ name: 'Justice League' }],
        story_arc_credits: [{ name: 'Court of Owls' }],
        image: { original_url: 'https://example.com/cover.jpg' },
        site_detail_url: 'https://comicvine.gamespot.com/batman-1/4000-12345/',
      } }],
    ]),
  })
  const issue = await cv.getIssue(42)

  // Basic fields
  expect(issue.title).toBe('Year One')
  expect(issue.year).toBe(2011)
  expect(issue.coverUrl).toBe('https://example.com/cover.jpg')
  expect(issue.siteUrl).toBe('https://comicvine.gamespot.com/batman-1/4000-12345/')

  // Multi-role split: "writer, cover" → two separate entries
  expect(issue.credits).toContainEqual({ name: 'Scott Snyder', role: 'writer' })
  expect(issue.credits).toContainEqual({ name: 'Scott Snyder', role: 'cover' })
  expect(issue.credits).toContainEqual({ name: 'Greg Capullo', role: 'penciler' })
  expect(issue.credits).toContainEqual({ name: 'Jonathan Glapion', role: 'inker' })
  // 4 entries total: 2 from Snyder + 1 each from Capullo and Glapion
  expect(issue.credits).toHaveLength(4)

  // Arrays
  expect(issue.characters).toEqual(['Batman', 'The Joker'])
  expect(issue.teams).toEqual(['Justice League'])
  expect(issue.storyArcs).toEqual(['Court of Owls'])
})

test('getIssue returns empty arrays when no credits/tags', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([
      ['/issue/', { results: {
        name: 'Empty Issue', issue_number: '2', cover_date: '2020-01-01',
        description: null,
      } }],
    ]),
  })
  const issue = await cv.getIssue(99)
  expect(issue.credits).toEqual([])
  expect(issue.characters).toEqual([])
  expect(issue.teams).toEqual([])
  expect(issue.storyArcs).toEqual([])
  expect(issue.year).toBe(2020)
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
