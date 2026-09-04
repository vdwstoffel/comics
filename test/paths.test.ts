import { test, expect } from 'vitest'
import { sanitizeEditionFolder, editionFolderPath } from '../server/lib/paths.js'

test('sanitizeEditionFolder trims and replaces bad chars', () => {
  expect(sanitizeEditionFolder('Spider-Man')).toBe('Spider-Man')
  expect(sanitizeEditionFolder('  Batman  ')).toBe('Batman')
  // Each slash and each .. run both get replaced; ../../evil has 2 slashes + 2 dot-pairs = 4 underscores
  expect(sanitizeEditionFolder('../../evil')).toBe('____evil')
  expect(sanitizeEditionFolder('a/b\\c')).toBe('a_b_c')
  expect(sanitizeEditionFolder('')).toBe('Unsorted')
  expect(sanitizeEditionFolder('   ')).toBe('Unsorted')
})

test('an edition folder nests under its series', () => {
  expect(editionFolderPath('The Amazing Spider-Man', 'The Amazing Spider-Man (2025)'))
    .toBe('The Amazing Spider-Man/The Amazing Spider-Man (2025)')
})

test('an edition with no series stays at the top level', () => {
  expect(editionFolderPath(null, 'Unsorted')).toBe('Unsorted')
  expect(editionFolderPath('   ', 'Unsorted')).toBe('Unsorted')
})

// deriveSeriesName returns a plain name unchanged, so most existing editions have a
// series equal to their own name. Nesting those would give Unsorted/Unsorted and
// Batman/Batman - a level that says nothing. A level is added only when the series is
// genuinely distinct from the edition.
test('a series identical to the edition name adds no level', () => {
  expect(editionFolderPath('Unsorted', 'Unsorted')).toBe('Unsorted')
  expect(editionFolderPath('Batman', 'Batman')).toBe('Batman')
})

// A series name may itself contain a slash - the library has "Amazing Spider-Man/Venom".
// It must stay one folder, not become a nesting level.
test('a slash inside a series name does not create a folder level', () => {
  expect(editionFolderPath('Amazing Spider-Man/Venom', 'Amazing Spider-Man/Venom (2025)'))
    .toBe('Amazing Spider-Man_Venom/Amazing Spider-Man_Venom (2025)')
})

test('a traversal attempt survives as a literal segment', () => {
  // sanitize('..') -> '_'; sanitize('../etc') -> '.._etc' -> '__etc'
  expect(editionFolderPath('..', '../etc')).toBe('_/__etc')
})
