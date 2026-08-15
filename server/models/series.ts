import type { Db, Series } from '../types.js'

interface SeriesRow {
  id: number
  name: string
  folder: string
  publisher: string | null
  summary: string | null
  comicvine_id: number | null
  created_at: string
  book_count?: number
}

function toSeries(row: SeriesRow | undefined): Series | undefined {
  if (!row) return undefined
  return {
    id: row.id, name: row.name, folder: row.folder,
    publisher: row.publisher ?? null, summary: row.summary ?? null,
    comicvineId: row.comicvine_id ?? null, createdAt: row.created_at,
    bookCount: row.book_count ?? undefined,
  }
}

export function upsertSeries(db: Db, { name, folder }: { name: string; folder: string }): Series {
  const existing = db.prepare('SELECT * FROM series WHERE name = ?').get(name) as SeriesRow | undefined
  if (existing) return toSeries(existing) as Series
  const info = db
    .prepare('INSERT INTO series (name, folder, created_at) VALUES (?,?,?)')
    .run(name, folder, new Date().toISOString())
  return toSeries(db.prepare('SELECT * FROM series WHERE id = ?').get(info.lastInsertRowid) as SeriesRow) as Series
}

export function getSeries(db: Db, id: number): Series | undefined {
  return toSeries(db.prepare('SELECT * FROM series WHERE id = ?').get(id) as SeriesRow | undefined)
}

export function listSeries(db: Db): Series[] {
  return (db
    .prepare(`SELECT s.*, COUNT(b.id) AS book_count
              FROM series s LEFT JOIN book b ON b.series_id = s.id
              GROUP BY s.id ORDER BY s.name COLLATE NOCASE`)
    .all() as SeriesRow[])
    .map((r) => toSeries(r) as Series)
}

// WARNING: Do NOT use updateSeries/SERIES_FIELDS to change a series' `name`.
// Name changes must go through renameSeries() in services/library.ts, which also
// moves the files on disk and updates the `folder` column. Updating `name` directly
// here will leave files in the old folder and break the path invariant.
const SERIES_FIELDS: Record<string, string> = { publisher: 'publisher', summary: 'summary', comicvineId: 'comicvine_id', name: 'name' }

export type SeriesUpdate = Partial<Pick<Series, 'publisher' | 'summary' | 'comicvineId' | 'name'>>

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
