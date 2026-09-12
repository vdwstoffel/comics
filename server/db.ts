import Database from 'better-sqlite3'
import type { Db } from './types.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS edition (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  folder       TEXT NOT NULL,
  publisher    TEXT,
  summary      TEXT,
  comicvine_id INTEGER,
  series_name  TEXT,
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS book (
  id           INTEGER PRIMARY KEY,
  edition_id   INTEGER NOT NULL REFERENCES edition(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS comic_index (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL,
  year        INTEGER,
  number      TEXT,
  imported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comic_index_category ON comic_index(category);

-- Comic Vine's issue list for a volume, so an edition can show the whole run without
-- asking Comic Vine on every page view. A running volume gains an issue a month, so this
-- is a cache with an age, not a source of truth - volume_cache records when we last asked.
-- It is a separate table because a volume Comic Vine lists NO issues for still has to
-- record the attempt; otherwise "no rows" and "never asked" are indistinguishable and it
-- would refetch forever.
CREATE TABLE IF NOT EXISTS volume_cache (
  volume_id  INTEGER PRIMARY KEY,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS volume_issue (
  volume_id   INTEGER NOT NULL,
  cv_issue_id INTEGER NOT NULL,
  number      TEXT,
  name        TEXT,
  cover_date  TEXT,
  site_url    TEXT,
  PRIMARY KEY (volume_id, cv_issue_id)
);

-- The volumes Comic Vine offers for a series name, so opening the same search heading
-- twice costs one request rather than two. Comic Vine allows 200 requests an hour and a
-- single search can list two dozen series, which is what makes this a cache rather than a
-- convenience. Split in two for the same reason as volume_cache above: a series Comic Vine
-- knows nothing about still has to record that we asked, or it would be asked forever.
CREATE TABLE IF NOT EXISTS cv_volume_search (
  query      TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cv_volume_match (
  query        TEXT NOT NULL,
  cv_volume_id INTEGER NOT NULL,
  rank         INTEGER NOT NULL,
  name         TEXT,
  start_year   INTEGER,
  publisher    TEXT,
  issue_count  INTEGER,
  deck         TEXT,
  thumb_url    TEXT,
  site_url     TEXT,
  PRIMARY KEY (query, cv_volume_id)
);

-- Full-text index over titles. External-content table: the fts rows mirror comic_index
-- and are kept in sync by the triggers below, so any writer (server or the python
-- scraper) gets a correct index without having to remember to rebuild it.
CREATE VIRTUAL TABLE IF NOT EXISTS comic_index_fts
  USING fts5(title, content='comic_index', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS comic_index_ai AFTER INSERT ON comic_index BEGIN
  INSERT INTO comic_index_fts(rowid, title) VALUES (new.id, new.title);
END;
CREATE TRIGGER IF NOT EXISTS comic_index_ad AFTER DELETE ON comic_index BEGIN
  INSERT INTO comic_index_fts(comic_index_fts, rowid, title) VALUES('delete', old.id, old.title);
END;
CREATE TRIGGER IF NOT EXISTS comic_index_au AFTER UPDATE ON comic_index BEGIN
  INSERT INTO comic_index_fts(comic_index_fts, rowid, title) VALUES('delete', old.id, old.title);
  INSERT INTO comic_index_fts(rowid, title) VALUES (new.id, new.title);
END;
`

function columnsOf(db: Db, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((r) => r.name)
}

/**
 * A folder of issues used to be called a "series" and the franchise above it a "group".
 * Both names sat one rung too low: the franchise is the series, and a folder holds one
 * edition of it. Renames the old tables in place so an existing library keeps its rows.
 *
 * Must run before SCHEMA - CREATE TABLE IF NOT EXISTS would otherwise leave an empty
 * `edition` table beside the populated `series` one, and the rename would never happen.
 */
function renameSeriesToEdition(db: Db): void {
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map((r) => r.name),
  )
  if (!tables.has('series') || tables.has('edition')) return

  // RENAME TO rewrites book's foreign key to point at `edition` on its own.
  db.exec('ALTER TABLE series RENAME TO edition')
  if (columnsOf(db, 'edition').includes('group_name')) {
    db.exec('ALTER TABLE edition RENAME COLUMN group_name TO series_name')
  }
  if (tables.has('book') && columnsOf(db, 'book').includes('series_id')) {
    db.exec('ALTER TABLE book RENAME COLUMN series_id TO edition_id')
  }
}

export function openDb(dbPath: string): Db {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  renameSeriesToEdition(db)
  db.exec(SCHEMA)

  // Additive migration: add new columns to book if missing
  const bookCols = columnsOf(db, 'book')
  if (!bookCols.includes('year')) db.exec('ALTER TABLE book ADD COLUMN year INTEGER')
  if (!bookCols.includes('cover_url')) db.exec('ALTER TABLE book ADD COLUMN cover_url TEXT')
  if (!bookCols.includes('cv_site_url')) db.exec('ALTER TABLE book ADD COLUMN cv_site_url TEXT')
  if (!bookCols.includes('publisher')) db.exec('ALTER TABLE book ADD COLUMN publisher TEXT')

  db.exec(MIGRATION)

  // Additive migration: character tags gained the Comic Vine id that says WHICH character
  // they are. Four different people have gone by "Hobgoblin"; the name alone can't pick one.
  if (!columnsOf(db, 'book_tag').includes('ext_id')) {
    db.exec('ALTER TABLE book_tag ADD COLUMN ext_id INTEGER')
  }

  // Editions that predate the grouping feature have no series of their own yet.
  if (!columnsOf(db, 'edition').includes('series_name')) {
    db.exec('ALTER TABLE edition ADD COLUMN series_name TEXT')
  }

  // The Comic Vine volume an edition belongs to: its canonical name and the year the
  // run started. Together they are the name this edition should carry.
  const editionCols = columnsOf(db, 'edition')
  if (!editionCols.includes('cv_name')) db.exec('ALTER TABLE edition ADD COLUMN cv_name TEXT')
  if (!editionCols.includes('cv_start_year')) db.exec('ALTER TABLE edition ADD COLUMN cv_start_year INTEGER')

  // Additive migration: comic_index gained year/number after first release
  const indexCols = columnsOf(db, 'comic_index')
  if (!indexCols.includes('year')) db.exec('ALTER TABLE comic_index ADD COLUMN year INTEGER')
  if (!indexCols.includes('number')) db.exec('ALTER TABLE comic_index ADD COLUMN number TEXT')

  return db
}
