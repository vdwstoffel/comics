import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import arcRoutes from '../server/routes/arcs.js'
import { openDb } from '../server/db.js'
import { cacheArc } from '../server/models/arcCache.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { CvStoryArc } from '../server/lib/comicvine.js'
import type { Config } from '../server/config.js'

// An arc as the page holds it: the series it is named for, plus a tie-in from another
// volume entirely. Filling the tie-in is most of what an arc page is for.
const ARC: CvStoryArc = {
  id: 56676,
  name: 'Death Spiral',
  issues: [
    { id: 1156915, number: '1', volumeName: 'Death Spiral', volumeId: 7, coverDate: '2015-03-01' },
    { id: 1158149, number: '14', volumeName: 'Black Cat', volumeId: 176900, coverDate: '2026-11-01' },
  ],
}

// The markup the real parser recognises: the main button in a div.aio-button-center,
// labelled "DOWNLOAD NOW".
const POST_HTML = '<div class="aio-button-center"><a href="https://files/black-cat-14.cbz">DOWNLOAD NOW</a></div>'

/** Every Comic Vine url the server asks for, so the no-search invariant is testable. */
let cvUrls: string[] = []

async function setup(fetchPage: (url: string) => Promise<string> = async () => {
  throw new Error('unexpected fetch in this test')
}) {
  cvUrls = []
  const origFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    cvUrls.push(String(url))
    return { ok: true, json: async () => ({ results: [] }) }
  }) as never

  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  setComicVineKey(db, 'test-key')
  const enqueue = vi.fn(() => ({
    queued: true,
    entry: { id: 1, position: 0, state: 'queued', url: '', attempts: 0, queuedAt: new Date().toISOString() },
  }))
  app.decorate('downloader', {
    enqueue, status: () => ({ active: [], queue: [], history: [] }),
    cancel: vi.fn(), wake: vi.fn(),
  } as never)
  await app.register(arcRoutes, { fetchPage })

  // One index row that can only be Black Cat #14. `number` is stored zero-padded to three
  // digits, the same form the matcher's candidate query compares against.
  db.prepare(
    `INSERT INTO comic_index (title, url, category, imported_at, number, year)
     VALUES (?,?,?,?,?,?)`,
  ).run('Black Cat #14 (2026)', 'https://index/black-cat-14', 'comics', '2026-09-14', '014', 2026)

  cacheArc(db, 56676, ARC, '2026-09-14T12:00:00.000Z')
  return { app, db, enqueue, cleanup: async () => { globalThis.fetch = origFetch; await app.close() } }
}

test('an issue in no cached arc 404s', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/arcs/issues/9999999/download' })
    expect(res.statusCode).toBe(404)
    expect(t.enqueue).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

// You own nothing of the tie-in's series, so the edition is named exactly as Comic Vine
// names that volume - not after the arc, which is not a series and is not a shelf.
test('a tie-in you own no edition for lands under its own volume name', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/arcs/issues/1158149/download' })

    expect(res.statusCode).toBe(202)
    expect(t.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ edition: 'Black Cat', issueId: 1158149 }),
    )
  } finally { await t.cleanup() }
})

// Filing by the bare volume name would miss the run you already have and create a second
// edition with its own folder, splitting the run across two places on disk.
test('an issue whose volume you already own files into that edition, by its real name', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const owned = upsertEdition(t.db, { name: 'Black Cat (2019)', folder: 'Black Cat (2019)' })
    updateEdition(t.db, owned.id, { comicvineId: 176900 })

    const res = await t.app.inject({ method: 'POST', url: '/api/arcs/issues/1158149/download' })

    expect(res.statusCode).toBe(202)
    expect(t.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ edition: 'Black Cat (2019)', issueId: 1158149 }),
    )
  } finally { await t.cleanup() }
})

// Identity is the volume id, not the label: Marvel and DC relaunch under identical names.
test('an edition for a different volume does not claim the issue', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const other = upsertEdition(t.db, { name: 'Black Cat (2010)', folder: 'Black Cat (2010)' })
    updateEdition(t.db, other.id, { comicvineId: 999999 })

    const res = await t.app.inject({ method: 'POST', url: '/api/arcs/issues/1158149/download' })

    expect(res.statusCode).toBe(202)
    expect(t.enqueue).toHaveBeenCalledWith(expect.objectContaining({ edition: 'Black Cat' }))
  } finally { await t.cleanup() }
})

// Arcs cached before the volume id was stored carry only the name. The download still has
// to work: the alternative is a button that is dead until the arc happens to be refreshed.
test('an arc issue cached without a volume id still lands under its volume name', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const { volumeId: _omitted, ...nameOnly } = ARC.issues[1]!
    cacheArc(t.db, 56676, { ...ARC, issues: [nameOnly] }, '2026-09-14T12:00:00.000Z')

    const res = await t.app.inject({ method: 'POST', url: '/api/arcs/issues/1158149/download' })

    expect(res.statusCode).toBe(202)
    expect(t.enqueue).toHaveBeenCalledWith(expect.objectContaining({ edition: 'Black Cat' }))
  } finally { await t.cleanup() }
})

// The rule that drew the button is the rule that acts. Nothing scraped can be issue #1 of
// Death Spiral, so the press refuses rather than downloading something adjacent.
test('an issue nothing uniquely matches is refused, and says why', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/arcs/issues/1156915/download' })

    expect(res.statusCode).toBe(409)
    expect(res.json().reason).toBe('no-match')
    expect(t.enqueue).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

// `reason` is how a client tells a duplicate 409 from an ambiguous-match one; the message
// is for a person, not for code to match on.
test('an issue already in the queue is refused as a duplicate, and says so', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    t.enqueue.mockReturnValueOnce({
      queued: false,
      duplicate: { id: 7, position: 0, state: 'queued', url: '', attempts: 0, queuedAt: new Date().toISOString() },
    } as never)

    const res = await t.app.inject({ method: 'POST', url: '/api/arcs/issues/1158149/download' })

    expect(res.statusCode).toBe(409)
    expect(res.json().reason).toBe('duplicate')
    expect(res.json().entry.id).toBe(7)
  } finally { await t.cleanup() }
})

test('an unreadable post reports 502 rather than starting anything', async () => {
  const t = await setup(async () => { throw new Error('offline') })
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/arcs/issues/1158149/download' })

    expect(res.statusCode).toBe(502)
    expect(t.enqueue).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

// The queue row is labelled by the issue's own volume, not the arc: "Black Cat #14" is
// what landed on disk, and a row reading "Death Spiral #14" would name no comic at all.
test('the queue row is labelled with the volume and issue number', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    await t.app.inject({ method: 'POST', url: '/api/arcs/issues/1158149/download' })

    expect(t.enqueue).toHaveBeenCalledWith(expect.objectContaining({ label: 'Black Cat #14' }))
  } finally { await t.cleanup() }
})

// This path knows Comic Vine's id for the issue. A name-based search cannot tell a dozen
// relaunches of a title apart, so falling back to one would quietly reintroduce exactly
// the failure the id exists to prevent.
test('pressing get never searches Comic Vine by name', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    await t.app.inject({ method: 'POST', url: '/api/arcs/issues/1158149/download' })

    expect(cvUrls.filter((u) => u.includes('/search/'))).toEqual([])
  } finally { await t.cleanup() }
})
