import { BOOK_STATE_SQL } from './editions.js'
import { deriveReadState } from './progress.js'
import type { ReadState, BookWithProgress } from './progress.js'
import type { Db, Book } from '../types.js'

interface BookRow {
  id: number
  edition_id: number
  file_path: string
  title: string | null
  number: string | null
  page_count: number
  file_size: number
  writer: string | null
  penciller: string | null
  summary: string | null
  date: string | null
  comicvine_id: number | null
  comicinfo_synced: number
  added_at: string
  year: number | null
  cover_url: string | null
  cv_site_url: string | null
  publisher: string | null
}

function toBook(row: BookRow | undefined): Book | undefined {
  if (!row) return undefined
  return {
    id: row.id, editionId: row.edition_id, filePath: row.file_path,
    title: row.title ?? null, number: row.number ?? null,
    pageCount: row.page_count, fileSize: row.file_size,
    writer: row.writer ?? null, penciller: row.penciller ?? null,
    summary: row.summary ?? null, date: row.date ?? null,
    comicvineId: row.comicvine_id ?? null,
    comicinfoSynced: !!row.comicinfo_synced, addedAt: row.added_at,
    year: row.year ?? null, coverUrl: row.cover_url ?? null, cvSiteUrl: row.cv_site_url ?? null,
    publisher: row.publisher ?? null,
  }
}

export interface InsertBookInput {
  editionId: number
  filePath: string
  title?: string | null
  number?: string | null
  pageCount: number
  fileSize: number
  writer?: string | null
  penciller?: string | null
  summary?: string | null
  date?: string | null
  addedAt?: string
}

export function insertBook(db: Db, d: InsertBookInput): Book | undefined {
  const info = db.prepare(`
    INSERT INTO book (edition_id, file_path, title, number, page_count, file_size,
                      writer, penciller, summary, date, added_at)
    VALUES (@editionId, @filePath, @title, @number, @pageCount, @fileSize,
            @writer, @penciller, @summary, @date, @addedAt)
  `).run({
    editionId: d.editionId, filePath: d.filePath, title: d.title ?? null, number: d.number ?? null,
    pageCount: d.pageCount, fileSize: d.fileSize, writer: d.writer ?? null,
    penciller: d.penciller ?? null, summary: d.summary ?? null, date: d.date ?? null,
    addedAt: d.addedAt ?? new Date().toISOString(),
  })
  return getBook(db, info.lastInsertRowid)
}

export function getBook(db: Db, id: number | bigint): Book | undefined {
  return toBook(db.prepare('SELECT * FROM book WHERE id = ?').get(id) as BookRow | undefined)
}

export function findBookByPath(db: Db, filePath: string): Book | undefined {
  return toBook(db.prepare('SELECT * FROM book WHERE file_path = ?').get(filePath) as BookRow | undefined)
}

/**
 * A book as the library shelf needs it: the book, its progress, and the volume and series
 * holding it. Both names come from the edition rather than the book because that is where
 * they live; carrying them here is what lets the shelf group by volume and by series
 * without a second request per group.
 */
export interface LibraryBook extends BookWithProgress {
  editionName: string
  /** Null for an edition nobody has given a series to - the shelf falls back to the
   *  volume's own name, which is a decision about tiles rather than about the data. */
  seriesName: string | null
  /** The story arcs this comic is tagged with, in the order they were written. Empty for
   *  the many comics that carry none. */
  arcs: string[]
}

/**
 * Book id -> the story arcs it is tagged with.
 *
 * One query for the whole library rather than one per book: the tags are already indexed
 * by kind, there are a handful of them per comic, and the shelf needs them for every row
 * it is about to draw. Grouping the shelf by arc is a question about the library, so it
 * is answered here and never by asking Comic Vine.
 */
function arcsByBook(db: Db): Map<number, string[]> {
  const rows = db
    .prepare("SELECT book_id, value FROM book_tag WHERE kind = 'story_arc' ORDER BY id")
    .all() as Array<{ book_id: number; value: string }>

  const arcs = new Map<number, string[]>()
  for (const { book_id: bookId, value } of rows) {
    const found = arcs.get(bookId)
    if (found) found.push(value)
    else arcs.set(bookId, [value])
  }
  return arcs
}

/**
 * Every book in the library matching a read state and/or a publisher.
 *
 * The rail carries both at once, so both narrow together — a view honouring only one
 * would misdescribe what it is showing. The state fragments come from BOOK_STATE_SQL, the
 * same ones the sidebar counts with, so "unread" cannot come to mean one thing in the
 * rail and another in the grid.
 *
 * Ordered by series then issue number: this is the "what do I read next" list, so it
 * reads in the order you would read it.
 */
export function listLibraryBooks(
  db: Db,
  { readState, publisher }: { readState?: ReadState; publisher?: string },
): LibraryBook[] {
  const clauses: string[] = []
  const params: unknown[] = []

  if (readState) clauses.push(BOOK_STATE_SQL[readState])
  if (publisher === '__unknown__') clauses.push('e.publisher IS NULL')
  else if (publisher) { clauses.push('e.publisher = ?'); params.push(publisher) }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT b.*, e.series_name AS series_name, e.name AS edition_name
              FROM book b
              JOIN edition e ON e.id = b.edition_id
              LEFT JOIN read_progress p ON p.book_id = b.id
              ${where}`)
    .all(...params) as Array<BookRow & { series_name: string | null; edition_name: string }>

  const arcs = arcsByBook(db)

  return rows
    .sort((a, b) => {
      const series = String(a.series_name ?? '').localeCompare(String(b.series_name ?? ''), undefined, { sensitivity: 'base' })
      if (series !== 0) return series
      return String(a.number ?? a.file_path).localeCompare(String(b.number ?? b.file_path), undefined, { numeric: true })
    })
    .map((r) => ({
      ...deriveReadState(db, toBook(r) as Book),
      editionName: r.edition_name,
      seriesName: r.series_name?.trim() || null,
      arcs: arcs.get(r.id) ?? [],
    }))
}

export function listBooksByEdition(db: Db, editionId: number, readState?: ReadState): Book[] {
  const filter = readState ? `AND ${BOOK_STATE_SQL[readState]}` : ''
  return (db
    .prepare(`SELECT b.* FROM book b
              LEFT JOIN read_progress p ON p.book_id = b.id
              WHERE b.edition_id = ? ${filter}`)
    .all(editionId) as BookRow[])
    .map((r) => toBook(r) as Book)
    .sort((a, b) => String(a.number ?? a.filePath).localeCompare(String(b.number ?? b.filePath), undefined, { numeric: true }))
}


const BOOK_FIELDS: Record<string, string> = {
  title: 'title', number: 'number', writer: 'writer', penciller: 'penciller',
  summary: 'summary', date: 'date', comicvineId: 'comicvine_id', comicinfoSynced: 'comicinfo_synced',
  year: 'year', coverUrl: 'cover_url', cvSiteUrl: 'cv_site_url', publisher: 'publisher',
}

export type BookUpdate = Partial<{
  title: string | null
  number: string | null
  writer: string | null
  penciller: string | null
  summary: string | null
  date: string | null
  comicvineId: number | null
  comicinfoSynced: boolean
  year: number | null
  coverUrl: string | null
  cvSiteUrl: string | null
  publisher: string | null
}>

export function updateBook(db: Db, id: number | bigint, fields: BookUpdate): Book | undefined {
  const sets: string[] = [], vals: unknown[] = []
  for (const [k, col] of Object.entries(BOOK_FIELDS)) {
    if (k in fields) {
      const v = (fields as Record<string, unknown>)[k]
      sets.push(`${col} = ?`); vals.push(k === 'comicinfoSynced' ? (v ? 1 : 0) : v)
    }
  }
  if (sets.length) db.prepare(`UPDATE book SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return getBook(db, id)
}

export function setBookEdition(db: Db, bookId: number, editionId: number, filePath: string): Book {
  db.prepare('UPDATE book SET edition_id = ?, file_path = ? WHERE id = ?').run(editionId, filePath, bookId)
  return getBook(db, bookId) as Book
}

export function deleteBook(db: Db, id: number): void {
  db.prepare('DELETE FROM book WHERE id = ?').run(id)
}
