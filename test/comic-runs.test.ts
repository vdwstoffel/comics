import { test, expect } from 'vitest'
import { splitRuns, REST_KEY } from '../server/lib/comicRuns.js'

const issue = (n: number, year: number, name = 'Thor') =>
  ({ title: `${name} #${n} (${year})`, number: String(n).padStart(3, '0'), year })

const seq = (from: number, to: number, year: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => issue(from + i, year))

test('a series with one unbroken run reports it as one run', () => {
  const runs = splitRuns(seq(1, 12, 2020))
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({ yearFrom: 2020, yearTo: 2020, first: 1, last: 12, total: 12 })
})

test('a jump in the numbering begins a new run', () => {
  // Two numbering streams interleaved: the relaunch and its legacy numbers.
  const runs = splitRuns([...seq(1, 10, 2023), ...seq(791, 800, 2023)])
  expect(runs.map((r) => `${r.first}-${r.last}`).sort()).toEqual(['1-10', '791-800'])
})

test('numbering that goes backwards begins a new run, not only a reset to #1', () => {
  const runs = splitRuns([...seq(120, 140, 2020), ...seq(100, 118, 2021)])
  expect(runs).toHaveLength(2)
})

test('a restart to a low number begins a new run', () => {
  const runs = splitRuns([...seq(1, 16, 2018), ...seq(1, 35, 2020)])
  expect(runs.map((r) => `${r.first}-${r.last}`)).toEqual(['1-35', '1-16'])
})

test('runs are listed newest first', () => {
  const runs = splitRuns([...seq(1, 16, 2018), ...seq(1, 35, 2020)])
  expect(runs[0].yearFrom).toBe(2020)
})

test('a long silence begins a new run even without a restart', () => {
  const runs = splitRuns([...seq(1, 5, 2005), ...seq(6, 10, 2015)])
  expect(runs).toHaveLength(2)
})

test('a gap of a year or two does not break a run', () => {
  const runs = splitRuns([...seq(1, 5, 2020), ...seq(6, 10, 2021), ...seq(11, 15, 2022)])
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({ yearFrom: 2020, yearTo: 2022, total: 15 })
})

test('the same issue posted twice does not break a run', () => {
  const runs = splitRuns([...seq(1, 10, 2020), issue(5, 2020), issue(6, 2020)])
  expect(runs).toHaveLength(1)
  expect(runs[0].total).toBe(10)
})

test('a run carries a label leading with the years it covers', () => {
  const [run] = splitRuns(seq(1, 35, 2020).concat(seq(36, 40, 2022)))
  expect(run.label).toBe('2020-2022 · #1-40')
})

test('three years of silence is a new run, not a long one', () => {
  const runs = splitRuns(seq(1, 35, 2020).concat(seq(36, 40, 2023)))
  expect(runs).toHaveLength(2)
})

test('a run inside a single year says that year once', () => {
  const [run] = splitRuns(seq(6, 8, 2015))
  expect(run.label).toBe('2015 · #6-8')
})

test('each run has a key of its own even when two share a year', () => {
  const runs = splitRuns([...seq(1, 8, 2016), ...seq(1, 4, 2016)])
  expect(new Set(runs.map((r) => r.key)).size).toBe(runs.length)
})

// ---- two numberings running side by side ----

// Batman as it really is: a relaunch numbered #1 up, and the legacy numbering it is
// also published under, both appearing in the same two years.
const DUAL = [
  ...seq(1, 4, 2025), ...seq(156, 162, 2025),
  ...seq(5, 12, 2026), ...seq(163, 163, 2026),
]

test('a run carries on into the next year rather than stopping at the year end', () => {
  const runs = splitRuns(DUAL)
  expect(runs.find((r) => r.first === 1)).toMatchObject({ last: 12, yearFrom: 2025, yearTo: 2026 })
})

test('the numbering running alongside it is carried on separately', () => {
  const runs = splitRuns(DUAL)
  expect(runs.find((r) => r.first === 156)).toMatchObject({ last: 163, yearFrom: 2025, yearTo: 2026 })
})

test('two numberings at once make two runs, not four year-sized pieces', () => {
  expect(splitRuns(DUAL)).toHaveLength(2)
})

test('every issue of both numberings is still accounted for', () => {
  expect(splitRuns(DUAL).reduce((n, r) => n + r.total, 0)).toBe(DUAL.length)
})

// ---- the legacy-numbering guard ----

// Gaps at the threshold stay in one stretch, so these three span 51 numbers between
// them — too thin for any range to describe honestly.
const SCATTERED = [issue(1, 2020), issue(26, 2020), issue(51, 2020)]

test('a stretch too sparse to name is quarantined, not the whole series', () => {
  const runs = splitRuns([...seq(1, 20, 2018), ...SCATTERED])
  expect(runs.find((r) => r.first === 1 && r.last === 20)).toBeTruthy()
  expect(runs.find((r) => r.key === REST_KEY)?.total).toBe(3)
})

test('the quarantined stretch is last and named for what it is', () => {
  const runs = splitRuns([...seq(1, 20, 2018), ...SCATTERED])
  const rest = runs[runs.length - 1]
  expect(rest.key).toBe(REST_KEY)
  expect(rest.label).toBe('Other issues')
})

test('a dense run is kept even though it is short', () => {
  expect(splitRuns(seq(6, 8, 2015))).toHaveLength(1)
})

// ---- what is not an issue does not belong to a run ----

test('an issue with no year is set aside rather than costing the series its runs', () => {
  const runs = splitRuns([...seq(1, 5, 2020), { title: 'Thor #99', number: '099', year: null }])
  expect(runs.find((r) => r.first === 1 && r.last === 5)).toBeTruthy()
  expect(runs.find((r) => r.key === REST_KEY)?.total).toBe(1)
})

test('the runs offered always account for every issue given', () => {
  const rows = [...seq(1, 16, 2018), ...seq(1, 35, 2021)]
  const total = splitRuns(rows).reduce((n, r) => n + r.total, 0)
  expect(total).toBe(rows.length)
})

test('nothing hides, even when most of it is unplaceable', () => {
  const rows = [
    ...seq(1, 20, 2018),
    ...SCATTERED,
    { title: 'Thor #99', number: '099', year: null },
    { title: 'Thor #x', number: null, year: 2020 },
  ]
  expect(splitRuns(rows).reduce((n, r) => n + r.total, 0)).toBe(rows.length)
})

test('a series with nothing placeable is all leftovers, not an empty page', () => {
  const rows = [{ title: 'Thor #1', number: '001', year: null }]
  const runs = splitRuns(rows)
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({ key: REST_KEY, total: 1 })
})

test('nothing to split returns nothing', () => {
  expect(splitRuns([])).toEqual([])
})
