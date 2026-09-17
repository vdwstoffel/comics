import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import releaseRoutes from '../server/routes/releases.js'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { cacheRelease, getCachedRelease } from '../server/models/releases.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

// 2026-09-14 is a Monday, so the most recent Wednesday is 2026-09-09. The clock is faked
// rather than injected: the route reads `new Date()` directly, and a seam in production
// code that exists only for a test is a seam worth not having.
const NOW = new Date('2026-09-14T12:00:00.000Z')

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

function issueRow(id: number, volumeId: number, volumeName: string, number: string) {
  return {
    id, issue_number: number, name: null,
    cover_date: '2026-11-01', store_date: '2026-09-09',
    image: { small_url: `cover-${id}.jpg` },
    site_detail_url: `https://cv/${id}`,
    volume: { id: volumeId, name: volumeName },
  }
}

const DAY_ISSUES = {
  results: [
    issueRow(1192026, 176900, 'Black Cat', '14'),
    issueRow(1191941, 91078, 'Action Comics', '1102'),
    issueRow(1192263, 53817, 'Weekly Shonen Sunday', '3970'),
  ],
  number_of_total_results: 3,
}

const PUBLISHERS = {
  results: [
    { id: 176900, publisher: { name: 'Marvel' } },
    { id: 91078, publisher: { name: 'DC Comics' } },
    { id: 53817, publisher: { name: 'Shogakukan' } },
  ],
}

// Comic Vine's own response order for a real Wednesday - not alphabetical by volume name.
// Deliberately out of the expected order: a fixture that already matched it would let a
// broken cold path pass by accident.
const OUT_OF_ORDER_DC = {
  results: [
    issueRow(2001, 91078, 'Action Comics', '1102'),
    issueRow(2002, 91079, 'Barbara Gordon: Breakout', '5'),
    issueRow(2003, 91080, 'Batman and Robin: Year One', '2'),
    issueRow(2004, 91081, 'Absolute Batman', '3'),
  ],
  number_of_total_results: 4,
}

const OUT_OF_ORDER_PUBLISHERS = {
  results: [
    { id: 91078, publisher: { name: 'DC Comics' } },
    { id: 91079, publisher: { name: 'DC Comics' } },
    { id: 91080, publisher: { name: 'DC Comics' } },
    { id: 91081, publisher: { name: 'DC Comics' } },
  ],
}

// Only the Marvel volume of the three comes back: the chunk carrying the other two
// failed and byIds swallowed it. Half a Wednesday, presented as a whole one.
const PARTIAL_PUBLISHERS = {
  results: [{ id: 176900, publisher: { name: 'Marvel' } }],
}

// The lost chunk happened to hold every Marvel and DC volume, so what survives is a
// day that looks completely empty but is not.
const ONLY_UNSHOWN_PUBLISHER = {
  results: [{ id: 53817, publisher: { name: 'Shogakukan' } }],
}

// Comic Vine has been known to repeat an id across pages. Both copies reach the route.
const REPEATED_ID_DC = {
  results: [
    issueRow(2001, 91078, 'Action Comics', '1102'),
    issueRow(2002, 91079, 'Barbara Gordon: Breakout', '5'),
    issueRow(2001, 91078, 'Action Comics', '1102'),
  ],
  number_of_total_results: 3,
}

const REPEATED_ID_PUBLISHERS = {
  results: [
    { id: 91078, publisher: { name: 'DC Comics' } },
    { id: 91079, publisher: { name: 'DC Comics' } },
  ],
}

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
  app.decorate('config', {} as Config)
  // The key is a setting now, not configuration. A suite that passes '' is testing the
  // unconfigured path and seeds nothing.
  if (apiKey) setComicVineKey(db, apiKey)
  const { urls, impl } = recordingFetch(routes)
  const origFetch = globalThis.fetch
  // A single stub, installed once before the route registers its Comic Vine client and
  // never reassigned again - matching how the route itself resolves `fetch` exactly once,
  // at registration (see server/routes/arcs.ts, the control case for this idiom). A test
  // that wants different behaviour partway through calls setFetch() to swap what this
  // stub delegates to, not the global itself; reassigning the global after registration
  // would have no visible effect on the route.
  let handler = impl as unknown as typeof fetch
  globalThis.fetch = ((url: string, init?: RequestInit) => handler(url, init)) as unknown as typeof fetch
  await app.register(releaseRoutes)

  const edition = upsertEdition(db, { name: 'Black Cat', folder: 'Black Cat' })
  const mk = (path: string, cvId: number) => {
    const b = insertBook(db, { editionId: edition.id, filePath: path, pageCount: 1, fileSize: 100 })!
    updateBook(db, b.id, { comicvineId: cvId })
    return b
  }
  return {
    app, db, urls, mk,
    setFetch: (fn: typeof fetch) => { handler = fn },
    cleanup: async () => { globalThis.fetch = origFetch; await app.close() },
  }
}

const LIVE: Array<[string, unknown]> = [['/issues/', DAY_ISSUES], ['/volumes/', PUBLISHERS]]

test('the page shows the most recent Wednesday', async () => {
  const t = await setup(LIVE)
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    expect(res.statusCode).toBe(200)
    expect(res.json().day).toBe('2026-09-09')
  } finally { await t.cleanup() }
})

test('everything that is not Marvel or DC is dropped', async () => {
  const t = await setup(LIVE)
  try {
    const { publishers } = (await t.app.inject({ url: '/api/releases' })).json()
    expect(publishers.map((p: { name: string }) => p.name)).toEqual(['Marvel', 'DC Comics'])
    const all = publishers.flatMap((p: { issues: unknown[] }) => p.issues)
    expect(all).toHaveLength(2)
    expect(JSON.stringify(all)).not.toContain('Shonen')
  } finally { await t.cleanup() }
})

test('a second visit costs no Comic Vine requests', async () => {
  const t = await setup(LIVE)
  try {
    await t.app.inject({ url: '/api/releases' })
    const afterFirst = t.urls.length
    await t.app.inject({ url: '/api/releases' })
    expect(t.urls.length).toBe(afterFirst)
  } finally { await t.cleanup() }
})

test('refresh=1 asks again', async () => {
  const t = await setup(LIVE)
  try {
    await t.app.inject({ url: '/api/releases' })
    const afterFirst = t.urls.length
    await t.app.inject({ url: '/api/releases?refresh=1' })
    expect(t.urls.length).toBeGreaterThan(afterFirst)
  } finally { await t.cleanup() }
})

test('an issue you own is marked and carries its book id', async () => {
  const t = await setup(LIVE)
  const book = t.mk('Black Cat/14.cbz', 1192026)
  try {
    const { publishers } = (await t.app.inject({ url: '/api/releases' })).json()
    const marvel = publishers.find((p: { name: string }) => p.name === 'Marvel')
    expect(marvel.issues[0]).toMatchObject({ id: 1192026, owned: true, bookId: book.id })
  } finally { await t.cleanup() }
})

// A match for a comic you already have would be computed and thrown away.
test('a match is computed only for an issue you do not own', async () => {
  const t = await setup(LIVE)
  t.mk('Black Cat/14.cbz', 1192026)
  try {
    const { publishers } = (await t.app.inject({ url: '/api/releases' })).json()
    const owned = publishers.find((p: { name: string }) => p.name === 'Marvel').issues[0]
    const missing = publishers.find((p: { name: string }) => p.name === 'DC Comics').issues[0]
    expect(owned.match).toBeUndefined()
    expect(missing).toHaveProperty('match')
  } finally { await t.cleanup() }
})

// Early on a Wednesday, before Comic Vine has been updated.
test('a Wednesday with nothing falls back to the week before', async () => {
  const empty = { results: [], number_of_total_results: 0 }
  const t = await setup([])
  t.setFetch((async (url: string) => {
    if (url.includes('/volumes/')) return { ok: true, json: async () => PUBLISHERS }
    const day = new URL(url).searchParams.get('filter')
    return { ok: true, json: async () => (day?.includes('2026-09-09') ? empty : DAY_ISSUES) }
  }) as unknown as typeof fetch)
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    expect(res.json().day).toBe('2026-09-02')
  } finally { await t.cleanup() }
})

test('the fallback runs once, not forever', async () => {
  const t = await setup([['/issues/', { results: [], number_of_total_results: 0 }], ['/volumes/', { results: [] }]])
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    expect(res.statusCode).toBe(200)
    expect(res.json().publishers.flatMap((p: { issues: unknown[] }) => p.issues)).toEqual([])
    expect(t.urls.filter((u) => u.includes('/issues/'))).toHaveLength(2)
  } finally { await t.cleanup() }
})

// A day cached as empty must fall back too, not just an empty fetch.
test('a day cached as empty falls back as well', async () => {
  const t = await setup(LIVE)
  cacheRelease(t.db, '2026-09-09', [], NOW.toISOString())
  try {
    expect((await t.app.inject({ url: '/api/releases' })).json().day).toBe('2026-09-02')
  } finally { await t.cleanup() }
})

test('a cached day is served when Comic Vine will not answer', async () => {
  const t = await setup(LIVE)
  try {
    await t.app.inject({ url: '/api/releases' })
    t.setFetch((async () => { throw new Error('offline') }) as unknown as typeof fetch)
    const res = await t.app.inject({ url: '/api/releases?refresh=1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().stale).toBe(true)
    expect(res.json().publishers.flatMap((p: { issues: unknown[] }) => p.issues)).toHaveLength(2)
  } finally { await t.cleanup() }
})

test('nothing cached and Comic Vine down says so rather than erroring', async () => {
  const t = await setup([])
  t.setFetch((async () => { throw new Error('offline') }) as unknown as typeof fetch)
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    expect(res.statusCode).toBe(200)
    expect(res.json().unavailable).toBe(true)
  } finally { await t.cleanup() }
})

test('the page 400s when no API key is configured', async () => {
  const t = await setup(LIVE, '')
  try {
    expect((await t.app.inject({ url: '/api/releases' })).statusCode).toBe(400)
  } finally { await t.cleanup() }
})

// Regression guard for Finding A: getVolumePublishers is built on byIds, which swallows a
// failed chunk rather than rethrowing. A day whose /issues/ call succeeds but whose
// /volumes/ call fails must not be stamped as a genuinely quiet day - every issue drops
// out for want of a known publisher, and if that were cached, a day earlier than today
// reads at Infinity and would never be asked about again.
test('a day whose publisher lookup fails is not stamped as empty', async () => {
  const t = await setup([])
  t.setFetch((async (url: string) => {
    if (url.includes('/volumes/')) return { ok: false, status: 500, json: async () => ({}) }
    if (url.includes('/issues/')) return { ok: true, json: async () => DAY_ISSUES }
    throw new Error(`unexpected url ${url}`)
  }) as unknown as typeof fetch)
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    expect(res.statusCode).toBe(200)
    expect(res.json().day).toBe('2026-09-09')
    // The failed /volumes/ lookup must not have stamped the day as genuinely empty.
    expect(getCachedRelease(t.db, '2026-09-09', Infinity)).toBeFalsy()
  } finally { await t.cleanup() }
})

// Regression guard for Finding B: `stale` and `unavailable` used to be shared flags
// mutated by both resolve() calls, so a fallback that found nothing could contaminate a
// primary day that was served just fine.
test('a normal non-empty Wednesday sets neither stale nor unavailable', async () => {
  const t = await setup(LIVE)
  try {
    const body = (await t.app.inject({ url: '/api/releases' })).json()
    expect(body.stale).toBeUndefined()
    expect(body.unavailable).toBeUndefined()
  } finally { await t.cleanup() }
})

test('a stale primary day is not also reported unavailable when its fallback cannot be reached', async () => {
  const t = await setup([])
  // A quiet Wednesday from a prior, successful visit - legitimately cached as empty.
  cacheRelease(t.db, '2026-09-09', [], '2026-09-01T00:00:00.000Z')
  t.setFetch((async () => { throw new Error('offline') }) as unknown as typeof fetch)
  try {
    // refresh=1 forces both the primary and the fallback resolve() to attempt Comic Vine
    // rather than read their caches, so both hit the offline catch path.
    const res = await t.app.inject({ url: '/api/releases?refresh=1' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // The primary day fell back to its own cache (stale, but served). The fallback day
    // found nothing cached at all - but that must not turn the served primary day
    // "unavailable" too.
    expect(body.stale).toBe(true)
    expect(body.unavailable).toBeUndefined()
  } finally { await t.cleanup() }
})

// A cold (cache-miss) response used to return Comic Vine's own arbitrary order; only a
// cache hit went through the ORDER BY that actually defines the page. Asserting a
// hardcoded order in just one of the two paths is exactly what let that through, so this
// compares the cold response's order against the cached response's order directly, and
// against the stale (cache-served-after-failure) response's order too.
test('a cold response and a cached response order issues identically', async () => {
  const t = await setup([['/issues/', OUT_OF_ORDER_DC], ['/volumes/', OUT_OF_ORDER_PUBLISHERS]])
  const dcOrder = (body: { publishers: Array<{ name: string; issues: Array<{ id: number }> }> }) =>
    body.publishers.find((p) => p.name === 'DC Comics')!.issues.map((i) => i.id)
  try {
    const cold = (await t.app.inject({ url: '/api/releases' })).json()
    const coldOrder = dcOrder(cold)

    // The fixture's own order must not already be the expected order, or the assertions
    // below would pass whether or not the cold path sorts anything.
    expect(coldOrder).not.toEqual([2001, 2002, 2003, 2004])
    expect(coldOrder).toEqual([2004, 2001, 2002, 2003])

    const cached = (await t.app.inject({ url: '/api/releases' })).json()
    expect(dcOrder(cached)).toEqual(coldOrder)

    // The stale path: a cache hit served after Comic Vine fails must agree too.
    t.setFetch((async () => { throw new Error('offline') }) as unknown as typeof fetch)
    const stale = (await t.app.inject({ url: '/api/releases?refresh=1' })).json()
    expect(stale.stale).toBe(true)
    expect(dcOrder(stale)).toEqual(coldOrder)
  } finally { await t.cleanup() }
})

// --- Finding 1: a Wednesday fetched ON that Wednesday used to freeze at UTC midnight.
// Permanence was keyed on the day being past rather than on the fetch having happened
// after the day ended, and Comic Vine carries no future store_dates - so the day is
// still filling in while you are looking at it.

test('a day fetched during that same day is asked about again later', async () => {
  const t = await setup(LIVE)
  // Wednesday 20:00, when Comic Vine held only part of the day.
  cacheRelease(t.db, '2026-09-09', [], '2026-09-09T20:00:00.000Z')
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    // The partial snapshot was not served as final: Comic Vine was asked again, and the
    // day it now reports is the real one rather than a permanent fallback to last week.
    expect(t.urls.filter((u) => u.includes('/issues/')).length).toBeGreaterThan(0)
    expect(res.json().day).toBe('2026-09-09')
    expect(res.json().publishers.flatMap((p: { issues: unknown[] }) => p.issues)).toHaveLength(2)
  } finally { await t.cleanup() }
})

test('a day fetched after the day ended costs no Comic Vine requests', async () => {
  const t = await setup(LIVE)
  // Thursday morning: nothing more can arrive for a Wednesday that is over.
  cacheRelease(t.db, '2026-09-09', [], '2026-09-10T09:00:00.000Z')
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    // Settled and genuinely empty, so it falls back - but only the fallback day is
    // fetched; the settled day itself is never re-asked.
    expect(res.json().day).toBe('2026-09-02')
    expect(t.urls.filter((u) => u.includes('filter=store_date%3A2026-09-09'))).toHaveLength(0)
  } finally { await t.cleanup() }
})

// The two halves of the rule read against each other: same cached content, same clock,
// and the only difference is which side of the day's end the fetch fell on.
test('what makes a cached day final is the fetch time, not the day being past', async () => {
  const during = await setup(LIVE)
  const after = await setup(LIVE)
  try {
    cacheRelease(during.db, '2026-09-09', [], '2026-09-09T20:00:00.000Z')
    cacheRelease(after.db, '2026-09-09', [], '2026-09-10T09:00:00.000Z')
    const asked = (t: { urls: string[] }) =>
      t.urls.filter((u) => u.includes('filter=store_date%3A2026-09-09')).length
    await during.app.inject({ url: '/api/releases' })
    await after.app.inject({ url: '/api/releases' })
    expect(asked(during)).toBeGreaterThan(0)
    expect(asked(after)).toBe(0)
  } finally { await during.cleanup(); await after.cleanup() }
})

// --- Finding 2: an incomplete publisher lookup used to be indistinguishable from a
// complete answer. byIds swallows a failed chunk, and a real Wednesday is two chunks.

test('a partial publisher lookup is reported stale rather than as the whole day', async () => {
  const t = await setup([['/issues/', DAY_ISSUES], ['/volumes/', PARTIAL_PUBLISHERS]])
  try {
    const body = (await t.app.inject({ url: '/api/releases' })).json()
    expect(body.stale).toBe(true)
    expect(body.day).toBe('2026-09-09')
    // What we did learn is still served - half a day beats no day.
    expect(body.publishers.flatMap((p: { issues: unknown[] }) => p.issues)).toHaveLength(1)
    // And it is not recorded, so the next visit asks again.
    expect(getCachedRelease(t.db, '2026-09-09', Infinity)).toBeFalsy()
  } finally { await t.cleanup() }
})

// The dangerous shape: the lost chunk held every Marvel and DC volume, so the day looks
// empty. Falling back there hands back last Wednesday as a complete-looking answer.
test('a publisher lookup that loses every shown volume does not serve the previous Wednesday', async () => {
  const t = await setup([['/issues/', DAY_ISSUES], ['/volumes/', ONLY_UNSHOWN_PUBLISHER]])
  try {
    const body = (await t.app.inject({ url: '/api/releases' })).json()
    expect(body.day).toBe('2026-09-09')
    expect(body.stale).toBe(true)
    // The fallback must not have run at all: one day asked about, not two.
    expect(t.urls.filter((u) => u.includes('/issues/'))).toHaveLength(1)
  } finally { await t.cleanup() }
})

// --- Finding 5: the duplicate-id defence lived in cacheRelease only, so the cached path
// was deduped by the primary key while a cold response rendered two tiles under one key.

test('a repeated Comic Vine id renders once, and identically cold and cached', async () => {
  const t = await setup([['/issues/', REPEATED_ID_DC], ['/volumes/', REPEATED_ID_PUBLISHERS]])
  const dcIds = (body: { publishers: Array<{ name: string; issues: Array<{ id: number }> }> }) =>
    body.publishers.find((p) => p.name === 'DC Comics')!.issues.map((i) => i.id)
  try {
    const coldIds = dcIds((await t.app.inject({ url: '/api/releases' })).json())
    expect(coldIds).toEqual([...new Set(coldIds)])
    expect(coldIds).toHaveLength(2)
    // The invariant asserted across the two paths rather than against a hardcoded list -
    // a list on one path is how the ordering divergence survived review.
    expect(dcIds((await t.app.inject({ url: '/api/releases' })).json())).toEqual(coldIds)
  } finally { await t.cleanup() }
})
