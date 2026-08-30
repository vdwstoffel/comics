import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition, listEditions, listReadStates } from '../server/models/editions.js'
import { listSeries } from '../server/models/series.js'
import { insertBook, listBooksByEdition } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import type { Db } from '../server/types.js'

type Kind = 'unread' | 'reading' | 'read'

function seed(db: Db, name: string, kinds: Kind[], publisher?: string) {
  const edition = upsertEdition(db, { name, folder: name })
  if (publisher) updateEdition(db, edition.id, { publisher })
  kinds.forEach((kind, i) => {
    const book = insertBook(db, {
      editionId: edition.id, filePath: `${name}/${i}.cbz`, pageCount: 10, fileSize: 100,
    })!
    if (kind === 'reading') setProgress(db, book.id, { lastPage: 4 })
    if (kind === 'read') setProgress(db, book.id, { lastPage: 9, completed: true })
    // 'unread' leaves no read_progress row at all, as a freshly scanned book has none
  })
  return edition
}

function library(db: Db) {
  seed(db, 'All Unread', ['unread', 'unread'], 'DC Comics')
  seed(db, 'Part Read', ['read', 'unread', 'read'], 'Marvel')
  seed(db, 'In Progress', ['reading', 'read'], 'Marvel')
  seed(db, 'Finished', ['read', 'read'], 'Marvel')
  seed(db, 'Empty', [], 'Marvel')
}

const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort()

test('unread lists every series with an issue still to read', () => {
  const db = openDb(':memory:')
  library(db)
  expect(names(listEditions(db, { readState: 'unread' }))).toEqual(['All Unread', 'Part Read'])
  db.close()
})

test('reading lists series with an issue in progress', () => {
  const db = openDb(':memory:')
  library(db)
  expect(names(listEditions(db, { readState: 'reading' }))).toEqual(['In Progress'])
  db.close()
})

test('read lists every series holding a completed issue', () => {
  const db = openDb(':memory:')
  library(db)
  expect(names(listEditions(db, { readState: 'read' })))
    .toEqual(['Finished', 'In Progress', 'Part Read'])
  db.close()
})

// A part-read series belongs to both: it has issues left AND issues finished.
test('a part-read series appears under unread and under read', () => {
  const db = openDb(':memory:')
  library(db)
  expect(names(listEditions(db, { readState: 'unread' }))).toContain('Part Read')
  expect(names(listEditions(db, { readState: 'read' }))).toContain('Part Read')
  db.close()
})

test('the issue count of a filtered series counts only matching issues', () => {
  const db = openDb(':memory:')
  library(db)
  const under = (state: 'unread' | 'reading' | 'read') =>
    listEditions(db, { readState: state }).find((x) => x.name === 'Part Read')?.bookCount
  expect(under('unread')).toBe(1)
  expect(under('read')).toBe(2)
  expect(listEditions(db).find((x) => x.name === 'Part Read')?.bookCount).toBe(3)
  db.close()
})

test('a book with no progress row counts as unread', () => {
  const db = openDb(':memory:')
  seed(db, 'Never Opened', ['unread'])
  expect(names(listEditions(db, { readState: 'unread' }))).toEqual(['Never Opened'])
  db.close()
})

test('a series with no books matches no read state', () => {
  const db = openDb(':memory:')
  library(db)
  for (const state of ['unread', 'reading', 'read'] as const) {
    expect(names(listEditions(db, { readState: state }))).not.toContain('Empty')
  }
  expect(names(listEditions(db))).toContain('Empty')
  db.close()
})

test('no read state given leaves the list unfiltered', () => {
  const db = openDb(':memory:')
  library(db)
  expect(listEditions(db)).toHaveLength(5)
  db.close()
})

test('read state composes with the publisher filter', () => {
  const db = openDb(':memory:')
  library(db)
  expect(names(listEditions(db, { readState: 'unread', publisher: 'Marvel' }))).toEqual(['Part Read'])
  expect(names(listEditions(db, { readState: 'unread', publisher: 'DC Comics' }))).toEqual(['All Unread'])
  db.close()
})

test('listReadStates counts issues, not series', () => {
  const db = openDb(':memory:')
  library(db)
  // 3 unread issues, 1 in progress, 5 completed across the fixture
  expect(listReadStates(db)).toEqual([
    { name: 'unread', count: 3 },
    { name: 'reading', count: 1 },
    { name: 'read', count: 5 },
  ])
  db.close()
})

test('listBooksByEdition can return only the issues in one state', () => {
  const db = openDb(':memory:')
  const edition = seed(db, 'Mixed', ['unread', 'reading', 'read', 'read'])
  expect(listBooksByEdition(db, edition.id)).toHaveLength(4)
  expect(listBooksByEdition(db, edition.id, 'unread')).toHaveLength(1)
  expect(listBooksByEdition(db, edition.id, 'reading')).toHaveLength(1)
  expect(listBooksByEdition(db, edition.id, 'read')).toHaveLength(2)
  db.close()
})

test('the grid groups whatever survives the read-state filter', () => {
  const db = openDb(':memory:')
  const a = seed(db, 'Hawkeye (2012)', ['unread'])
  const b = seed(db, 'Hawkeye Omnibus', ['read'])
  updateEdition(db, a.id, { seriesName: 'Hawkeye' })
  updateEdition(db, b.id, { seriesName: 'Hawkeye' })

  const unread = listSeries(db, { readState: 'unread' })
  expect(unread).toHaveLength(1)
  expect(unread[0].editions.map((s) => s.name)).toEqual(['Hawkeye (2012)'])

  expect(listSeries(db)[0].editions).toHaveLength(2)
  db.close()
})
