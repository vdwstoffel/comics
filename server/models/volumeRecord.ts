import type { Db } from '../types.js'
import type { CvVolume, ComicVineClient } from '../lib/comicvine.js'

/** A day, matching volume_issue and the volume search. One policy, changed in one place. */
export const VOLUME_RECORD_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Row {
  name: string | null
  publisher: string | null
  summary: string | null
  description_html: string | null
  start_year: number | null
  site_url: string | null
}

/** Replace what we hold for a volume and stamp when we asked. */
export function cacheVolumeRecord(
  db: Db,
  volumeId: number,
  volume: CvVolume,
  now = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO cv_volume
       (volume_id, name, publisher, summary, description_html, start_year, site_url, fetched_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(volume_id) DO UPDATE SET
       name = excluded.name, publisher = excluded.publisher, summary = excluded.summary,
       description_html = excluded.description_html, start_year = excluded.start_year,
       site_url = excluded.site_url, fetched_at = excluded.fetched_at`,
  ).run(
    volumeId, volume.name ?? null, volume.publisher ?? null, volume.summary ?? null,
    volume.descriptionHtml ?? null, volume.startYear ?? null, volume.siteUrl ?? null, now,
  )
}

/**
 * What we hold for a volume, or nothing when we have never asked or the answer has aged
 * out. Pass `Infinity` as maxAgeMs to read at any age — a stale record beats none when
 * Comic Vine will not answer.
 *
 * Absent fields are LEFT OUT rather than returned as null, the way `getCachedVolumeIssues`
 * does it. A caller that spreads this into an update would otherwise erase a field Comic
 * Vine merely had nothing to say about — the trap `applyIssueToBook` is built around.
 */
export function getCachedVolumeRecord(
  db: Db,
  volumeId: number,
  maxAgeMs = VOLUME_RECORD_CACHE_MAX_AGE_MS,
  now = new Date(),
): CvVolume | undefined {
  const row = db
    .prepare(
      `SELECT name, publisher, summary, description_html, start_year, site_url, fetched_at
         FROM cv_volume WHERE volume_id = ?`,
    )
    .get(volumeId) as (Row & { fetched_at: string }) | undefined
  if (!row) return undefined

  if (Number.isFinite(maxAgeMs)) {
    const age = now.getTime() - new Date(row.fetched_at).getTime()
    if (age > maxAgeMs) return undefined
  }

  return {
    ...(row.name == null ? {} : { name: row.name }),
    ...(row.publisher == null ? {} : { publisher: row.publisher }),
    ...(row.summary == null ? {} : { summary: row.summary }),
    ...(row.description_html == null ? {} : { descriptionHtml: row.description_html }),
    ...(row.start_year == null ? {} : { startYear: row.start_year }),
    ...(row.site_url == null ? {} : { siteUrl: row.site_url }),
  }
}

/**
 * The volume record, from the cache when it is fresh and from Comic Vine when it is not.
 *
 * Undefined rather than throwing: every caller treats the volume as best-effort context
 * for something else — a publisher to put on an edition, a name to build a file name from
 * — and none of them should lose their own work because this lookup failed. A stale record
 * beats nothing for the same reason.
 */
export async function getVolumeCached(
  db: Db,
  cv: Pick<ComicVineClient, 'getVolume'>,
  volumeId: number | string,
): Promise<CvVolume | undefined> {
  const id = Number(volumeId)
  if (!Number.isFinite(id)) return undefined

  const fresh = getCachedVolumeRecord(db, id)
  if (fresh) return fresh

  try {
    const volume = await cv.getVolume(id)
    cacheVolumeRecord(db, id, volume)
    return volume
  } catch {
    return getCachedVolumeRecord(db, id, Infinity)
  }
}
