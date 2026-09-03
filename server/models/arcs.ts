import type { Db } from '../types.js'

export interface StoryArcSummary {
  name: string
  /** How many issues in the library carry this arc. */
  owned: number
}

export function listStoryArcs(db: Db): StoryArcSummary[] {
  return db
    .prepare(`
      SELECT value AS name, COUNT(DISTINCT book_id) AS owned
      FROM book_tag WHERE kind = 'story_arc'
      GROUP BY value ORDER BY owned DESC, value
    `)
    .all() as StoryArcSummary[]
}

export interface ArcTagRow {
  bookId: number
  extId: number | null
  comicvineId: number | null
}

/** Every book carrying this arc — one of them supplies the arc's Comic Vine id. */
export function booksInArc(db: Db, name: string): ArcTagRow[] {
  const rows = db
    .prepare(`
      SELECT t.book_id, t.ext_id, b.comicvine_id
      FROM book_tag t JOIN book b ON b.id = t.book_id
      WHERE t.kind = 'story_arc' AND t.value = ?
      ORDER BY t.book_id
    `)
    .all(name) as Array<{ book_id: number; ext_id: number | null; comicvine_id: number | null }>
  return rows.map((r) => ({ bookId: r.book_id, extId: r.ext_id, comicvineId: r.comicvine_id }))
}

/**
 * Comic Vine issue id -> the book in the library that is that issue. This is what tells an
 * arc's issue list apart into owned and missing, and it is exact: both sides are the same id.
 */
export function ownedIssueIds(db: Db): Map<number, number> {
  const rows = db
    .prepare('SELECT id, comicvine_id FROM book WHERE comicvine_id IS NOT NULL')
    .all() as Array<{ id: number; comicvine_id: number }>
  return new Map(rows.map((r) => [r.comicvine_id, r.id]))
}
