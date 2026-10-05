import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import booksRoutes from '../server/routes/books.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags } from '../server/models/metadata.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { cacheArc } from '../server/models/arcCache.js'
import { addFollow } from '../server/models/follows.js'
import * as following from '../server/services/following.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

async function setup() {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { thumbsDir: '/tmp/none' } as Config)
  app.decorate('downloader', { enqueue: () => ({ queued: false }) } as unknown as App['downloader'])
  await app.register(booksRoutes)

  const edition = upsertEdition(db, { name: 'Iron Man', folder: 'Iron Man' })
  updateEdition(db, edition.id, { comicvineId: 500, cvName: 'Iron Man' })
  cacheVolumeIssues(db, 500, [
    { id: 101, number: '1', coverDate: '2020-01-01' },
    { id: 102, number: '2', coverDate: '2020-02-01' },
  ])
  const book = insertBook(db, { editionId: edition.id, filePath: 'Iron Man/1.cbz', pageCount: 10, fileSize: 1 })!
  updateBook(db, book.id, { comicvineId: 101 })
  return { app, db, edition, book, cleanup: () => app.close() }
}

test('finishing a comic attempts the follow on its run', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('queued')
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    const res = await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 9, completed: true },
    })
    expect(res.statusCode).toBe(200)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][1]).toMatchObject({ kind: 'volume', refId: t.edition.id })
  } finally { spy.mockRestore(); await t.cleanup() }
})

test('finishing a comic attempts the follows on its arcs', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('queued')
  try {
    cacheArc(t.db, 56676, { id: 56676, name: 'Death Spiral', issues: [] })
    replaceBookTags(t.db, t.book.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
    addFollow(t.db, 'arc', 56676, 'Death Spiral')
    await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 9, completed: true },
    })
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][1]).toMatchObject({ kind: 'arc', refId: 56676 })
  } finally { spy.mockRestore(); await t.cleanup() }
})

test('saving your place partway through attempts nothing', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('queued')
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 4, completed: false },
    })
    expect(spy).not.toHaveBeenCalled()
  } finally { spy.mockRestore(); await t.cleanup() }
})

// Review Focus 3: the reader re-sends completed:true on every page turn at the end.
test('re-finishing a comic you had already finished attempts nothing', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('queued')
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    setProgress(t.db, t.book.id, { lastPage: 9, completed: true })
    await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 9, completed: true },
    })
    expect(spy).not.toHaveBeenCalled()
  } finally { spy.mockRestore(); await t.cleanup() }
})

test('an attempt that throws still saves your place', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockRejectedValue(new Error('the site is down'))
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    const res = await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 9, completed: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().progress.completed).toBe(true)
  } finally { spy.mockRestore(); await t.cleanup() }
})
