import { test, expect } from 'vitest'
import Fastify from 'fastify'
import arcRoutes from '../server/routes/arcs.js'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags, getBookTags } from '../server/models/metadata.js'
import { setProgress } from '../server/models/progress.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

const ARC = {
  id: 56676,
  name: 'Death Spiral',
  deck: 'A nine part crossover.',
  publisher: { name: 'Marvel' },
  image: { medium_url: 'arc.jpg' },
  site_detail_url: 'https://comicvine.gamespot.com/death-spiral/4045-56676/',
  issues: [
    { id: 1156915, name: 'Part One', site_detail_url: 'https://cv/one' },
    { id: 1158149, name: 'Part Two', site_detail_url: 'https://cv/two' },
    { id: 9999999, name: 'Part Three', site_detail_url: 'https://cv/three' },
  ],
}

// What /issues/ returns for the three above, so the route runs the real ordering path.
const ARC_ISSUE_DETAILS = {
  results: [
    { id: 1156915, issue_number: '1', cover_date: '2015-03-01', store_date: '2015-01-07', volume: { id: 7, name: 'Death Spiral' } },
    { id: 1158149, issue_number: '2', cover_date: '2015-04-01', store_date: '2015-02-04', volume: { id: 7, name: 'Death Spiral' } },
    { id: 9999999, issue_number: '3', cover_date: '2015-05-01', store_date: '2015-03-04', volume: { id: 7, name: 'Death Spiral' } },
  ],
  number_of_total_results: 3,
}

const ISSUE = { name: 'Part One', issue_number: '1', description: null, story_arc_credits: [{ id: 56676, name: 'Death Spiral' }] }

function recordingFetch(routes: Array<[string, unknown]>) {
  const urls: string[] = []
  let broken = false
  const impl = async (url: string) => {
    urls.push(url)
    if (broken) throw new Error('Comic Vine is down')
    for (const [needle, body] of routes) if (url.includes(needle)) return { ok: true, json: async () => body }
    throw new Error(`unexpected url ${url}`)
  }
  return { urls, impl, breakFetch: () => { broken = true } }
}

async function setup(routes: Array<[string, unknown]> = [], apiKey = 'test-key') {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  // The key is a setting now, not configuration. A suite that passes '' is testing the
  // unconfigured path and seeds nothing.
  if (apiKey) setComicVineKey(db, apiKey)
  const { urls, impl, breakFetch } = recordingFetch([...routes, ['/issues/', ARC_ISSUE_DETAILS]])
  const origFetch = globalThis.fetch
  globalThis.fetch = impl as unknown as typeof fetch
  await app.register(arcRoutes)

  const edition = upsertEdition(db, { name: 'Vol 7', folder: 'Vol 7' })
  const mk = (path: string, cvId: number) => {
    const b = insertBook(db, { editionId: edition.id, filePath: path, pageCount: 1, fileSize: 100 })!
    updateBook(db, b.id, { comicvineId: cvId })
    return b
  }
  return { app, db, urls, edition, mk, breakFetch, cleanup: async () => { globalThis.fetch = origFetch; await app.close() } }
}

test('the arc list names each arc and counts the issues you own', async () => {
  const t = await setup()
  const a = t.mk('Vol 7/1.cbz', 1156915)
  const b = t.mk('Vol 7/2.cbz', 1158149)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  replaceBookTags(t.db, b.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  try {
    const res = await t.app.inject({ url: '/api/arcs' })
    expect(res.statusCode).toBe(200)
    expect(res.json().arcs).toEqual([{ name: 'Death Spiral', owned: 2 }])
  } finally { await t.cleanup() }
})

// Listing arcs is a library question, not a Comic Vine one.
test('the arc list costs no Comic Vine requests', async () => {
  const t = await setup()
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  try {
    await t.app.inject({ url: '/api/arcs' })
    expect(t.urls).toHaveLength(0)
  } finally { await t.cleanup() }
})

test('character tags are not mistaken for arcs', async () => {
  const t = await setup()
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'character', value: 'Venom' }])
  try {
    expect((await t.app.inject({ url: '/api/arcs' })).json().arcs).toEqual([])
  } finally { await t.cleanup() }
})

test('an arc shows every issue in it, in reading order', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const res = await t.app.inject({ url: '/api/arcs/Death%20Spiral' })
    expect(res.statusCode).toBe(200)
    expect(res.json().arc.issues.map((i: { name: string }) => i.name)).toEqual(['Part One', 'Part Two', 'Part Three'])
  } finally { await t.cleanup() }
})

test('an issue you own is marked owned and carries its book id', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const issues = (await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).json().arc.issues
    expect(issues[0]).toMatchObject({ id: 1156915, name: 'Part One', owned: true, bookId: a.id })
  } finally { await t.cleanup() }
})

test('an issue you do not own is marked missing and has no book id', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const issues = (await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).json().arc.issues
    const missing = issues.find((i: { id: number }) => i.id === 9999999)
    expect(missing).toMatchObject({ owned: false })
    expect(missing.bookId).toBeUndefined()
  } finally { await t.cleanup() }
})

// Same lazy backfill as characters: the tag has no id, so re-read an issue that carries it.
test('an arc with no id backfills it from an issue that carries the tag', async () => {
  const t = await setup([['/issue/', { results: ISSUE }], ['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  try {
    const res = await t.app.inject({ url: '/api/arcs/Death%20Spiral' })
    expect(res.statusCode).toBe(200)
    expect(getBookTags(t.db, a.id)).toContainEqual({ kind: 'story_arc', value: 'Death Spiral', extId: 56676 })
    expect(t.urls[0]).toContain('/issue/4000-1156915/')
    expect(t.urls[1]).toContain('/story_arc/4045-56676/')
  } finally { await t.cleanup() }
})

// The backfill writes the arc id onto the tag, so the second visit must not re-read an
// issue to rediscover it - and the arc itself is now cached, so it costs nothing at all.
test('a second visit to an arc is served from the cache', async () => {
  const t = await setup([['/issue/', { results: ISSUE }], ['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  try {
    const first = await t.app.inject({ url: '/api/arcs/Death%20Spiral' })
    const afterFirst = t.urls.length
    const second = await t.app.inject({ url: '/api/arcs/Death%20Spiral' })

    expect(t.urls.slice(afterFirst)).toEqual([])
    expect(second.json().arc.issues).toEqual(first.json().arc.issues)
  } finally { await t.cleanup() }
})

// A running arc gains issues, so there has to be a way to ask for the current run now
// rather than waiting out the cache.
test('refresh=1 re-reads an arc that is already cached', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    await t.app.inject({ url: '/api/arcs/Death%20Spiral' })
    const afterFirst = t.urls.length
    const res = await t.app.inject({ url: '/api/arcs/Death%20Spiral?refresh=1' })

    expect(res.statusCode).toBe(200)
    expect(t.urls.slice(afterFirst).filter((u) => u.includes('/story_arc/'))).toHaveLength(1)
  } finally { await t.cleanup() }
})

// A run we already hold beats no run at all, however old it is.
test('an arc Comic Vine will not answer for falls back to what we already hold', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    await t.app.inject({ url: '/api/arcs/Death%20Spiral' })

    // Comic Vine goes down; the forced refresh has to fail over to the cache.
    t.breakFetch()
    const res = await t.app.inject({ url: '/api/arcs/Death%20Spiral?refresh=1' })

    expect(res.statusCode).toBe(200)
    expect(res.json().arc.issues).toHaveLength(3)
    expect(res.json().stale).toBe(true)
  } finally { await t.cleanup() }
})

test('an arc Comic Vine will not answer for and we hold nothing for fails', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    t.breakFetch()
    expect((await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).statusCode).toBe(502)
  } finally { await t.cleanup() }
})

// The arc page labels a tile with its series and number, because Comic Vine titles only a
// fraction of issues. Those fields have to survive the route, not just the client.
test('an arc issue carries its series and number through to the page', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const issues = (await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).json().arc.issues
    expect(issues[0]).toMatchObject({ id: 1156915, volumeName: 'Death Spiral', number: '1', storeDate: '2015-01-07' })
  } finally { await t.cleanup() }
})

test('an arc nothing in the library carries 404s without calling Comic Vine', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  try {
    expect((await t.app.inject({ url: '/api/arcs/Nothing%20Here' })).statusCode).toBe(404)
    expect(t.urls).toHaveLength(0)
  } finally { await t.cleanup() }
})

test('the arc page 400s when no API key is configured', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]], '')
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    expect((await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).statusCode).toBe(400)
  } finally { await t.cleanup() }
})

// The arc page draws the same read badges the edition grid does, so it needs the same
// two fields. An issue you do not own has no read state to report.
test('an issue you own carries its read state into the arc', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const done = t.mk('Vol 7/1.cbz', 1156915)
  const partway = t.mk('Vol 7/2.cbz', 1158149)
  replaceBookTags(t.db, done.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  replaceBookTags(t.db, partway.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  setProgress(t.db, done.id, { lastPage: 19, completed: true })
  setProgress(t.db, partway.id, { lastPage: 9 })
  try {
    const issues = (await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).json().arc.issues
    const byId = Object.fromEntries(issues.map((i: { id: number }) => [i.id, i]))
    expect(byId[1156915]).toMatchObject({ owned: true, readState: 'read' })
    expect(byId[1158149]).toMatchObject({ owned: true, readState: 'reading' })
    expect(byId[1158149].percent).toBeGreaterThan(0)
  } finally { await t.cleanup() }
})

test('an issue you do not own reports no read state', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const issues = (await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).json().arc.issues
    const missing = issues.find((i: { owned: boolean }) => !i.owned)
    expect(missing.readState).toBeUndefined()
    expect(missing.percent).toBeUndefined()
  } finally { await t.cleanup() }
})

test('an unread issue you own says so rather than saying nothing', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const issues = (await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).json().arc.issues
    expect(issues.find((i: { id: number }) => i.id === 1156915)).toMatchObject({ readState: 'unread' })
  } finally { await t.cleanup() }
})

// This plugin builds its Comic Vine client once, when it registers. A client that
// captured the key at that moment would hold an empty one for the life of the process,
// so a key entered under Settings would do nothing until a restart. Every other test in
// this suite seeds the key BEFORE registering, which is exactly why none of them can
// catch that - reverting the construction to `apiKey: getComicVineKey(app.db)` leaves
// them all green.
test('a key entered after the routes registered is used without a restart', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]], '')
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    expect((await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).statusCode).toBe(400)

    setComicVineKey(t.db, 'test-key')
    expect((await t.app.inject({ url: '/api/arcs/Death%20Spiral' })).statusCode).toBe(200)
  } finally { await t.cleanup() }
})

// ── Where an issue sits in its arc ────────────────────────────────────────────────────
// The detail page asks this per book, so it must be cheap and must never block on an
// arc it can serve from the cache.

test('an issue reports its place in the arc it belongs to', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/2.cbz', 1158149)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const res = await t.app.inject({ url: `/api/books/${a.id}/arcs` })
    expect(res.statusCode).toBe(200)
    expect(res.json().arcs).toEqual([
      { name: 'Death Spiral', arcId: 56676, position: 2, total: 3, siteUrl: ARC.site_detail_url },
    ])
  } finally { await t.cleanup() }
})

// Position counts the whole arc, not the part of it you happen to own - the point is
// where you are in the STORY.
test('the position counts every issue in the arc, not just the ones you own', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/3.cbz', 9999999)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const arcs = (await t.app.inject({ url: `/api/books/${a.id}/arcs` })).json().arcs
    expect(arcs[0]).toMatchObject({ position: 3, total: 3 })
  } finally { await t.cleanup() }
})

test('an issue in no arc reports no arcs and costs no Comic Vine requests', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'character', value: 'Venom' }])
  try {
    const res = await t.app.inject({ url: `/api/books/${a.id}/arcs` })
    expect(res.json().arcs).toEqual([])
    expect(t.urls).toHaveLength(0)
  } finally { await t.cleanup() }
})

// A tie-in can carry an arc tag without Comic Vine listing it among the arc's issues.
// Reporting "Part 0 of 9" would be a lie, so the arc is named with no position at all.
test('an issue the arc does not list is named without a position', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/tie-in.cbz', 7777777)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const arcs = (await t.app.inject({ url: `/api/books/${a.id}/arcs` })).json().arcs
    expect(arcs).toHaveLength(1)
    expect(arcs[0]).toMatchObject({ name: 'Death Spiral', total: 3 })
    expect(arcs[0].position).toBeUndefined()
  } finally { await t.cleanup() }
})

test('an issue in two arcs reports its place in each', async () => {
  // Listed newest-first on purpose: the run is sorted into reading order by date, so this
  // book is the arc's SECOND issue however Comic Vine happened to list it.
  const OTHER = {
    id: 61350, name: 'Armageddon', publisher: { name: 'Marvel' },
    site_detail_url: 'https://cv/armageddon',
    issues: [
      { id: 1158149, name: 'Part Two' },
      { id: 1156915, name: 'Part One' },
    ],
  }
  const t = await setup([['/story_arc/4045-56676/', { results: ARC }], ['/story_arc/4045-61350/', { results: OTHER }]])
  const a = t.mk('Vol 7/2.cbz', 1158149)
  replaceBookTags(t.db, a.id, [
    { kind: 'story_arc', value: 'Death Spiral', extId: 56676 },
    { kind: 'story_arc', value: 'Armageddon', extId: 61350 },
  ])
  try {
    const arcs = (await t.app.inject({ url: `/api/books/${a.id}/arcs` })).json().arcs
    expect(arcs).toEqual([
      { name: 'Death Spiral', arcId: 56676, position: 2, total: 3, siteUrl: ARC.site_detail_url },
      { name: 'Armageddon', arcId: 61350, position: 2, total: 2, siteUrl: 'https://cv/armageddon' },
    ])
  } finally { await t.cleanup() }
})

// The arc page and the detail page must not each pay for the same run.
test('the arc page warms the cache the issue page then reads', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/2.cbz', 1158149)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    await t.app.inject({ url: '/api/arcs/Death%20Spiral' })
    const afterArcPage = t.urls.length
    const res = await t.app.inject({ url: `/api/books/${a.id}/arcs` })

    expect(t.urls.slice(afterArcPage)).toEqual([])
    expect(res.json().arcs[0]).toMatchObject({ position: 2, total: 3 })
  } finally { await t.cleanup() }
})

// A book with no Comic Vine id cannot be placed in a run, but the arc it carries is still
// worth naming. Nothing here needs Comic Vine to answer that.
test('an issue with no Comic Vine id still names its arc', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const b = insertBook(t.db, { editionId: t.edition.id, filePath: 'Vol 7/x.cbz', pageCount: 1, fileSize: 100 })!
  replaceBookTags(t.db, b.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const res = await t.app.inject({ url: `/api/books/${b.id}/arcs` })
    expect(res.statusCode).toBe(200)
    expect(res.json().arcs[0]).toMatchObject({ name: 'Death Spiral' })
    expect(res.json().arcs[0].position).toBeUndefined()
    expect(t.urls).toHaveLength(0)
  } finally { await t.cleanup() }
})

// The detail page must render whether or not Comic Vine is reachable or configured, so a
// failure here names the arc rather than failing the request.
test('an issue whose arc Comic Vine will not answer for still names the arc', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/2.cbz', 1158149)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    t.breakFetch()
    const res = await t.app.inject({ url: `/api/books/${a.id}/arcs` })
    expect(res.statusCode).toBe(200)
    expect(res.json().arcs[0]).toMatchObject({ name: 'Death Spiral' })
    expect(res.json().arcs[0].position).toBeUndefined()
  } finally { await t.cleanup() }
})

test('an issue page with no API key configured still names the arc', async () => {
  const t = await setup([['/story_arc/', { results: ARC }]], '')
  const a = t.mk('Vol 7/2.cbz', 1158149)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  try {
    const res = await t.app.inject({ url: `/api/books/${a.id}/arcs` })
    expect(res.statusCode).toBe(200)
    expect(res.json().arcs[0]).toMatchObject({ name: 'Death Spiral' })
    expect(res.json().arcs[0].position).toBeUndefined()
  } finally { await t.cleanup() }
})

test('the arcs of a book that does not exist 404', async () => {
  const t = await setup()
  try {
    expect((await t.app.inject({ url: '/api/books/999/arcs' })).statusCode).toBe(404)
  } finally { await t.cleanup() }
})
