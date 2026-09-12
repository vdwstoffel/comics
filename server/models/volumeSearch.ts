import type { Db } from '../types.js'
import type { CvVolumeMatch } from '../lib/comicvine.js'

/** A day, matching the volume issue list. One constant, so the policy changes in one place. */
export const VOLUME_SEARCH_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Row {
  cv_volume_id: number
  name: string | null
  start_year: number | null
  publisher: string | null
  issue_count: number | null
  deck: string | null
  thumb_url: string | null
  site_url: string | null
}

/**
 * The key a series name is stored under. Search headings arrive with whatever spacing and
 * capitalisation the scraped titles carried, and "The Mighty Thor" and "the mighty  thor"
 * are the same question to Comic Vine — they should not be two rows and two requests.
 */
function key(series: string): string {
  return series.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Replace what we hold for a series and stamp when we asked. One transaction, so a
 * half-written list can never be served as though it were the whole answer.
 */
export function cacheVolumeSearch(
  db: Db,
  series: string,
  volumes: CvVolumeMatch[],
  now = new Date().toISOString(),
): void {
  const q = key(series)
  const clear = db.prepare('DELETE FROM cv_volume_match WHERE query = ?')
  const insert = db.prepare(
    `INSERT INTO cv_volume_match
       (query, cv_volume_id, rank, name, start_year, publisher, issue_count, deck, thumb_url, site_url)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
  const stamp = db.prepare(
    'INSERT INTO cv_volume_search (query, fetched_at) VALUES (?,?) ' +
    'ON CONFLICT(query) DO UPDATE SET fetched_at = excluded.fetched_at'
  )

  db.transaction(() => {
    clear.run(q)
    const seen = new Set<number>()
    for (const [i, v] of volumes.entries()) {
      // Comic Vine has been known to repeat a result; the primary key would reject the
      // second one and abort the whole list.
      if (seen.has(v.id)) continue
      seen.add(v.id)
      insert.run(
        q, v.id, i, v.name ?? null, v.startYear ?? null, v.publisher ?? null,
        v.issueCount ?? null, v.deck ?? null, v.thumbnail ?? null, v.siteUrl ?? null,
      )
    }
    stamp.run(q, now)
  })()
}

export interface CachedVolumeSearch {
  volumes: CvVolumeMatch[]
  fetchedAt: string
}

/**
 * What we hold for a series, or nothing when we have never asked or the answer has aged
 * out. Pass `Infinity` as maxAgeMs to read at any age — a stale list beats no list when
 * Comic Vine will not answer.
 */
export function getCachedVolumeSearch(
  db: Db,
  series: string,
  maxAgeMs = VOLUME_SEARCH_CACHE_MAX_AGE_MS,
  now = new Date(),
): CachedVolumeSearch | undefined {
  const q = key(series)
  const stamp = db
    .prepare('SELECT fetched_at FROM cv_volume_search WHERE query = ?')
    .get(q) as { fetched_at: string } | undefined
  if (!stamp) return undefined

  if (Number.isFinite(maxAgeMs)) {
    const age = now.getTime() - new Date(stamp.fetched_at).getTime()
    if (age > maxAgeMs) return undefined
  }

  const rows = db
    .prepare(
      `SELECT cv_volume_id, name, start_year, publisher, issue_count, deck, thumb_url, site_url
       FROM cv_volume_match WHERE query = ? ORDER BY rank`
    )
    .all(q) as Row[]

  return {
    fetchedAt: stamp.fetched_at,
    volumes: rows.map((r) => ({
      id: r.cv_volume_id,
      ...(r.name == null ? {} : { name: r.name }),
      ...(r.start_year == null ? {} : { startYear: r.start_year }),
      ...(r.publisher == null ? {} : { publisher: r.publisher }),
      ...(r.issue_count == null ? {} : { issueCount: r.issue_count }),
      ...(r.deck == null ? {} : { deck: r.deck }),
      ...(r.thumb_url == null ? {} : { thumbnail: r.thumb_url }),
      ...(r.site_url == null ? {} : { siteUrl: r.site_url }),
    })),
  }
}
