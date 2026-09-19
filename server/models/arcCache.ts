import type { Db } from '../types.js'
import type { CvStoryArc, CvArcIssue } from '../lib/comicvine.js'

/** A day, the same policy volume_issue uses. One named constant, so changing it is one line. */
export const ARC_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface IssueRow {
  cv_issue_id: number
  number: string | null
  name: string | null
  volume_name: string | null
  cover_date: string | null
  store_date: string | null
  site_url: string | null
}

interface ArcRow {
  name: string | null
  deck: string | null
  publisher: string | null
  image_url: string | null
  site_url: string | null
  fetched_at: string
}

/**
 * Replace everything known about an arc and stamp when it was read. One transaction, so a
 * half-written run can never be served as if it were complete.
 *
 * The issues are stored in the order given, which is the running order getStoryArc sorted
 * them into. Rewriting the whole list rather than merging is what keeps a running arc
 * honest: when a new issue lands in the MIDDLE of the run, every position after it shifts.
 */
export function cacheArc(
  db: Db,
  arcId: number,
  arc: CvStoryArc,
  now = new Date().toISOString(),
): void {
  const clear = db.prepare('DELETE FROM arc_issue WHERE arc_id = ?')
  const insert = db.prepare(
    `INSERT INTO arc_issue
       (arc_id, cv_issue_id, position, number, name, volume_name, cover_date, store_date, site_url)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
  const stamp = db.prepare(
    `INSERT INTO arc_cache (arc_id, name, deck, publisher, image_url, site_url, fetched_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(arc_id) DO UPDATE SET
       name = excluded.name, deck = excluded.deck, publisher = excluded.publisher,
       image_url = excluded.image_url, site_url = excluded.site_url,
       fetched_at = excluded.fetched_at`
  )

  db.transaction(() => {
    clear.run(arcId)
    const seen = new Set<number>()
    let position = 0
    for (const issue of arc.issues) {
      // Comic Vine has been known to repeat an id across pages; the primary key would
      // reject the second one and abort the whole run.
      if (seen.has(issue.id)) continue
      seen.add(issue.id)
      insert.run(
        arcId, issue.id, position++, issue.number ?? null, issue.name ?? null,
        issue.volumeName ?? null, issue.coverDate ?? null, issue.storeDate ?? null,
        issue.siteUrl ?? null,
      )
    }
    stamp.run(
      arcId, arc.name ?? null, arc.deck ?? null, arc.publisher ?? null,
      arc.imageUrl ?? null, arc.siteUrl ?? null, now,
    )
  })()
}

export interface CachedArc {
  arc: CvStoryArc
  fetchedAt: string
}

/**
 * What we hold for an arc, or nothing when we have never asked or the answer has aged out.
 * Pass `Infinity` as maxAgeMs to read at any age - serving a stale run beats serving
 * nothing when Comic Vine will not answer.
 */
export function getCachedArc(
  db: Db,
  arcId: number,
  maxAgeMs = ARC_CACHE_MAX_AGE_MS,
  now = new Date(),
): CachedArc | undefined {
  const row = db
    .prepare(`SELECT name, deck, publisher, image_url, site_url, fetched_at
              FROM arc_cache WHERE arc_id = ?`)
    .get(arcId) as ArcRow | undefined
  if (!row) return undefined

  if (Number.isFinite(maxAgeMs)) {
    const age = now.getTime() - new Date(row.fetched_at).getTime()
    if (age > maxAgeMs) return undefined
  }

  const rows = db
    .prepare(`SELECT cv_issue_id, number, name, volume_name, cover_date, store_date, site_url
              FROM arc_issue WHERE arc_id = ? ORDER BY position`)
    .all(arcId) as IssueRow[]

  const issues: CvArcIssue[] = rows.map((r) => ({
    id: r.cv_issue_id,
    ...(r.name == null ? {} : { name: r.name }),
    ...(r.site_url == null ? {} : { siteUrl: r.site_url }),
    ...(r.number == null ? {} : { number: r.number }),
    ...(r.volume_name == null ? {} : { volumeName: r.volume_name }),
    ...(r.cover_date == null ? {} : { coverDate: r.cover_date }),
    ...(r.store_date == null ? {} : { storeDate: r.store_date }),
  }))

  return {
    fetchedAt: row.fetched_at,
    arc: {
      id: arcId,
      ...(row.name == null ? {} : { name: row.name }),
      ...(row.deck == null ? {} : { deck: row.deck }),
      ...(row.publisher == null ? {} : { publisher: row.publisher }),
      ...(row.image_url == null ? {} : { imageUrl: row.image_url }),
      ...(row.site_url == null ? {} : { siteUrl: row.site_url }),
      issues,
    },
  }
}
