import { test, expect, beforeEach, afterEach } from 'vitest'
import { openDb } from '../server/db.js'
import type { Db } from '../server/types.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, getBook, updateBook, deleteBook } from '../server/models/books.js'
import {
  upsertManualEntry, recordManualCheck, listManualEntries, deleteManualEntry,
} from '../server/models/cvManualEntry.js'

let db: Db
let bookId: number

function addBook(filePath: string, title: string | null = 'Venom 1'): number {
  const ed = upsertEdition(db, { name: 'Venom (2025)', folder: 'zz-test/Venom (2025)', seriesName: 'Venom' })
  return insertBook(db, { editionId: ed.id, filePath, title, pageCount: 20, fileSize: 1 })!.id
}

beforeEach(() => {
  db = openDb(':memory:')
  bookId = addBook('zz-test/Venom (2025)/throwaway-1.cbz')
})
afterEach(() => db.close())

test('re-entering an id updates in place and keeps created_at', () => {
  upsertManualEntry(db, bookId, 1197227)
  const first = listManualEntries(db)[0]!.createdAt
  upsertManualEntry(db, bookId, 999)
  const rows = listManualEntries(db)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ cvIssueId: 999, createdAt: first })
})

test('an unchecked entry reports no missing fields and a null checkedAt', () => {
  upsertManualEntry(db, bookId, 1197227)
  expect(listManualEntries(db)[0]).toMatchObject({ checkedAt: null, missing: [] })
})

test('recordManualCheck stores the missing list and stamps checkedAt', () => {
  upsertManualEntry(db, bookId, 1197227)
  recordManualCheck(db, bookId, ['date', 'title'])
  const row = listManualEntries(db)[0]!
  expect(row.missing).toEqual(['date', 'title'])
  expect(row.checkedAt).not.toBeNull()
})

test('a check that found nothing missing is checked, with an empty list', () => {
  upsertManualEntry(db, bookId, 1197227)
  recordManualCheck(db, bookId, [])
  expect(listManualEntries(db)[0]).toMatchObject({ missing: [] })
  expect(listManualEntries(db)[0]!.checkedAt).not.toBeNull()
})

test('recordManualCheck on a book with no entry does nothing', () => {
  recordManualCheck(db, bookId, ['date'])
  expect(listManualEntries(db)).toEqual([])
})

test('an unparseable cv_missing reads as an empty list', () => {
  upsertManualEntry(db, bookId, 1197227)
  db.prepare('UPDATE cv_manual_entry SET cv_missing = ? WHERE book_id = ?').run('{{{', bookId)
  expect(listManualEntries(db)[0]!.missing).toEqual([])
})

test('a cv_missing that is valid JSON but not a string array reads as empty', () => {
  upsertManualEntry(db, bookId, 1197227)
  db.prepare('UPDATE cv_manual_entry SET cv_missing = ? WHERE book_id = ?').run('{"a":1}', bookId)
  expect(listManualEntries(db)[0]!.missing).toEqual([])
})

test('the list joins the book and orders newest entry first', () => {
  const second = addBook('zz-test/Venom (2025)/throwaway-2.cbz', null)
  upsertManualEntry(db, bookId, 1)
  db.prepare('UPDATE cv_manual_entry SET created_at = ? WHERE book_id = ?').run('2026-01-01T00:00:00.000Z', bookId)
  upsertManualEntry(db, second, 2)
  updateBook(db, second, { comicvineId: 77, cvSiteUrl: 'https://comicvine.gamespot.com/x/4000-77/' })
  const rows = listManualEntries(db)
  expect(rows.map((r) => r.bookId)).toEqual([second, bookId])
  expect(rows[0]).toMatchObject({
    title: null, fileName: 'throwaway-2.cbz', bookCvId: 77,
    cvSiteUrl: 'https://comicvine.gamespot.com/x/4000-77/',
  })
  expect(rows[1]).toMatchObject({ title: 'Venom 1', fileName: 'throwaway-1.cbz', bookCvId: null })
})

test('deleting a book removes its entry', () => {
  upsertManualEntry(db, bookId, 1197227)
  deleteBook(db, bookId)
  // Read the table itself: listManualEntries inner-joins book, which would hide an
  // orphan and let this pass with the cascade (or foreign_keys) switched off.
  expect(db.prepare('SELECT COUNT(*) AS n FROM cv_manual_entry').get()).toEqual({ n: 0 })
})

test('deleteManualEntry leaves book.comicvine_id set', () => {
  updateBook(db, bookId, { comicvineId: 1197227 })
  upsertManualEntry(db, bookId, 1197227)
  deleteManualEntry(db, bookId)
  expect(listManualEntries(db)).toEqual([])
  expect(getBook(db, bookId)!.comicvineId).toBe(1197227)
})

test('correcting the id clears the old check, which described the old id', () => {
  upsertManualEntry(db, bookId, 1)
  recordManualCheck(db, bookId, ['date'])
  upsertManualEntry(db, bookId, 2)
  expect(listManualEntries(db)[0]).toMatchObject({ checkedAt: null, missing: [] })
})

// Re-typing the SAME id happens: it is what you do when Comic Vine was down the first
// time. The earlier check still describes the record that is still bound, and discarding
// it would make the row claim "not yet read" about a record that was read.
test('re-entering the same id keeps the check it already had', () => {
  upsertManualEntry(db, bookId, 1197227)
  recordManualCheck(db, bookId, ['date'])
  const checked = listManualEntries(db)[0]!.checkedAt

  upsertManualEntry(db, bookId, 1197227)

  expect(listManualEntries(db)[0]).toMatchObject({ checkedAt: checked, missing: ['date'] })
})
