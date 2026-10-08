import { test, expect } from 'vitest'
import { labelForPath } from '../src/lib/backOrigin'

test('the home shelf is the Library', () => {
  expect(labelForPath('/')).toBe('Library')
})

test('the follows shelf names itself', () => {
  expect(labelForPath('/following')).toBe('Following')
})

test('a series is named by the series', () => {
  expect(labelForPath('/series/The%20Amazing%20Spider-Man')).toBe('The Amazing Spider-Man')
})

// The annuals url is a series url with a tail, so a looser rule matches it first and
// names the page after the run it hangs off - which is a different page.
test('a series annuals page is not mistaken for the series', () => {
  expect(labelForPath('/series/The%20Amazing%20Spider-Man/annuals'))
    .toBe('The Amazing Spider-Man annuals')
})

test('the arcs shelf and a single arc are told apart', () => {
  expect(labelForPath('/arcs')).toBe('All story arcs')
  expect(labelForPath('/arcs/Death%20Spiral')).toBe('Death Spiral')
})

// A run's name lives in its data, never in its url, so the route cannot answer for one.
// The caller passes it instead; what matters here is that the guess is not a wrong name.
test('a page the route cannot name falls back to the Library', () => {
  expect(labelForPath('/edition/9')).toBe('Library')
})
