import { basename } from 'node:path'
import type { Db } from '../types.js'

/**
 * A comic the user bound to a Comic Vine issue by typing its id, and what Comic Vine
 * was still missing the last time it was read. A sticky note: nothing about the comic's
 * behaviour depends on whether it has one.
 */
export interface ManualEntry {
  bookId: number
  title: string | null
  fileName: string
  cvIssueId: number
  bookCvId: number | null
  cvSiteUrl: string | null
  createdAt: string
  /** Null means Comic Vine has never been successfully read for this entry, which is not
   *  the same as "read, and had everything" - the list renders the two differently. */
  checkedAt: string | null
  /** Fields the Comic Vine response did not supply at the last read - not fields the book
   *  lacks, which would read "complete" for a comic that arrived with its own ComicInfo. */
  missing: string[]
}

interface Row {
  book_id: number
  title: string | null
  file_path: string
  cv_issue_id: number
  comicvine_id: number | null
  cv_site_url: string | null
  created_at: string
  checked_at: string | null
  cv_missing: string | null
}

/**
 * Never throws: this feeds the Settings page, and a row from before the column existed
 * or a corrupted value must read as "nothing recorded" rather than break the page.
 */
function parseMissing(raw: string | null): string[] {
  if (raw == null) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : []
  } catch {
    return []
  }
}

/**
 * Re-entering an id for the same comic is a correction, not a new reminder, so the
 * original created_at stays.
 *
 * The earlier check is cleared ONLY when the id actually changed: a check describes
 * whichever record was bound when it ran, so a corrected id invalidates it. Re-typing the
 * SAME id does not - and that happens, because typing an id during an outage goes through
 * here with no response to record afterwards. Clearing then would throw away a real read
 * and leave the row claiming "Not yet read from Comic Vine" about a record that was read.
 */
export function upsertManualEntry(db: Db, bookId: number, cvIssueId: number): void {
  db.prepare(
    `INSERT INTO cv_manual_entry (book_id, cv_issue_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET
       cv_issue_id = excluded.cv_issue_id,
       checked_at = CASE WHEN excluded.cv_issue_id <> cv_manual_entry.cv_issue_id
                         THEN NULL ELSE cv_manual_entry.checked_at END,
       cv_missing = CASE WHEN excluded.cv_issue_id <> cv_manual_entry.cv_issue_id
                         THEN NULL ELSE cv_manual_entry.cv_missing END`,
  ).run(bookId, cvIssueId, new Date().toISOString())
}

/** A no-op for a book with no entry: it is called on every apply, manual or not. */
export function recordManualCheck(db: Db, bookId: number, missing: string[]): void {
  db.prepare('UPDATE cv_manual_entry SET checked_at = ?, cv_missing = ? WHERE book_id = ?')
    .run(new Date().toISOString(), JSON.stringify(missing), bookId)
}

/** Newest entry first; the book join supplies what the list shows to identify the comic. */
export function listManualEntries(db: Db): ManualEntry[] {
  const rows = db.prepare(
    `SELECT m.book_id, b.title, b.file_path, m.cv_issue_id, b.comicvine_id, b.cv_site_url,
            m.created_at, m.checked_at, m.cv_missing
       FROM cv_manual_entry m JOIN book b ON b.id = m.book_id
      ORDER BY m.created_at DESC, m.book_id DESC`,
  ).all() as Row[]
  return rows.map((r) => ({
    bookId: r.book_id,
    title: r.title,
    fileName: basename(r.file_path),
    cvIssueId: r.cv_issue_id,
    bookCvId: r.comicvine_id,
    cvSiteUrl: r.cv_site_url,
    createdAt: r.created_at,
    checkedAt: r.checked_at,
    missing: parseMissing(r.cv_missing),
  }))
}

/** Drops the reminder only; the book keeps its comicvine_id. */
export function deleteManualEntry(db: Db, bookId: number): void {
  db.prepare('DELETE FROM cv_manual_entry WHERE book_id = ?').run(bookId)
}
