import { test, expect } from 'vitest'
import { matchIssue } from '../server/lib/issueMatch.js'
import type { IndexCandidate } from '../server/lib/issueMatch.js'

/** A scraped index row, with only the fields the rule reads. */
function row(id: number, title: string, number: string | null, year: number | null): IndexCandidate {
  return { id, title, number, year }
}

const VENOM_250 = row(1, 'Venom #250 (2025)', '250', 2025)

test('one candidate that satisfies every condition is the match', () => {
  const hit = matchIssue([VENOM_250], { seriesKey: 'venom', number: '250', coverYear: 2025 })
  expect(hit?.id).toBe(1)
})

test('no candidate at all is no match', () => {
  expect(matchIssue([], { seriesKey: 'venom', number: '250', coverYear: 2025 })).toBeNull()
})

// Comic Vine cover dates run ahead of the release the scraper sees: Venom #251 has a
// 2026-01 cover date and is listed as "Venom #251 (2025)".
test('a scraped year one behind the cover year still matches', () => {
  const hit = matchIssue([row(1, 'Venom #251 (2025)', '251', 2025)], { seriesKey: 'venom', number: '251', coverYear: 2026 })
  expect(hit?.id).toBe(1)
})

test('a scraped year one ahead of the cover year still matches', () => {
  const hit = matchIssue([row(1, 'Venom #251 (2026)', '251', 2026)], { seriesKey: 'venom', number: '251', coverYear: 2025 })
  expect(hit?.id).toBe(1)
})

test('two years apart is too far to be the same issue', () => {
  expect(matchIssue([row(1, 'Venom #251 (2023)', '251', 2023)], { seriesKey: 'venom', number: '251', coverYear: 2025 })).toBeNull()
})

// The whole safety property: the real two-candidate case from the index.
test('two candidates within the window are no match, not a guess', () => {
  const hits = matchIssue(
    [row(1, 'Venom #3 (2017)', '003', 2017), row(2, 'Venom #3 (2018)', '003', 2018)],
    { seriesKey: 'venom', number: '003', coverYear: 2017 },
  )
  expect(hits).toBeNull()
})

test('a different series with the same number does not match', () => {
  expect(matchIssue([row(1, 'All-New Venom #1 (2025)', '001', 2025)], { seriesKey: 'venom', number: '001', coverYear: 2025 })).toBeNull()
})

test('a leading "The" does not separate a series from itself', () => {
  const hit = matchIssue([row(1, 'The Mighty Thor #700 (2017)', '700', 2017)], { seriesKey: 'mighty thor', number: '700', coverYear: 2017 })
  expect(hit?.id).toBe(1)
})

// A post holding #1-85 is not issue #1, however its number parses.
test('a bundle of many issues does not match a single issue', () => {
  expect(matchIssue([row(1, 'Venom #1 – 85 (2025)', '001', 2025)], { seriesKey: 'venom', number: '001', coverYear: 2025 })).toBeNull()
})

test('a collected edition does not match a single issue', () => {
  expect(matchIssue([row(1, 'Venom Vol. 1 (TPB) (2025)', '001', 2025)], { seriesKey: 'venom', number: '001', coverYear: 2025 })).toBeNull()
})

test('a row with no year can never be matched', () => {
  expect(matchIssue([row(1, 'Venom #250 (2025)', '250', null)], { seriesKey: 'venom', number: '250', coverYear: 2025 })).toBeNull()
})

test('an issue with no cover year can never be matched', () => {
  expect(matchIssue([VENOM_250], { seriesKey: 'venom', number: '250', coverYear: null })).toBeNull()
})

test('a row with no number can never be matched', () => {
  expect(matchIssue([row(1, 'Venom (2025)', null, 2025)], { seriesKey: 'venom', number: '250', coverYear: 2025 })).toBeNull()
})

test('the one match is found among candidates that do not qualify', () => {
  const hit = matchIssue(
    [
      row(2, 'All-New Venom #250 (2025)', '250', 2025),   // wrong series
      VENOM_250,                                           // id 1, the answer
      row(3, 'Venom #250 – 261 (2025)', '250', 2025),      // a bundle, not one issue
    ],
    { seriesKey: 'venom', number: '250', coverYear: 2025 },
  )
  expect(hit?.id).toBe(1)
  expect(hit?.title).toBe('Venom #250 (2025)')
})
