import type { Db } from '../types.js'

/**
 * The order you put an arc in by hand, or an empty list when you never did.
 *
 * Comic Vine records no reading order for an arc - the issues come back unordered and the
 * run is reconstructed from dates. That is right about the weeks and guesses within them,
 * so a crossover whose publisher printed a checklist needs somewhere to keep the answer.
 */
export function getArcOrder(db: Db, arcId: number): number[] {
  const rows = db
    .prepare('SELECT cv_issue_id FROM arc_order WHERE arc_id = ? ORDER BY position')
    .all(arcId) as Array<{ cv_issue_id: number }>
  return rows.map((r) => r.cv_issue_id)
}

/** Replace the arrangement wholesale. One transaction, so a half-written order is never read. */
export function saveArcOrder(db: Db, arcId: number, issueIds: number[]): void {
  const clear = db.prepare('DELETE FROM arc_order WHERE arc_id = ?')
  const insert = db.prepare('INSERT INTO arc_order (arc_id, cv_issue_id, position) VALUES (?,?,?)')
  db.transaction(() => {
    clear.run(arcId)
    let position = 0
    const seen = new Set<number>()
    for (const id of issueIds) {
      // A repeated id would be rejected by the primary key and abort the whole save.
      if (seen.has(id)) continue
      seen.add(id)
      insert.run(arcId, id, position++)
    }
  })()
}

/** Forget the arrangement, dropping the arc back to the order computed from dates. */
export function clearArcOrder(db: Db, arcId: number): void {
  db.prepare('DELETE FROM arc_order WHERE arc_id = ?').run(arcId)
}
