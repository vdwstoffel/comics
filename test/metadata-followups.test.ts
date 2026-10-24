import { test, expect, beforeEach, afterEach } from 'vitest'
import { openDb } from '../server/db.js'
import type { Db } from '../server/types.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook, deleteBook, getBook } from '../server/models/books.js'
import { replaceBookCredits } from '../server/models/metadata.js'
import { upsertManualEntry, recordManualCheck, listManualEntries } from '../server/models/cvManualEntry.js'
import {
  listMetadataFollowups, dismissFollowup, restoreFollowup, missingMetadata,
} from '../server/models/metadataFollowups.js'

let db: Db

interface BookFields {
  title?: string | null
  summary?: string | null
  date?: string | null
  credits?: boolean
}

/** A comic that is complete by default, so each test states only the hole it is about. */
function addBook(file: string, f: BookFields = {}): number {
  const ed = upsertEdition(db, { name: 'Venom (2025)', folder: 'zz-test/Venom (2025)', seriesName: 'Venom' })
  const id = insertBook(db, {
    editionId: ed.id,
    filePath: `zz-test/Venom (2025)/${file}`,
    title: f.title === undefined ? 'Venom 1' : f.title,
    summary: f.summary === undefined ? 'A symbiote.' : f.summary,
    date: f.date === undefined ? '2025-06-01' : f.date,
    pageCount: 20,
    fileSize: 1,
  })!.id
  if (f.credits !== false) replaceBookCredits(db, id, [{ name: 'Al Ewing', role: 'writer' }])
  return id
}

beforeEach(() => { db = openDb(':memory:') })
afterEach(() => db.close())

test('a comic with a date, a summary and credits is not on the list', () => {
  addBook('throwaway-1.cbz')
  expect(listMetadataFollowups(db)).toEqual([])
})

test('a missing date, summary or credit each puts a comic on the list and is named', () => {
  const noDate = addBook('throwaway-date.cbz', { date: null })
  const noSummary = addBook('throwaway-summary.cbz', { summary: null })
  const noCredits = addBook('throwaway-credits.cbz', { credits: false })

  const byId = new Map(listMetadataFollowups(db).map((f) => [f.bookId, f.missing]))
  expect(byId.get(noDate)).toEqual(['date'])
  expect(byId.get(noSummary)).toEqual(['summary'])
  expect(byId.get(noCredits)).toEqual(['credits'])
})

test('several holes are all named, in a fixed order', () => {
  addBook('throwaway-1.cbz', { date: null, credits: false })
  expect(listMetadataFollowups(db)[0]!.missing).toEqual(['date', 'credits'])
})

// Comic Vine stores empty strings where a scan wrote one. "There but empty" is as useful
// to the reader as "absent", so it counts the same.
test('a blank string counts as missing', () => {
  addBook('throwaway-1.cbz', { summary: '   ' })
  expect(listMetadataFollowups(db)[0]!.missing).toEqual(['summary'])
})

// 78 of the 208 comics in the real library have no title and are filed correctly: most
// Comic Vine issues have no name beyond their number. Counting it would park a third of
// the library here forever.
test('a blank title alone does not put a comic on the list', () => {
  addBook('throwaway-1.cbz', { title: null })
  expect(listMetadataFollowups(db)).toEqual([])
  expect(missingMetadata({ date: '2025-06-01', summary: 'x', hasCredits: true })).toEqual([])
})

// The point of the rework: membership is about the comic, not about how it was matched.
test('a comic matched without a hand-typed id is still listed', () => {
  const id = addBook('throwaway-1.cbz', { summary: null })
  updateBook(db, id, { comicvineId: 1197227 })
  expect(listManualEntries(db)).toEqual([])
  expect(listMetadataFollowups(db).map((f) => f.bookId)).toEqual([id])
})

test('a hand-typed id is carried as context, with what Comic Vine lacked', () => {
  const id = addBook('throwaway-1.cbz', { date: null })
  updateBook(db, id, { comicvineId: 1197227, cvSiteUrl: 'https://comicvine.gamespot.com/issue/4000-1197227/' })
  upsertManualEntry(db, id, 1197227)
  recordManualCheck(db, id, ['cover_date'])

  const row = listMetadataFollowups(db)[0]!
  expect(row).toMatchObject({
    manual: true, typedIssueId: 1197227, bookCvId: 1197227, cvMissing: ['cover_date'],
    title: 'Venom 1', fileName: 'throwaway-1.cbz',
    cvSiteUrl: 'https://comicvine.gamespot.com/issue/4000-1197227/',
  })
  expect(row.checkedAt).not.toBeNull()
})

test('a complete comic stays off the list even when its id was typed by hand', () => {
  const id = addBook('throwaway-1.cbz')
  upsertManualEntry(db, id, 1197227)
  expect(listMetadataFollowups(db)).toEqual([])
})

test('an unbound comic reports no Comic Vine id, so the row can say it cannot be refreshed', () => {
  addBook('throwaway-1.cbz', { date: null })
  expect(listMetadataFollowups(db)[0]).toMatchObject({ bookCvId: null, manual: false, cvMissing: [] })
})

test('an unparseable cv_missing reads as an empty list', () => {
  const id = addBook('throwaway-1.cbz', { date: null })
  upsertManualEntry(db, id, 1197227)
  db.prepare('UPDATE cv_manual_entry SET cv_missing = ? WHERE book_id = ?').run('{{{', id)
  expect(listMetadataFollowups(db)[0]!.cvMissing).toEqual([])
})

test('the newest comic is first', () => {
  const older = addBook('throwaway-old.cbz', { date: null })
  const newer = addBook('throwaway-new.cbz', { date: null })
  db.prepare('UPDATE book SET added_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', older)
  db.prepare('UPDATE book SET added_at = ? WHERE id = ?').run('2026-06-01T00:00:00.000Z', newer)
  expect(listMetadataFollowups(db).map((f) => f.bookId)).toEqual([newer, older])
})

test('a dismissed comic is gone from the list and stays gone', () => {
  const id = addBook('throwaway-1.cbz', { date: null })
  dismissFollowup(db, id)
  expect(listMetadataFollowups(db)).toEqual([])
  // Nothing re-derives it: the hole is still there and the list still skips it.
  expect(listMetadataFollowups(db)).toEqual([])
})

test('dismissing touches neither the comic nor its hand-typed provenance', () => {
  const id = addBook('throwaway-1.cbz', { date: null })
  updateBook(db, id, { comicvineId: 1197227 })
  upsertManualEntry(db, id, 1197227)
  dismissFollowup(db, id)

  const book = getBook(db, id)!
  expect(book.comicvineId).toBe(1197227)
  expect(book.summary).toBe('A symbiote.')
  expect(listManualEntries(db)).toHaveLength(1)
})

test('dismissing twice keeps the first stamp and raises nothing', () => {
  const id = addBook('throwaway-1.cbz', { date: null })
  dismissFollowup(db, id)
  const first = db.prepare('SELECT dismissed_at FROM metadata_followup_dismissed WHERE book_id = ?').get(id)
  dismissFollowup(db, id)
  expect(db.prepare('SELECT dismissed_at FROM metadata_followup_dismissed WHERE book_id = ?').get(id)).toEqual(first)
})

// The list and the database can disagree for as long as a page is open.
test('dismissing a comic that is already gone is not an error', () => {
  expect(() => dismissFollowup(db, 99999)).not.toThrow()
  expect(db.prepare('SELECT COUNT(*) AS n FROM metadata_followup_dismissed').get()).toEqual({ n: 0 })
})

test('restoring puts a dismissed comic back', () => {
  const id = addBook('throwaway-1.cbz', { date: null })
  dismissFollowup(db, id)
  restoreFollowup(db, id)
  expect(listMetadataFollowups(db).map((f) => f.bookId)).toEqual([id])
})

test('deleting a book leaves no dismissal behind', () => {
  const id = addBook('throwaway-1.cbz', { date: null })
  dismissFollowup(db, id)
  deleteBook(db, id)
  // Read the table itself. Asking the list would answer "no rows" either way, and would
  // pass just as happily with the cascade - or foreign_keys - switched off, leaving the
  // verdict to be inherited by whatever book next takes that id.
  expect(db.prepare('SELECT COUNT(*) AS n FROM metadata_followup_dismissed').get()).toEqual({ n: 0 })
})
