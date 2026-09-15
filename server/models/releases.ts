import type { CvReleaseIssue } from '../lib/comicvine.js'
import type { Db } from '../types.js'

/**
 * How long the *current* day's releases are trusted. A Wednesday in the past does not
 * change and is read at Infinity; today is still filling in, and an early-morning visit
 * that caught three issues of an eventual twenty must not hold them forever.
 */
export const TODAY_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** A release issue as stored: Comic Vine's fields plus the publisher we resolved. */
export type ReleaseIssue = CvReleaseIssue & { publisher: string }

export interface CachedRelease {
  issues: ReleaseIssue[]
  fetchedAt: string
}

// SQLite's `CAST(x AS REAL)`: skip leading whitespace, read an optional sign and digits,
// stop at the first character that is not part of a number. Anything with no numeric
// prefix casts to 0. Mirrored here, in JS, rather than in SQL - see sortReleaseIssues.
function numericPrefix(s: string | null | undefined): number {
  if (s == null) return 0
  const m = /^\s*[+-]?\d+(\.\d+)?/.exec(s)
  return m ? Number(m[0]) : 0
}

function compareNullable(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The one true ordering for a day's issues, on every path that produces them: a cache
 * hit, a fresh fetch (cached or not - see the incomplete-publisher-lookup case in
 * routes/releases.ts), and a stale-but-served day. A second, JavaScript-side
 * reimplementation of "how release issues sort" living only in one of those paths is
 * exactly what let a cold response and a cached response disagree; this is the only
 * place that decides.
 *
 * Publisher first (relevant when a caller has not already split by publisher), then
 * volume name, then issue number - numerically where the number reads as one, falling
 * back to a plain string compare to break a tie ("5" before "5AU") or order the
 * unparseable consistently. Duplicate ids are dropped here for the same reason - see
 * the comment in the body.
 */
export function sortReleaseIssues(issues: ReleaseIssue[]): ReleaseIssue[] {
  // Comic Vine has been known to repeat an id across pages, and the duplicate defence
  // used to live only in cacheRelease - so the cached path was quietly deduped by the
  // primary key while a cold response rendered the same id twice, under the same React
  // key. That is the same cold/cached divergence the ordering had. Both are decided here.
  const seen = new Set<number>()
  const unique = issues.filter((i) => {
    if (seen.has(i.id)) return false
    seen.add(i.id)
    return true
  })
  return unique.sort((a, b) => (
    compareNullable(a.publisher, b.publisher)
    || compareNullable(a.volumeName ?? null, b.volumeName ?? null)
    || (numericPrefix(a.number) - numericPrefix(b.number))
    || compareNullable(a.number ?? null, b.number ?? null)
  ))
}

interface Row {
  cv_issue_id: number
  publisher: string
  volume_id: number
  volume_name: string | null
  number: string | null
  name: string | null
  cover_date: string | null
  store_date?: string | null
  cover_url: string | null
  site_url: string | null
  day?: string
}

const SELECT = `SELECT cv_issue_id, publisher, volume_id, volume_name, number, name,
                       cover_date, cover_url, site_url, day
                FROM release_issue`

function toIssue(r: Row): ReleaseIssue {
  return {
    id: r.cv_issue_id,
    publisher: r.publisher,
    volumeId: r.volume_id,
    ...(r.volume_name == null ? {} : { volumeName: r.volume_name }),
    ...(r.number == null ? {} : { number: r.number }),
    ...(r.name == null ? {} : { name: r.name }),
    ...(r.cover_date == null ? {} : { coverDate: r.cover_date }),
    // The day IS the store date - that is what the row was selected by.
    ...(r.day == null ? {} : { storeDate: r.day }),
    ...(r.cover_url == null ? {} : { coverUrl: r.cover_url }),
    ...(r.site_url == null ? {} : { siteUrl: r.site_url }),
  }
}

/** Age arithmetic, in one place: an infinite budget is never exceeded. */
function withinAge(fetchedAt: string, maxAgeMs: number, now: Date): boolean {
  if (!Number.isFinite(maxAgeMs)) return true
  return now.getTime() - new Date(fetchedAt).getTime() <= maxAgeMs
}

/**
 * Replace everything held for a day and stamp when it was read. One transaction, so a
 * half-written day can never be served as if it were complete.
 */
export function cacheRelease(
  db: Db,
  day: string,
  issues: ReleaseIssue[],
  now = new Date().toISOString(),
): void {
  const clear = db.prepare('DELETE FROM release_issue WHERE day = ?')
  const insert = db.prepare(
    `INSERT INTO release_issue
       (day, cv_issue_id, publisher, volume_id, volume_name, number, name,
        cover_date, cover_url, site_url)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  const stamp = db.prepare(
    'INSERT INTO release_day (day, fetched_at) VALUES (?,?) ' +
    'ON CONFLICT(day) DO UPDATE SET fetched_at = excluded.fetched_at',
  )

  db.transaction(() => {
    clear.run(day)
    const seen = new Set<number>()
    for (const issue of issues) {
      // Comic Vine has been known to repeat an id across pages; the primary key would
      // reject the second one and abort the whole day.
      if (seen.has(issue.id)) continue
      seen.add(issue.id)
      insert.run(
        day, issue.id, issue.publisher, issue.volumeId, issue.volumeName ?? null,
        issue.number ?? null, issue.name ?? null, issue.coverDate ?? null,
        issue.coverUrl ?? null, issue.siteUrl ?? null,
      )
    }
    stamp.run(day, now)
  })()
}

/**
 * What we hold for a day, or nothing when we never asked or the answer aged out. An
 * empty `issues` with a `fetchedAt` means we asked and that day had no Marvel or DC
 * releases - which is a normal outcome and must not trigger a refetch.
 */
export function getCachedRelease(
  db: Db,
  day: string,
  maxAgeMs: number,
  now = new Date(),
): CachedRelease | undefined {
  const stamp = db
    .prepare('SELECT fetched_at FROM release_day WHERE day = ?')
    .get(day) as { fetched_at: string } | undefined
  if (!stamp) return undefined

  if (!withinAge(stamp.fetched_at, maxAgeMs, now)) return undefined

  // Ordering lives in sortReleaseIssues, not here - see its comment for why a second,
  // SQL-side implementation of the same ordering is exactly the bug this replaced.
  const rows = db.prepare(`${SELECT} WHERE day = ?`).all(day) as Row[]

  return { fetchedAt: stamp.fetched_at, issues: sortReleaseIssues(rows.map(toIssue)) }
}

/**
 * What we hold for a day, if it can still be trusted - the one place that decides.
 *
 * A snapshot is final only once it was FETCHED after the day it describes had ended.
 * Comic Vine carries no future store_dates (spec §2.4), so a Wednesday only fills in on
 * or after that Wednesday: an evening visit that caught 12 of an eventual 22 issues - or
 * none at all - is the normal case, not the exception. Keying permanence on the day
 * merely being in the past instead froze exactly that partial snapshot the moment UTC
 * midnight passed, and an empty one froze into a permanent fallback to last Wednesday.
 *
 * So: fetched_at's date strictly after `day` means nothing more can arrive and the
 * snapshot is read at any age; fetched_at on `day` or earlier means the day was still
 * filling in when we looked, and it expires after TODAY_MAX_AGE_MS.
 */
export function getFreshRelease(
  db: Db,
  day: string,
  now = new Date(),
): CachedRelease | undefined {
  const held = getCachedRelease(db, day, Infinity, now)
  if (!held) return undefined
  const settled = held.fetchedAt.slice(0, 10) > day
  if (settled) return held
  return withinAge(held.fetchedAt, TODAY_MAX_AGE_MS, now) ? held : undefined
}

/**
 * One issue by its Comic Vine id, whatever day it was released. Read at any age: a
 * download press only ever follows a page view that filled this cache, and a published
 * issue's number and cover date do not change.
 */
export function findReleaseIssue(db: Db, cvIssueId: number): ReleaseIssue | undefined {
  const row = db.prepare(`${SELECT} WHERE cv_issue_id = ? LIMIT 1`).get(cvIssueId) as Row | undefined
  return row ? toIssue(row) : undefined
}
