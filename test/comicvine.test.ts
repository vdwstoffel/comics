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

test('getIssue returns volumeId from volume.id', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([
      ['/issue/', { results: {
        name: 'Year One', issue_number: '1', cover_date: '2011-11-01',
        description: null,
        volume: { name: 'Batman', id: 7890 },
      } }],
    ]),
  })
  const issue = await cv.getIssue(42)
  expect(issue.volumeId).toBe(7890)
})

test('getIssue volumeId is undefined when volume has no id', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([
      ['/issue/', { results: {
        name: 'Year One', issue_number: '1', cover_date: '2011-11-01',
        description: null,
        volume: { name: 'Batman' },
      } }],
    ]),
  })
  const issue = await cv.getIssue(42)
  expect(issue.volumeId).toBeUndefined()
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
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import comicvineRoutes from '../server/routes/comicvine.js'
import { openDb } from '../server/db.js'
import { upsertSeries } from '../server/models/series.js'
import { insertBook, getBook } from '../server/models/books.js'
import { getSeries } from '../server/models/series.js'
import { makeCbz } from './helpers/makeCbz.js'
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

test('apply route stores publisher on book and series when getVolume returns one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-apply-'))
  mkdirSync(join(dir, 'Batman'), { recursive: true })
  await makeCbz(join(dir, 'Batman'), ['p1.png'], '001.cbz')

  // Mock fetch: issue returns volumeId 7890; volume returns publisher "DC"
  const mockFetchImpl = mockFetch([
    ['/issue/', { results: {
      name: 'Year One', issue_number: '1', cover_date: '2011-11-01',
      description: null,
      volume: { name: 'Batman', id: 7890 },
      person_credits: [],
    } }],
    ['/volume/', { results: {
      name: 'Batman',
      publisher: { name: 'DC' },
      description: null,
    } }],
  ])

  const app = Fastify()
  const db = openDb(':memory:')
  const config = { comicVineApiKey: 'test-key', comicsDir: dir, thumbsDir: dir } as Config
  app.decorate('db', db)
  app.decorate('config', config)
  // Override fetch in the module by injecting via the client — we pass a mock fetch to the route
  // by replacing globalThis.fetch before the module uses it
  const origFetch = globalThis.fetch
  globalThis.fetch = mockFetchImpl as unknown as typeof fetch

  await app.register(comicvineRoutes)

  const series = upsertSeries(db, { name: 'Batman', folder: 'Batman' })
  const book = insertBook(db, { seriesId: series.id, filePath: 'Batman/001.cbz', pageCount: 1, fileSize: 100 })!

  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/books/${book.id}/comicvine`,
      payload: { issueId: 42 },
    })
    expect(res.statusCode).toBe(200)
    const updatedBook = getBook(db, book.id)!
    expect(updatedBook.publisher).toBe('DC')
    const updatedSeries = getSeries(db, series.id)!
    expect(updatedSeries.publisher).toBe('DC')
  } finally {
    globalThis.fetch = origFetch
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
