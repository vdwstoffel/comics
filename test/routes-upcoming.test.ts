import { test, expect } from 'vitest'
import Fastify from 'fastify'
import upcomingRoutes from '../server/routes/upcoming.js'
import { openDb } from '../server/db.js'
import { cacheUpcomingWeek } from '../server/models/upcoming.js'
import { MARVEL_USER_AGENT } from '../server/lib/marvelCalendar.js'
import type { Config } from '../server/config.js'
import type { Db } from '../server/types.js'

const NOW = new Date('2026-09-25T10:00:00Z') // a Friday; upcoming starts 2026-09-30

/** One week's page, shaped like the real one. Titles invented - see marvel-calendar.test. */
function page(entries: Array<{ id: string; headline: string; date: string }>): string {
  const content = entries.map((e) => ({
    headline: e.headline,
    releaseDate: e.date,
    isVariant: 0,
    creators_shortlist: 'Invented',
    image: { filename: `https://cdn.marvel.com/x/${e.id}.jpg` },
    link: { link: `https://www.marvel.com/comics/issue/${e.id}/x` },
  }))
  return `<html><script>window.x={"allComicsReleases":${
    JSON.stringify({ total: content.length, content })},"allCollectionsReleases":{"total":0,"content":[]}}</script></html>`
}

/**
 * Issue ids must be numeric: Marvel's are (134736), and marvelCalendar's issueId only
 * matches digits, so a week's id is its date with the dashes taken out.
 */

/** The Wednesday a calendar url is asking about: dateStart is always the Wednesday - 3. */
function weekOf(url: string): string {
  const start = new URL(url).searchParams.get('dateStart')!
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 3)
  return d.toISOString().slice(0, 10)
}

async function setup(fetchPage: (url: string) => Promise<string>): Promise<{ app: ReturnType<typeof Fastify>; db: Db }> {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  await app.register(upcomingRoutes, { fetchPage, now: () => NOW })
  return { app, db }
}

/** Answers every week with one invented issue, and records which urls were asked for. */
function everyWeek() {
  const urls: string[] = []
  const fetchPage = async (url: string) => {
    urls.push(url)
    const week = weekOf(url)
    return page([{ id: week.replace(/-/g, ''), headline: `Invented Ongoing (2026) #1`, date: week }])
  }
  return { urls, fetchPage }
}

test('serves upcoming weeks, nearest first, starting after this week', async () => {
  const { fetchPage } = everyWeek()
  const { app } = await setup(fetchPage)
  const res = await app.inject({ method: 'GET', url: '/api/releases/upcoming' })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  const marvel = body.publishers.find((p: { name: string }) => p.name === 'Marvel')
  expect(marvel.weeks[0].week).toBe('2026-09-30')
  const weeks = marvel.weeks.map((w: { week: string }) => w.week)
  expect([...weeks].sort()).toEqual(weeks)
  expect(marvel.weeks[0].issues[0].headline).toBe('Invented Ongoing (2026) #1')
})

// Not behind the Comic Vine key check: this reads Marvel, so the tab works on a fresh
// install with no key entered. /api/releases/running sets the precedent.
test('answers with no Comic Vine key configured', async () => {
  const { fetchPage } = everyWeek()
  const { app } = await setup(fetchPage)
  const res = await app.inject({ method: 'GET', url: '/api/releases/upcoming' })
  expect(res.statusCode).toBe(200)
  expect(res.json().publishers[0].weeks.length).toBeGreaterThan(0)
})

test('DC keeps its tab and is marked unsupported rather than empty', async () => {
  const { fetchPage } = everyWeek()
  const { app } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()

  expect(body.publishers.map((p: { name: string }) => p.name)).toEqual(['Marvel', 'DC Comics'])
  const dc = body.publishers[1]
  expect(dc.unsupported).toBe(true)
  expect(dc.weeks).toEqual([])
})

test('a fresh cached week is served without fetching it', async () => {
  const { urls, fetchPage } = everyWeek()
  const { app, db } = await setup(fetchPage)
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', [{
    sourceId: '1', headline: 'Invented Cached (2026) #7', seriesName: 'Invented Cached',
    number: '7', releaseDate: '2026-09-30', coverUrl: null,
    siteUrl: 'https://www.marvel.com/comics/issue/1/x', creators: null,
  }], NOW.toISOString())

  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()
  expect(urls.map(weekOf)).not.toContain('2026-09-30')
  expect(body.publishers[0].weeks[0].issues[0].headline).toBe('Invented Cached (2026) #7')
})

// Review Focus 5: nothing on a happy path would notice ten simultaneous requests.
test('never has more than three requests to Marvel in flight', async () => {
  let inFlight = 0
  let peak = 0
  const fetchPage = async (url: string) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight--
    const week = weekOf(url)
    return page([{ id: week.replace(/-/g, ''), headline: 'Invented Ongoing (2026) #1', date: week }])
  }
  const { app } = await setup(fetchPage)
  await app.inject({ method: 'GET', url: '/api/releases/upcoming' })
  expect(peak).toBeLessThanOrEqual(3)
  expect(peak).toBeGreaterThan(1)
})

test('one failing week does not blank the others, and is named stale', async () => {
  const fetchPage = async (url: string) => {
    const week = weekOf(url)
    if (week === '2026-10-07') throw new Error('network is down')
    return page([{ id: week.replace(/-/g, ''), headline: 'Invented Ongoing (2026) #1', date: week }])
  }
  const { app } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()

  const weeks = body.publishers[0].weeks.map((w: { week: string }) => w.week)
  expect(weeks).toContain('2026-09-30')
  // The failed week keeps its place in the run rather than vanishing from the middle of
  // the calendar - it is empty, and named as stale, which is a different thing from a
  // week that was never announced.
  expect(weeks).toContain('2026-10-07')
  const failed = body.publishers[0].weeks.find((w: { week: string }) => w.week === '2026-10-07')
  expect(failed.issues).toEqual([])
  expect(body.staleWeeks).toContain('2026-10-07')
})

test('a failing week falls back to what is cached, at any age', async () => {
  // Every OTHER week must return a real issue: a load where every week that succeeded
  // came back empty is the structural-change case, which refuses to cache at all and
  // would mask the fallback this test is about.
  const fetchPage = async (url: string) => {
    const week = weekOf(url)
    if (week === '2026-09-30') throw new Error('network is down')
    return page([{ id: week.replace(/-/g, ''), headline: 'Invented Ongoing (2026) #1', date: week }])
  }
  const { app, db } = await setup(fetchPage)
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', [{
    sourceId: '1', headline: 'Invented Old (2026) #1', seriesName: 'Invented Old',
    number: '1', releaseDate: '2026-09-30', coverUrl: null,
    siteUrl: 'https://www.marvel.com/comics/issue/1/x', creators: null,
  }], '2026-09-01T12:00:00.000Z') // long stale

  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()
  expect(body.publishers[0].weeks[0].issues[0].headline).toBe('Invented Old (2026) #1')
  expect(body.staleWeeks).toContain('2026-09-30')
})

// The horizon: Marvel solicits about nine weeks out, so the tail is genuinely empty and
// the page must end there rather than showing a run of empty headings.
test('trailing empty weeks are dropped', async () => {
  const fetchPage = async (url: string) => {
    const week = weekOf(url)
    if (week > '2026-10-14') return page([])
    return page([{ id: week.replace(/-/g, ''), headline: 'Invented Ongoing (2026) #1', date: week }])
  }
  const { app } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()
  const weeks = body.publishers[0].weeks.map((w: { week: string }) => w.week)
  expect(weeks[weeks.length - 1]).toBe('2026-10-14')
})

// A three-issue week is real (measured), so "few" never means "broken". Only EVERY week
// coming back empty means the payload changed shape - and that must not be cached, or the
// emptiness sticks for twelve hours.
test('every week empty is reported as unavailable and is not cached', async () => {
  const fetchPage = async () => page([])
  const { app, db } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()

  expect(body.publishers[0].unavailable).toBe(true)
  expect(body.publishers[0].weeks).toEqual([])
  const rows = db.prepare('SELECT COUNT(*) AS n FROM upcoming_week').get() as { n: number }
  expect(rows.n).toBe(0)
})

test('a payload that changed shape is not cached as an empty week', async () => {
  const fetchPage = async () => '<html><body>Marvel redesigned the page</body></html>'
  const { app, db } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()

  expect(body.publishers[0].unavailable).toBe(true)
  const rows = db.prepare('SELECT COUNT(*) AS n FROM upcoming_week').get() as { n: number }
  expect(rows.n).toBe(0)
})

test('weeks now in the past are pruned on the way through', async () => {
  const { fetchPage } = everyWeek()
  const { app, db } = await setup(fetchPage)
  cacheUpcomingWeek(db, '2026-09-16', 'Marvel', [], '2026-09-10T12:00:00.000Z')

  await app.inject({ method: 'GET', url: '/api/releases/upcoming' })

  const gone = db.prepare('SELECT COUNT(*) AS n FROM upcoming_week WHERE week = ?').get('2026-09-16') as { n: number }
  expect(gone.n).toBe(0)
})

/** One solicited issue, for seeding the cache. */
const seed = (sourceId: string) => ({
  sourceId, headline: `Invented Ongoing (2026) #${sourceId}`, seriesName: 'Invented Ongoing',
  number: sourceId, releaseDate: '2026-09-30', coverUrl: null,
  siteUrl: `https://www.marvel.com/comics/issue/${sourceId}/x`, creators: null,
})

/**
 * The structural-change guard must weigh the WHOLE window, not just the weeks fetched this
 * time round. Marvel's horizon is about nine weeks, so the tenth is empty by definition; and
 * the window rolls forward every Wednesday, admitting exactly one new far-horizon week while
 * the other nine are still inside their twelve-hour cache. Judging "did the page change
 * shape?" on that one empty week threw away nine good weeks and reported the whole tab
 * unavailable - roughly weekly, for up to twelve hours.
 */
test('one empty far-horizon week does not blank the weeks already cached', async () => {
  const fetchPage = async () => page([])
  const { app, db } = await setup(fetchPage)
  // Every week but the last is cached fresh, with real issues.
  const weeks = ['2026-09-30', '2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28',
    '2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']
  for (const w of weeks) cacheUpcomingWeek(db, w, 'Marvel', [seed('1')], NOW.toISOString())

  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()
  const marvel = body.publishers[0]

  expect(marvel.unavailable).toBeUndefined()
  expect(marvel.weeks.map((w: { week: string }) => w.week)).toEqual(weeks)
})

// Review Focus 1 in the plan names this the one failure that ships green. Pinning the shape
// of the UA constant does not defend it: the route has to actually default to the fetcher
// that sends it. Swap the default back to fetchSourcePage and only this test notices.
test('defaults to the fetcher Marvel accepts, and sends that User-Agent', async () => {
  const seen: Array<{ url: string; ua: string }> = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    seen.push({ url: String(url), ua: String(init?.headers?.['user-agent'] ?? '') })
    return { ok: true, text: async () => page([]) }
  }) as unknown as typeof fetch

  try {
    const app = Fastify()
    const db = openDb(':memory:')
    app.decorate('db', db)
    app.decorate('config', {} as Config)
    // No fetchPage injected: this is the live wiring.
    await app.register(upcomingRoutes, { now: () => NOW })
    await app.inject({ method: 'GET', url: '/api/releases/upcoming' })
  } finally {
    globalThis.fetch = realFetch
  }

  expect(seen.length).toBeGreaterThan(0)
  expect(seen[0]!.url).toContain('marvel.com/comics/calendar')
  expect(seen[0]!.ua).toBe(MARVEL_USER_AGENT)
})
