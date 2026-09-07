import { test, expect } from 'vitest'
import { comicFileName } from '../server/lib/comicFileName.js'

test('a matched comic is named for its series and issue number', () => {
  expect(comicFileName('Venom', '256', '.cbz')).toBe('venom_256.cbz')
})

// Unpadded numbers sort 1, 10, 2 in every file manager there is.
test('issue numbers are padded so they sort in reading order', () => {
  expect(comicFileName('The Amazing Spider-Man', '7', '.cbz')).toBe('the_amazing_spider-man_007.cbz')
  expect(comicFileName('Venom', '1', '.cbz')).toBe('venom_001.cbz')
})

test('a number already wider than the padding keeps its digits', () => {
  expect(comicFileName('Detective Comics', '1000', '.cbz')).toBe('detective_comics_1000.cbz')
})

test('a half issue keeps the part that makes it distinct', () => {
  expect(comicFileName('Amazing Spider-Man', '16.1', '.cbz')).toBe('amazing_spider-man_016.1.cbz')
})

// A series name can carry anything a comic title can — the library holds one with a
// slash in it. None of it may become a path separator or need quoting in a shell.
test('punctuation in a series name cannot become a path or need quoting', () => {
  expect(comicFileName('Amazing Spider-Man/Venom: Death Spiral', '1', '.cbz'))
    .toBe('amazing_spider-man_venom_death_spiral_001.cbz')
})

test('a series of nothing but punctuation still yields a usable name', () => {
  expect(comicFileName('///', '1', '.cbz')).toBe('comic_001.cbz')
})

test('the original extension is kept', () => {
  expect(comicFileName('Venom', '256', '.cbr')).toBe('venom_256.cbr')
})

// Without a number there is nothing to sort by and nothing to distinguish two files.
test('a comic with no issue number has no slug to build', () => {
  expect(comicFileName('Venom', null, '.cbz')).toBeNull()
  expect(comicFileName('', '256', '.cbz')).toBeNull()
})
