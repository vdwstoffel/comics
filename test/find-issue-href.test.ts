import { test, expect } from 'vitest'
import { findIssueHref } from '../src/lib/findIssueHref'

test('searches the index for the series', () => {
  expect(findIssueHref('Amazing Spider-Man')).toBe('/search?q=Amazing+Spider-Man')
})

// Comic Vine's cover date runs ahead of the scraped release year - Venom #251 has a
// 2026-01 cover date but is posted as "Venom #251 (2025)" - so a floor set to the cover
// year exactly would filter out the very row Find exists to surface. Back it off by the
// same one year the matching rule tolerates.
test('the year floor is backed off one year from the cover date', () => {
  expect(findIssueHref('Venom', '2026-01-15')).toBe('/search?q=Venom&yearFrom=2025')
})

test('an issue with no cover date searches without a year floor', () => {
  expect(findIssueHref('Venom', undefined)).toBe('/search?q=Venom')
})

test('a cover date that is not a year is no floor at all', () => {
  expect(findIssueHref('Venom', 'unknown')).toBe('/search?q=Venom')
})
