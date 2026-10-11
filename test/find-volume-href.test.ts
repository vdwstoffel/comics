import { test, expect } from 'vitest'
import { findVolumeHref } from '../src/lib/findVolumeHref'

// A volume knows where it started and not where it ended, so the window is drawn around
// the launch - the part of a run you go looking for first.
test('searches the year the volume launched, give or take one', () => {
  expect(findVolumeHref('The Amazing Spider-Man', 1963))
    .toBe('/search?q=The+Amazing+Spider-Man&yearFrom=1962&yearTo=1964')
})

test('a volume with no start year searches without a window', () => {
  expect(findVolumeHref('The Amazing Spider-Man', undefined))
    .toBe('/search?q=The+Amazing+Spider-Man')
})

test('a start year that is not a year is no window at all', () => {
  expect(findVolumeHref('Venom', Number.NaN)).toBe('/search?q=Venom')
})
