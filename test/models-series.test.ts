import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition, getEdition } from '../server/models/editions.js'
import { insertBook } from '../server/models/books.js'
import {
  backfillSeriesNames,
  listSeries,
  getSeries,
} from '../server/models/series.js'
import type { Db } from '../server/types.js'

function seed(db: Db, name: string, books = 1, publisher?: string) {
  const edition = upsertEdition(db, { name, folder: name })
  if (publisher) updateEdition(db, edition.id, { publisher })
  for (let i = 0; i < books; i++) {
    insertBook(db, { editionId: edition.id, filePath: `${name}/${i}.cbz`, pageCount: 10, fileSize: 100 })
  }
  return edition
}

// Mirrors the real library
function seedLibrary(db: Db) {
  seed(db, 'Amazing Spider-Man (2025)', 3, 'Marvel')
  seed(db, 'Amazing Spider-Man by Nick Spencer Omnibus', 2, 'Marvel')
  seed(db, 'Avengers by Jonathan Hickman: The Complete Collection', 5, 'Marvel')
  seed(db, 'Batman Vol. 2 (New 52 TPB)', 10, 'DC Comics')
  seed(db, 'Spider-Man By Joe Kelly Omnibus', 1, 'Marvel')
}

test('upsertEdition stores a derived series name', () => {
  const db = openDb(':memory:')
  const edition = seed(db, 'Amazing Spider-Man (2025)')
  expect(getEdition(db, edition.id)!.seriesName).toBe('Amazing Spider-Man')
  db.close()
})

test('backfill fills rows that have no series yet and reports how many', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  db.prepare('UPDATE edition SET series_name = NULL').run()
  expect(backfillSeriesNames(db)).toBe(5)
  const names = db.prepare('SELECT DISTINCT series_name FROM edition ORDER BY series_name').all()
  expect(names).toEqual([
    { series_name: 'Amazing Spider-Man' },
    { series_name: 'Avengers' },
    { series_name: 'Batman' },
    { series_name: 'Spider-Man' },
  ])
  db.close()
})

test('backfill never overwrites a series set by hand', () => {
  const db = openDb(':memory:')
  const joe = seed(db, 'Spider-Man By Joe Kelly Omnibus')
  updateEdition(db, joe.id, { seriesName: 'Amazing Spider-Man' })
  expect(backfillSeriesNames(db)).toBe(0)
  expect(getEdition(db, joe.id)!.seriesName).toBe('Amazing Spider-Man')
  db.close()
})

test('backfill is idempotent', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  db.prepare('UPDATE edition SET series_name = NULL').run()
  backfillSeriesNames(db)
  expect(backfillSeriesNames(db)).toBe(0)
  db.close()
})

test('listSeries puts the two Amazing Spider-Man editions under one series', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const series = listSeries(db)
  expect(series.map((s) => s.name)).toEqual([
    'Amazing Spider-Man', 'Avengers', 'Batman', 'Spider-Man',
  ])
  const asm = series.find((s) => s.name === 'Amazing Spider-Man')!
  expect(asm.editions.map((e) => e.name)).toEqual([
    'Amazing Spider-Man (2025)', 'Amazing Spider-Man by Nick Spencer Omnibus',
  ])
  db.close()
})

test('a series reports its own book total across editions', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const asm = listSeries(db).find((s) => s.name === 'Amazing Spider-Man')!
  expect(asm.bookCount).toBe(5)
  expect(asm.editions).toHaveLength(2)
  db.close()
})

test('an edition with no siblings is a series of one, so nothing disappears', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const batman = listSeries(db).find((s) => s.name === 'Batman')!
  expect(batman.editions).toHaveLength(1)
  expect(batman.bookCount).toBe(10)
  db.close()
})

test('grouping ignores case differences between series names', () => {
  const db = openDb(':memory:')
  const a = seed(db, 'Hawkeye (2012)')
  const b = seed(db, 'Hawkeye Omnibus')
  updateEdition(db, a.id, { seriesName: 'hawkeye' })
  updateEdition(db, b.id, { seriesName: 'Hawkeye' })
  const series = listSeries(db)
  expect(series).toHaveLength(1)
  expect(series[0].editions).toHaveLength(2)
  db.close()
})

test('the publisher filter narrows series to matching editions', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const dc = listSeries(db, { publisher: 'DC Comics' })
  expect(dc.map((s) => s.name)).toEqual(['Batman'])
  const marvel = listSeries(db, { publisher: 'Marvel' })
  expect(marvel.map((s) => s.name)).toEqual(['Amazing Spider-Man', 'Avengers', 'Spider-Man'])
  db.close()
})

test('getSeries returns one series by name, case-insensitively', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const series = getSeries(db, 'amazing spider-man')
  expect(series).toBeDefined()
  expect(series!.name).toBe('Amazing Spider-Man')
  expect(series!.editions).toHaveLength(2)
  db.close()
})

test('getSeries returns undefined for a series that does not exist', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  expect(getSeries(db, 'Aquaman')).toBeUndefined()
  db.close()
})

test('an edition moved into another series follows it', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const joe = listSeries(db).find((s) => s.name === 'Spider-Man')!.editions[0]
  updateEdition(db, joe.id, { seriesName: 'Amazing Spider-Man' })
  const series = listSeries(db)
  expect(series.map((s) => s.name)).toEqual(['Amazing Spider-Man', 'Avengers', 'Batman'])
  expect(getSeries(db, 'Amazing Spider-Man')!.editions).toHaveLength(3)
  db.close()
})
