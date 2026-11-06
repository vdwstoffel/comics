import { test, expect } from 'vitest'
import { formatBytes } from '../src/lib/bytes'

test('a size is given in the largest unit it fills', () => {
  expect(formatBytes(512)).toBe('512 B')
  expect(formatBytes(16_000_000)).toBe('16 MB')
  expect(formatBytes(40_000_000_000)).toBe('40 GB')
  expect(formatBytes(1_200_000_000_000)).toBe('1.2 TB')
})

// "4 GB" and "4.9 GB" are nearly a gigabyte apart, which matters when the question is
// whether the next download fits. Past ten of a unit that precision is noise.
test('a small number of a big unit keeps a decimal', () => {
  expect(formatBytes(4_500_000_000)).toBe('4.5 GB')
  expect(formatBytes(45_000_000_000)).toBe('45 GB')
})

test('an empty folder reads as nothing rather than blank', () => {
  expect(formatBytes(0)).toBe('0 B')
})

// tmp is normally empty and thumbnails are small; neither should ever read as "0.0 KB".
test('bytes are whole', () => {
  expect(formatBytes(1)).toBe('1 B')
  expect(formatBytes(999)).toBe('999 B')
})
