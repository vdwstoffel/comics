import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { addFollow, listFollows } from '../server/models/follows.js'
import { setListLength } from '../server/models/readingLists.js'
import { setComicVineKey } from '../server/models/settings.js'
import { nextWantedIssue } from '../server/services/following.js'
import followRoutes from '../server/routes/follows.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

vi.mock('../server/readingLists/index.js', async () =>
  ({ READING_LISTS: [(await import('./helpers/readingListFixture.js')).LIST] }))

function seed() {
  const db = openDb(':memory:')
  const avengers = upsertEdition(db, { name: 'Avengers (2012)', folder: 'Avengers (2012)' })
  updateEdition(db, avengers.id, { comicvineId: 500, cvName: 'Avengers' })
  const follow = addFollow(db, 'list', 7, 'Test List')
  let copies = 0
  const own = (cvId: number, finished: boolean) => {
    const b = insertBook(db, { editionId: avengers.id, filePath: `list/${cvId}-${copies++}.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvId })
    if (finished) setProgress(db, b.id, { lastPage: 9, completed: true })
    return b
  }
  return { db, avengers, follow, own }
}

test('in Core, the next issue skips the tie-in', () => {
  const t = seed()
  t.own(101, true)
  expect(nextWantedIssue(t.db, t.follow)).toEqual({
    state: 'wanted',
    // number and coverDate are what the matcher bails on without.
    issue: { id: 102, number: '2', name: 'The Garden', coverDate: '2013-03-01' },
    volumeName: 'Avengers',
    editionName: 'Avengers (2012)',
  })
})

// The page and the follow read one saved length, so switching changes what comes next.
test('in Full, the next issue is the tie-in, filed under its own volume', () => {
  const t = seed()
  t.own(101, true)
  setListLength(t.db, 7, 'full')
  expect(nextWantedIssue(t.db, t.follow)).toEqual({
    state: 'wanted',
    issue: { id: 901, number: '1', coverDate: '2013-11-01' },
    volumeName: 'Mighty Avengers',
    editionName: 'Mighty Avengers',
  })
})

test('a list you have not started waits, as a run does', () => {
  const t = seed()
  expect(nextWantedIssue(t.db, t.follow).state).toBe('dormant')
})

test('a next issue you already have is supplied, and the end is caught up', () => {
  const t = seed()
  t.own(101, true)
  t.own(102, false)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('supplied')
  t.own(103, true)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('caught-up')
})

test('a list taken out of the code no longer resolves', () => {
  const t = seed()
  const gone = addFollow(t.db, 'list', 99, 'Gone')
  expect(nextWantedIssue(t.db, gone).state).toBe('unresolved')
})

async function routes() {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  app.decorate('downloader', { enqueue: () => ({ queued: false }) } as unknown as App['downloader'])
  setComicVineKey(db, 'test-key')
  await app.register(followRoutes, { fetchPage: async () => { throw new Error('no network') } })
  return { app, db, cleanup: () => app.close() }
}

test('a list is followed by its id, under its own name', async () => {
  const t = await routes()
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/follows', payload: { kind: 'list', listId: 7 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().follow).toMatchObject({ kind: 'list', refId: 7, name: 'Test List' })
    const missing = await t.app.inject({ method: 'POST', url: '/api/follows', payload: { kind: 'list', listId: 99 } })
    expect(missing.statusCode).toBe(404)
  } finally { await t.cleanup() }
})

// The shelf finds the list's comics among your unread ones by Comic Vine id, in the order
// the list reads in its saved length.
test("a list follow tells the shelf where its page is and which comics are its", async () => {
  const t = await routes()
  try {
    addFollow(t.db, 'list', 7, 'Test List')
    const [view] = (await t.app.inject({ url: '/api/follows' })).json().follows
    expect(view).toMatchObject({ kind: 'list', refId: 7, list: { slug: 'test-list', issueIds: [101, 102, 103] } })
    setListLength(t.db, 7, 'full')
    const [full] = (await t.app.inject({ url: '/api/follows' })).json().follows
    expect(full.list.issueIds).toEqual([101, 901, 102, 902, 103, 904])
  } finally { await t.cleanup() }
})

test('a follow of a list that has gone is pruned on read', async () => {
  const t = await routes()
  try {
    addFollow(t.db, 'list', 99, 'Gone')
    expect((await t.app.inject({ url: '/api/follows' })).json().follows).toEqual([])
    expect(listFollows(t.db)).toEqual([])
  } finally { await t.cleanup() }
})

test('unfollowing a list removes it', async () => {
  const t = await routes()
  try {
    addFollow(t.db, 'list', 7, 'Test List')
    const res = await t.app.inject({ method: 'DELETE', url: '/api/follows/list/7' })
    expect(res.statusCode).toBe(200)
    expect(listFollows(t.db)).toEqual([])
  } finally { await t.cleanup() }
})
