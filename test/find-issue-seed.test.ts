import { test, expect } from 'vitest'
import { findIssueSeed, searchHref } from '../src/lib/findIssueSeed'

test('searches the index for the series', () => {
  expect(findIssueSeed('Amazing Spider-Man')).toEqual({ q: 'Amazing Spider-Man' })
})

// Comic Vine's cover date runs ahead of the scraped release year - Venom #251 has a
// 2026-01 cover date but is posted as "Venom #251 (2025)" - so a floor set to the cover
// year exactly would filter out the very row Find exists to surface. Back it off by the
// same one year the matching rule tolerates.
test('the year floor is backed off one year from the cover date', () => {
  expect(findIssueSeed('Venom', '2026-01-15')).toEqual({ q: 'Venom', yearFrom: 2025 })
})

test('an issue with no cover date searches without a year floor', () => {
  expect(findIssueSeed('Venom', undefined)).toEqual({ q: 'Venom' })
})

test('a cover date that is not a year is no floor at all', () => {
  expect(findIssueSeed('Venom', 'unknown')).toEqual({ q: 'Venom' })
})

// The issue number is not in the seed: the index is searched with FTS prefix tokens, so
// "Venom 251" would AND in `"251"*` - which is not the filter it looks like.
test('the issue number never reaches the query', () => {
  expect(findIssueSeed('Venom', '2026-01-15').q).toBe('Venom')
})

test('the seed serialises to the search page url', () => {
  expect(searchHref({ q: 'Amazing Spider-Man' })).toBe('/search?q=Amazing+Spider-Man')
  expect(searchHref({ q: 'Venom', yearFrom: 2025 })).toBe('/search?q=Venom&yearFrom=2025')
})
