import type { Db } from '../types.js'

export interface BookCredit {
  name: string
  role: string
}

export interface BookTag {
  kind: string
  value: string
}

export function replaceBookCredits(db: Db, bookId: number, credits: BookCredit[]): void {
  db.transaction(() => {
    db.prepare('DELETE FROM book_credit WHERE book_id = ?').run(bookId)
    const insert = db.prepare('INSERT INTO book_credit (book_id, name, role) VALUES (?, ?, ?)')
    for (const { name, role } of credits) {
      insert.run(bookId, name, role)
    }
  })()
}

export function getBookCredits(db: Db, bookId: number): BookCredit[] {
  return db.prepare('SELECT name, role FROM book_credit WHERE book_id = ? ORDER BY id').all(bookId) as BookCredit[]
}

export function replaceBookTags(db: Db, bookId: number, tags: BookTag[]): void {
  db.transaction(() => {
    db.prepare('DELETE FROM book_tag WHERE book_id = ?').run(bookId)
    const insert = db.prepare('INSERT INTO book_tag (book_id, kind, value) VALUES (?, ?, ?)')
    for (const { kind, value } of tags) {
      insert.run(bookId, kind, value)
    }
  })()
}

export function getBookTags(db: Db, bookId: number): BookTag[] {
  return db.prepare('SELECT kind, value FROM book_tag WHERE book_id = ? ORDER BY id').all(bookId) as BookTag[]
}
