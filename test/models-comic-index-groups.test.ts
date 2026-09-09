import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertComicIndex, groupComicIndex, searchComicIndex } from '../server/models/comicIndex.js'

const MARVEL = 'Marvel Comics'
const DC = 'DC Comics'

function seed() {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    { title: 'Thor #1 (2018)', url: 'https://x.test/t1/', category: MARVEL },
    { title: 'Thor #2 (2018)', url: 'https://x.test/t2/', category: MARVEL },
    { title: 'Thor #3 (2019)', url: 'https://x.test/t3/', category: MARVEL },
    { title: 'Thor Vol. 2 #1 – 85 + TPBs (1998-2004)', url: 'https://x.test/t4/', category: MARVEL },
    { title: 'Thor – Godstorm #1 – 3 (2001)', url: 'https://x.test/t6/', category: MARVEL },
    { title: 'The Mighty Thor #700 (2017)', url: 'https://x.test/m1/', category: MARVEL },
    { title: 'Mighty Thor #701 (2017)', url: 'https://x.test/m2/', category: MARVEL },
    { title: 'The Mighty Thor #702 (2018)', url: 'https://x.test/m3/', category: MARVEL },
    { title: 'Thorgal #1 (1980)', url: 'https://x.test/g1/', category: DC },
    { title: 'Thorgal #2 (1981)', url: 'https://x.test/g2/', category: DC },
    { title: 'Thorgal #3 (1982)', url: 'https://x.test/g3/', category: DC },
    // The two stragglers: one row each, so they are what gets swept into "Other".
    { title: 'Astonishing Thor (TPB) (2011)', url: 'https://x.test/t5/', category: MARVEL },
    { title: 'Thor Corps #1 (1993)', url: 'https://x.test/c1/', category: MARVEL },
  ])
  return db
}

const keys = (db: ReturnType<typeof openDb>, q = 'thor') =>
  groupComicIndex(db, { q }).groups.map((g) => g.key)

test('results collapse into one group per series', () => {
  const db = seed()
  expect(new Set(keys(db))).toEqual(new Set(['thor', 'mighty thor', 'thorgal', '__other__']))
})

test('a group counts every matching row under it', () => {
  const db = seed()
  const thor = groupComicIndex(db, { q: 'thor' }).groups.find((g) => g.key === 'thor')!
  // 3 issues + 1 bundle + 1 subtitled bundle
  expect(thor.total).toBe(5)
})

test('a group breaks its members down by kind', () => {
  const db = seed()
  const thor = groupComicIndex(db, { q: 'thor' }).groups.find((g) => g.key === 'thor')!
  expect(thor.kinds).toMatchObject({ issue: 3, bundle: 2 })
})

test('a group is labelled with the spelling its members use', () => {
  const db = seed()
  const mighty = groupComicIndex(db, { q: 'thor' }).groups.find((g) => g.key === 'mighty thor')!
  expect(mighty.name).toMatch(/Mighty Thor/)
})

test('groups are counted and totalled independently', () => {
  const db = seed()
  const { totalGroups, totalResults } = groupComicIndex(db, { q: 'thor' })
  expect(totalGroups).toBe(4)
  expect(totalResults).toBe(13)
})

test('the biggest groups lead so the list opens on what matters', () => {
  const db = seed()
  expect(keys(db)[0]).toBe('thor')
})

test('groups page independently of the rows inside them', () => {
  const db = seed()
  const page = groupComicIndex(db, { q: 'thor', limit: 2, offset: 0 })
  expect(page.groups).toHaveLength(2)
  expect(page.totalGroups).toBe(4)
  const next = groupComicIndex(db, { q: 'thor', limit: 2, offset: 2 })
  expect(next.groups.map((g) => g.key)).not.toEqual(page.groups.map((g) => g.key))
})

test('an existing filter still applies before anything is grouped', () => {
  const db = seed()
  expect(keys(db).includes('thorgal')).toBe(true)
  const marvelOnly = groupComicIndex(db, { q: 'thor', category: MARVEL }).groups.map((g) => g.key)
  expect(marvelOnly).not.toContain('thorgal')
})

test('a search with no query groups nothing', () => {
  const db = seed()
  expect(groupComicIndex(db, { q: '' })).toMatchObject({ groups: [], totalGroups: 0, totalResults: 0 })
})

// ---- expanding a group ----

test('asking for one series returns only its rows', () => {
  const db = seed()
  const { results } = searchComicIndex(db, { q: 'thor', series: 'thor' })
  expect(results).toHaveLength(5)
  expect(results.every((r) => r.title.toLowerCase().startsWith('thor'))).toBe(true)
})

test('asking for one kind within a series narrows it further', () => {
  const db = seed()
  const { results, total } = searchComicIndex(db, { q: 'thor', series: 'thor', kind: 'issue' })
  expect(total).toBe(3)
  expect(results.map((r) => r.number)).toEqual(['001', '002', '003'])
})

test('an expanded group still pages', () => {
  const db = seed()
  const { results, total } = searchComicIndex(db, { q: 'thor', series: 'thor', kind: 'issue', limit: 2 })
  expect(total).toBe(3)
  expect(results).toHaveLength(2)
})

test('a series nobody has heard of returns nothing rather than everything', () => {
  const db = seed()
  expect(searchComicIndex(db, { q: 'thor', series: 'nope' })).toMatchObject({ results: [], total: 0 })
})

test('an ordinary search is untouched by the new filters', () => {
  const db = seed()
  expect(searchComicIndex(db, { q: 'thor' }).total).toBe(13)
})

// ---- sweeping the stragglers together ----

test('series with only a row or two are swept into one Other heading', () => {
  const db = seed()
  const other = groupComicIndex(db, { q: 'thor' }).groups.find((g) => g.key === '__other__')!
  // Astonishing Thor and Thor Corps, one row each.
  expect(other.total).toBe(2)
  expect(other.name).toBe('Other')
})

test('the series it swept up no longer have headings of their own', () => {
  const db = seed()
  expect(keys(db)).not.toContain('astonishing thor')
  expect(keys(db)).not.toContain('thor corps')
})

test('Other comes last even though it is not the smallest', () => {
  const db = seed()
  const all = keys(db)
  expect(all[all.length - 1]).toBe('__other__')
})

test('a series with three rows keeps its own heading', () => {
  const db = seed()
  expect(keys(db)).toContain('thorgal')
})

test('Other adds up the kinds of everything in it', () => {
  const db = seed()
  const other = groupComicIndex(db, { q: 'thor' }).groups.find((g) => g.key === '__other__')!
  expect(other.kinds).toMatchObject({ issue: 1, collection: 1 })
})

test('one straggler on its own is left alone rather than renamed Other', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    { title: 'Thor #1 (2018)', url: 'https://x.test/a/', category: MARVEL },
    { title: 'Thor #2 (2018)', url: 'https://x.test/b/', category: MARVEL },
    { title: 'Thor #3 (2018)', url: 'https://x.test/c/', category: MARVEL },
    { title: 'Astonishing Thor (TPB) (2011)', url: 'https://x.test/d/', category: MARVEL },
  ])
  const all = groupComicIndex(db, { q: 'thor' }).groups.map((g) => g.key)
  expect(all).toContain('astonishing thor')
  expect(all).not.toContain('__other__')
})

test('opening Other returns the rows from every series it swept up', () => {
  const db = seed()
  const { results, total } = searchComicIndex(db, { q: 'thor', series: '__other__' })
  expect(total).toBe(2)
  expect(results.map((r) => r.title).sort())
    .toEqual(['Astonishing Thor (TPB) (2011)', 'Thor Corps #1 (1993)'])
})

test('Other can be narrowed by kind like any other heading', () => {
  const db = seed()
  const { total } = searchComicIndex(db, { q: 'thor', series: '__other__', kind: 'collection' })
  expect(total).toBe(1)
})

// ---- runs inside a series ----

function runSeed() {
  const db = openDb(':memory:')
  const rows = [
    ...Array.from({ length: 16 }, (_, i) => ({
      title: `Thor #${i + 1} (${2018 + Math.floor(i / 10)})`,
      url: `https://x.test/a${i}/`, category: MARVEL,
    })),
    ...Array.from({ length: 20 }, (_, i) => ({
      title: `Thor #${i + 1} (${2021 + Math.floor(i / 10)})`,
      url: `https://x.test/b${i}/`, category: MARVEL,
    })),
    { title: 'Thor Omnibus Vol. 1 (TPB) (2020)', url: 'https://x.test/c/', category: MARVEL },
  ]
  upsertComicIndex(db, rows)
  return db
}

const thorGroup = (db: ReturnType<typeof openDb>) =>
  groupComicIndex(db, { q: 'thor' }).groups.find((g) => g.key === 'thor')!

test('a series reports the runs its issues fall into', () => {
  const runs = thorGroup(runSeed()).runs
  expect(runs).toHaveLength(2)
  expect(runs.map((r) => r.total)).toEqual([20, 16])
})

test('the newest run is offered first', () => {
  expect(thorGroup(runSeed()).runs[0].yearFrom).toBe(2021)
})

test('collections are not part of any run', () => {
  const total = thorGroup(runSeed()).runs.reduce((n, r) => n + r.total, 0)
  expect(total).toBe(36)
})

test('opening a run returns just that run\'s issues', () => {
  const db = runSeed()
  const [newest] = thorGroup(db).runs
  const { results, total } = searchComicIndex(db, { q: 'thor', series: 'thor', run: newest.key })
  expect(total).toBe(20)
  expect(results.every((r) => r.year !== null && r.year >= 2021)).toBe(true)
})

test('a run key that names nothing returns nothing rather than everything', () => {
  const db = runSeed()
  expect(searchComicIndex(db, { q: 'thor', series: 'thor', run: 'nope' }))
    .toMatchObject({ results: [], total: 0 })
})

test('a series printed under two numberings has them told apart, not discarded', () => {
  const db = openDb(':memory:')
  upsertComicIndex(db, [
    ...Array.from({ length: 10 }, (_, i) => ({
      title: `Wonder Woman #${i + 1} (2023)`, url: `https://x.test/w${i}/`, category: DC,
    })),
    // The same issues under their legacy numbering.
    ...Array.from({ length: 10 }, (_, i) => ({
      title: `Wonder Woman #${791 + i} (2023)`, url: `https://x.test/l${i}/`, category: DC,
    })),
  ])
  const group = groupComicIndex(db, { q: 'wonder' }).groups.find((g) => g.key === 'wonder woman')!
  expect(group.runs.map((r) => `${r.first}-${r.last}`).sort()).toEqual(['1-10', '791-800'])
  expect(group.kinds.issue).toBe(20)
})

test('every issue in a series is reachable through exactly one run', () => {
  const db = runSeed()
  const group = thorGroup(db)
  const inRuns = group.runs.reduce((n, r) => n + r.total, 0)
  expect(inRuns).toBe(group.kinds.issue)
})
