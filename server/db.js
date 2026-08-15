import Database from 'better-sqlite3'

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

export function openDb(dbPath) {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
