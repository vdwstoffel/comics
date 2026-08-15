import type { Db, Book } from '../types.js'

interface BookRow {
  id: number
  series_id: number
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
    id: row.id, seriesId: row.series_id, filePath: row.file_path,
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
  seriesId: number
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
    INSERT INTO book (series_id, file_path, title, number, page_count, file_size,
                      writer, penciller, summary, date, added_at)
    VALUES (@seriesId, @filePath, @title, @number, @pageCount, @fileSize,
            @writer, @penciller, @summary, @date, @addedAt)
  `).run({
    seriesId: d.seriesId, filePath: d.filePath, title: d.title ?? null, number: d.number ?? null,
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

export function listBooksBySeries(db: Db, seriesId: number): Book[] {
  return (db.prepare('SELECT * FROM book WHERE series_id = ?').all(seriesId) as BookRow[])
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

export function setBookSeries(db: Db, bookId: number, seriesId: number, filePath: string): Book {
  db.prepare('UPDATE book SET series_id = ?, file_path = ? WHERE id = ?').run(seriesId, filePath, bookId)
  return getBook(db, bookId) as Book
}
