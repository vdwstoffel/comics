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
        character_credits: [{ id: 1699, name: 'Batman' }, { id: 9268, name: 'The Joker' }],
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
  expect(issue.characters).toEqual([{ id: 1699, name: 'Batman' }, { id: 9268, name: 'The Joker' }])
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
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, getBook } from '../server/models/books.js'
import { getEdition } from '../server/models/editions.js'
import { getBookTags } from '../server/models/metadata.js'
import { makeCbz } from './helpers/makeCbz.js'
import { readZipEntry } from './helpers/readZipEntry.js'
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

  const edition = upsertEdition(db, { name: 'Batman', folder: 'Batman' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Batman/001.cbz', pageCount: 1, fileSize: 100 })!

  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/books/${book.id}/comicvine`,
      payload: { issueId: 42 },
    })
    expect(res.statusCode).toBe(200)
    const updatedBook = getBook(db, book.id)!
    expect(updatedBook.publisher).toBe('DC')
    const updatedSeries = getEdition(db, edition.id)!
    expect(updatedSeries.publisher).toBe('DC')
  } finally {
    globalThis.fetch = origFetch
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applying an issue embeds its metadata, credits and tags into the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-embed-'))
  mkdirSync(join(dir, 'Batman'), { recursive: true })
  await makeCbz(join(dir, 'Batman'), ['p1.png'], '001.cbz')

  const mockFetchImpl = mockFetch([
    ['/issue/', { results: {
      name: 'Shed', issue_number: '12', cover_date: '2011-11-01', description: null,
      volume: { name: 'Batman', id: 7890 },
      person_credits: [
        { name: 'Scott Snyder', role: 'writer' },
        { name: 'Greg Capullo', role: 'penciller, cover' },
      ],
      character_credits: [{ name: 'Batman' }, { name: 'Commissioner Gordon' }],
      team_credits: [{ name: 'Court of Owls' }],
      story_arc_credits: [{ name: 'The Black Mirror' }],
    } }],
    ['/volume/', { results: { name: 'Batman', publisher: { name: 'DC' }, description: null } }],
  ])

  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { comicVineApiKey: 'test-key', comicsDir: dir, thumbsDir: dir } as Config)
  const origFetch = globalThis.fetch
  globalThis.fetch = mockFetchImpl as unknown as typeof fetch

  await app.register(comicvineRoutes)
  const edition = upsertEdition(db, { name: 'Batman', folder: 'Batman' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Batman/001.cbz', pageCount: 1, fileSize: 100 })!

  try {
    const res = await app.inject({
      method: 'POST', url: `/api/books/${book.id}/comicvine`, payload: { issueId: 42 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().book.comicinfoSynced).toBe(true)

    const xml = await readZipEntry(join(dir, 'Batman', '001.cbz'), 'ComicInfo.xml')
    expect(xml).toContain('<Title>Shed</Title>')
    expect(xml).toContain('<Writer>Scott Snyder</Writer>')
    expect(xml).toContain('<CoverArtist>Greg Capullo</CoverArtist>')
    expect(xml).toContain('<Characters>Batman, Commissioner Gordon</Characters>')
    expect(xml).toContain('<Teams>Court of Owls</Teams>')
    expect(xml).toContain('<StoryArc>The Black Mirror</StoryArc>')
  } finally {
    globalThis.fetch = origFetch
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

// The grid of candidates needs art big enough to read; thumb_url is 104x160, while
// small_url is 418x640. Both are mapped so a caller can pick the size it wants.
test('search maps the small image as the cover, keeping the thumbnail', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([
      ['/search/', { results: [{ id: 42, name: 'Batman', issue_number: '1',
        image: { thumb_url: 'scale_avatar/t.jpg', small_url: 'scale_small/s.jpg' } }] }],
    ]),
  })
  const [result] = await cv.search('batman', 'issue')
  expect(result).toMatchObject({ cover: 'scale_small/s.jpg', thumbnail: 'scale_avatar/t.jpg' })
})

test('a result with no small image falls back to the thumbnail for its cover', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([
      ['/search/', { results: [{ id: 42, name: 'Batman', image: { thumb_url: 't.jpg' } }] }],
    ]),
  })
  const [result] = await cv.search('batman', 'issue')
  expect(result.cover).toBe('t.jpg')
})

// --- character lookup -------------------------------------------------------

const HOBGOBLIN = {
  id: 7605,
  name: 'Hobgoblin (Kingsley)',
  real_name: 'Roderick Kingsley',
  // Comic Vine returns aliases as one newline-separated string, not a list.
  aliases: 'Roderick Kingsley\nHobgoblin\nDevil-Spider\nHobgobbler',
  deck: 'Roderick Kingsley became a worthy heir of the Goblin legacy.',
  publisher: { name: 'Marvel' },
  first_appeared_in_issue: { id: 20469, name: 'Pretty Poison', issue_number: '43' },
  count_of_issue_appearances: 576,
  image: { small_url: 'small.jpg', thumb_url: 'thumb.jpg' },
  site_detail_url: 'https://comicvine.gamespot.com/hobgoblin/4005-7605/',
}

test('getCharacter maps the fields the card renders', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([['/character/', { results: HOBGOBLIN }]]),
  })
  const c = await cv.getCharacter(7605)
  expect(c).toMatchObject({
    id: 7605,
    name: 'Hobgoblin (Kingsley)',
    realName: 'Roderick Kingsley',
    deck: 'Roderick Kingsley became a worthy heir of the Goblin legacy.',
    publisher: 'Marvel',
    firstAppearance: 'Pretty Poison #43',
    appearanceCount: 576,
    imageUrl: 'small.jpg',
    siteUrl: 'https://comicvine.gamespot.com/hobgoblin/4005-7605/',
  })
})

test('getCharacter splits the newline-separated aliases into a list', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([['/character/', { results: HOBGOBLIN }]]),
  })
  const c = await cv.getCharacter(7605)
  expect(c.aliases).toEqual(['Roderick Kingsley', 'Hobgoblin', 'Devil-Spider', 'Hobgobbler'])
})

test('getCharacter has no aliases when the field is absent', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([['/character/', { results: { id: 1, name: 'Nobody' } }]]),
  })
  const c = await cv.getCharacter(1)
  expect(c.aliases).toEqual([])
})

// The card renders the profile behind an expander, so it has to come down with the card.
// One 30KB request beats a second round trip against a 200/hour budget.
test('getCharacter requests the description the profile is built from', async () => {
  const urls: string[] = []
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => ({ results: HOBGOBLIN }) }
    },
  })
  await cv.getCharacter(7605)
  const fieldList = new URL(urls[0]).searchParams.get('field_list')!
  expect(fieldList).toContain('description')
  expect(fieldList).toContain('deck')
})

// issue_credits is 576 entries for Hobgoblin and nothing renders it; it would triple the
// payload on its own.
test('getCharacter does not request the issue or volume credit lists', async () => {
  const urls: string[] = []
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => ({ results: HOBGOBLIN }) }
    },
  })
  await cv.getCharacter(7605)
  const fieldList = new URL(urls[0]).searchParams.get('field_list')!
  expect(fieldList).not.toContain('issue_credits')
  expect(fieldList).not.toContain('volume_credits')
})

test('getCharacter turns the description into renderable blocks', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([['/character/', { results: {
      ...HOBGOBLIN,
      description: '<h2>Origin</h2><p>Roderick Kingsley was a <b>famous</b> designer.</p>',
    } }]]),
  })
  const c = await cv.getCharacter(7605)
  expect(c.profile).toEqual([
    { kind: 'heading', level: 2, text: 'Origin' },
    { kind: 'para', text: 'Roderick Kingsley was a famous designer.' },
  ])
})

test('a character with no description has an empty profile', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([['/character/', { results: { id: 1, name: 'Nobody' } }]]),
  })
  expect((await cv.getCharacter(1)).profile).toEqual([])
})

test('getCharacter addresses the character resource by its 4005 prefix', async () => {
  const urls: string[] = []
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => ({ results: HOBGOBLIN }) }
    },
  })
  await cv.getCharacter(7605)
  expect(urls[0]).toContain('/character/4005-7605/')
})

test('applying an issue stores the Comic Vine id alongside each character tag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-charid-'))
  mkdirSync(join(dir, 'Spider-Man'), { recursive: true })
  await makeCbz(join(dir, 'Spider-Man'), ['p1.png'], '238.cbz')

  const mockFetchImpl = mockFetch([
    ['/issue/', { results: {
      name: 'The Hobgoblin', issue_number: '238', cover_date: '1983-03-01', description: null,
      volume: { name: 'The Amazing Spider-Man', id: 2127 },
      person_credits: [],
      character_credits: [{ id: 1443, name: 'Spider-Man' }, { id: 7605, name: 'Hobgoblin (Kingsley)' }],
      team_credits: [{ id: 999, name: 'Sinister Six' }],
    } }],
    ['/volume/', { results: { name: 'The Amazing Spider-Man', publisher: { name: 'Marvel' }, description: null } }],
  ])

  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { comicVineApiKey: 'test-key', comicsDir: dir, thumbsDir: dir } as Config)
  const origFetch = globalThis.fetch
  globalThis.fetch = mockFetchImpl as unknown as typeof fetch

  await app.register(comicvineRoutes)
  const edition = upsertEdition(db, { name: 'Spider-Man', folder: 'Spider-Man' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Spider-Man/238.cbz', pageCount: 1, fileSize: 100 })!

  try {
    const res = await app.inject({
      method: 'POST', url: `/api/books/${book.id}/comicvine`, payload: { issueId: 42 },
    })
    expect(res.statusCode).toBe(200)
    const tags = getBookTags(db, book.id)
    expect(tags).toContainEqual({ kind: 'character', value: 'Spider-Man', extId: 1443 })
    expect(tags).toContainEqual({ kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 })
  } finally {
    globalThis.fetch = origFetch
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
