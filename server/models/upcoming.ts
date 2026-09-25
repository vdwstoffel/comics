import { sortUpcomingIssues } from '../lib/marvelCalendar.js'
import type { UpcomingIssue } from '../lib/marvelCalendar.js'
import type { Db } from '../types.js'

/**
 * How long a cached week is trusted.
 *
 * Every week here is a solicitation, and a solicitation changes until it ships - a date
 * slips, an issue is cancelled. This is the sharpest difference from models/releases.ts,
 * where a day fetched after it ended is final and read at any age. Nothing upcoming is
 * ever final, so everything expires.
 */
export const UPCOMING_MAX_AGE_MS = 12 * 60 * 60 * 1000

export interface CachedUpcomingWeek {
  issues: UpcomingIssue[]
  fetchedAt: string
}

interface Row {
  source_id: string
  headline: string
  series_name: string
  number: string | null
  release_date: string
  cover_url: string | null
  site_url: string
  creators: string | null
}

const SELECT = `SELECT source_id, headline, series_name, number, release_date,
                       cover_url, site_url, creators
                FROM upcoming_issue`

function toIssue(r: Row): UpcomingIssue {
  return {
    sourceId: r.source_id,
    headline: r.headline,
    seriesName: r.series_name,
    number: r.number,
    releaseDate: r.release_date,
    coverUrl: r.cover_url,
    siteUrl: r.site_url,
    creators: r.creators,
  }
}

/** Age arithmetic, in one place: an infinite budget is never exceeded. */
function withinAge(fetchedAt: string, maxAgeMs: number, now: Date): boolean {
  if (!Number.isFinite(maxAgeMs)) return true
  return now.getTime() - new Date(fetchedAt).getTime() <= maxAgeMs
}

/**
 * Replace everything held for one publisher's week and stamp when it was read. One
 * transaction, so a half-written week can never be served as a whole one.
 */
export function cacheUpcomingWeek(
  db: Db,
  week: string,
  publisher: string,
  issues: UpcomingIssue[],
  now = new Date().toISOString(),
): void {
  const clear = db.prepare('DELETE FROM upcoming_issue WHERE week = ? AND publisher = ?')
  const insert = db.prepare(
    `INSERT INTO upcoming_issue
       (week, publisher, source_id, headline, series_name, number, release_date,
        cover_url, site_url, creators)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  const stamp = db.prepare(
    'INSERT INTO upcoming_week (week, publisher, fetched_at) VALUES (?,?,?) ' +
    'ON CONFLICT(week, publisher) DO UPDATE SET fetched_at = excluded.fetched_at',
  )

  db.transaction(() => {
    clear.run(week, publisher)
    const seen = new Set<string>()
    for (const issue of issues) {
      // Marvel has been seen to repeat an entry; the primary key would reject the second
      // one and abort the whole week. The Latest tab learned this from Comic Vine.
      if (seen.has(issue.sourceId)) continue
      seen.add(issue.sourceId)
      insert.run(
        week, publisher, issue.sourceId, issue.headline, issue.seriesName,
        issue.number, issue.releaseDate, issue.coverUrl, issue.siteUrl, issue.creators,
      )
    }
    stamp.run(week, publisher, now)
  })()
}

/**
 * What we hold for a publisher's week, or nothing when we never asked or it aged out. An
 * empty `issues` with a `fetchedAt` means we asked and Marvel has announced nothing for
 * that week - a normal outcome near the horizon, and not a reason to refetch.
 */
export function getCachedUpcomingWeek(
  db: Db,
  week: string,
  publisher: string,
  maxAgeMs: number,
  now = new Date(),
): CachedUpcomingWeek | undefined {
  const stamp = db
    .prepare('SELECT fetched_at FROM upcoming_week WHERE week = ? AND publisher = ?')
    .get(week, publisher) as { fetched_at: string } | undefined
  if (!stamp) return undefined
  if (!withinAge(stamp.fetched_at, maxAgeMs, now)) return undefined

  // Ordering lives in sortUpcomingIssues, never in SQL - see its comment for why a second
  // implementation of the same ordering is the bug this avoids.
  const rows = db
    .prepare(`${SELECT} WHERE week = ? AND publisher = ?`)
    .all(week, publisher) as Row[]

  return { fetchedAt: stamp.fetched_at, issues: sortUpcomingIssues(rows.map(toIssue)) }
}

/** What we hold, if it can still be trusted. The one place the TTL is applied. */
export function getFreshUpcomingWeek(
  db: Db,
  week: string,
  publisher: string,
  now = new Date(),
): CachedUpcomingWeek | undefined {
  return getCachedUpcomingWeek(db, week, publisher, UPCOMING_MAX_AGE_MS, now)
}

/**
 * Drop every week before `day`, for every publisher.
 *
 * Nothing else ever deletes from these tables, so without this they grow without bound.
 * A week that has arrived is no longer upcoming - the Latest tab owns it from then on.
 */
export function pruneUpcomingBefore(db: Db, day: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM upcoming_issue WHERE week < ?').run(day)
    db.prepare('DELETE FROM upcoming_week WHERE week < ?').run(day)
  })()
}
