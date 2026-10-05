import { test, expect } from 'vitest'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { upsertComicIndex } from '../server/models/comicIndex.js'
import { addFollow } from '../server/models/follows.js'
import { enqueue as enqueueRow, listQueue } from '../server/models/downloadQueue.js'
import { attemptFollow } from '../server/services/following.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

// The shape parseDownloadLink actually reads — see test/comic-post-page.test.ts.
const POST = '<div class="aio-button-center">'
  + '<a href="https://dl.example/ironman2.cbz">DOWNLOAD NOW</a></div>'

function seed({ indexed = true }: { indexed?: boolean } = {}) {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  // The real queue model behind a stub runner: nothing downloads, but the duplicate
  // guard is the genuine partial unique index rather than a reimplementation of it.
  // Note the rename — the runner takes `issueId`, the model stores `cvIssueId`.
  app.decorate('downloader', {
    enqueue: (req: { url: string; edition?: string; issueId?: number; label?: string }) =>
      enqueueRow(db, { url: req.url, edition: req.edition, cvIssueId: req.issueId, label: req.label }),
  } as unknown as App['downloader'])

  const edition = upsertEdition(db, { name: 'Iron Man', folder: 'Iron Man' })
  updateEdition(db, edition.id, { comicvineId: 500, cvName: 'Iron Man' })
  cacheVolumeIssues(db, 500, [
    { id: 101, number: '1', coverDate: '2020-01-01' },
    { id: 102, number: '2', coverDate: '2020-02-01' },
  ])
  if (indexed) {
    // `number` and `year` are NOT passed: upsertComicIndex derives both from the title.
    upsertComicIndex(db, [{
      title: 'Iron Man #2 (2020)', url: 'https://src.example/iron-man-2', category: 'Marvel',
    }])
  }
  const follow = addFollow(db, 'volume', edition.id, 'Iron Man')
  const b = insertBook(db, { editionId: edition.id, filePath: 'Iron Man/1.cbz', pageCount: 10, fileSize: 1 })!
  updateBook(db, b.id, { comicvineId: 101 })
  setProgress(db, b.id, { lastPage: 9, completed: true })
  return { app, db, edition, follow }
}

test('a wanted issue is queued, labelled by volume and number', async () => {
  const t = seed()
  const result = await attemptFollow(t.app, t.follow, async () => POST)
  expect(result).toBe('queued')
  const queue = listQueue(t.db)
  expect(queue).toHaveLength(1)
  expect(queue[0]).toMatchObject({
    url: 'https://dl.example/ironman2.cbz', edition: 'Iron Man', cvIssueId: 102, label: 'Iron Man #2',
  })
})

test('an issue the index cannot match queues nothing and throws nothing', async () => {
  const t = seed({ indexed: false })
  expect(await attemptFollow(t.app, t.follow, async () => POST)).toBe('skipped')
  expect(listQueue(t.db)).toHaveLength(0)
})

test('an issue already queued is not queued twice', async () => {
  const t = seed()
  await attemptFollow(t.app, t.follow, async () => POST)
  expect(await attemptFollow(t.app, t.follow, async () => POST)).toBe('skipped')
  expect(listQueue(t.db)).toHaveLength(1)
})

test('a follow with nothing to want fetches no page at all', async () => {
  const t = seed()
  // Finish #2 as well, leaving the run caught up.
  const b = insertBook(t.db, { editionId: t.edition.id, filePath: 'Iron Man/2.cbz', pageCount: 10, fileSize: 1 })!
  updateBook(t.db, b.id, { comicvineId: 102 })
  setProgress(t.db, b.id, { lastPage: 9, completed: true })
  let fetched = 0
  expect(await attemptFollow(t.app, t.follow, async () => { fetched++; return POST })).toBe('skipped')
  expect(fetched).toBe(0)
})

test('a post that cannot be read is skipped rather than thrown', async () => {
  const t = seed()
  const result = await attemptFollow(t.app, t.follow, async () => { throw new Error('offline') })
  expect(result).toBe('skipped')
  expect(listQueue(t.db)).toHaveLength(0)
})
