import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'

test('openDb creates the expected tables', () => {
  const db = openDb(':memory:')
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => (r as { name: string }).name)
  expect(names).toContain('series')
  expect(names).toContain('book')
  expect(names).toContain('read_progress')
  db.close()
})

test('openDb creates book_credit and book_tag tables', () => {
  const db = openDb(':memory:')
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => (r as { name: string }).name)
  expect(names).toContain('book_credit')
  expect(names).toContain('book_tag')
  db.close()
})

test('openDb adds year, cover_url, cv_site_url columns to book', () => {
  const db = openDb(':memory:')
  const cols = (db.pragma('table_info(book)') as Array<{ name: string }>).map((r) => r.name)
  expect(cols).toContain('year')
  expect(cols).toContain('cover_url')
  expect(cols).toContain('cv_site_url')
  db.close()
})

test('openDb is idempotent: calling openDb twice does not throw', () => {
  // First open — sets up schema + migration
  const db1 = openDb(':memory:')
  db1.close()
  // Second open on a new :memory: DB is also idempotent
  const db2 = openDb(':memory:')
  const cols = (db2.pragma('table_info(book)') as Array<{ name: string }>).map((r) => r.name)
  expect(cols).toContain('year')
  expect(cols).toContain('cover_url')
  expect(cols).toContain('cv_site_url')
  db2.close()
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
  const row = db.prepare('SELECT * FROM book WHERE id = ?').get(b.lastInsertRowid) as { page_count: number }
  expect(row.page_count).toBe(22)
  db.close()
})
