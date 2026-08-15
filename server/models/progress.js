export function getProgress(db, bookId) {
  const row = db.prepare('SELECT * FROM read_progress WHERE book_id = ?').get(bookId)
  if (!row) return { bookId, lastPage: 0, completed: false, updatedAt: null }
  return { bookId: row.book_id, lastPage: row.last_page, completed: !!row.completed, updatedAt: row.updated_at }
}

export function setProgress(db, bookId, { lastPage, completed = false }) {
  db.prepare(`
    INSERT INTO read_progress (book_id, last_page, completed, updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(book_id) DO UPDATE SET last_page = excluded.last_page,
      completed = excluded.completed, updated_at = excluded.updated_at
  `).run(bookId, lastPage, completed ? 1 : 0, new Date().toISOString())
  return getProgress(db, bookId)
}
