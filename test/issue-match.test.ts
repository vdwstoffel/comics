import { test, expect } from 'vitest'
import { matchIssue, releaseYears } from '../server/lib/issueMatch.js'
import type { IndexCandidate } from '../server/lib/issueMatch.js'

/** A scraped index row, with only the fields the rule reads. */
function row(id: number, title: string, number: string | null, year: number | null): IndexCandidate {
  return { id, title, number, year }
}

const VENOM_250 = row(1, 'Venom #250 (2025)', '250', 2025)

test('one candidate that satisfies every condition is the match', () => {
  const hit = matchIssue([VENOM_250], { matchKey: 'venom', number: '250', coverDate: '2025-06-01' })
  expect(hit?.id).toBe(1)
})

test('no candidate at all is no match', () => {
  expect(matchIssue([], { matchKey: 'venom', number: '250', coverDate: '2025-06-01' })).toBeNull()
})

// Comic Vine cover dates run ahead of the release the scraper sees: Venom #251 has a
// 2026-01 cover date and is listed as "Venom #251 (2025)".
test('an early-year cover may be posted under the year before', () => {
  const hit = matchIssue([row(1, 'Venom #251 (2025)', '251', 2025)], { matchKey: 'venom', number: '251', coverDate: '2026-01-01' })
  expect(hit?.id).toBe(1)
})

test('a March cover may still be posted under the year before', () => {
  const hit = matchIssue([row(1, 'Venom #253 (2025)', '253', 2025)], { matchKey: 'venom', number: '253', coverDate: '2026-03-01' })
  expect(hit?.id).toBe(1)
})

// A June cover was on sale in spring at the earliest, so a post from the year before
// is some other comic: Iron Man #4 (2026) is not the 2024 run's "Iron Man #4 (2025)".
test('a later cover is never posted under the year before', () => {
  expect(matchIssue([row(1, 'Iron Man #4 (2025)', '004', 2025)], { matchKey: 'iron man', number: '004', coverDate: '2026-06-01' })).toBeNull()
})

test('a relaunch is told apart from the run before it with the same name', () => {
  const hit = matchIssue(
    [row(1, 'Iron Man #4 (2025)', '004', 2025), row(2, 'Iron Man #4 (2026)', '004', 2026)],
    { matchKey: 'iron man', number: '004', coverDate: '2026-06-01' },
  )
  expect(hit?.id).toBe(2)
})

// Release runs ahead of the cover date, never behind it. Every year-ahead match in the
// library was a different series: "Batman #6 (2016)" for a 2015-04 cover.
test('a scraped year ahead of the cover year does not match', () => {
  expect(matchIssue([row(1, 'Batman #6 (2016)', '006', 2016)], { matchKey: 'batman', number: '006', coverDate: '2015-04-30' })).toBeNull()
})

test('two years apart is too far to be the same issue', () => {
  expect(matchIssue([row(1, 'Venom #251 (2023)', '251', 2023)], { matchKey: 'venom', number: '251', coverDate: '2025-02-01' })).toBeNull()
})

test('a cover date with no month allows the year before', () => {
  expect(releaseYears('2026')).toEqual({ from: 2025, to: 2026 })
})

test('no cover date gives no window', () => {
  expect(releaseYears(null)).toBeNull()
  expect(releaseYears('soon')).toBeNull()
})

// The whole safety property: the real two-candidate case from the index.
test('two candidates within the window are no match, not a guess', () => {
  const hits = matchIssue(
    [row(1, 'Venom #3 (2017)', '003', 2017), row(2, 'Venom #3 (2018)', '003', 2018)],
    { matchKey: 'venom', number: '003', coverDate: '2018-02-01' },
  )
  expect(hits).toBeNull()
})

test('a different series with the same number does not match', () => {
  expect(matchIssue([row(1, 'All-New Venom #1 (2025)', '001', 2025)], { matchKey: 'venom', number: '001', coverDate: '2025-06-01' })).toBeNull()
})

test('a leading "The" does not separate a series from itself', () => {
  const hit = matchIssue([row(1, 'The Mighty Thor #700 (2017)', '700', 2017)], { matchKey: 'mighty thor', number: '700', coverDate: '2017-06-01' })
  expect(hit?.id).toBe(1)
})

// A post holding #1-85 is not issue #1, however its number parses.
test('a bundle of many issues does not match a single issue', () => {
  expect(matchIssue([row(1, 'Venom #1 – 85 (2025)', '001', 2025)], { matchKey: 'venom', number: '001', coverDate: '2025-06-01' })).toBeNull()
})

test('a collected edition does not match a single issue', () => {
  expect(matchIssue([row(1, 'Venom Vol. 1 (TPB) (2025)', '001', 2025)], { matchKey: 'venom', number: '001', coverDate: '2025-06-01' })).toBeNull()
})

test('a row with no year can never be matched', () => {
  expect(matchIssue([row(1, 'Venom #250 (2025)', '250', null)], { matchKey: 'venom', number: '250', coverDate: '2025-06-01' })).toBeNull()
})

test('an issue with no cover year can never be matched', () => {
  expect(matchIssue([VENOM_250], { matchKey: 'venom', number: '250', coverDate: null })).toBeNull()
})

test('a row with no number can never be matched', () => {
  expect(matchIssue([row(1, 'Venom (2025)', null, 2025)], { matchKey: 'venom', number: '250', coverDate: '2025-06-01' })).toBeNull()
})

test('the one match is found among candidates that do not qualify', () => {
  const hit = matchIssue(
    [
      row(2, 'All-New Venom #250 (2025)', '250', 2025),   // wrong series
      VENOM_250,                                           // id 1, the answer
      row(3, 'Venom #250 – 261 (2025)', '250', 2025),      // a bundle, not one issue
    ],
    { matchKey: 'venom', number: '250', coverDate: '2025-06-01' },
  )
  expect(hit?.id).toBe(1)
  expect(hit?.title).toBe('Venom #250 (2025)')
})
