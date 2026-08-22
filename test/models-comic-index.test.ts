import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  upsertComicIndex,
  searchComicIndex,
  comicIndexCategories,
} from '../server/models/comicIndex.js'

const DC = 'DC Comics'
const MARVEL = 'Marvel Comics'

function seed(db: ReturnType<typeof openDb>) {
  return upsertComicIndex(db, [
    { title: 'Batman (2011) #1', url: 'https://x.test/batman-2011-1/', category: DC },
    { title: 'Batman (2016) #1', url: 'https://x.test/batman-2016-1/', category: DC },
    { title: 'Superman: Year One', url: 'https://x.test/superman-year-one/', category: DC },
    { title: 'The Amazing Spider-Man #300', url: 'https://x.test/asm-300/', category: MARVEL },
  ])
}

test('upsertComicIndex inserts new entries and reports the count', () => {
  const db = openDb(':memory:')
  const result = seed(db)
  expect(result).toEqual({ inserted: 4, updated: 0, unchanged: 0 })
  const rows = db.prepare('SELECT COUNT(*) AS n FROM comic_index').get() as { n: number }
  expect(rows.n).toBe(4)
  db.close()
})

test('re-running the same entries adds no duplicates', () => {
  const db = openDb(':memory:')
  seed(db)
  const second = seed(db)
  expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 4 })
  const rows = db.prepare('SELECT COUNT(*) AS n FROM comic_index').get() as { n: number }
  expect(rows.n).toBe(4)
  db.close()
})

test('a later run inserts only the entries whose url is new', () => {
  const db = openDb(':memory:')
  seed(db)
  const result = upsertComicIndex(db, [
    { title: 'Batman (2011) #1', url: 'https://x.test/batman-2011-1/', category: DC },
    { title: 'Daredevil #1', url: 'https://x.test/daredevil-1/', category: MARVEL },
  ])
  expect(result).toEqual({ inserted: 1, updated: 0, unchanged: 1 })
  const rows = db.prepare('SELECT COUNT(*) AS n FROM comic_index').get() as { n: number }
  expect(rows.n).toBe(5)
  db.close()
})

test('same url with a changed title updates the title but keeps the original imported_at', () => {
  const db = openDb(':memory:')
  seed(db)
  const before = db
    .prepare('SELECT imported_at FROM comic_index WHERE url = ?')
    .get('https://x.test/asm-300/') as { imported_at: string }

  const result = upsertComicIndex(db, [
    { title: 'Amazing Spider-Man #300 (Remastered)', url: 'https://x.test/asm-300/', category: MARVEL },
  ])
  expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 0 })

  const after = db
    .prepare('SELECT title, imported_at FROM comic_index WHERE url = ?')
    .get('https://x.test/asm-300/') as { title: string; imported_at: string }
  expect(after.title).toBe('Amazing Spider-Man #300 (Remastered)')
  expect(after.imported_at).toBe(before.imported_at)
  db.close()
})

test('duplicate urls within a single batch collapse to one row', () => {
  const db = openDb(':memory:')
  const result = upsertComicIndex(db, [
    { title: 'Batman #1', url: 'https://x.test/dupe/', category: DC },
    { title: 'Batman #1', url: 'https://x.test/dupe/', category: DC },
  ])
  expect(result.inserted).toBe(1)
  const rows = db.prepare('SELECT COUNT(*) AS n FROM comic_index').get() as { n: number }
  expect(rows.n).toBe(1)
  db.close()
})

test('entries already in the db are kept when a later run no longer lists them', () => {
  const db = openDb(':memory:')
  seed(db)
  upsertComicIndex(db, [{ title: 'Daredevil #1', url: 'https://x.test/daredevil-1/', category: MARVEL }])
  const rows = db.prepare('SELECT COUNT(*) AS n FROM comic_index').get() as { n: number }
  expect(rows.n).toBe(5)
  db.close()
})

test('searchComicIndex matches a single word', () => {
  const db = openDb(':memory:')
  seed(db)
  const { results, total } = searchComicIndex(db, { q: 'batman' })
  expect(total).toBe(2)
  expect(results.map((r) => r.title).sort()).toEqual(['Batman (2011) #1', 'Batman (2016) #1'])
  expect(results[0].url).toContain('https://x.test/batman-')
  db.close()
})

test('searchComicIndex matches word prefixes', () => {
  const db = openDb(':memory:')
  seed(db)
  const { results } = searchComicIndex(db, { q: 'superm' })
  expect(results.map((r) => r.title)).toEqual(['Superman: Year One'])
  db.close()
})

test('searchComicIndex requires all terms, in any order', () => {
  const db = openDb(':memory:')
  seed(db)
  expect(searchComicIndex(db, { q: 'batman 2011' }).results.map((r) => r.title)).toEqual(['Batman (2011) #1'])
  expect(searchComicIndex(db, { q: '2011 batman' }).results.map((r) => r.title)).toEqual(['Batman (2011) #1'])
  expect(searchComicIndex(db, { q: 'batman daredevil' }).results).toEqual([])
  db.close()
})

test('searchComicIndex ignores punctuation in the query instead of throwing', () => {
  const db = openDb(':memory:')
  seed(db)
  for (const q of ['superman: year one', '"batman"', 'spider-man', 'batman AND OR NOT', '#300', '*']) {
    expect(() => searchComicIndex(db, { q })).not.toThrow()
  }
  expect(searchComicIndex(db, { q: 'superman: year one' }).results.map((r) => r.title))
    .toEqual(['Superman: Year One'])
  expect(searchComicIndex(db, { q: 'spider-man' }).results.map((r) => r.title))
    .toEqual(['The Amazing Spider-Man #300'])
  db.close()
})

test('searchComicIndex returns nothing for a query with no searchable characters', () => {
  const db = openDb(':memory:')
  seed(db)
  for (const q of ['', '   ', '***']) {
    expect(searchComicIndex(db, { q })).toEqual({ results: [], total: 0 })
  }
  db.close()
})

test('searchComicIndex filters by category', () => {
  const db = openDb(':memory:')
  seed(db)
  expect(searchComicIndex(db, { q: 'batman', category: MARVEL }).total).toBe(0)
  expect(searchComicIndex(db, { q: 'batman', category: DC }).total).toBe(2)
  db.close()
})

test('searchComicIndex pages through results while reporting the full total', () => {
  const db = openDb(':memory:')
  seed(db)
  const page1 = searchComicIndex(db, { q: 'batman', limit: 1, offset: 0 })
  const page2 = searchComicIndex(db, { q: 'batman', limit: 1, offset: 1 })
  expect(page1.total).toBe(2)
  expect(page2.total).toBe(2)
  expect(page1.results).toHaveLength(1)
  expect(page2.results).toHaveLength(1)
  expect(page1.results[0].url).not.toBe(page2.results[0].url)
  db.close()
})

test('searchComicIndex clamps an oversized limit', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, Array.from({ length: 300 }, (_, i) => ({
    title: `Batman #${i}`, url: `https://x.test/b${i}/`, category: DC,
  })))
  expect(searchComicIndex(db, { q: 'batman', limit: 5000 }).results).toHaveLength(200)
  db.close()
})

test('comicIndexCategories reports a count per category, largest first', () => {
  const db = openDb(':memory:')
  seed(db)
  expect(comicIndexCategories(db)).toEqual([
    { name: DC, count: 3 },
    { name: MARVEL, count: 1 },
  ])
  db.close()
})

test('updating a title makes the new title searchable and the old one not', () => {
  const db = openDb(':memory:')
  seed(db)
  upsertComicIndex(db, [
    { title: 'Nightwing #1', url: 'https://x.test/superman-year-one/', category: DC },
  ])
  expect(searchComicIndex(db, { q: 'nightwing' }).total).toBe(1)
  expect(searchComicIndex(db, { q: 'superman' }).total).toBe(0)
  db.close()
})

// The server never parses titles - the scraper derives these and passes them in, so a
// caller that supplies nothing gets nulls rather than a second parser's guess.
test('upsertComicIndex stores the number and year it is given', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    { title: 'Spider-Man #10 (2016)', url: 'https://x.test/s10/', category: MARVEL },
    { title: 'Some Omnibus (2024)', url: 'https://x.test/omni/', category: DC },
    { title: 'Unparsed Annual', url: 'https://x.test/annual/', category: DC },
  ])
  const issue = searchComicIndex(db, { q: 'spider' }).results[0]
  expect(issue.number).toBe('010')
  expect(issue.year).toBe(2016)
  const omnibus = searchComicIndex(db, { q: 'omnibus' }).results[0]
  expect(omnibus.number).toBeNull()
  expect(omnibus.year).toBe(2024)
  const unparsed = searchComicIndex(db, { q: 'annual' }).results[0]
  expect([unparsed.number, unparsed.year]).toEqual([null, null])
  db.close()
})

test('an update revises the number and year along with the title', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    { title: 'Spider-Man #1 (2016)', url: 'https://x.test/s/', category: MARVEL },
  ])
  const result = upsertComicIndex(db, [
    { title: 'Spider-Man #12 (2019)', url: 'https://x.test/s/', category: MARVEL },
  ])
  expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 0 })
  const row = searchComicIndex(db, { q: 'spider' }).results[0]
  expect([row.number, row.year]).toEqual(['012', 2019])
  db.close()
})

test('a row identical in every derived field counts as unchanged', () => {
  const db = openDb(':memory:')
  const entry = { title: 'Spider-Man #1 (2016)', url: 'https://x.test/s/', category: MARVEL }
  upsertComicIndex(db, [entry])
  expect(upsertComicIndex(db, [entry])).toEqual({ inserted: 0, updated: 0, unchanged: 1 })
  db.close()
})

// The bug this fixes: ordering by raw title puts #10 and #11 between #1 and #2.
test('results come back in issue-number order, not lexicographic title order', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [1, 2, 3, 10, 11, 12, 16, 20].map((n) => ({
    title: `Spider-Man #${n} (2016)`,
    url: `https://x.test/s${n}/`,
    category: MARVEL,
  })))
  const titles = searchComicIndex(db, { q: 'spider-man' }).results.map((r) => r.number)
  expect(titles).toEqual(['001', '002', '003', '010', '011', '012', '016', '020'])
  db.close()
})

test('issue numbers wider than the pad still sort after the narrower ones', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [1, 99, 100, 999, 1000, 1000000].map((n) => ({
    title: `Detective Comics #${n} (1990)`,
    url: `https://x.test/d${n}/`,
    category: DC,
  })))
  expect(searchComicIndex(db, { q: 'detective' }).results.map((r) => r.number))
    .toEqual(['001', '099', '100', '999', '1000', '1000000'])
  db.close()
})

test('negative issue numbers sort before the first issue', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    { title: 'Spider-Man #1 (1997)', url: 'https://x.test/a/', category: MARVEL },
    { title: 'Spider-Man #-1 (1997)', url: 'https://x.test/b/', category: MARVEL },
  ])
  expect(searchComicIndex(db, { q: 'spider-man' }).results.map((r) => r.number))
    .toEqual(['-001', '001'])
  db.close()
})

test('different series stay grouped together when numbers interleave', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    { title: 'Batman #2 (2016)', url: 'https://x.test/b2/', category: DC },
    { title: 'Aquaman #10 (2016)', url: 'https://x.test/a10/', category: DC },
    { title: 'Batman #1 (2016)', url: 'https://x.test/b1/', category: DC },
    { title: 'Aquaman #2 (2016)', url: 'https://x.test/a2/', category: DC },
  ])
  expect(searchComicIndex(db, { q: '2016' }).results.map((r) => r.title)).toEqual([
    'Aquaman #2 (2016)', 'Aquaman #10 (2016)', 'Batman #1 (2016)', 'Batman #2 (2016)',
  ])
  db.close()
})

// Observed on real data: bm25 scores a short title ("Amazing Spider-Man #11") above a
// longer one ("Amazing Spider-Man #1 (2015)"), which pushed #11-#16 ahead of #1. Every
// row already matches every term, so relevance must not outrank issue order.
test('a shorter title does not jump ahead of lower issue numbers in the same series', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    { title: 'Amazing Spider-Man #11', url: 'https://x.test/11/', category: MARVEL },
    { title: 'Amazing Spider-Man #1 (2015)', url: 'https://x.test/1/', category: MARVEL },
    { title: 'Amazing Spider-Man #2 (2018)', url: 'https://x.test/2/', category: MARVEL },
  ])
  expect(searchComicIndex(db, { q: 'amazing spider-man' }).results.map((r) => r.number))
    .toEqual(['001', '002', '011'])
  db.close()
})

test('same series and issue number orders by year', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    { title: 'Spider-Man #1 (2022)', url: 'https://x.test/c/', category: MARVEL },
    { title: 'Spider-Man #1 (2016)', url: 'https://x.test/a/', category: MARVEL },
    { title: 'Spider-Man #1 (2019)', url: 'https://x.test/b/', category: MARVEL },
  ])
  expect(searchComicIndex(db, { q: 'spider-man' }).results.map((r) => r.year))
    .toEqual([2016, 2019, 2022])
  db.close()
})

function seedYears(db: ReturnType<typeof openDb>) {
  upsertComicIndex(db, [
    { title: 'Amazing Spider-Man #3 (2015)', url: 'https://x.test/y2015/', category: MARVEL },
    { title: 'Amazing Spider-Man #3 (2018)', url: 'https://x.test/y2018/', category: MARVEL },
    { title: 'Amazing Spider-Man #3 (2022)', url: 'https://x.test/y2022/', category: MARVEL },
    { title: 'Amazing Spider-Man #1.5', url: 'https://x.test/undated/', category: MARVEL },
    { title: 'Amazing Spider-Man Annual (2016)', url: 'https://x.test/dc2016/', category: DC },
  ])
}

test('a year range keeps only the years inside it, inclusive of both bounds', () => {
  const db = openDb(':memory:')
  seedYears(db)
  const { results, total } = searchComicIndex(db, { q: 'amazing spider-man', yearFrom: 2015, yearTo: 2018 })
  expect(results.map((r) => r.year)).toEqual([2015, 2018, 2016])
  expect(total).toBe(3)
  db.close()
})

test('yearFrom alone means that year onwards', () => {
  const db = openDb(':memory:')
  seedYears(db)
  expect(searchComicIndex(db, { q: 'amazing spider-man', yearFrom: 2018 }).results.map((r) => r.year))
    .toEqual([2018, 2022])
  db.close()
})

test('yearTo alone means up to and including that year', () => {
  const db = openDb(':memory:')
  seedYears(db)
  expect(searchComicIndex(db, { q: 'amazing spider-man', yearTo: 2016 }).results.map((r) => r.year))
    .toEqual([2015, 2016])
  db.close()
})

test('rows with no year drop out once a bound is set, and return when it is cleared', () => {
  const db = openDb(':memory:')
  seedYears(db)
  const bounded = searchComicIndex(db, { q: 'amazing spider-man', yearFrom: 1900 })
  expect(bounded.results.some((r) => r.year === null)).toBe(false)
  const unbounded = searchComicIndex(db, { q: 'amazing spider-man' })
  expect(unbounded.results.some((r) => r.year === null)).toBe(true)
  db.close()
})

test('reversed bounds are treated as a typo and swapped', () => {
  const db = openDb(':memory:')
  seedYears(db)
  const swapped = searchComicIndex(db, { q: 'amazing spider-man', yearFrom: 2018, yearTo: 2015 })
  const normal = searchComicIndex(db, { q: 'amazing spider-man', yearFrom: 2015, yearTo: 2018 })
  expect(swapped.results.map((r) => r.url)).toEqual(normal.results.map((r) => r.url))
  expect(swapped.total).toBe(3)
  db.close()
})

test('a year range composes with the category filter', () => {
  const db = openDb(':memory:')
  seedYears(db)
  const { results, total } = searchComicIndex(db, {
    q: 'amazing spider-man', category: MARVEL, yearFrom: 2015, yearTo: 2018,
  })
  expect(total).toBe(2)
  expect(results.map((r) => r.year)).toEqual([2015, 2018])
  db.close()
})

test('total reflects the year range so paging stays correct', () => {
  const db = openDb(':memory:')
  seedYears(db)
  const page = searchComicIndex(db, { q: 'amazing spider-man', yearFrom: 2015, yearTo: 2022, limit: 1 })
  expect(page.results).toHaveLength(1)
  expect(page.total).toBe(4)
  db.close()
})

test('a single year is expressed by setting both bounds the same', () => {
  const db = openDb(':memory:')
  seedYears(db)
  expect(searchComicIndex(db, { q: 'amazing spider-man', yearFrom: 2018, yearTo: 2018 }).total).toBe(1)
  db.close()
})

test('upsertComicIndex derives number and year from the title', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    { title: 'Spider-Man #10 (2016)', url: 'https://x.test/s10/', category: MARVEL },
    { title: 'Detective Comics #1000 (2018)', url: 'https://x.test/d/', category: DC },
    { title: 'Some Omnibus (2024)', url: 'https://x.test/omni/', category: DC },
    { title: 'No Marker At All', url: 'https://x.test/none/', category: DC },
  ])
  const byUrl = Object.fromEntries(
    ['spider', 'detective', 'omnibus', 'marker']
      .map((q) => searchComicIndex(db, { q }).results[0])
      .map((r) => [r.url, [r.number, r.year]])
  )
  expect(byUrl['https://x.test/s10/']).toEqual(['010', 2016])
  expect(byUrl['https://x.test/d/']).toEqual(['1000', 2018])
  expect(byUrl['https://x.test/omni/']).toEqual([null, 2024])
  expect(byUrl['https://x.test/none/']).toEqual([null, null])
  db.close()
})

test('a retitled row has its number and year re-derived', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [{ title: 'Spider-Man #1 (2016)', url: 'https://x.test/s/', category: MARVEL }])
  const result = upsertComicIndex(db, [
    { title: 'Spider-Man #12 (2019)', url: 'https://x.test/s/', category: MARVEL },
  ])
  expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 0 })
  const row = searchComicIndex(db, { q: 'spider' }).results[0]
  expect([row.number, row.year]).toEqual(['012', 2019])
  db.close()
})

test('re-upserting an unchanged title derives the same values and reports unchanged', () => {
  const db = openDb(':memory:')
  const entry = { title: 'Spider-Man #1 (2016)', url: 'https://x.test/s/', category: MARVEL }
  upsertComicIndex(db, [entry])
  expect(upsertComicIndex(db, [entry])).toEqual({ inserted: 0, updated: 0, unchanged: 1 })
  db.close()
})

// Root cause of repeated "updated" churn: the same post is listed in several category
// panes (the weekly packs appear under DC, Marvel and Others), so a row keyed on url
// was rewritten once per sighting and whichever landed last won.
const MULTI_PANE = [
  { title: '2026.08.19 Weekly Pack', url: 'https://x.test/weekly/', category: DC },
  { title: '2026.08.19 Weekly Pack', url: 'https://x.test/weekly/', category: MARVEL },
  { title: '2026.08.19 Weekly Pack', url: 'https://x.test/weekly/', category: 'Others Comics' },
]

test('a url listed under several categories becomes one row, counted once', () => {
  const db = openDb(':memory:')
  expect(upsertComicIndex(db, MULTI_PANE)).toEqual({ inserted: 1, updated: 0, unchanged: 2 })
  const rows = db.prepare('SELECT COUNT(*) AS n FROM comic_index').get() as { n: number }
  expect(rows.n).toBe(1)
  db.close()
})

test('the first category seen wins and is not rewritten by later sightings', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, MULTI_PANE)
  const row = db.prepare('SELECT category FROM comic_index').get() as { category: string }
  expect(row.category).toBe(DC)
  db.close()
})

test('re-running an unchanged multi-category batch reports no updates at all', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, MULTI_PANE)
  expect(upsertComicIndex(db, MULTI_PANE).updated).toBe(0)
  // and again with the panes in a different order, as a later scrape may see them
  expect(upsertComicIndex(db, [...MULTI_PANE].reverse()).updated).toBe(0)
  db.close()
})

test('a genuine title change still updates, even for a multi-category url', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, MULTI_PANE)
  const result = upsertComicIndex(db, [
    { title: '2026.08.19 Weekly Pack (Updated)', url: 'https://x.test/weekly/', category: MARVEL },
  ])
  expect(result.updated).toBe(1)
  const row = db.prepare('SELECT title, category FROM comic_index').get() as { title: string; category: string }
  expect(row.title).toBe('2026.08.19 Weekly Pack (Updated)')
  expect(row.category).toBe(DC)
  db.close()
})
