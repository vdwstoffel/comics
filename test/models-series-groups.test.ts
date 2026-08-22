import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertSeries, updateSeries, getSeries } from '../server/models/series.js'
import { insertBook } from '../server/models/books.js'
import {
  backfillSeriesGroups,
  listSeriesGroups,
  getSeriesGroup,
} from '../server/models/seriesGroups.js'
import type { Db } from '../server/types.js'

function seed(db: Db, name: string, books = 1, publisher?: string) {
  const series = upsertSeries(db, { name, folder: name })
  if (publisher) updateSeries(db, series.id, { publisher })
  for (let i = 0; i < books; i++) {
    insertBook(db, { seriesId: series.id, filePath: `${name}/${i}.cbz`, pageCount: 10, fileSize: 100 })
  }
  return series
}

// Mirrors the real library
function seedLibrary(db: Db) {
  seed(db, 'Amazing Spider-Man (2025)', 3, 'Marvel')
  seed(db, 'Amazing Spider-Man by Nick Spencer Omnibus', 2, 'Marvel')
  seed(db, 'Avengers by Jonathan Hickman: The Complete Collection', 5, 'Marvel')
  seed(db, 'Batman Vol. 2 (New 52 TPB)', 10, 'DC Comics')
  seed(db, 'Spider-Man By Joe Kelly Omnibus', 1, 'Marvel')
}

test('upsertSeries stores a derived group name', () => {
  const db = openDb(':memory:')
  const series = seed(db, 'Amazing Spider-Man (2025)')
  expect(getSeries(db, series.id)!.groupName).toBe('Amazing Spider-Man')
  db.close()
})

test('backfill fills rows that have no group yet and reports how many', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  db.prepare('UPDATE series SET group_name = NULL').run()
  expect(backfillSeriesGroups(db)).toBe(5)
  const groups = db.prepare('SELECT DISTINCT group_name FROM series ORDER BY group_name').all()
  expect(groups).toEqual([
    { group_name: 'Amazing Spider-Man' },
    { group_name: 'Avengers' },
    { group_name: 'Batman' },
    { group_name: 'Spider-Man' },
  ])
  db.close()
})

test('backfill never overwrites a group set by hand', () => {
  const db = openDb(':memory:')
  const joe = seed(db, 'Spider-Man By Joe Kelly Omnibus')
  updateSeries(db, joe.id, { groupName: 'Amazing Spider-Man' })
  expect(backfillSeriesGroups(db)).toBe(0)
  expect(getSeries(db, joe.id)!.groupName).toBe('Amazing Spider-Man')
  db.close()
})

test('backfill is idempotent', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  db.prepare('UPDATE series SET group_name = NULL').run()
  backfillSeriesGroups(db)
  expect(backfillSeriesGroups(db)).toBe(0)
  db.close()
})

test('listSeriesGroups puts the two Amazing Spider-Man series under one group', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const groups = listSeriesGroups(db)
  expect(groups.map((g) => g.name)).toEqual([
    'Amazing Spider-Man', 'Avengers', 'Batman', 'Spider-Man',
  ])
  const asm = groups.find((g) => g.name === 'Amazing Spider-Man')!
  expect(asm.series.map((s) => s.name)).toEqual([
    'Amazing Spider-Man (2025)', 'Amazing Spider-Man by Nick Spencer Omnibus',
  ])
  db.close()
})

test('a group reports its own book total across editions', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const asm = listSeriesGroups(db).find((g) => g.name === 'Amazing Spider-Man')!
  expect(asm.bookCount).toBe(5)
  expect(asm.series).toHaveLength(2)
  db.close()
})

test('a series with no siblings is a group of one, so nothing disappears', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const batman = listSeriesGroups(db).find((g) => g.name === 'Batman')!
  expect(batman.series).toHaveLength(1)
  expect(batman.bookCount).toBe(10)
  db.close()
})

test('grouping ignores case differences between group names', () => {
  const db = openDb(':memory:')
  const a = seed(db, 'Hawkeye (2012)')
  const b = seed(db, 'Hawkeye Omnibus')
  updateSeries(db, a.id, { groupName: 'hawkeye' })
  updateSeries(db, b.id, { groupName: 'Hawkeye' })
  const groups = listSeriesGroups(db)
  expect(groups).toHaveLength(1)
  expect(groups[0].series).toHaveLength(2)
  db.close()
})

test('the publisher filter narrows groups to matching series', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const dc = listSeriesGroups(db, { publisher: 'DC Comics' })
  expect(dc.map((g) => g.name)).toEqual(['Batman'])
  const marvel = listSeriesGroups(db, { publisher: 'Marvel' })
  expect(marvel.map((g) => g.name)).toEqual(['Amazing Spider-Man', 'Avengers', 'Spider-Man'])
  db.close()
})

test('getSeriesGroup returns one group by name, case-insensitively', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const group = getSeriesGroup(db, 'amazing spider-man')
  expect(group).toBeDefined()
  expect(group!.name).toBe('Amazing Spider-Man')
  expect(group!.series).toHaveLength(2)
  db.close()
})

test('getSeriesGroup returns undefined for a group that does not exist', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  expect(getSeriesGroup(db, 'Aquaman')).toBeUndefined()
  db.close()
})

test('a series moved into another group follows it', () => {
  const db = openDb(':memory:')
  seedLibrary(db)
  const joe = listSeriesGroups(db).find((g) => g.name === 'Spider-Man')!.series[0]
  updateSeries(db, joe.id, { groupName: 'Amazing Spider-Man' })
  const groups = listSeriesGroups(db)
  expect(groups.map((g) => g.name)).toEqual(['Amazing Spider-Man', 'Avengers', 'Batman'])
  expect(getSeriesGroup(db, 'Amazing Spider-Man')!.series).toHaveLength(3)
  db.close()
})
