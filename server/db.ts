import Database from 'better-sqlite3'
import type { Db } from './types.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS series (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  folder       TEXT NOT NULL,
  publisher    TEXT,
  summary      TEXT,
  comicvine_id INTEGER,
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS book (
  id           INTEGER PRIMARY KEY,
  series_id    INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL UNIQUE,
  title        TEXT,
  number       TEXT,
  page_count   INTEGER NOT NULL,
  file_size    INTEGER NOT NULL,
  writer       TEXT,
  penciller    TEXT,
  summary      TEXT,
  date         TEXT,
  comicvine_id INTEGER,
  comicinfo_synced INTEGER NOT NULL DEFAULT 0,
  added_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS read_progress (
  book_id     INTEGER PRIMARY KEY REFERENCES book(id) ON DELETE CASCADE,
  last_page   INTEGER NOT NULL DEFAULT 0,
  completed   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);
`

const MIGRATION = `
CREATE TABLE IF NOT EXISTS book_credit (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_credit_book ON book_credit(book_id);
CREATE INDEX IF NOT EXISTS idx_book_credit_name ON book_credit(name);
CREATE TABLE IF NOT EXISTS book_tag (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_tag_book ON book_tag(book_id);
CREATE INDEX IF NOT EXISTS idx_book_tag_kind_value ON book_tag(kind, value);
`

export function openDb(dbPath: string): Db {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)

  // Additive migration: add new columns to book if missing
  const bookCols = (db.pragma('table_info(book)') as Array<{ name: string }>).map((r) => r.name)
  if (!bookCols.includes('year')) db.exec('ALTER TABLE book ADD COLUMN year INTEGER')
  if (!bookCols.includes('cover_url')) db.exec('ALTER TABLE book ADD COLUMN cover_url TEXT')
  if (!bookCols.includes('cv_site_url')) db.exec('ALTER TABLE book ADD COLUMN cv_site_url TEXT')
  if (!bookCols.includes('publisher')) db.exec('ALTER TABLE book ADD COLUMN publisher TEXT')

  db.exec(MIGRATION)
  return db
}
