import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import booksRoutes from '../server/routes/books.js'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { addFollow } from '../server/models/follows.js'
import { setListLength } from '../server/models/readingLists.js'
import * as following from '../server/services/following.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

vi.mock('../server/readingLists/index.js', async () =>
  ({ READING_LISTS: [(await import('./helpers/readingListFixture.js')).LIST] }))

async function setup(cvId: number | null = 102) {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { thumbsDir: '/tmp/none' } as Config)
  app.decorate('downloader', { enqueue: () => ({ queued: false }) } as unknown as App['downloader'])
  await app.register(booksRoutes)
  const edition = upsertEdition(db, { name: 'Avengers (2012)', folder: 'Avengers (2012)' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Avengers/2.cbz', pageCount: 10, fileSize: 1 })!
  if (cvId != null) updateBook(db, book.id, { comicvineId: cvId })
  return { app, db, book, cleanup: () => app.close() }
}

// Lists are in code, so where a comic sits in one costs no request and comes with it.
test('a comic says where it falls in each list holding it', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ url: `/api/books/${t.book.id}` })
    expect(res.json().readingLists).toEqual([{ slug: 'test-list', name: 'Test List', position: 2, total: 3 }])
    setListLength(t.db, 7, 'full')
    expect((await t.app.inject({ url: `/api/books/${t.book.id}` })).json().readingLists)
      .toEqual([{ slug: 'test-list', name: 'Test List', position: 3, total: 6 }])
  } finally { await t.cleanup() }
})

test('a comic never matched to Comic Vine is in no list', async () => {
  const t = await setup(null)
  try {
    expect((await t.app.inject({ url: `/api/books/${t.book.id}` })).json().readingLists).toEqual([])
  } finally { await t.cleanup() }
})

test('finishing a comic attempts the follows on the lists holding it', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('queued')
  try {
    addFollow(t.db, 'list', 7, 'Test List')
    // A list that does not hold this comic is left alone.
    addFollow(t.db, 'list', 99, 'Another')
    await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 9, completed: true },
    })
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][1]).toMatchObject({ kind: 'list', refId: 7 })
  } finally { spy.mockRestore(); await t.cleanup() }
})
