import type { Db } from '../types.js'

export interface BookCredit {
  name: string
  role: string
}

export interface BookTag {
  kind: string
  value: string
  /** Comic Vine id, for character tags matched from an issue's credits. */
  extId?: number
}

// Must be called within a transaction for atomicity.
export function replaceBookCredits(db: Db, bookId: number, credits: BookCredit[]): void {
  db.prepare('DELETE FROM book_credit WHERE book_id = ?').run(bookId)
  const insert = db.prepare('INSERT INTO book_credit (book_id, name, role) VALUES (?, ?, ?)')
  for (const { name, role } of credits) {
    insert.run(bookId, name, role)
  }
}

export function getBookCredits(db: Db, bookId: number): BookCredit[] {
  return db.prepare('SELECT name, role FROM book_credit WHERE book_id = ? ORDER BY id').all(bookId) as BookCredit[]
}

// Must be called within a transaction for atomicity.
export function replaceBookTags(db: Db, bookId: number, tags: BookTag[]): void {
  db.prepare('DELETE FROM book_tag WHERE book_id = ?').run(bookId)
  const insert = db.prepare('INSERT INTO book_tag (book_id, kind, value, ext_id) VALUES (?, ?, ?, ?)')
  for (const { kind, value, extId } of tags) {
    insert.run(bookId, kind, value, extId ?? null)
  }
}

/**
 * Fill in Comic Vine ids on tags of one kind that were saved without them — tags written
 * before ids were captured, or parsed out of a ComicInfo.xml during a scan. Matches on the
 * name the tag was stored under, which is Comic Vine's own name for it. Scoped by kind
 * because a character and a story arc can share a name (Venom is both).
 * Idempotent: re-running it writes the same ids.
 */
export function setTagIds(db: Db, bookId: number, kind: string, refs: Array<{ id?: number; name: string }>): void {
  const update = db.prepare(
    'UPDATE book_tag SET ext_id = ? WHERE book_id = ? AND kind = ? AND value = ?',
  )
  for (const { id, name } of refs) {
    if (id == null) continue
    update.run(id, bookId, kind, name)
  }
}

export function getBookTags(db: Db, bookId: number): BookTag[] {
  const rows = db
    .prepare('SELECT kind, value, ext_id FROM book_tag WHERE book_id = ? ORDER BY id')
    .all(bookId) as Array<{ kind: string; value: string; ext_id: number | null }>
  return rows.map(({ kind, value, ext_id }) => ({ kind, value, extId: ext_id ?? undefined }))
}
