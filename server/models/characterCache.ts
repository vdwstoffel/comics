import type { Db } from '../types.js'
import type { CvCharacter } from '../lib/comicvine.js'

/**
 * A week. A character's page is read like an encyclopedia entry - opened again from every
 * comic they are in - while what Comic Vine says about them changes over months, not days.
 */
export const CHARACTER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * What Comic Vine last said about a character, and when.
 *
 * Kept whole, as the client parsed it, rather than as columns: the page shows every field,
 * the profile is a list of blocks, and nothing ever queries inside it.
 */
export function getCachedCharacter(db: Db, cvId: number): { character: CvCharacter; fetchedAt: string } | undefined {
  const row = db.prepare('SELECT data, fetched_at FROM character_cache WHERE cv_id = ?').get(cvId) as
    { data: string; fetched_at: string } | undefined
  if (!row) return undefined
  try {
    return { character: JSON.parse(row.data) as CvCharacter, fetchedAt: row.fetched_at }
  } catch {
    // A row that will not parse is as good as no row: the next read replaces it.
    return undefined
  }
}

export function cacheCharacter(db: Db, cvId: number, character: CvCharacter, now = new Date().toISOString()): void {
  db.prepare(`INSERT INTO character_cache (cv_id, data, fetched_at) VALUES (?, ?, ?)
              ON CONFLICT(cv_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`)
    .run(cvId, JSON.stringify(character), now)
}
