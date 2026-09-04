import type { Db } from '../types.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'

/** A day. One named constant, so changing the policy is a one-line change. */
export const VOLUME_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Row {
  cv_issue_id: number
  number: string | null
  name: string | null
  cover_date: string | null
  site_url: string | null
}

/**
 * Numeric issue order, with the raw string as the tiebreak. Text order would put #10
 * between #1 and #2, and a lettered or unnumbered issue still needs to land somewhere
 * stable. CAST to REAL is what does the numeric part; SQLite yields 0.0 for text, so the
 * `number IS NULL` key keeps unnumbered issues out of the middle of the run.
 */
const ORDER_BY = `ORDER BY number IS NULL, CAST(number AS REAL), number`

/**
 * Replace everything known about a volume and stamp when it was read. One transaction, so
 * a half-written list can never be served as if it were complete.
 */
export function cacheVolumeIssues(
  db: Db,
  volumeId: number,
  issues: CvVolumeIssue[],
  now = new Date().toISOString(),
): void {
  const clear = db.prepare('DELETE FROM volume_issue WHERE volume_id = ?')
  const insert = db.prepare(
    `INSERT INTO volume_issue (volume_id, cv_issue_id, number, name, cover_date, site_url)
     VALUES (?,?,?,?,?,?)`
  )
  const stamp = db.prepare(
    'INSERT INTO volume_cache (volume_id, fetched_at) VALUES (?,?) ' +
    'ON CONFLICT(volume_id) DO UPDATE SET fetched_at = excluded.fetched_at'
  )

  db.transaction(() => {
    clear.run(volumeId)
    const seen = new Set<number>()
    for (const issue of issues) {
      // Comic Vine has been known to repeat an id across pages; the primary key would
      // reject the second one and abort the whole list.
      if (seen.has(issue.id)) continue
      seen.add(issue.id)
      insert.run(
        volumeId, issue.id, issue.number ?? null, issue.name ?? null,
        issue.coverDate ?? null, issue.siteUrl ?? null,
      )
    }
    stamp.run(volumeId, now)
  })()
}

export interface CachedVolume {
  issues: CvVolumeIssue[]
  fetchedAt: string
}

/**
 * What we hold for a volume, or nothing when we have never asked or the answer has aged
 * out. Pass `Infinity` as maxAgeMs to read at any age — serving a stale list beats serving
 * nothing when Comic Vine will not answer.
 */
export function getCachedVolumeIssues(
  db: Db,
  volumeId: number,
  maxAgeMs = VOLUME_CACHE_MAX_AGE_MS,
  now = new Date(),
): CachedVolume | undefined {
  const stamp = db
    .prepare('SELECT fetched_at FROM volume_cache WHERE volume_id = ?')
    .get(volumeId) as { fetched_at: string } | undefined
  if (!stamp) return undefined

  if (Number.isFinite(maxAgeMs)) {
    const age = now.getTime() - new Date(stamp.fetched_at).getTime()
    if (age > maxAgeMs) return undefined
  }

  const rows = db
    .prepare(`SELECT cv_issue_id, number, name, cover_date, site_url
              FROM volume_issue WHERE volume_id = ? ${ORDER_BY}`)
    .all(volumeId) as Row[]

  return {
    fetchedAt: stamp.fetched_at,
    issues: rows.map((r) => ({
      id: r.cv_issue_id,
      ...(r.number == null ? {} : { number: r.number }),
      ...(r.name == null ? {} : { name: r.name }),
      ...(r.cover_date == null ? {} : { coverDate: r.cover_date }),
      ...(r.site_url == null ? {} : { siteUrl: r.site_url }),
    })),
  }
}
