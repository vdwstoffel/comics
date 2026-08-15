function toBook(row) {
  if (!row) return undefined
  return {
    id: row.id, seriesId: row.series_id, filePath: row.file_path,
    title: row.title ?? null, number: row.number ?? null,
    pageCount: row.page_count, fileSize: row.file_size,
    writer: row.writer ?? null, penciller: row.penciller ?? null,
    summary: row.summary ?? null, date: row.date ?? null,
    comicvineId: row.comicvine_id ?? null,
    comicinfoSynced: !!row.comicinfo_synced, addedAt: row.added_at,
  }
}

export function insertBook(db, d) {
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

export function getBook(db, id) {
  return toBook(db.prepare('SELECT * FROM book WHERE id = ?').get(id))
}

export function findBookByPath(db, filePath) {
  return toBook(db.prepare('SELECT * FROM book WHERE file_path = ?').get(filePath))
}

export function listBooksBySeries(db, seriesId) {
  return db.prepare('SELECT * FROM book WHERE series_id = ?').all(seriesId)
    .map(toBook)
    .sort((a, b) => String(a.number ?? a.filePath).localeCompare(String(b.number ?? b.filePath), undefined, { numeric: true }))
}

const BOOK_FIELDS = {
  title: 'title', number: 'number', writer: 'writer', penciller: 'penciller',
  summary: 'summary', date: 'date', comicvineId: 'comicvine_id', comicinfoSynced: 'comicinfo_synced',
}

export function updateBook(db, id, fields) {
  const sets = [], vals = []
  for (const [k, col] of Object.entries(BOOK_FIELDS)) {
    if (k in fields) { sets.push(`${col} = ?`); vals.push(k === 'comicinfoSynced' ? (fields[k] ? 1 : 0) : fields[k]) }
  }
  if (sets.length) db.prepare(`UPDATE book SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return getBook(db, id)
}
