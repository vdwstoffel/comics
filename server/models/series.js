function toSeries(row) {
  if (!row) return undefined
  return {
    id: row.id, name: row.name, folder: row.folder,
    publisher: row.publisher ?? null, summary: row.summary ?? null,
    comicvineId: row.comicvine_id ?? null, createdAt: row.created_at,
    bookCount: row.book_count ?? undefined,
  }
}

export function upsertSeries(db, { name, folder }) {
  const existing = db.prepare('SELECT * FROM series WHERE name = ?').get(name)
  if (existing) return toSeries(existing)
  const info = db
    .prepare('INSERT INTO series (name, folder, created_at) VALUES (?,?,?)')
    .run(name, folder, new Date().toISOString())
  return toSeries(db.prepare('SELECT * FROM series WHERE id = ?').get(info.lastInsertRowid))
}

export function getSeries(db, id) {
  return toSeries(db.prepare('SELECT * FROM series WHERE id = ?').get(id))
}

export function listSeries(db) {
  return db
    .prepare(`SELECT s.*, COUNT(b.id) AS book_count
              FROM series s LEFT JOIN book b ON b.series_id = s.id
              GROUP BY s.id ORDER BY s.name COLLATE NOCASE`)
    .all()
    .map(toSeries)
}

const SERIES_FIELDS = { publisher: 'publisher', summary: 'summary', comicvineId: 'comicvine_id', name: 'name' }

export function updateSeries(db, id, fields) {
  const sets = [], vals = []
  for (const [k, col] of Object.entries(SERIES_FIELDS)) {
    if (k in fields) { sets.push(`${col} = ?`); vals.push(fields[k]) }
  }
  if (sets.length) db.prepare(`UPDATE series SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return getSeries(db, id)
}
