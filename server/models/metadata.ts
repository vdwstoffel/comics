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

// Must be called within a transaction for atomicity.
// Replaces only the tags of one kind, so a record that carries no story arcs can leave
// the arcs already on the book alone instead of wiping them. An empty `tags` clears that
// kind, so a caller with nothing to write must skip the call rather than pass [].
// Throws on a tag whose kind differs from `kind`: the DELETE and the INSERT would otherwise
// disagree about which rows belong to this replace, and duplicates would pile up silently.
export function replaceBookTagsOfKind(db: Db, bookId: number, kind: string, tags: BookTag[]): void {
  for (const tag of tags) {
    if (tag.kind !== kind) {
      throw new Error(`replaceBookTagsOfKind(${kind}) given a tag of kind ${tag.kind}`)
    }
  }
  db.prepare('DELETE FROM book_tag WHERE book_id = ? AND kind = ?').run(bookId, kind)
  const insert = db.prepare('INSERT INTO book_tag (book_id, kind, value, ext_id) VALUES (?, ?, ?, ?)')
  for (const { value, extId } of tags) {
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

/**
 * What your comics call a Comic Vine character - the name their credits most often use -
 * or undefined when none of them credit it. What the character's page is headed with when
 * Comic Vine cannot be read: the comics underneath are still yours to list.
 */
export function characterName(db: Db, extId: number): string | undefined {
  const row = db.prepare(`SELECT value FROM book_tag WHERE kind = 'character' AND ext_id = ?
                          GROUP BY value ORDER BY COUNT(*) DESC, value LIMIT 1`).get(extId) as { value: string } | undefined
  return row?.value
}

export interface CharacterHit {
  /** Comic Vine's id: what the character's page is keyed on. */
  id: number
  /** What your comics call them, the most-used name where they differ. */
  name: string
  /** How many of your comics credit them. */
  comics: number
}

/**
 * The characters credited in your comics whose name holds every word typed, the ones in
 * most of your comics first.
 *
 * Grouped by Comic Vine id, not by name, so the four Hobgoblins stay four - and only
 * credits that carry an id are found, since a character's page is keyed on one. Words are
 * matched literally, the way the comics search matches them: a "%" typed is a percent
 * sign, not a wildcard.
 */
export function searchCharacters(db: Db, q: string, limit = 200): CharacterHit[] {
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 8)
  if (terms.length === 0) return []
  const like = terms.map(() => `value LIKE ? ESCAPE '\\'`).join(' AND ')
  const rows = db.prepare(
    `SELECT ext_id AS id, COUNT(DISTINCT book_id) AS comics
       FROM book_tag
      WHERE kind = 'character' AND ext_id IS NOT NULL AND ${like}
      GROUP BY ext_id
      ORDER BY comics DESC
      LIMIT ?`,
  ).all(...terms.map((t) => `%${t.replace(/[\\%_]/g, '\\$&')}%`), limit) as Array<{ id: number; comics: number }>

  // Named the way the page heads them: one character can be credited under two spellings,
  // and the one most of your comics use is the one shown.
  return rows
    .map((r) => ({ id: r.id, name: characterName(db, r.id) ?? '', comics: r.comics }))
    .sort((a, b) => b.comics - a.comics || a.name.localeCompare(b.name))
}
