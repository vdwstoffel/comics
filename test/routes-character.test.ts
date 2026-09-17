import { test, expect } from 'vitest'
import Fastify from 'fastify'
import comicvineRoutes from '../server/routes/comicvine.js'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags, getBookTags } from '../server/models/metadata.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

const CHARACTER = {
  id: 7605,
  name: 'Hobgoblin (Kingsley)',
  real_name: 'Roderick Kingsley',
  deck: 'Roderick Kingsley became a worthy heir of the Goblin legacy.',
  publisher: { name: 'Marvel' },
  count_of_issue_appearances: 576,
  image: { small_url: 'hobgoblin.jpg' },
  site_detail_url: 'https://comicvine.gamespot.com/hobgoblin/4005-7605/',
}

const ISSUE = {
  name: 'The Hobgoblin', issue_number: '238', cover_date: '1983-03-01', description: null,
  character_credits: [{ id: 1443, name: 'Spider-Man' }, { id: 7605, name: 'Hobgoblin (Kingsley)' }],
}

/** Records every URL requested so a test can assert how many calls a lookup cost. */
function recordingFetch(routes: Array<[string, unknown]>) {
  const urls: string[] = []
  const impl = async (url: string) => {
    urls.push(url)
    for (const [needle, body] of routes) {
      if (url.includes(needle)) return { ok: true, json: async () => body }
    }
    throw new Error(`unexpected url ${url}`)
  }
  return { urls, impl }
}

async function setup(routes: Array<[string, unknown]>, apiKey = 'test-key') {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  // The key is a setting now, not configuration. A suite that passes '' is testing the
  // unconfigured path and seeds nothing.
  if (apiKey) setComicVineKey(db, apiKey)
  const { urls, impl } = recordingFetch(routes)
  const origFetch = globalThis.fetch
  globalThis.fetch = impl as unknown as typeof fetch
  await app.register(comicvineRoutes)

  const edition = upsertEdition(db, { name: 'Spider-Man', folder: 'Spider-Man' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Spider-Man/238.cbz', pageCount: 1, fileSize: 100 })!

  return {
    app, db, book, urls,
    lookup: (name: string) =>
      app.inject({ url: `/api/books/${book.id}/character?name=${encodeURIComponent(name)}` }),
    cleanup: async () => { globalThis.fetch = origFetch; await app.close() },
  }
}

test('a character tag with an id is fetched directly, in one request', async () => {
  const t = await setup([['/character/', { results: CHARACTER }]])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 }])
  try {
    const res = await t.lookup('Hobgoblin (Kingsley)')
    expect(res.statusCode).toBe(200)
    expect(res.json().character).toMatchObject({
      name: 'Hobgoblin (Kingsley)', realName: 'Roderick Kingsley', publisher: 'Marvel',
    })
    expect(t.urls).toHaveLength(1)
    expect(t.urls[0]).toContain('/character/4005-7605/')
  } finally { await t.cleanup() }
})

// The identity came from the issue's own credits, so it is the right Hobgoblin.
test('a character resolved by id is reported as verified', async () => {
  const t = await setup([['/character/', { results: CHARACTER }]])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 }])
  try {
    expect((await t.lookup('Hobgoblin (Kingsley)')).json().verified).toBe(true)
  } finally { await t.cleanup() }
})

test('a character tag with no id backfills every character id on the book from its issue', async () => {
  const t = await setup([['/issue/', { results: ISSUE }], ['/character/', { results: CHARACTER }]])
  updateBook(t.db, t.book.id, { comicvineId: 42 })
  replaceBookTags(t.db, t.book.id, [
    { kind: 'character', value: 'Spider-Man' },
    { kind: 'character', value: 'Hobgoblin (Kingsley)' },
  ])
  try {
    const res = await t.lookup('Hobgoblin (Kingsley)')
    expect(res.statusCode).toBe(200)

    // Both characters got ids, not just the one that was clicked.
    const tags = getBookTags(t.db, t.book.id)
    expect(tags).toContainEqual({ kind: 'character', value: 'Spider-Man', extId: 1443 })
    expect(tags).toContainEqual({ kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 })

    // Two requests: the issue for its credits, then the character itself.
    expect(t.urls).toHaveLength(2)
    expect(t.urls[0]).toContain('/issue/4000-42/')
    expect(t.urls[1]).toContain('/character/4005-7605/')
  } finally { await t.cleanup() }
})

test('a second lookup on a backfilled book costs one request, not two', async () => {
  const t = await setup([['/issue/', { results: ISSUE }], ['/character/', { results: CHARACTER }]])
  updateBook(t.db, t.book.id, { comicvineId: 42 })
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin (Kingsley)' }])
  try {
    await t.lookup('Hobgoblin (Kingsley)')
    const afterFirst = t.urls.length
    await t.lookup('Hobgoblin (Kingsley)')
    expect(t.urls.length - afterFirst).toBe(1)
  } finally { await t.cleanup() }
})

// No issue to read credits from, so the name is all we have. Comic Vine's search ranks by
// relevance over description text and will happily return Deadpool for "Hobgoblin".
test('a book with no Comic Vine match falls back to searching by name', async () => {
  const t = await setup([
    ['/search/', { results: [{ id: 7605, name: 'Hobgoblin (Kingsley)' }] }],
    ['/character/', { results: CHARACTER }],
  ])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin (Kingsley)' }])
  try {
    const res = await t.lookup('Hobgoblin (Kingsley)')
    expect(res.statusCode).toBe(200)
    expect(res.json().character).toMatchObject({ name: 'Hobgoblin (Kingsley)' })
    expect(t.urls[0]).toContain('/search/')
  } finally { await t.cleanup() }
})

test('a character resolved by name search is reported as unverified', async () => {
  const t = await setup([
    ['/search/', { results: [{ id: 7605, name: 'Hobgoblin (Kingsley)' }] }],
    ['/character/', { results: CHARACTER }],
  ])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin (Kingsley)' }])
  try {
    expect((await t.lookup('Hobgoblin (Kingsley)')).json().verified).toBe(false)
  } finally { await t.cleanup() }
})

test('a name search that finds nothing 404s', async () => {
  const t = await setup([['/search/', { results: [] }]])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Nobody At All' }])
  try {
    expect((await t.lookup('Nobody At All')).statusCode).toBe(404)
  } finally { await t.cleanup() }
})

test('a name that is not a character on this book 404s without calling Comic Vine', async () => {
  const t = await setup([['/character/', { results: CHARACTER }]])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Spider-Man', extId: 1443 }])
  try {
    expect((await t.lookup('Galactus')).statusCode).toBe(404)
    expect(t.urls).toHaveLength(0)
  } finally { await t.cleanup() }
})

test('the lookup 400s when no API key is configured', async () => {
  const t = await setup([['/character/', { results: CHARACTER }]], '')
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 }])
  try {
    expect((await t.lookup('Hobgoblin (Kingsley)')).statusCode).toBe(400)
  } finally { await t.cleanup() }
})
