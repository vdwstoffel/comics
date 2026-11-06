import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { cacheVolumeIssues, getCachedVolumeIssues } from '../server/models/volumeIssues.js'
import {
  volumeRefsFromDescription, compareIssueNumbers, mergeRun, hasNumberingGap, fitsInsideRun,
  sharesNumbers, numberSpan,
} from '../server/lib/runParts.js'
import type { CvVolumeIssue } from '../server/lib/comicvine.js'

let nextId = 1000
const issues = (...numbers: string[]): CvVolumeIssue[] =>
  numbers.map((number) => ({ id: nextId++, number }))

// Thor (2025) and Mortal Thor as Comic Vine actually files them.
const THOR = issues('1', '2', '3', '4', '5', '6', '800', '801', '802')
const MORTAL_THOR = issues('7', '8', '9', '10', '11', '12', '13')

test('every volume a description links is read, once each and in order', () => {
  const html = '<p>Briefly renamed to <a href="/mortal-thor/4050-177511/" data-ref-id="4050-177511">Mortal Thor</a>'
    + ' - see <a data-ref-id="4005-1234">a character</a> and <a data-ref-id="4050-166460">Thor</a>'
    + ' and <a data-ref-id="4050-177511">Mortal Thor</a> again.</p>'
  expect(volumeRefsFromDescription(html)).toEqual([177511, 166460])
  expect(volumeRefsFromDescription('')).toEqual([])
})

test('a run and its renamed stretch read as one run, in number order', () => {
  const run = mergeRun(THOR, [{ name: 'Mortal Thor', issues: MORTAL_THOR }])
  expect(run.map((i) => i.number)).toEqual(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '800', '801', '802'])
})

test('only the issues from the other volume carry its name', () => {
  const run = mergeRun(THOR, [{ name: 'Mortal Thor', issues: MORTAL_THOR }])
  expect(run.find((i) => i.number === '6')).not.toHaveProperty('volumeName')
  expect(run.find((i) => i.number === '7')).toMatchObject({ volumeName: 'Mortal Thor' })
})

test('a run with no other volumes is handed back untouched', () => {
  const unsorted = issues('3', '1', '2')
  expect(mergeRun(unsorted, [])).toBe(unsorted)
})

test('the merged order is the order the issue cache reads one volume back in', () => {
  const db = openDb(':memory:')
  const mixed = issues('10', '2', '1', '7.LR', '1.MU', 'Annual 1', '0', '800')
  cacheVolumeIssues(db, 1, [...mixed, { id: 1, name: 'no number' }])
  const sql = getCachedVolumeIssues(db, 1)!.issues.map((i) => i.number ?? null)
  const js = [...mixed, { id: 1, name: 'no number' }].sort(compareIssueNumbers).map((i) => i.number ?? null)
  expect(js).toEqual(sql)
  db.close()
})

test('a stretch that picks up where the run left off fits inside it', () => {
  expect(hasNumberingGap(THOR)).toBe(true)
  expect(fitsInsideRun(THOR, MORTAL_THOR)).toBe(true)
})

test('the run itself does not fit inside its renamed stretch', () => {
  expect(fitsInsideRun(MORTAL_THOR, THOR)).toBe(false)
})

// "Ongoing series, continuing from the 7th volume of X-Men." - the run before, renumbered.
test('the previous volume of the same title does not fit', () => {
  const xMen2024 = issues('1', '2', '3', '4', '5')
  const xMen2021 = issues('1', '2', '3', '35')
  expect(fitsInsideRun(xMen2024, xMen2021)).toBe(false)
})

// Detective Comics (2016) "continues from the original Volume 1", which sits wholly below it.
test('a volume entirely before the run does not fit', () => {
  const detective2016 = issues('934', '935', '1000', '1001')
  expect(fitsInsideRun(detective2016, issues('0', '1', '881'))).toBe(false)
})

test('a volume after the run does not fit either - nothing comes back after it', () => {
  expect(fitsInsideRun(issues('1', '2', '3'), issues('4', '5'))).toBe(false)
})

test('numbers that land in a gap without picking up from it do not fit', () => {
  expect(fitsInsideRun(THOR, issues('20', '21'))).toBe(false)
})

test('a run counted straight through has no gap', () => {
  expect(hasNumberingGap(issues('1', '2', '3', '3.1', 'Annual 1'))).toBe(false)
})

test('a volume reusing one of the run\'s numbers shares numbers with it', () => {
  expect(sharesNumbers(THOR, MORTAL_THOR)).toBe(false)
  expect(sharesNumbers(THOR, issues('6', '7'))).toBe(true)
  expect(sharesNumbers(THOR, [{ id: 1, number: '006' }])).toBe(true)
})

test('a volume says which stretch it holds', () => {
  expect(numberSpan(MORTAL_THOR)).toEqual({ first: '7', last: '13' })
  expect(numberSpan([])).toBeNull()
})
