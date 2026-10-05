import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues, getCachedVolumeIssues } from '../server/models/volumeIssues.js'
import { addFollow, removeFollow } from '../server/models/follows.js'
import { setComicVineKey } from '../server/models/settings.js'
import { sweepFollows, followSweepIdle } from '../server/services/following.js'
import * as following from '../server/services/following.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

const DAY_OLD = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()

function setup({ key = 'test-key' } = {}) {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  app.decorate('downloader', { enqueue: () => ({ queued: false }) } as unknown as App['downloader'])
  if (key) setComicVineKey(db, key)

  const follow = (name: string, cvVolumeId: number, caughtUp: boolean, fetchedAt?: string) => {
    const edition = upsertEdition(db, { name, folder: name })
    updateEdition(db, edition.id, { comicvineId: cvVolumeId, cvName: name })
    cacheVolumeIssues(db, cvVolumeId, [{ id: cvVolumeId + 1, number: '1', coverDate: '2020-01-01' }], fetchedAt)
    const b = insertBook(db, { editionId: edition.id, filePath: `${name}/1.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvVolumeId + 1 })
    if (caughtUp) setProgress(db, b.id, { lastPage: 9, completed: true })
    return addFollow(db, 'volume', edition.id, name)
  }
  return { app, db, follow }
}

test('a sweep attempts every follow', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  try {
    t.follow('Iron Man', 500, false)
    t.follow('Thor', 600, false)
    expect(sweepFollows(t.app, { delayMs: 0 })).toEqual({ swept: 2 })
    await followSweepIdle()
    expect(spy).toHaveBeenCalledTimes(2)
  } finally { spy.mockRestore() }
})

// Review Focus 4: two scrapes finishing at once must not double the outbound traffic.
test('a second sweep while one is running is refused', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve('skipped'), 20)),
  )
  try {
    t.follow('Iron Man', 500, false)
    expect(sweepFollows(t.app, { delayMs: 0 })).toEqual({ swept: 1 })
    expect(sweepFollows(t.app, { delayMs: 0 })).toEqual({ already: true })
    await followSweepIdle()
    expect(spy).toHaveBeenCalledTimes(1)
  } finally { spy.mockRestore() }
})

test('a caught-up follow with an aged list is refreshed from Comic Vine', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      status_code: 1, number_of_total_results: 2,
      results: [
        { id: 501, issue_number: '1', cover_date: '2020-01-01' },
        { id: 502, issue_number: '2', cover_date: '2020-02-01' },
      ],
    }),
  })) as unknown as typeof fetch
  try {
    t.follow('Iron Man', 500, true, DAY_OLD)
    sweepFollows(t.app, { delayMs: 0 })
    await followSweepIdle()
    expect(getCachedVolumeIssues(t.db, 500)?.issues).toHaveLength(2)
  } finally { globalThis.fetch = origFetch; spy.mockRestore() }
})

test('a follow that is not caught up is not refreshed', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  let fetched = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => { fetched++; throw new Error('should not be asked') }) as unknown as typeof fetch
  try {
    // Not caught up: it already knows what it wants, so a fresher list changes nothing.
    t.follow('Iron Man', 500, false, DAY_OLD)
    sweepFollows(t.app, { delayMs: 0 })
    await followSweepIdle()
    expect(fetched).toBe(0)
  } finally { globalThis.fetch = origFetch; spy.mockRestore() }
})

// Review Focus 5: a fresh install with no key must still queue what the index can match.
test('with no Comic Vine key, the sweep still attempts but never refreshes', async () => {
  const t = setup({ key: '' })
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  let fetched = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => { fetched++; throw new Error('should not be asked') }) as unknown as typeof fetch
  try {
    t.follow('Iron Man', 500, true, DAY_OLD)
    sweepFollows(t.app, { delayMs: 0 })
    await followSweepIdle()
    expect(fetched).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
  } finally { globalThis.fetch = origFetch; spy.mockRestore() }
})

test('the refresh is capped so a long follow list cannot spend the hourly budget', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  let fetched = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    fetched++
    return { ok: true, json: async () => ({ status_code: 1, number_of_total_results: 0, results: [] }) }
  }) as unknown as typeof fetch
  try {
    // Two that must be skipped without spending budget: a fresh cache, and no comicvineId.
    t.follow('Fresh', 400, true)
    const bare = t.follow('Bare', 410, true, DAY_OLD)
    updateEdition(t.db, bare.refId, { comicvineId: null })
    for (let i = 0; i < 5; i++) t.follow(`Run ${i}`, 500 + i * 10, true, DAY_OLD)
    sweepFollows(t.app, { delayMs: 0, refreshLimit: 2 })
    await followSweepIdle()
    expect(fetched).toBe(2)
  } finally { globalThis.fetch = origFetch; spy.mockRestore() }
})

test('one attempt rejecting does not stop the follows behind it', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow')
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue('skipped')
  try {
    t.follow('Iron Man', 500, false)
    t.follow('Thor', 600, false)
    sweepFollows(t.app, { delayMs: 0 })
    await followSweepIdle()
    expect(spy).toHaveBeenCalledTimes(2)
  } finally { spy.mockRestore() }
})

test('a refresh fault does not cancel the attempts or reject the handle', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  try {
    t.follow('Iron Man', 500, true, DAY_OLD)
    t.follow('Thor', 600, true, DAY_OLD)
    // The key read in refreshCaughtUp now throws, outside any per-follow try.
    t.db.exec('DROP TABLE setting')
    sweepFollows(t.app, { delayMs: 0 })
    await expect(followSweepIdle()).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(2)
  } finally { spy.mockRestore() }
})

test('a follow removed mid-sweep is not attempted', async () => {
  const t = setup()
  const a = t.follow('Iron Man', 500, false)
  const b = t.follow('Thor', 600, false)
  const spy = vi.spyOn(following, 'attemptFollow').mockImplementation(async () => {
    removeFollow(t.db, b.kind, b.refId)
    return 'skipped'
  })
  try {
    sweepFollows(t.app, { delayMs: 0 })
    await followSweepIdle()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![1].refId).toBe(a.refId)
  } finally { spy.mockRestore() }
})
