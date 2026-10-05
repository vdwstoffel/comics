import { booksInArc } from '../models/arcs.js'
import { setTagIds } from '../models/metadata.js'
import type { ComicVineClient } from '../lib/comicvine.js'
import type { Db } from '../types.js'

/**
 * The Comic Vine id for an arc the library knows by name, or the refusal to send back.
 *
 * Shared rather than private to the arc routes: reordering an arc, following one, and
 * drawing one all have to find the same id, or an arrangement gets filed under nothing
 * and a follow points at an arc nobody can open.
 */
export async function resolveArcId(
  db: Db, cv: ComicVineClient, name: string,
): Promise<{ id: number } | { code: number; error: string }> {
  const rows = booksInArc(db, name)
  if (rows.length === 0) return { code: 404, error: 'arc not in this library' }

  const stored = rows.find((r) => r.extId != null)?.extId ?? null
  if (stored != null) return { id: stored }

  // No id stored: re-read an issue that carries the tag, the same way a character is
  // backfilled. Two requests the first time this arc is opened, none after that.
  const source = rows.find((r) => r.comicvineId != null)
  if (source) {
    const issue = await cv.getIssue(source.comicvineId!)
    setTagIds(db, source.bookId, 'story_arc', issue.storyArcs)
    const found = issue.storyArcs.find((a) => a.name === name)?.id ?? null
    if (found != null) return { id: found }
  }
  return { code: 404, error: 'arc not found on Comic Vine' }
}
