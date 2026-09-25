import { upcomingWednesdays } from '../lib/releaseDay.js'
import { calendarUrl, parseCalendar, fetchCalendarPage, MARVEL } from '../lib/marvelCalendar.js'
import type { UpcomingIssue } from '../lib/marvelCalendar.js'
import {
  cacheUpcomingWeek, getCachedUpcomingWeek, getFreshUpcomingWeek, pruneUpcomingBefore,
} from '../models/upcoming.js'
import type { App } from '../types.js'

/**
 * How many Wednesdays ahead to ask about. Marvel was measured solicitating about nine
 * weeks out, and the boundary rolls forward as new solicitations drop; ten covers it with
 * room to grow. Weeks past the horizon come back empty and are dropped from the answer.
 */
const WEEKS_AHEAD = 10

/**
 * How many requests to Marvel may be in flight at once. A cold load is ten pages of about
 * 330KB; three at a time keeps it to a couple of seconds without hammering a site that is
 * doing us a favour by being readable at all.
 */
const CONCURRENCY = 3

/** The publishers this tab names, in the order the other two tabs name them. */
const SHOWN = [MARVEL, 'DC Comics'] as const

export interface UpcomingRouteOpts {
  /** Injected so tests never touch the network, exactly as the other release routes do. */
  fetchPage?: (url: string) => Promise<string>
  /** Injected so tests can pin "today". */
  now?: () => Date
}

interface Week {
  week: string
  issues: UpcomingIssue[]
}

/** Run `fn` over `items` with at most `limit` in flight, keeping input order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]!) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export default async function upcomingRoutes(app: App, opts: UpcomingRouteOpts = {}) {
  // fetchCalendarPage, NOT fetchSourcePage: Marvel answers that one's User-Agent with a
  // 403. Nothing in the test suite can catch this, because every test injects fetchPage.
  const { fetchPage = fetchCalendarPage, now = () => new Date() } = opts

  /**
   * What Marvel says is coming over the next weeks.
   *
   * Deliberately NOT behind the Comic Vine key check that guards `/api/releases`: this
   * reads Marvel and has nothing to do with Comic Vine, so the tab works on a fresh
   * install with no key entered - the same choice `/api/releases/running` makes.
   */
  app.get('/api/releases/upcoming', async () => {
    const today = now()
    const weeks = upcomingWednesdays(today, WEEKS_AHEAD)

    // A week that has arrived is no longer upcoming; the Latest tab owns it. Without this
    // the tables grow forever, because nothing else ever deletes from them.
    pruneUpcomingBefore(app.db, weeks[0]!)

    const held = new Map<string, UpcomingIssue[]>()
    const stale = new Set<string>()
    const toFetch: string[] = []

    for (const week of weeks) {
      const fresh = getFreshUpcomingWeek(app.db, week, MARVEL, today)
      if (fresh) held.set(week, fresh.issues)
      else toFetch.push(week)
    }

    const fetched = await pool(toFetch, CONCURRENCY, async (week) => ({
      week,
      issues: parseCalendar(await fetchPage(calendarUrl(week))),
    }))

    // A genuinely light week is real - three issues was measured - so "few" can never mean
    // "broken". But EVERY week being empty means the payload changed shape, and caching that
    // would freeze the emptiness in for twelve hours. A week that THREW never reaches here
    // at all, so an all-failed load is caught by the same guard.
    //
    // Weighed across the whole window rather than only the weeks fetched this time. Marvel's
    // horizon is about nine weeks, so the tenth is empty by definition, and the window rolls
    // forward every Wednesday - admitting one new far-horizon week while the other nine are
    // still inside their twelve-hour cache. Judging the page's shape on that single empty
    // week discarded nine perfectly good cached weeks and reported the whole tab unavailable,
    // about once a week, for as long as the cache held.
    const fetchedOk = fetched.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const knownIssues = [...held.values()].reduce((n, issues) => n + issues.length, 0)
      + fetchedOk.reduce((n, w) => n + w.issues.length, 0)
    const structural = fetchedOk.length > 0 && knownIssues === 0

    for (let i = 0; i < fetched.length; i++) {
      const week = toFetch[i]!
      const result = fetched[i]!
      if (result.status === 'fulfilled' && !structural) {
        cacheUpcomingWeek(app.db, week, MARVEL, result.value.issues, today.toISOString())
        held.set(week, result.value.issues)
        continue
      }
      if (result.status === 'rejected') {
        app.log.warn({ err: result.reason, week }, 'Marvel calendar read failed')
      }
      // Whatever we hold beats nothing, however old it is - and say that it is old.
      const anyAge = getCachedUpcomingWeek(app.db, week, MARVEL, Infinity, today)
      if (anyAge) held.set(week, anyAge.issues)
      stale.add(week)
    }

    // Marvel's horizon: the tail of the window is genuinely empty, and a run of empty
    // headings reads as a page that failed to finish rather than as the end of the news.
    const ordered: Week[] = weeks.map((week) => ({ week, issues: held.get(week) ?? [] }))
    while (ordered.length > 0 && ordered[ordered.length - 1]!.issues.length === 0) ordered.pop()

    const unavailable = structural || (ordered.length === 0 && stale.size > 0)

    return {
      publishers: SHOWN.map((name) => (
        name === MARVEL
          ? {
            name,
            weeks: unavailable ? [] : ordered,
            ...(unavailable ? { unavailable: true } : {}),
          }
          // DC has no forward-looking source: its site exposes nothing beyond the current
          // week outside a private GraphQL endpoint. `unsupported` is a different thing
          // from an empty list, and the difference is the point - an empty list would read
          // as "DC has announced nothing for two months", which is never what it means.
          : { name, weeks: [], unsupported: true as const }
      )),
      ...(stale.size > 0 ? { staleWeeks: [...stale].sort() } : {}),
    }
  })
}
