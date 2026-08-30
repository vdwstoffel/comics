import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, listEditions, getEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, getBook, listBooksByEdition, updateBook, findBookByPath } from '../server/models/books.js'
import { getProgress, setProgress } from '../server/models/progress.js'

function freshDb() { return openDb(':memory:') }

test('upsertEdition is idempotent by name and camelCases output', () => {
  const db = freshDb()
  const a = upsertEdition(db, { name: 'Batman', folder: 'Batman' })
  const b = upsertEdition(db, { name: 'Batman', folder: 'Batman' })
  expect(a.id).toBe(b.id)
  expect(a.name).toBe('Batman')
  expect(a.createdAt).toBeTruthy()
})

test('books insert, fetch, update, list', () => {
  const db = freshDb()
  const s = upsertEdition(db, { name: 'Batman', folder: 'Batman' })
  const book = insertBook(db, { editionId: s.id, filePath: 'Batman/001.cbz', pageCount: 20, fileSize: 100 })!
  expect(book.pageCount).toBe(20)
  expect(book.comicinfoSynced).toBe(false)
  const updated = updateBook(db, book.id, { title: 'One', number: '1' })!
  expect(updated.title).toBe('One')
  expect(getBook(db, book.id)!.number).toBe('1')
  expect(listBooksByEdition(db, s.id)).toHaveLength(1)
  expect(findBookByPath(db, 'Batman/001.cbz')!.id).toBe(book.id)
})

test('listEditions includes bookCount', () => {
  const db = freshDb()
  const s = upsertEdition(db, { name: 'Batman', folder: 'Batman' })
  insertBook(db, { editionId: s.id, filePath: 'Batman/001.cbz', pageCount: 1, fileSize: 1 })
  const list = listEditions(db)
  expect(list[0].bookCount).toBe(1)
})

test('progress defaults then persists', () => {
  const db = freshDb()
  const s = upsertEdition(db, { name: 'B', folder: 'B' })
  const book = insertBook(db, { editionId: s.id, filePath: 'B/1.cbz', pageCount: 10, fileSize: 1 })!
  expect(getProgress(db, book.id)).toMatchObject({ lastPage: 0, completed: false })
  setProgress(db, book.id, { lastPage: 5, completed: false })
  expect(getProgress(db, book.id).lastPage).toBe(5)
})
