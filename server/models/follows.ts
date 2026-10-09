import type { Db } from '../types.js'

export type FollowKind = 'volume' | 'arc'

export interface Follow {
  kind: FollowKind
  /** edition.id for a volume; Comic Vine's arc id for an arc. See db.ts. */
  refId: number
  name: string
  createdAt: string
}

interface Row { kind: string; ref_id: number; name: string; created_at: string }

const toFollow = (r: Row): Follow => ({
  kind: r.kind as FollowKind, refId: r.ref_id, name: r.name, createdAt: r.created_at,
})

/**
 * Follow something, or restate the name of something already followed.
 *
 * `created_at` is deliberately left alone on conflict: pressing Follow on a run you
 * already follow is a no-op you cannot tell apart from a double-click, and it has no
 * business resetting the day you started.
 */
export function addFollow(
  db: Db, kind: FollowKind, refId: number, name: string, now = new Date().toISOString(),
): Follow {
  db.prepare(
    `INSERT INTO follow (kind, ref_id, name, created_at) VALUES (?,?,?,?)
     ON CONFLICT(kind, ref_id) DO UPDATE SET name = excluded.name`,
  ).run(kind, refId, name, now)
  return getFollow(db, kind, refId)!
}

export function getFollow(db: Db, kind: FollowKind, refId: number): Follow | undefined {
  const row = db
    .prepare('SELECT * FROM follow WHERE kind = ? AND ref_id = ?')
    .get(kind, refId) as Row | undefined
  return row ? toFollow(row) : undefined
}

/**
 * Alphabetical, because the shelf is a list you scan by name rather than by age - though
 * the Following page now spends this as a tiebreaker inside each of its bands rather than
 * as the whole order. What you can read now, what is out but unposted, and when the next
 * issue lands are browser-side facts no query here can see; see src/lib/followOrder.
 */
export function listFollows(db: Db): Follow[] {
  return (db.prepare('SELECT * FROM follow ORDER BY name COLLATE NOCASE').all() as Row[]).map(toFollow)
}

export function removeFollow(db: Db, kind: FollowKind, refId: number): boolean {
  return db.prepare('DELETE FROM follow WHERE kind = ? AND ref_id = ?').run(kind, refId).changes > 0
}

/**
 * Drop the follow that pointed at a deleted edition. The `kind` is not optional
 * decoration: arc 42 and edition 42 are different rows, and matching on `ref_id` alone
 * would unfollow a story arc because a volume happened to share its number.
 */
export function removeFollowsForEdition(db: Db, editionId: number): void {
  db.prepare("DELETE FROM follow WHERE kind = 'volume' AND ref_id = ?").run(editionId)
}
