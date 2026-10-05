import type { Db, Book, Progress } from '../types.js'

export type ReadState = 'unread' | 'reading' | 'read'

/**
 * What the shelf can be filtered by, which is not the same list. 'reading' describes a
 * single book - it is what paints a tile's progress bar - but it is not a shelf of its
 * own: a comic you are partway through is still a comic you have to read, so it stays
 * under Unread until it is finished.
 */
export type FilterState = 'unread' | 'read'

export interface BookWithProgress extends Book {
  readState: ReadState
  percent: number
}

interface ProgressRow {
  book_id: number
  last_page: number
  completed: number
  updated_at: string
}

/**
 * The comicvine ids of every finished book, in one query rather than one per owned book:
 * the arc path runs inside the progress write and on every rail render, and a per-book
 * lookup recompiled its SQL for each of them. Built from every completed row, so two
 * copies of one issue agree with the volume path: a Map keyed by comicvine_id kept only
 * the last copy, and when just the other one was finished the arc read it as unfinished.
 */
export function finishedIssueIds(db: Db): Set<number> {
  const rows = db.prepare(
    `SELECT b.comicvine_id AS id FROM book b JOIN read_progress p ON p.book_id = b.id
     WHERE p.completed = 1 AND b.comicvine_id IS NOT NULL`).all() as Array<{ id: number }>
  return new Set(rows.map((r) => r.id))
}

export function getProgress(db: Db, bookId: number): Progress {
  const row = db.prepare('SELECT * FROM read_progress WHERE book_id = ?').get(bookId) as ProgressRow | undefined
  if (!row) return { bookId, lastPage: 0, completed: false, updatedAt: null }
  return { bookId: row.book_id, lastPage: row.last_page, completed: !!row.completed, updatedAt: row.updated_at }
}

export function setProgress(
  db: Db,
  bookId: number,
  { lastPage, completed = false }: { lastPage: number; completed?: boolean },
): Progress {
  db.prepare(`
    INSERT INTO read_progress (book_id, last_page, completed, updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(book_id) DO UPDATE SET last_page = excluded.last_page,
      completed = excluded.completed, updated_at = excluded.updated_at
  `).run(bookId, lastPage, completed ? 1 : 0, new Date().toISOString())
  return getProgress(db, bookId)
}

export function deriveReadState(db: Db, book: Book): BookWithProgress {
  const progress = getProgress(db, book.id)
  let readState: ReadState
  let percent: number
  if (progress.completed) {
    readState = 'read'
    percent = 100
  } else if (progress.lastPage > 0) {
    readState = 'reading'
    const divisor = Math.max(book.pageCount - 1, 1)
    percent = Math.min(Math.max(Math.round(progress.lastPage / divisor * 100), 1), 99)
  } else {
    readState = 'unread'
    percent = 0
  }
  return { ...book, readState, percent }
}
