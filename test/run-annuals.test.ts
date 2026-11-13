import { test, expect } from 'vitest'
import {
  annualQuery, isAnnualOf, annualIssuesInRun, interleaveAnnuals, annualCandidates,
} from '../server/lib/runAnnuals.js'
import type { RunIssue } from '../server/lib/runParts.js'

let nextId = 5000
const at = (number: string, coverDate?: string, over: Partial<RunIssue> = {}): RunIssue =>
  ({ id: nextId++, number, coverDate, ...over })

// Batman (2011) and Batman Annual (2012), with Comic Vine's own cover dates.
const BATMAN = [
  at('9', '2012-07-01'), at('10', '2012-08-24'), at('11', '2012-09-01'),
  at('21', '2013-08-31'), at('22', '2013-09-30'), at('23', '2013-10-01'),
  at('52', '2016-07-31'),
]
const ANNUAL = [
  at('1', '2012-07-31', { annual: true }), at('2', '2013-09-30', { annual: true }),
]

test('the search for a run\'s annuals is its name with "Annual" after it', () => {
  expect(annualQuery('Batman ')).toBe('Batman Annual')
})

test('an annual volume is named as the run plus "Annual", and only that', () => {
  expect(isAnnualOf('Batman', 'Batman Annual')).toBe(true)
  expect(isAnnualOf('Batman', 'Batman Annuals')).toBe(true)
  // Comic Vine writes the article on the run and not always on its annual.
  expect(isAnnualOf('The Amazing Spider-Man', 'Amazing Spider-Man Annual')).toBe(true)
  expect(isAnnualOf('Batman', 'Batman: Bad Seeds Annual')).toBe(false)
  expect(isAnnualOf('Batman', 'Superman/Batman Annual')).toBe(false)
  expect(isAnnualOf('Batman', 'Batman')).toBe(false)
})

test('each annual sits before the first issue of the run dated after it', () => {
  const run = interleaveAnnuals(BATMAN, ANNUAL)
  expect(run.map((i) => `${i.annual ? 'A' : ''}${i.number}`))
    .toEqual(['9', 'A1', '10', '11', '21', '22', 'A2', '23', '52'])
})

// Comic Vine's dates are uneven. A number is a better order for the run than a date, so
// only the annuals are placed by date and the run is never re-sorted around them.
test('the run keeps its number order even where its dates disagree', () => {
  const run = [at('1', '2012-03-01'), at('2', '2012-01-01'), at('3', '2012-05-01')]
  const placed = interleaveAnnuals(run, [at('1', '2012-04-01', { annual: true })])
  expect(placed.map((i) => `${i.annual ? 'A' : ''}${i.number}`)).toEqual(['1', '2', 'A1', '3'])
})

// Batman (2011) #0 sorts first by number but came out in November 2012, during Zero
// Month. An annual from July 2012 belongs after #9, not ahead of #0 at the very front.
test('an issue out of date order at the front of the run does not pull an annual there', () => {
  const run = [at('0', '2012-11-30'), at('1', '2011-11-01'), at('9', '2012-07-01'), at('10', '2012-08-24')]
  const placed = interleaveAnnuals(run, [at('1', '2012-07-31', { annual: true })])
  expect(placed.map((i) => `${i.annual ? 'A' : ''}${i.number}`)).toEqual(['0', '1', '9', 'A1', '10'])
})

test('an annual dated before the whole run opens it', () => {
  const placed = interleaveAnnuals(BATMAN, [at('1', '2011-01-01', { annual: true })])
  expect(placed[0]?.annual).toBe(true)
})

test('an annual dated past the run\'s last issue closes the run', () => {
  const placed = interleaveAnnuals(BATMAN, [at('4', '2016-09-30', { annual: true })])
  expect(placed.at(-1)?.annual).toBe(true)
})

test('a run with no annuals comes back exactly as it went in', () => {
  expect(interleaveAnnuals(BATMAN, [])).toBe(BATMAN)
})

// Comic Vine's own order for "The Amazing Spider-Man Annual". Only a few are read, so
// taken in that order the 2026 annual of The Amazing Spider-Man (2025) was third by luck.
test('the annual volumes nearest the run are tried first', () => {
  const run = [at('1', '2025-06-01'), at('1003', '2027-01-01')]
  const volumes = [2015, 2017, 2026, 1964, 2018, 2023, 2024, 2030].map((startYear) =>
    ({ id: startYear, name: 'Amazing Spider-Man Annual', startYear, publisher: 'Marvel' }))
  volumes.push({ id: 1, name: 'The Amazing Spider-Man Annual', startYear: 2026, publisher: 'Panini' })

  const tried = annualCandidates('The Amazing Spider-Man', 'Marvel', run, volumes)

  // Newest first, none begun after the run had ended, and never another publisher's.
  expect(tried.map((v) => v.id)).toEqual([2026, 2024, 2023, 2018])
})

test('an annual belongs to the run that was out when it was', () => {
  const kept = annualIssuesInRun(BATMAN, [
    at('1', '2012-07-31'),
    // Batman Annual (2016) #1 came out half a year after Batman (2011) ended: the next run's.
    at('1', '2017-01-31'),
    // Batman Annual (1961)'s last, months before Batman (2011) #1.
    at('28', '2011-02-28'),
  ])
  expect(kept.map((i) => i.coverDate)).toEqual(['2012-07-31'])
})

test('a run\'s last annual may trail it by a few months', () => {
  expect(annualIssuesInRun(BATMAN, [at('4', '2016-10-15')])).toHaveLength(1)
})

test('an annual with no cover date cannot be placed and is left out', () => {
  expect(annualIssuesInRun(BATMAN, [at('5')])).toEqual([])
})

test('a run with no dates at all takes no annuals', () => {
  expect(annualIssuesInRun([at('1'), at('2')], [at('1', '2012-07-31')])).toEqual([])
})
