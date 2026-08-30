import { test, expect } from 'vitest'
import { sanitizeEditionFolder } from '../server/lib/paths.js'

test('sanitizeEditionFolder trims and replaces bad chars', () => {
  expect(sanitizeEditionFolder('Spider-Man')).toBe('Spider-Man')
  expect(sanitizeEditionFolder('  Batman  ')).toBe('Batman')
  // Each slash and each .. run both get replaced; ../../evil has 2 slashes + 2 dot-pairs = 4 underscores
  expect(sanitizeEditionFolder('../../evil')).toBe('____evil')
  expect(sanitizeEditionFolder('a/b\\c')).toBe('a_b_c')
  expect(sanitizeEditionFolder('')).toBe('Unsorted')
  expect(sanitizeEditionFolder('   ')).toBe('Unsorted')
})
