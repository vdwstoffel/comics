import { test, expect } from 'vitest'
import { comicFileName } from '../server/lib/comicFileName.js'

test('a matched comic is named for its series and issue number', () => {
  expect(comicFileName('Venom', '256', '.cbz')).toBe('venom_0256.cbz')
})

// Unpadded numbers sort 1, 10, 2 in every file manager there is.
test('issue numbers are padded so they sort in reading order', () => {
  expect(comicFileName('The Amazing Spider-Man', '7', '.cbz')).toBe('the_amazing_spider-man_0007.cbz')
  expect(comicFileName('Venom', '1', '.cbz')).toBe('venom_0001.cbz')
})

test('a number already wider than the padding keeps its digits', () => {
  expect(comicFileName('Detective Comics', '10000', '.cbz')).toBe('detective_comics_10000.cbz')
})

// The padding has one job - making a file manager's A-Z order the reading order - and
// three digits stopped doing it the moment a series reached #1000, which sorts before
// #999. Asserting the ordering rather than the width is what keeps this honest.
test('a series either side of 1000 still sorts in reading order', () => {
  const reading = ['1', '999', '1000', '1001']
  const names = reading.map((n) => comicFileName('Amazing Spider-Man', n, '.cbz')!)
  expect([...names].sort()).toEqual(names)
})

test('a half issue keeps the part that makes it distinct', () => {
  expect(comicFileName('Amazing Spider-Man', '16.1', '.cbz')).toBe('amazing_spider-man_0016.1.cbz')
})

// A series name can carry anything a comic title can — the library holds one with a
// slash in it. None of it may become a path separator or need quoting in a shell.
test('punctuation in a series name cannot become a path or need quoting', () => {
  expect(comicFileName('Amazing Spider-Man/Venom: Death Spiral', '1', '.cbz'))
    .toBe('amazing_spider-man_venom_death_spiral_0001.cbz')
})

// A volume name can carry a subtitle behind a spaced hyphen - Comic Vine files the
// Death Spiral one-shot as "... Death Spiral - Body Count". That hyphen is a separator,
// while the one inside "Spider-Man" is part of the word; both appear here, because
// keeping them apart is the whole point.
test('a spaced hyphen in a series name separates, and one inside a word does not', () => {
  expect(comicFileName('Amazing Spider-Man/Venom: Death Spiral - Body Count', '1', '.cbz'))
    .toBe('amazing_spider-man_venom_death_spiral_body_count_0001.cbz')
})

test('a series of nothing but punctuation still yields a usable name', () => {
  expect(comicFileName('///', '1', '.cbz')).toBe('comic_0001.cbz')
})

test('the original extension is kept', () => {
  expect(comicFileName('Venom', '256', '.cbr')).toBe('venom_0256.cbr')
})

// Without a number there is nothing to sort by and nothing to distinguish two files.
test('a comic with no issue number has no slug to build', () => {
  expect(comicFileName('Venom', null, '.cbz')).toBeNull()
  expect(comicFileName('', '256', '.cbz')).toBeNull()
})
