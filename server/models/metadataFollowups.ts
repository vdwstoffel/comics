import { basename } from 'node:path'
import type { Db } from '../types.js'

/**
 * A comic whose metadata is incomplete, and the context that explains why it might be.
 *
 * Derived from the books themselves, NOT from a record of how each comic was matched.
 * That distinction is the whole point: the case this list exists for is "Comic Vine's
 * search was down, I pasted the issue id, and the record was still empty" - but the same
 * hole appears when an issue is matched from search the day it is solicited, or when a
 * file is scanned in with a thin ComicInfo.xml. Membership asks what the comic lacks
 * today; nothing about how it got here changes the answer.
 */
export interface MetadataFollowup {
  bookId: number
  title: string | null
  fileName: string
  /** The book's CURRENT Comic Vine id. Null means there is nothing to re-read. */
  bookCvId: number | null
  cvSiteUrl: string | null
  addedAt: string
  /** What the BOOK is missing: the membership test, named so the row can show it. */
  missing: string[]
  /** True when cv_manual_entry has a row: the id was typed. Context only, never membership. */
  manual: boolean
  /** The id that was typed, when one was. It can differ from bookCvId after a correction. */
  typedIssueId: number | null
  /** When Comic Vine was last read for a hand-typed entry; null for "never". */
  checkedAt: string | null
  /** What the Comic Vine RESPONSE lacked at that read - not what the book lacks. */
  cvMissing: string[]
}

interface Row {
  id: number
  title: string | null
  file_path: string
  comicvine_id: number | null
  cv_site_url: string | null
  added_at: string
  date: string | null
  summary: string | null
  has_credits: number
  cv_issue_id: number | null
  checked_at: string | null
  cv_missing: string | null
}

/** A value that is there but empty is as missing as one that is null. */
const blank = (v: string | null): boolean => v === null || v.trim() === ''

/**
 * What this comic is missing - and, because an empty answer means it does not belong on
 * the list, also the membership test itself. One function so the two can never disagree.
 *
 * A blank TITLE is deliberately not counted. 78 of the 208 comics in the real library
 * have none, and nearly all of them are filed correctly: most Comic Vine issues have no
 * name beyond their number, so a blank title says nothing about whether the comic was
 * matched. Counting it would park a third of the library on this list permanently, and a
 * list that is always long is a list nobody reads.
 *
 * A cover date, a summary and a credit are different. A filled-in Comic Vine issue
 * carries all three, so a comic without one was either never matched or matched against a
 * record that had not been written yet - which is exactly the "check back on this later"
 * the user asked for. Measured against the same library: 3 comics have no date, 10 no
 * summary, 12 no credits, which is a list short enough to work through.
 */
export function missingMetadata(b: {
  date: string | null
  summary: string | null
  hasCredits: boolean
}): string[] {
  const missing: string[] = []
  if (blank(b.date)) missing.push('date')
  if (blank(b.summary)) missing.push('summary')
  if (!b.hasCredits) missing.push('credits')
  return missing
}

/**
 * Never throws: this feeds the Settings page, and a corrupted value must read as
 * "nothing recorded" rather than take the page down with it.
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
 * Every comic with a hole in its metadata that you have not dismissed, newest first.
 *
 * Dismissals are filtered in SQL because that is a question the database can answer
 * exactly; incompleteness is decided in TypeScript by missingMetadata, so the rule the
 * rows display is literally the rule that selected them. The cost is reading one row per
 * undismissed book - 208 of them in the real library, and a few thousand in any library
 * this app would ever hold, which is far cheaper than two copies of the criterion
 * drifting apart.
 */
export function listMetadataFollowups(db: Db): MetadataFollowup[] {
  const rows = db.prepare(
    `SELECT b.id, b.title, b.file_path, b.comicvine_id, b.cv_site_url, b.added_at,
            b.date, b.summary,
            EXISTS (SELECT 1 FROM book_credit c WHERE c.book_id = b.id) AS has_credits,
            m.cv_issue_id, m.checked_at, m.cv_missing
       FROM book b
       LEFT JOIN cv_manual_entry m ON m.book_id = b.id
      WHERE NOT EXISTS (SELECT 1 FROM metadata_followup_dismissed d WHERE d.book_id = b.id)
      ORDER BY b.added_at DESC, b.id DESC`,
  ).all() as Row[]

  return rows
    .map((r) => ({
      bookId: r.id,
      title: r.title,
      fileName: basename(r.file_path),
      bookCvId: r.comicvine_id,
      cvSiteUrl: r.cv_site_url,
      addedAt: r.added_at,
      missing: missingMetadata({
        date: r.date,
        summary: r.summary,
        hasCredits: r.has_credits === 1,
      }),
      manual: r.cv_issue_id !== null,
      typedIssueId: r.cv_issue_id,
      checkedAt: r.checked_at,
      cvMissing: parseMissing(r.cv_missing),
    }))
    .filter((f) => f.missing.length > 0)
}

/**
 * Stop reminding me about this comic. Touches nothing but this table: the book keeps its
 * Comic Vine id, its metadata and its file, and a hand-typed entry keeps its provenance
 * row - this is a sticky note coming down, not an edit to the comic.
 */
export function dismissFollowup(db: Db, bookId: number): void {
  // A dismissal for a comic that no longer exists is nothing worth keeping, and the
  // foreign key would reject the row anyway. Two tabs showing the same list is enough to
  // produce the race, so it is a no-op rather than an error.
  if (!db.prepare('SELECT 1 FROM book WHERE id = ?').get(bookId)) return
  db.prepare(
    `INSERT INTO metadata_followup_dismissed (book_id, dismissed_at) VALUES (?, ?)
     ON CONFLICT(book_id) DO NOTHING`,
  ).run(bookId, new Date().toISOString())
}

/**
 * Put a dismissed comic back on the list.
 *
 * Called when an id is typed for it by hand, which is the user saying "this one is bound
 * to a record I expect to fill in later" - the exact thing the list is for. Nothing
 * automatic calls this: a dismissal that an overnight refresh could undo would be a
 * reminder the user cannot switch off.
 */
export function restoreFollowup(db: Db, bookId: number): void {
  db.prepare('DELETE FROM metadata_followup_dismissed WHERE book_id = ?').run(bookId)
}
