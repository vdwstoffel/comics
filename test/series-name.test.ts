import { test, expect } from 'vitest'
import { deriveSeriesName } from '../server/lib/seriesName.js'

// The first five are the real series names in the library.
const CASES: [name: string, group: string][] = [
  ['Amazing Spider-Man (2025)', 'Amazing Spider-Man'],
  ['Amazing Spider-Man by Nick Spencer Omnibus', 'Amazing Spider-Man'],
  ['Avengers by Jonathan Hickman: The Complete Collection', 'Avengers'],
  ['Batman Vol. 2 (New 52 TPB)', 'Batman'],
  ['Spider-Man By Joe Kelly Omnibus', 'Spider-Man'],
  // a bare series name is its own group
  ['Batman', 'Batman'],
  ['Saga', 'Saga'],
  // edition markers in other shapes
  ['X-Men Vol. 5', 'X-Men'],
  ['X-Men Vol 5', 'X-Men'],
  ['Daredevil (2019)', 'Daredevil'],
  ['Immortal Hulk Omnibus', 'Immortal Hulk'],
  ['Fantastic Four TPB', 'Fantastic Four'],
  ['Y The Last Man: The Complete Collection', 'Y The Last Man'],
  ['Hawkeye by Matt Fraction', 'Hawkeye'],
  // whitespace is normalised
  ['  Doom   Patrol  ', 'Doom Patrol'],
]

test.each(CASES)('%s -> %s', (name, group) => {
  expect(deriveSeriesName(name)).toBe(group)
})

// Stripping must never leave nothing behind, or every such series would collapse
// into one nameless group.
test.each([['Omnibus'], ['(2025)'], ['Vol. 1'], ['by Nick Spencer'], ['   ']])(
  'falls back to the original name for %s',
  (name) => {
    expect(deriveSeriesName(name)).toBe(name.trim() || name)
  },
)

test('a year suffix marks the edition, leaving the series behind it', () => {
  expect(deriveSeriesName('The Amazing Spider-Man (2025)')).toBe('The Amazing Spider-Man')
  expect(deriveSeriesName('Venom (2025)')).toBe('Venom')
})

test('is stable when applied twice', () => {
  for (const [name] of CASES) {
    const once = deriveSeriesName(name)
    expect(deriveSeriesName(once)).toBe(once)
  }
})
