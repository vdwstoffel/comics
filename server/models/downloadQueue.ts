import type { Db } from '../types.js'

export type QueueState = 'queued' | 'running' | 'done' | 'failed'

/** How many finished rows are kept. A number, not a policy - see the spec's §9. */
export const HISTORY_LIMIT = 50

const LIVE = `('queued', 'running')`

export interface QueueEntry {
  id: number
  position: number
  state: QueueState
  url: string
  edition?: string
  cvIssueId?: number
  label?: string
  attempts: number
  fileName?: string
  bookId?: number
  error?: string
  queuedAt: string
  startedAt?: string
  finishedAt?: string
}

export interface EnqueueRequest {
  url: string
  edition?: string
  cvIssueId?: number
  label?: string
}

interface Row {
  id: number; position: number; state: QueueState; url: string
  edition: string | null; cv_issue_id: number | null; label: string | null
  attempts: number; file_name: string | null; book_id: number | null; error: string | null
  queued_at: string; started_at: string | null; finished_at: string | null
}

const COLS = `id, position, state, url, edition, cv_issue_id, label, attempts,
              file_name, book_id, error, queued_at, started_at, finished_at`

function toEntry(r: Row): QueueEntry {
  return {
    id: r.id, position: r.position, state: r.state, url: r.url, attempts: r.attempts,
    queuedAt: r.queued_at,
    ...(r.edition == null ? {} : { edition: r.edition }),
    ...(r.cv_issue_id == null ? {} : { cvIssueId: r.cv_issue_id }),
    ...(r.label == null ? {} : { label: r.label }),
    ...(r.file_name == null ? {} : { fileName: r.file_name }),
    ...(r.book_id == null ? {} : { bookId: r.book_id }),
    ...(r.error == null ? {} : { error: r.error }),
    ...(r.started_at == null ? {} : { startedAt: r.started_at }),
    ...(r.finished_at == null ? {} : { finishedAt: r.finished_at }),
  }
}

export function findLiveByIssue(db: Db, cvIssueId: number): QueueEntry | undefined {
  const row = db
    .prepare(`SELECT ${COLS} FROM download_queue WHERE cv_issue_id = ? AND state IN ${LIVE} LIMIT 1`)
    .get(cvIssueId) as Row | undefined
  return row ? toEntry(row) : undefined
}

/**
 * Add a download. A live duplicate is rejected by the partial unique index rather than by
 * a check here: two presses in the same tick both reach the insert, and only one can win.
 */
export function enqueue(
  db: Db,
  req: EnqueueRequest,
  now = new Date().toISOString(),
): { queued: true; entry: QueueEntry } | { queued: false; duplicate: QueueEntry } {
  const next = (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM download_queue WHERE state IN ${LIVE}`)
    .get() as { p: number }).p
  try {
    const info = db
      .prepare(`INSERT INTO download_queue (position, state, url, edition, cv_issue_id, label, queued_at)
                VALUES (?, 'queued', ?, ?, ?, ?, ?)`)
      .run(next, req.url, req.edition ?? null, req.cvIssueId ?? null, req.label ?? null, now)
    const row = db.prepare(`SELECT ${COLS} FROM download_queue WHERE id = ?`).get(info.lastInsertRowid) as Row
    return { queued: true, entry: toEntry(row) }
  } catch (err) {
    const existing = req.cvIssueId == null ? undefined : findLiveByIssue(db, req.cvIssueId)
    // Only a duplicate is expected here; anything else is a real fault and must not be
    // reported as "already queued".
    if (!existing) throw err
    return { queued: false, duplicate: existing }
  }
}

/**
 * The next eligible row, marked running in the same statement that selects it. That
 * atomicity is the whole mechanism that lets more than one worker share this queue.
 */
export function takeNext(db: Db, now = new Date().toISOString()): QueueEntry | undefined {
  const row = db
    .prepare(`UPDATE download_queue SET state = 'running', started_at = ?, not_before = NULL
              WHERE id = (
                SELECT id FROM download_queue
                WHERE state = 'queued' AND (not_before IS NULL OR not_before <= ?)
                ORDER BY position LIMIT 1
              )
              RETURNING ${COLS}`)
    .get(now, now) as Row | undefined
  return row ? toEntry(row) : undefined
}

export function finish(
  db: Db,
  id: number,
  r: { bookId?: number; fileName?: string; error?: string },
  now = new Date().toISOString(),
): void {
  db.prepare(`UPDATE download_queue
              SET state = 'done', book_id = ?, file_name = COALESCE(?, file_name),
                  error = ?, finished_at = ?
              WHERE id = ?`)
    .run(r.bookId ?? null, r.fileName ?? null, r.error ?? null, now, id)
  pruneHistory(db)
}

/**
 * With `retryAt`, back to the end of the queue and not eligible until then. Without it,
 * final. A cancel is a fail with no retryAt - stopping something is not a reason to
 * start it again.
 */
export function fail(
  db: Db,
  id: number,
  error: string,
  opts?: { retryAt: string },
  now = new Date().toISOString(),
): void {
  if (opts?.retryAt) {
    const next = (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM download_queue WHERE state IN ${LIVE}`)
      .get() as { p: number }).p
    db.prepare(`UPDATE download_queue
                SET state = 'queued', attempts = attempts + 1, error = ?,
                    not_before = ?, position = ?, started_at = NULL
                WHERE id = ?`)
      .run(error, opts.retryAt, next, id)
    return
  }
  db.prepare(`UPDATE download_queue
              SET state = 'failed', attempts = attempts + 1, error = ?, finished_at = ?
              WHERE id = ?`)
    .run(error, now, id)
  pruneHistory(db)
}

export function listQueue(db: Db): QueueEntry[] {
  return (db.prepare(`SELECT ${COLS} FROM download_queue WHERE state IN ${LIVE} ORDER BY position`)
    .all() as Row[]).map(toEntry)
}

export function listHistory(db: Db, limit = HISTORY_LIMIT): QueueEntry[] {
  return (db.prepare(`SELECT ${COLS} FROM download_queue
                      WHERE state IN ('done', 'failed')
                      ORDER BY finished_at DESC, id DESC LIMIT ?`)
    .all(limit) as Row[]).map(toEntry)
}

/** Move a queued row to a 0-based index in the live list, renumbering in one transaction. */
export function move(db: Db, id: number, toIndex: number): boolean {
  const live = listQueue(db)
  const from = live.findIndex((e) => e.id === id)
  // A running row is already downloading; there is nowhere useful to move it to.
  if (from === -1 || live[from].state === 'running') return false
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= live.length) return false

  const order = live.map((e) => e.id)
  order.splice(from, 1)
  order.splice(toIndex, 0, id)
  const set = db.prepare('UPDATE download_queue SET position = ? WHERE id = ?')
  db.transaction(() => { order.forEach((rowId, n) => set.run(n, rowId)) })()
  return true
}

export function remove(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM download_queue WHERE id = ?').run(id).changes > 0
}

/**
 * Delete a row only while it is still live - queued or running. A cancel aimed at
 * something already finished must be refused, not quietly erase it from history.
 */
export function removeIfLive(db: Db, id: number): boolean {
  return db.prepare(`DELETE FROM download_queue WHERE id = ? AND state IN ${LIVE}`).run(id).changes > 0
}

/** A failed row back to the end of the queue, its attempts forgiven. */
export function retry(db: Db, id: number): boolean {
  const next = (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM download_queue WHERE state IN ${LIVE}`)
    .get() as { p: number }).p
  return db.prepare(`UPDATE download_queue
                     SET state = 'queued', attempts = 0, error = NULL, not_before = NULL,
                         position = ?, started_at = NULL, finished_at = NULL
                     WHERE id = ? AND state = 'failed'`)
    .run(next, id).changes > 0
}

export function clearHistory(db: Db): void {
  db.prepare(`DELETE FROM download_queue WHERE state IN ('done', 'failed')`).run()
}

/**
 * A row still marked running when the process starts is a casualty of the restart, not a
 * failure of the download: it goes back to the FRONT and spends no attempt. Its staging
 * file is already gone - index.ts sweeps tmpDir before the runner is built.
 */
export function recoverRunning(db: Db): number {
  const min = (db.prepare(`SELECT COALESCE(MIN(position), 0) AS p FROM download_queue WHERE state IN ${LIVE}`)
    .get() as { p: number }).p
  // Ordered by position so they go back in the order they were taken, and each gets its
  // own slot: at concurrency above 1 there can be several, and two rows sharing a position
  // leaves listQueue with no tiebreak.
  const running = db.prepare(`SELECT id FROM download_queue WHERE state = 'running' ORDER BY position, id`)
    .all() as Array<{ id: number }>
  if (running.length === 0) return 0

  const set = db.prepare(`UPDATE download_queue SET state = 'queued', started_at = NULL, position = ?
                          WHERE id = ?`)
  db.transaction(() => {
    running.forEach((row, n) => set.run(min - running.length + n, row.id))
  })()
  return running.length
}

export function pruneHistory(db: Db, keep = HISTORY_LIMIT): void {
  db.prepare(`DELETE FROM download_queue WHERE id IN (
                SELECT id FROM download_queue WHERE state IN ('done', 'failed')
                ORDER BY finished_at DESC, id DESC LIMIT -1 OFFSET ?
              )`).run(keep)
}
