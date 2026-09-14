import { test, expect } from 'vitest'
import Fastify from 'fastify'
import arcRoutes from '../server/routes/arcs.js'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags, getBookTags } from '../server/models/metadata.js'
import { setProgress } from '../server/models/progress.js'
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
  const impl = async (url: string) => {
    urls.push(url)
    for (const [needle, body] of routes) if (url.includes(needle)) return { ok: true, json: async () => body }
    throw new Error(`unexpected url ${url}`)
  }
  return { urls, impl }
}

async function setup(routes: Array<[string, unknown]> = [], apiKey = 'test-key') {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { comicVineApiKey: apiKey } as Config)
  const { urls, impl } = recordingFetch([...routes, ['/issues/', ARC_ISSUE_DETAILS]])
  const origFetch = globalThis.fetch
  globalThis.fetch = impl as unknown as typeof fetch
  await app.register(arcRoutes)

  const edition = upsertEdition(db, { name: 'Vol 7', folder: 'Vol 7' })
  const mk = (path: string, cvId: number) => {
    const b = insertBook(db, { editionId: edition.id, filePath: path, pageCount: 1, fileSize: 100 })!
    updateBook(db, b.id, { comicvineId: cvId })
    return b
  }
  return { app, db, urls, edition, mk, cleanup: async () => { globalThis.fetch = origFetch; await app.close() } }
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
// issue to rediscover it. The arc itself and its issue dates are fetched either way.
test('a second visit to a backfilled arc does not re-read an issue to find the id', async () => {
  const t = await setup([['/issue/', { results: ISSUE }], ['/story_arc/', { results: ARC }]])
  const a = t.mk('Vol 7/1.cbz', 1156915)
  replaceBookTags(t.db, a.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  try {
    await t.app.inject({ url: '/api/arcs/Death%20Spiral' })
    const afterFirst = t.urls.length
    await t.app.inject({ url: '/api/arcs/Death%20Spiral' })
    const second = t.urls.slice(afterFirst)
    expect(second.some((u) => u.includes('/issue/4000-'))).toBe(false)
    expect(second.filter((u) => u.includes('/story_arc/'))).toHaveLength(1)
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
