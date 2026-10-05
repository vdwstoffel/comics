import { test, expect } from 'vitest'
import Fastify from 'fastify'
import followRoutes from '../server/routes/follows.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition, deleteEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags } from '../server/models/metadata.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { upsertComicIndex } from '../server/models/comicIndex.js'
import { addFollow, listFollows } from '../server/models/follows.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

async function setup(fetchPage: (url: string) => Promise<string> = async () => { throw new Error('no network') }) {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  app.decorate('downloader', { enqueue: () => ({ queued: false }) } as unknown as App['downloader'])
  setComicVineKey(db, 'test-key')
  // Most tests never reach the fetch (an attempt with no match stops before it); the one
  // that does passes its own `fetchPage`, and the default throws so a stray fetch is loud.
  await app.register(followRoutes, { fetchPage })

  const edition = upsertEdition(db, { name: 'Iron Man', folder: 'Iron Man' })
  updateEdition(db, edition.id, { comicvineId: 500, cvName: 'Iron Man' })
  cacheVolumeIssues(db, 500, [
    { id: 101, number: '1', coverDate: '2020-01-01' },
    { id: 102, number: '2', coverDate: '2020-02-01' },
  ])
  const own = (cvId: number, finished: boolean) => {
    const b = insertBook(db, { editionId: edition.id, filePath: `Iron Man/${cvId}.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvId })
    if (finished) setProgress(db, b.id, { lastPage: 9, completed: true })
    return b
  }
  return { app, db, edition, own, cleanup: () => app.close() }
}

test('following a volume stores it and answers with it', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'POST', url: '/api/follows',
      payload: { kind: 'volume', editionId: t.edition.id },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().follow).toMatchObject({ kind: 'volume', refId: t.edition.id, name: 'Iron Man' })
    expect(listFollows(t.db)).toHaveLength(1)
  } finally { await t.cleanup() }
})

test('a volume never matched to Comic Vine is refused with a reason', async () => {
  const t = await setup()
  try {
    const bare = upsertEdition(t.db, { name: 'Unsorted', folder: 'Unsorted' })
    const res = await t.app.inject({
      method: 'POST', url: '/api/follows', payload: { kind: 'volume', editionId: bare.id },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/match/i)
    expect(listFollows(t.db)).toHaveLength(0)
  } finally { await t.cleanup() }
})

test('the list carries what each follow is waiting for', async () => {
  const t = await setup()
  try {
    t.own(101, true)
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    const follows = (await t.app.inject({ url: '/api/follows' })).json().follows
    expect(follows).toHaveLength(1)
    expect(follows[0]).toMatchObject({
      kind: 'volume', refId: t.edition.id, name: 'Iron Man',
      state: 'wanted', want: { id: 102, number: '2' }, queued: false,
    })
  } finally { await t.cleanup() }
})

test('a dormant follow says so and carries no want', async () => {
  const t = await setup()
  try {
    t.own(101, false)
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    const follows = (await t.app.inject({ url: '/api/follows' })).json().follows
    expect(follows[0].state).toBe('dormant')
    expect(follows[0].want).toBeUndefined()
  } finally { await t.cleanup() }
})

test('a follow whose edition has been deleted is pruned on read', async () => {
  const t = await setup()
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    deleteEdition(t.db, t.edition.id)
    expect((await t.app.inject({ url: '/api/follows' })).json().follows).toEqual([])
    expect(listFollows(t.db)).toEqual([])
  } finally { await t.cleanup() }
})

test('an arc is followed by name and stored under its Comic Vine id', async () => {
  const t = await setup()
  try {
    const b = t.own(101, false)
    replaceBookTags(t.db, b.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
    const res = await t.app.inject({
      method: 'POST', url: '/api/follows', payload: { kind: 'arc', name: 'Death Spiral' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().follow).toMatchObject({ kind: 'arc', refId: 56676, name: 'Death Spiral' })
  } finally { await t.cleanup() }
})

test('unfollowing removes it, and unfollowing nothing is a 404', async () => {
  const t = await setup()
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    expect((await t.app.inject({ method: 'DELETE', url: `/api/follows/volume/${t.edition.id}` })).statusCode).toBe(200)
    expect((await t.app.inject({ method: 'DELETE', url: `/api/follows/volume/${t.edition.id}` })).statusCode).toBe(404)
  } finally { await t.cleanup() }
})

test('a kind that is not a kind is refused', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/follows', payload: { kind: 'character', name: 'Venom' } })
    expect(res.statusCode).toBe(400)
  } finally { await t.cleanup() }
})

// The only thing isolating a faulting follow is the try/catch around attemptFollow.
// startIssueDownload already absorbs a failed fetch, so the fault has to come from further
// in: the page fetches fine and the download runner throws. The fixture is genuinely
// `wanted` and indexed so the attempt really gets that far.
test('a fault inside the first attempt does not fail the follow', async () => {
  const page = '<div class="aio-button-center"><a href="https://dl.example/x.cbz">DOWNLOAD NOW</a></div>'
  const t = await setup(async () => page)
  try {
    ;(t.app.downloader as unknown as { enqueue: () => never }).enqueue = () => { throw new Error('boom') }
    t.own(101, true)
    upsertComicIndex(t.db, [{
      title: 'Iron Man #2 (2020)', url: 'https://src.example/iron-man-2', category: 'Marvel',
    }])
    const res = await t.app.inject({
      method: 'POST', url: '/api/follows', payload: { kind: 'volume', editionId: t.edition.id },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().follow).toMatchObject({ kind: 'volume', refId: t.edition.id })
    expect(listFollows(t.db)).toHaveLength(1)
  } finally { await t.cleanup() }
})

test('a volume follow carries the names the solicitation calendar matches on', async () => {
  const t = await setup()
  try {
    updateEdition(t.db, t.edition.id, { seriesName: 'Iron Man', cvStartYear: 2020 })
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')

    const res = await t.app.inject({ method: 'GET', url: '/api/follows' })

    expect(res.json().follows[0].edition).toEqual({
      name: 'Iron Man', seriesName: 'Iron Man', cvName: 'Iron Man', cvStartYear: 2020,
    })
  } finally { await t.cleanup() }
})

test('an arc follow carries no edition names, having no one volume to match on', async () => {
  const t = await setup()
  try {
    addFollow(t.db, 'arc', 9001, 'Dark Reign')

    const res = await t.app.inject({ method: 'GET', url: '/api/follows' })

    const arc = res.json().follows.find((f: { kind: string }) => f.kind === 'arc')
    expect(arc).toMatchObject({ state: 'caught-up' })
    expect(arc.edition).toBeUndefined()
  } finally { await t.cleanup() }
})
