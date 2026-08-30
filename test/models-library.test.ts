import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, getEditionByName, deleteEdition } from '../server/models/editions.js'
import { insertBook, setBookEdition } from '../server/models/books.js'

function freshDb() { return openDb(':memory:') }

test('getEditionByName finds existing series', () => {
  const db = freshDb()
  upsertEdition(db, { name: 'Batman', folder: 'Batman' })
  const found = getEditionByName(db, 'Batman')
  expect(found).toBeDefined()
  expect(found!.name).toBe('Batman')
})

test('getEditionByName returns undefined for unknown name', () => {
  const db = freshDb()
  expect(getEditionByName(db, 'Nonexistent')).toBeUndefined()
})

test('deleteEdition removes the row', () => {
  const db = freshDb()
  const s = upsertEdition(db, { name: 'Batman', folder: 'Batman' })
  deleteEdition(db, s.id)
  expect(getEditionByName(db, 'Batman')).toBeUndefined()
})

test('setBookEdition updates editionId and filePath', () => {
  const db = freshDb()
  const s1 = upsertEdition(db, { name: 'A', folder: 'A' })
  const s2 = upsertEdition(db, { name: 'B', folder: 'B' })
  const book = insertBook(db, { editionId: s1.id, filePath: 'A/001.cbz', pageCount: 5, fileSize: 100 })!
  const updated = setBookEdition(db, book.id, s2.id, 'B/001.cbz')
  expect(updated.editionId).toBe(s2.id)
  expect(updated.filePath).toBe('B/001.cbz')
})
