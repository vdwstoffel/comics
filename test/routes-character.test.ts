import { test, expect } from 'vitest'
import Fastify from 'fastify'
import comicvineRoutes from '../server/routes/comicvine.js'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags, getBookTags } from '../server/models/metadata.js'
import { cacheCharacter } from '../server/models/characterCache.js'
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
    page: (id: number) => app.inject({ url: `/api/characters/${id}` }),
    cleanup: async () => { globalThis.fetch = origFetch; await app.close() },
  }
}

// ---- which character a chip is

test('a chip whose character id is known resolves without asking Comic Vine', async () => {
  const t = await setup([])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 }])
  try {
    const res = await t.lookup('Hobgoblin (Kingsley)')
    expect(res.json()).toEqual({ id: 7605, verified: true })
    expect(t.urls).toHaveLength(0)
  } finally { await t.cleanup() }
})

test('a chip with no id backfills every character id on the book from its issue', async () => {
  const t = await setup([['/issue/', { results: ISSUE }]])
  updateBook(t.db, t.book.id, { comicvineId: 42 })
  replaceBookTags(t.db, t.book.id, [
    { kind: 'character', value: 'Spider-Man' },
    { kind: 'character', value: 'Hobgoblin (Kingsley)' },
  ])
  try {
    expect((await t.lookup('Hobgoblin (Kingsley)')).json()).toEqual({ id: 7605, verified: true })
    // Both characters got ids, not just the one that was clicked.
    const tags = getBookTags(t.db, t.book.id)
    expect(tags).toContainEqual({ kind: 'character', value: 'Spider-Man', extId: 1443 })
    expect(tags).toContainEqual({ kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 })
    expect(t.urls).toHaveLength(1)
    expect(t.urls[0]).toContain('/issue/4000-42/')
  } finally { await t.cleanup() }
})

// No issue to read credits from, so the name is all we have. Comic Vine's search ranks by
// relevance over description text and will happily return Deadpool for "Hobgoblin".
test('a chip on an unmatched comic falls back to a name search, flagged as a guess', async () => {
  const t = await setup([['/search/', { results: [{ id: 7605, name: 'Hobgoblin (Kingsley)' }] }]])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin (Kingsley)' }])
  try {
    expect((await t.lookup('Hobgoblin (Kingsley)')).json()).toEqual({ id: 7605, verified: false })
    expect(t.urls[0]).toContain('/search/')
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
  const t = await setup([])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Spider-Man', extId: 1443 }])
  try {
    expect((await t.lookup('Galactus')).statusCode).toBe(404)
    expect(t.urls).toHaveLength(0)
  } finally { await t.cleanup() }
})

test('a chip with no id cannot be resolved without an API key', async () => {
  const t = await setup([], '')
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin (Kingsley)' }])
  try {
    expect((await t.lookup('Hobgoblin (Kingsley)')).statusCode).toBe(400)
  } finally { await t.cleanup() }
})

// ---- the character's page

test('a character is read from Comic Vine once, then served from the cache', async () => {
  const t = await setup([['/character/', { results: CHARACTER }]])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin', extId: 7605 }])
  try {
    const first = await t.page(7605)
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({
      name: 'Hobgoblin',
      character: { name: 'Hobgoblin (Kingsley)', realName: 'Roderick Kingsley', publisher: 'Marvel', appearanceCount: 576 },
    })
    await t.page(7605)
    expect(t.urls).toHaveLength(1)
  } finally { await t.cleanup() }
})

test('a week-old record is read again', async () => {
  const t = await setup([['/character/', { results: { ...CHARACTER, deck: 'Newer.' } }]])
  cacheCharacter(t.db, 7605, { name: 'Hobgoblin (Kingsley)', deck: 'Older.', aliases: [], profile: [] } as never,
    new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString())
  try {
    expect((await t.page(7605)).json().character.deck).toBe('Newer.')
  } finally { await t.cleanup() }
})

// The comics are the library's to list; Comic Vine being down must not blank the page.
test('when Comic Vine cannot be read, a stale record is served, and with none the name still is', async () => {
  const t = await setup([])
  replaceBookTags(t.db, t.book.id, [{ kind: 'character', value: 'Hobgoblin', extId: 7605 }])
  try {
    const bare = await t.page(7605)
    expect(bare.statusCode).toBe(200)
    expect(bare.json()).toMatchObject({ character: null, name: 'Hobgoblin', unavailable: 'Comic Vine could not be read' })

    cacheCharacter(t.db, 7605, { name: 'Hobgoblin (Kingsley)', aliases: [], profile: [] } as never,
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    expect((await t.page(7605)).json().character.name).toBe('Hobgoblin (Kingsley)')
  } finally { await t.cleanup() }
})

test('a character id that is not a positive number is refused', async () => {
  const t = await setup([])
  try {
    expect((await t.page(0)).statusCode).toBe(400)
  } finally { await t.cleanup() }
})
