import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import { openDb } from '../server/db.js'
import type { Db } from '../server/types.js'
import type { Config } from '../server/config.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { dismissFollowup } from '../server/models/metadataFollowups.js'
import { setComicVineKey } from '../server/models/settings.js'
import { CvApiError } from '../server/lib/comicvine.js'
import { createMetadataCatchup, PAUSE_MS, RETRY_AFTER_MS } from '../server/services/metadataCatchup.js'
import type { applyIssueToBook } from '../server/services/applyIssue.js'

let db: Db
let clock: number
let read: number[]
let answer: (bookId: number) => void

/** A bare comic: bound to an issue, but with nothing Comic Vine would have filled in. */
function addBare(file: string, cvId: number | null = 1000): number {
  const ed = upsertEdition(db, { name: 'Venom (2025)', folder: 'zz-test/Venom (2025)', seriesName: 'Venom' })
  const id = insertBook(db, { editionId: ed.id, filePath: `zz-test/Venom (2025)/${file}`, pageCount: 20, fileSize: 1 })!.id
  if (cvId !== null) updateBook(db, id, { comicvineId: cvId })
  return id
}

/** What a read that fills a comic in looks like from here: the comic leaves the list. */
function fillIn(bookId: number) {
  updateBook(db, bookId, { summary: 'A symbiote.', date: '2025-06-01' })
  db.prepare("INSERT INTO book_credit (book_id, name, role) VALUES (?, 'Al Ewing', 'writer')").run(bookId)
}

function catchup() {
  const apply = vi.fn(async (_ctx: unknown, bookId: number) => {
    read.push(bookId)
    answer(bookId)
    return {} as never
  }) as unknown as typeof applyIssueToBook
  return createMetadataCatchup({ db, config: {} as Config }, { apply, now: () => clock })
}

beforeEach(() => {
  db = openDb(':memory:')
  setComicVineKey(db, 'key')
  clock = Date.parse('2026-11-14T20:00:00Z')
  read = []
  answer = fillIn
})
afterEach(() => db.close())

test('one comic is read per tick, the newest first, until none is left', async () => {
  const older = addBare('throwaway-1.cbz')
  const newer = addBare('throwaway-2.cbz')
  const c = catchup()
  expect(c.status().due).toBe(2)

  expect(await c.tick()).toBe('applied')
  expect(await c.tick()).toBe('applied')
  expect(await c.tick()).toBe('idle')
  expect(read).toEqual([newer, older])
  expect(c.status().due).toBe(0)
})

// Comic Vine fills a new record in over days; reading it every twenty seconds meanwhile
// would spend the whole budget on the same comic.
test('a comic Comic Vine still answered thinly waits days before it is read again', async () => {
  const thin = addBare('throwaway-1.cbz')
  answer = () => {}
  const c = catchup()
  await c.tick()
  expect(await c.tick()).toBe('idle')
  expect(c.status().due).toBe(0)

  clock += RETRY_AFTER_MS + 1
  expect(await c.tick()).toBe('applied')
  expect(read).toEqual([thin, thin])
})

// The limit is spent in minutes by a run filed in one go; asking every twenty seconds
// would only keep it spent.
test('a refusal leaves Comic Vine alone for a while, and the comic is first when it ends', async () => {
  const first = addBare('throwaway-1.cbz')
  answer = () => { throw Object.assign(new CvApiError('Comic Vine error 107: Rate limit exceeded'), { cvStatus: 107 }) }
  const c = catchup()
  expect(await c.tick()).toBe('refused')
  expect(await c.tick()).toBe('paused')
  expect(c.status()).toMatchObject({ due: 1, reason: 'Comic Vine error 107: Rate limit exceeded' })
  expect(c.status().pausedUntil).toBe(new Date(clock + PAUSE_MS).toISOString())

  answer = fillIn
  clock += PAUSE_MS
  expect(await c.tick()).toBe('applied')
  expect(read).toEqual([first, first])
  expect(c.status()).toMatchObject({ due: 0, pausedUntil: null, reason: null })
})

test('an id Comic Vine does not have is left for a person and not asked about again soon', async () => {
  addBare('throwaway-1.cbz')
  answer = () => { throw Object.assign(new CvApiError('Comic Vine error 101: Object Not Found'), { cvStatus: 101 }) }
  const c = catchup()
  expect(await c.tick()).toBe('not-found')
  expect(await c.tick()).toBe('idle')
})

// The list's own rule: only what Refresh would offer, and nothing you took down.
test('a comic with no id to read, or one you dismissed, is never touched', async () => {
  addBare('throwaway-1.cbz', null)
  const dismissed = addBare('throwaway-2.cbz')
  dismissFollowup(db, dismissed)
  const c = catchup()
  expect(c.status().due).toBe(0)
  expect(await c.tick()).toBe('idle')
  expect(read).toEqual([])
})

test('without a Comic Vine key there is nothing to read with', async () => {
  addBare('throwaway-1.cbz')
  setComicVineKey(db, '')
  expect(await catchup().tick()).toBe('idle')
  expect(read).toEqual([])
})
