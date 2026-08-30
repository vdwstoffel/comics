import { test, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb } from '../server/db.js'

// Track temp dirs created during tests so we can clean up
const tempDirs: string[] = []
function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'comics-test-'))
  tempDirs.push(dir)
  return join(dir, 'test.db')
}

afterEach(() => {
  while (tempDirs.length) {
    try { rmSync(tempDirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

test('openDb creates the expected tables', () => {
  const db = openDb(':memory:')
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => (r as { name: string }).name)
  expect(names).toContain('edition')
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

test('openDb is idempotent: re-opening an already-migrated file DB is a safe no-op and preserves data', () => {
  const dbPath = makeTempDb()

  // First open — sets up full schema + migration
  const db1 = openDb(dbPath)
  const s = db1
    .prepare("INSERT INTO edition (name, folder, created_at) VALUES (?,?,?)")
    .run('X-Men', 'X-Men', '2026-01-01T00:00:00Z')
  const b = db1
    .prepare(
      "INSERT INTO book (edition_id, file_path, page_count, file_size, added_at) VALUES (?,?,?,?,?)"
    )
    .run(s.lastInsertRowid, 'X-Men/001.cbz', 10, 5000, '2026-01-01T00:00:00Z')
  const insertedId = b.lastInsertRowid
  db1.close()

  // Second open over the SAME file — must not throw even though columns already exist
  const db2 = openDb(dbPath)

  // Columns must be present exactly once
  const cols = (db2.pragma('table_info(book)') as Array<{ name: string }>).map((r) => r.name)
  expect(cols.filter((c) => c === 'year')).toHaveLength(1)
  expect(cols.filter((c) => c === 'cover_url')).toHaveLength(1)
  expect(cols.filter((c) => c === 'cv_site_url')).toHaveLength(1)

  // Auxiliary tables must exist
  const tableNames = db2
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => (r as { name: string }).name)
  expect(tableNames).toContain('book_credit')
  expect(tableNames).toContain('book_tag')

  // Previously inserted row must still be intact
  const row = db2.prepare('SELECT * FROM book WHERE id = ?').get(insertedId) as { page_count: number } | undefined
  expect(row).toBeDefined()
  expect(row!.page_count).toBe(10)

  db2.close()
})

test('openDb adds new columns to a pre-existing book table that lacks them (simulates upgrade from old schema)', async () => {
  const dbPath = makeTempDb()

  // Bootstrap a minimal DB that looks like the old schema (no year/cover_url/cv_site_url)
  // Use a dynamic import so this ESM test file can access better-sqlite3 directly.
  const BetterSQLite = (await import('better-sqlite3')).default
  const rawDb = new BetterSQLite(dbPath)
  rawDb.pragma('journal_mode = WAL')
  rawDb.pragma('foreign_keys = ON')
  rawDb.exec(`
    CREATE TABLE series (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, folder TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE book (
      id INTEGER PRIMARY KEY,
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT, number TEXT,
      page_count INTEGER NOT NULL, file_size INTEGER NOT NULL,
      writer TEXT, penciller TEXT, summary TEXT, date TEXT,
      comicvine_id INTEGER, comicinfo_synced INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL
    );
  `)
  rawDb.close()

  // Now call openDb — it should detect missing columns and add them without throwing
  const db = openDb(dbPath)
  const cols = (db.pragma('table_info(book)') as Array<{ name: string }>).map((r) => r.name)
  expect(cols).toContain('year')
  expect(cols).toContain('cover_url')
  expect(cols).toContain('cv_site_url')
  db.close()
})

test('book row round-trips', () => {
  const db = openDb(':memory:')
  const s = db
    .prepare("INSERT INTO edition (name, folder, created_at) VALUES (?,?,?)")
    .run('Batman', 'Batman', '2026-01-01T00:00:00Z')
  const b = db
    .prepare(
      "INSERT INTO book (edition_id, file_path, page_count, file_size, added_at) VALUES (?,?,?,?,?)"
    )
    .run(s.lastInsertRowid, 'Batman/001.cbz', 22, 1234, '2026-01-01T00:00:00Z')
  const row = db.prepare('SELECT * FROM book WHERE id = ?').get(b.lastInsertRowid) as { page_count: number }
  expect(row.page_count).toBe(22)
  db.close()
})

test('an old library is migrated from series/group_name to edition/series_name, rows intact', async () => {
  const dbPath = makeTempDb()

  const BetterSQLite = (await import('better-sqlite3')).default
  const rawDb = new BetterSQLite(dbPath)
  rawDb.pragma('foreign_keys = ON')
  rawDb.exec(`
    CREATE TABLE series (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, folder TEXT NOT NULL,
      publisher TEXT, summary TEXT, comicvine_id INTEGER, group_name TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE book (
      id INTEGER PRIMARY KEY,
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT, number TEXT,
      page_count INTEGER NOT NULL, file_size INTEGER NOT NULL,
      writer TEXT, penciller TEXT, summary TEXT, date TEXT,
      comicvine_id INTEGER, comicinfo_synced INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL
    );
  `)
  rawDb
    .prepare("INSERT INTO series (name, folder, publisher, group_name, created_at) VALUES (?,?,?,?,?)")
    .run('Amazing Spider-Man Vol 7', 'Amazing Spider-Man Vol 7', 'Marvel', 'Amazing Spider-Man', '2026-01-01T00:00:00Z')
  rawDb
    .prepare("INSERT INTO book (series_id, file_path, page_count, file_size, added_at) VALUES (?,?,?,?,?)")
    .run(1, 'Amazing Spider-Man Vol 7/001.cbz', 22, 1234, '2026-01-01T00:00:00Z')
  rawDb.close()

  const db = openDb(dbPath)

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => (r as { name: string }).name)
  expect(tables).toContain('edition')
  expect(tables).not.toContain('series')

  const edition = db.prepare('SELECT * FROM edition WHERE id = 1').get() as {
    name: string; publisher: string; series_name: string
  }
  expect(edition.name).toBe('Amazing Spider-Man Vol 7')
  expect(edition.publisher).toBe('Marvel')
  // The old group_name column keeps its value under its new name.
  expect(edition.series_name).toBe('Amazing Spider-Man')

  const book = db.prepare('SELECT * FROM book WHERE id = 1').get() as { edition_id: number; page_count: number }
  expect(book.edition_id).toBe(1)
  expect(book.page_count).toBe(22)

  db.close()
})

test('migrating an old library twice is a no-op the second time', async () => {
  const dbPath = makeTempDb()

  const BetterSQLite = (await import('better-sqlite3')).default
  const rawDb = new BetterSQLite(dbPath)
  rawDb.exec(`
    CREATE TABLE series (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, folder TEXT NOT NULL,
      group_name TEXT, created_at TEXT NOT NULL
    );
  `)
  rawDb
    .prepare("INSERT INTO series (name, folder, group_name, created_at) VALUES (?,?,?,?)")
    .run('Batman Vol. 2', 'Batman Vol. 2', 'Batman', '2026-01-01T00:00:00Z')
  rawDb.close()

  openDb(dbPath).close()
  const db = openDb(dbPath)

  const rows = db.prepare('SELECT name, series_name FROM edition').all()
  expect(rows).toEqual([{ name: 'Batman Vol. 2', series_name: 'Batman' }])
  db.close()
})
