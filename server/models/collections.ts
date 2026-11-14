import type { Db } from '../types.js'

/** Comics that arrived together, waiting for review. */
export interface Collection {
  id: number
  label: string
  /** The folder under stagingDir holding what is left. A name, never a path. */
  dir: string
  /** How many comics were left at the last count. */
  fileCount: number
  /** How many downloads were queued into it. One for a single zip. */
  parts: number
  /** Of those, how many are still queued or downloading. Ready for review at zero. */
  waiting: number
  /** Parts that failed for good. A cancel is not counted: you stopped it yourself. */
  failed: number
  /** Parts a bot check stopped, waiting on you in Needs you. */
  blocked: number
  createdAt: string
}

interface Row {
  id: number; label: string; dir: string; file_count: number; parts: number
  waiting: number; failed: number; blocked: number; created_at: string
}

// Counted off the queue rather than stored: a part changes state in the runner, and a
// second copy of that state here would be a second thing to keep in step with it.
const COLS = `c.id, c.label, c.dir, c.file_count, c.parts, c.created_at,
  (SELECT COUNT(*) FROM download_queue q WHERE q.collection_id = c.id AND q.state IN ('queued', 'running')) AS waiting,
  (SELECT COUNT(*) FROM download_queue q WHERE q.collection_id = c.id AND q.state = 'failed'
     AND COALESCE(q.error, '') != 'cancelled') AS failed,
  (SELECT COUNT(*) FROM download_queue q WHERE q.collection_id = c.id AND q.state = 'blocked') AS blocked`

function toCollection(r: Row): Collection {
  return {
    id: r.id, label: r.label, dir: r.dir, fileCount: r.file_count, parts: r.parts,
    waiting: r.waiting, failed: r.failed, blocked: r.blocked, createdAt: r.created_at,
  }
}

export function createCollection(
  db: Db,
  c: { label: string; dir: string; fileCount: number; parts?: number },
  now = new Date().toISOString(),
): Collection {
  const info = db.prepare('INSERT INTO collection (label, dir, file_count, parts, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(c.label, c.dir, c.fileCount, c.parts ?? 1, now)
  return getCollection(db, Number(info.lastInsertRowid))!
}

export function getCollection(db: Db, id: number): Collection | undefined {
  const row = db.prepare(`SELECT ${COLS} FROM collection c WHERE c.id = ?`).get(id) as Row | undefined
  return row ? toCollection(row) : undefined
}

/** Oldest first - the order they landed in, as the blocked list is. */
export function listCollections(db: Db): Collection[] {
  return (db.prepare(`SELECT ${COLS} FROM collection c ORDER BY c.created_at, c.id`).all() as Row[]).map(toCollection)
}

export function setCollectionCount(db: Db, id: number, fileCount: number): void {
  db.prepare('UPDATE collection SET file_count = ? WHERE id = ?').run(fileCount, id)
}

/** The queue rows still coming into a collection - what a discard has to stop first. */
export function waitingParts(db: Db, id: number): number[] {
  return (db.prepare(`SELECT id FROM download_queue WHERE collection_id = ? AND state IN ('queued', 'running')`)
    .all(id) as Array<{ id: number }>).map((r) => r.id)
}

export function removeCollection(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM collection WHERE id = ?').run(id).changes > 0
}
