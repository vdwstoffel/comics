import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertSeries, getSeriesByName, deleteSeries } from '../server/models/series.js'
import { insertBook, setBookSeries } from '../server/models/books.js'

function freshDb() { return openDb(':memory:') }

test('getSeriesByName finds existing series', () => {
  const db = freshDb()
  upsertSeries(db, { name: 'Batman', folder: 'Batman' })
  const found = getSeriesByName(db, 'Batman')
  expect(found).toBeDefined()
  expect(found!.name).toBe('Batman')
})

test('getSeriesByName returns undefined for unknown name', () => {
  const db = freshDb()
  expect(getSeriesByName(db, 'Nonexistent')).toBeUndefined()
})

test('deleteSeries removes the row', () => {
  const db = freshDb()
  const s = upsertSeries(db, { name: 'Batman', folder: 'Batman' })
  deleteSeries(db, s.id)
  expect(getSeriesByName(db, 'Batman')).toBeUndefined()
})

test('setBookSeries updates seriesId and filePath', () => {
  const db = freshDb()
  const s1 = upsertSeries(db, { name: 'A', folder: 'A' })
  const s2 = upsertSeries(db, { name: 'B', folder: 'B' })
  const book = insertBook(db, { seriesId: s1.id, filePath: 'A/001.cbz', pageCount: 5, fileSize: 100 })!
  const updated = setBookSeries(db, book.id, s2.id, 'B/001.cbz')
  expect(updated.seriesId).toBe(s2.id)
  expect(updated.filePath).toBe('B/001.cbz')
})
