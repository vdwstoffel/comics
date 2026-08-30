import { deriveSeriesName } from '../lib/seriesName.js'
import type { ReadState } from './progress.js'
import type { Db, Edition } from '../types.js'

interface EditionRow {
  id: number
  name: string
  folder: string
  publisher: string | null
  summary: string | null
  comicvine_id: number | null
  series_name: string | null
  created_at: string
  book_count?: number
}

function toEdition(row: EditionRow | undefined): Edition | undefined {
  if (!row) return undefined
  return {
    id: row.id, name: row.name, folder: row.folder,
    publisher: row.publisher ?? null, summary: row.summary ?? null,
    comicvineId: row.comicvine_id ?? null, seriesName: row.series_name ?? null,
    createdAt: row.created_at, bookCount: row.book_count ?? undefined,
  }
}

export function upsertEdition(db: Db, { name, folder }: { name: string; folder: string }): Edition {
  const existing = db.prepare('SELECT * FROM edition WHERE name = ?').get(name) as EditionRow | undefined
  if (existing) return toEdition(existing) as Edition
  const info = db
    .prepare('INSERT INTO edition (name, folder, series_name, created_at) VALUES (?,?,?,?)')
    .run(name, folder, deriveSeriesName(name), new Date().toISOString())
  return toEdition(db.prepare('SELECT * FROM edition WHERE id = ?').get(info.lastInsertRowid) as EditionRow) as Edition
}

export function getEdition(db: Db, id: number): Edition | undefined {
  return toEdition(db.prepare('SELECT * FROM edition WHERE id = ?').get(id) as EditionRow | undefined)
}

// A book with no read_progress row has never been opened, so it counts as unread -
// the same rule deriveReadState applies to a single book.
const HAS_UNREAD = `EXISTS (
  SELECT 1 FROM book b2 LEFT JOIN read_progress p ON p.book_id = b2.id
  WHERE b2.edition_id = e.id AND (p.book_id IS NULL OR (p.last_page = 0 AND p.completed = 0)))`

const HAS_READING = `EXISTS (
  SELECT 1 FROM book b2 JOIN read_progress p ON p.book_id = b2.id
  WHERE b2.edition_id = e.id AND p.completed = 0 AND p.last_page > 0)`

const HAS_READ = `EXISTS (
  SELECT 1 FROM book b2 JOIN read_progress p ON p.book_id = b2.id
  WHERE b2.edition_id = e.id AND p.completed = 1)`

// One rule for all three: an edition matches a state when it holds at least one issue in
// it. A part-read edition is therefore both unread (issues left) and read (issues
// finished), which is what the tiles and their counts should say.
const READ_STATE_SQL: Record<ReadState, string> = {
  unread: HAS_UNREAD,
  reading: HAS_READING,
  read: HAS_READ,
}

// The same three states expressed against a book LEFT JOINed to its progress row,
// for counting and for listing the issues inside an edition.
export const BOOK_STATE_SQL: Record<ReadState, string> = {
  unread: '(p.book_id IS NULL OR (p.last_page = 0 AND p.completed = 0))',
  reading: '(p.completed = 0 AND p.last_page > 0)',
  read: '(p.completed = 1)',
}

export interface EditionFilter {
  publisher?: string
  readState?: ReadState
}

function buildEditionFilter({ publisher, readState }: EditionFilter): {
  where: string
  params: unknown[]
} {
  const clauses: string[] = []
  const params: unknown[] = []

  if (publisher === '__unknown__') clauses.push('e.publisher IS NULL')
  else if (publisher) { clauses.push('e.publisher = ?'); params.push(publisher) }

  if (readState && READ_STATE_SQL[readState]) clauses.push(READ_STATE_SQL[readState])

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listEditions(db: Db, opts?: EditionFilter): Edition[] {
  const { where, params } = buildEditionFilter(opts ?? {})
  // Under a filter the count must describe what the tile will actually open onto,
  // so it counts matching issues rather than every issue in the edition.
  const counted = opts?.readState ? BOOK_STATE_SQL[opts.readState] : 'b.id IS NOT NULL'
  return (db
    .prepare(`SELECT e.*, COUNT(CASE WHEN ${counted} THEN b.id END) AS book_count
              FROM edition e
              LEFT JOIN book b ON b.edition_id = e.id
              LEFT JOIN read_progress p ON p.book_id = b.id
              ${where}
              GROUP BY e.id ORDER BY e.name COLLATE NOCASE`)
    .all(...params) as EditionRow[])
    .map((r) => toEdition(r) as Edition)
}

export interface ReadStateFacet {
  name: ReadState
  count: number
}

/** Counts issues, not editions, so the numbers match what clicking through lists. */
export function listReadStates(db: Db): ReadStateFacet[] {
  const states: ReadState[] = ['unread', 'reading', 'read']
  return states.map((name) => ({
    name,
    count: (db
      .prepare(`SELECT COUNT(*) AS n FROM book b
                LEFT JOIN read_progress p ON p.book_id = b.id
                WHERE ${BOOK_STATE_SQL[name]}`)
      .get() as { n: number }).n,
  }))
}

export interface PublisherFacet {
  name: string
  count: number
}

export function listPublishers(db: Db): PublisherFacet[] {
  return (db
    .prepare(`SELECT publisher AS name, COUNT(*) AS count
              FROM edition
              WHERE publisher IS NOT NULL
              GROUP BY publisher
              ORDER BY publisher COLLATE NOCASE`)
    .all() as Array<{ name: string; count: number }>)
}

// WARNING: Do NOT use updateEdition/EDITION_FIELDS to change an edition's `name`.
// Name changes must go through renameEdition() in services/library.ts, which also
// moves the files on disk and updates the `folder` column. Updating `name` directly
// here will leave files in the old folder and break the path invariant.
const EDITION_FIELDS: Record<string, string> = { publisher: 'publisher', summary: 'summary', comicvineId: 'comicvine_id', name: 'name', seriesName: 'series_name' }

export type EditionUpdate = Partial<Pick<Edition, 'publisher' | 'summary' | 'comicvineId' | 'name' | 'seriesName'>>

export const EDITION_UPDATABLE_FIELDS = Object.keys(EDITION_FIELDS) as (keyof EditionUpdate)[]

/**
 * Everything a rename must carry over to the row it recreates: all updatable metadata
 * except the name itself. Derived from EDITION_FIELDS rather than listed by hand, so a
 * column added later is carried automatically instead of being silently dropped - which
 * is how publisher/summary/comicvineId and then the series name were each lost in turn.
 */
export function carryableMetadata(edition: Edition): EditionUpdate {
  const carried: Record<string, unknown> = {}
  for (const key of EDITION_UPDATABLE_FIELDS) {
    if (key === 'name') continue
    carried[key] = (edition as unknown as Record<string, unknown>)[key]
  }
  return carried as EditionUpdate
}

export function updateEdition(db: Db, id: number, fields: EditionUpdate): Edition | undefined {
  const sets: string[] = [], vals: unknown[] = []
  for (const [k, col] of Object.entries(EDITION_FIELDS)) {
    if (k in fields) { sets.push(`${col} = ?`); vals.push((fields as Record<string, unknown>)[k]) }
  }
  if (sets.length) db.prepare(`UPDATE edition SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return getEdition(db, id)
}

export function getEditionByName(db: Db, name: string): Edition | undefined {
  return toEdition(db.prepare('SELECT * FROM edition WHERE name = ?').get(name) as EditionRow | undefined)
}

export function deleteEdition(db: Db, id: number): void {
  db.prepare('DELETE FROM edition WHERE id = ?').run(id)
}
