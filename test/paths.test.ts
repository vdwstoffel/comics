import { test, expect } from 'vitest'
import { sanitizeSeriesFolder } from '../server/lib/paths.js'

test('sanitizeSeriesFolder trims and replaces bad chars', () => {
  expect(sanitizeSeriesFolder('Spider-Man')).toBe('Spider-Man')
  expect(sanitizeSeriesFolder('  Batman  ')).toBe('Batman')
  // Each slash and each .. run both get replaced; ../../evil has 2 slashes + 2 dot-pairs = 4 underscores
  expect(sanitizeSeriesFolder('../../evil')).toBe('____evil')
  expect(sanitizeSeriesFolder('a/b\\c')).toBe('a_b_c')
  expect(sanitizeSeriesFolder('')).toBe('Unsorted')
  expect(sanitizeSeriesFolder('   ')).toBe('Unsorted')
})
