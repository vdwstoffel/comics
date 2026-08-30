import { deriveGroupName } from '../lib/seriesGroup.js'
import type { ReadState } from './progress.js'
import type { Db, Series } from '../types.js'

interface SeriesRow {
  id: number
  name: string
  folder: string
  publisher: string | null
  summary: string | null
  comicvine_id: number | null
  group_name: string | null
  created_at: string
  book_count?: number
}

function toSeries(row: SeriesRow | undefined): Series | undefined {
  if (!row) return undefined
  return {
    id: row.id, name: row.name, folder: row.folder,
    publisher: row.publisher ?? null, summary: row.summary ?? null,
    comicvineId: row.comicvine_id ?? null, groupName: row.group_name ?? null,
    createdAt: row.created_at, bookCount: row.book_count ?? undefined,
  }
}

export function upsertSeries(db: Db, { name, folder }: { name: string; folder: string }): Series {
  const existing = db.prepare('SELECT * FROM series WHERE name = ?').get(name) as SeriesRow | undefined
  if (existing) return toSeries(existing) as Series
  const info = db
    .prepare('INSERT INTO series (name, folder, group_name, created_at) VALUES (?,?,?,?)')
    .run(name, folder, deriveGroupName(name), new Date().toISOString())
  return toSeries(db.prepare('SELECT * FROM series WHERE id = ?').get(info.lastInsertRowid) as SeriesRow) as Series
}

export function getSeries(db: Db, id: number): Series | undefined {
  return toSeries(db.prepare('SELECT * FROM series WHERE id = ?').get(id) as SeriesRow | undefined)
}

// A book with no read_progress row has never been opened, so it counts as unread -
// the same rule deriveReadState applies to a single book.
const HAS_UNREAD = `EXISTS (
  SELECT 1 FROM book b2 LEFT JOIN read_progress p ON p.book_id = b2.id
  WHERE b2.series_id = s.id AND (p.book_id IS NULL OR (p.last_page = 0 AND p.completed = 0)))`

const HAS_READING = `EXISTS (
  SELECT 1 FROM book b2 JOIN read_progress p ON p.book_id = b2.id
  WHERE b2.series_id = s.id AND p.completed = 0 AND p.last_page > 0)`

const HAS_READ = `EXISTS (
  SELECT 1 FROM book b2 JOIN read_progress p ON p.book_id = b2.id
  WHERE b2.series_id = s.id AND p.completed = 1)`

// One rule for all three: a series matches a state when it holds at least one issue in
// it. A part-read series is therefore both unread (issues left) and read (issues
// finished), which is what the tiles and their counts should say.
const READ_STATE_SQL: Record<ReadState, string> = {
  unread: HAS_UNREAD,
  reading: HAS_READING,
  read: HAS_READ,
}

// The same three states expressed against a book LEFT JOINed to its progress row,
// for counting and for listing the issues inside a series.
export const BOOK_STATE_SQL: Record<ReadState, string> = {
  unread: '(p.book_id IS NULL OR (p.last_page = 0 AND p.completed = 0))',
  reading: '(p.completed = 0 AND p.last_page > 0)',
  read: '(p.completed = 1)',
}

export interface SeriesFilter {
  publisher?: string
  readState?: ReadState
}

function buildSeriesFilter({ publisher, readState }: SeriesFilter): {
  where: string
  params: unknown[]
} {
  const clauses: string[] = []
  const params: unknown[] = []

  if (publisher === '__unknown__') clauses.push('s.publisher IS NULL')
  else if (publisher) { clauses.push('s.publisher = ?'); params.push(publisher) }

  if (readState && READ_STATE_SQL[readState]) clauses.push(READ_STATE_SQL[readState])

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listSeries(db: Db, opts?: SeriesFilter): Series[] {
  const { where, params } = buildSeriesFilter(opts ?? {})
  // Under a filter the count must describe what the tile will actually open onto,
  // so it counts matching issues rather than every issue in the series.
  const counted = opts?.readState ? BOOK_STATE_SQL[opts.readState] : 'b.id IS NOT NULL'
  return (db
    .prepare(`SELECT s.*, COUNT(CASE WHEN ${counted} THEN b.id END) AS book_count
              FROM series s
              LEFT JOIN book b ON b.series_id = s.id
              LEFT JOIN read_progress p ON p.book_id = b.id
              ${where}
              GROUP BY s.id ORDER BY s.name COLLATE NOCASE`)
    .all(...params) as SeriesRow[])
    .map((r) => toSeries(r) as Series)
}

export interface ReadStateFacet {
  name: ReadState
  count: number
}

/** Counts issues, not series, so the numbers match what clicking through lists. */
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
              FROM series
              WHERE publisher IS NOT NULL
              GROUP BY publisher
              ORDER BY publisher COLLATE NOCASE`)
    .all() as Array<{ name: string; count: number }>)
}

// WARNING: Do NOT use updateSeries/SERIES_FIELDS to change a series' `name`.
// Name changes must go through renameSeries() in services/library.ts, which also
// moves the files on disk and updates the `folder` column. Updating `name` directly
// here will leave files in the old folder and break the path invariant.
const SERIES_FIELDS: Record<string, string> = { publisher: 'publisher', summary: 'summary', comicvineId: 'comicvine_id', name: 'name', groupName: 'group_name' }

export type SeriesUpdate = Partial<Pick<Series, 'publisher' | 'summary' | 'comicvineId' | 'name' | 'groupName'>>

export const SERIES_UPDATABLE_FIELDS = Object.keys(SERIES_FIELDS) as (keyof SeriesUpdate)[]

/**
 * Everything a rename must carry over to the row it recreates: all updatable metadata
 * except the name itself. Derived from SERIES_FIELDS rather than listed by hand, so a
 * column added later is carried automatically instead of being silently dropped - which
 * is how publisher/summary/comicvineId and then group_name were each lost in turn.
 */
export function carryableMetadata(series: Series): SeriesUpdate {
  const carried: Record<string, unknown> = {}
  for (const key of SERIES_UPDATABLE_FIELDS) {
    if (key === 'name') continue
    carried[key] = (series as unknown as Record<string, unknown>)[key]
  }
  return carried as SeriesUpdate
}

export function updateSeries(db: Db, id: number, fields: SeriesUpdate): Series | undefined {
  const sets: string[] = [], vals: unknown[] = []
  for (const [k, col] of Object.entries(SERIES_FIELDS)) {
    if (k in fields) { sets.push(`${col} = ?`); vals.push((fields as Record<string, unknown>)[k]) }
  }
  if (sets.length) db.prepare(`UPDATE series SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return getSeries(db, id)
}

export function getSeriesByName(db: Db, name: string): Series | undefined {
  return toSeries(db.prepare('SELECT * FROM series WHERE name = ?').get(name) as SeriesRow | undefined)
}

export function deleteSeries(db: Db, id: number): void {
  db.prepare('DELETE FROM series WHERE id = ?').run(id)
}
