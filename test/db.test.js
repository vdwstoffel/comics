import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'

test('openDb creates the expected tables', () => {
  const db = openDb(':memory:')
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)
  expect(names).toContain('series')
  expect(names).toContain('book')
  expect(names).toContain('read_progress')
  db.close()
})

test('book row round-trips', () => {
  const db = openDb(':memory:')
  const s = db
    .prepare("INSERT INTO series (name, folder, created_at) VALUES (?,?,?)")
    .run('Batman', 'Batman', '2026-01-01T00:00:00Z')
  const b = db
    .prepare(
      "INSERT INTO book (series_id, file_path, page_count, file_size, added_at) VALUES (?,?,?,?,?)"
    )
    .run(s.lastInsertRowid, 'Batman/001.cbz', 22, 1234, '2026-01-01T00:00:00Z')
  const row = db.prepare('SELECT * FROM book WHERE id = ?').get(b.lastInsertRowid)
  expect(row.page_count).toBe(22)
  db.close()
})
