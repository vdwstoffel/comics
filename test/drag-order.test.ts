import { test, expect } from 'vitest'
import { dropIndex } from '../src/lib/dragOrder'

// Four rows, 40px each, starting at y=100.
const TOPS = [100, 140, 180, 220]
const H = 40

test('a pointer inside a row lands on that row', () => {
  expect(dropIndex(110, TOPS, H)).toBe(0)
  expect(dropIndex(150, TOPS, H)).toBe(1)
  expect(dropIndex(230, TOPS, H)).toBe(3)
})

test('above the first row lands on the first, below the last on the last', () => {
  expect(dropIndex(0, TOPS, H)).toBe(0)
  expect(dropIndex(-500, TOPS, H)).toBe(0)
  expect(dropIndex(9999, TOPS, H)).toBe(3)
})

// A boundary belongs to the row below it, so a slow drag moves exactly one place.
test('exactly on a boundary lands on the lower row', () => {
  expect(dropIndex(140, TOPS, H)).toBe(1)
  expect(dropIndex(180, TOPS, H)).toBe(2)
})

test('a single-item list has only one answer', () => {
  expect(dropIndex(-10, [100], H)).toBe(0)
  expect(dropIndex(10_000, [100], H)).toBe(0)
})

test('an empty list yields zero rather than a negative index', () => {
  expect(dropIndex(50, [], H)).toBe(0)
})

// What the stylesheet actually ships: 56px rows with an 8px gap, so consecutive tops are
// 64 apart while each row's HEIGHT is 56. Dividing the offset by the height drifts by a
// whole row a few rows down - y=330 is inside row 3 (292-348), but floor((330-100)/56) is
// 4. The PITCH between rows is what decides which row a pointer is in, and it is the only
// one of the two that no stylesheet change can invalidate.
const GAPPED = [100, 164, 228, 292, 356]
const ROW_H = 56

test('rows with a gap between them are found by their pitch, not their height', () => {
  expect(dropIndex(130, GAPPED, ROW_H)).toBe(0)
  expect(dropIndex(194, GAPPED, ROW_H)).toBe(1)
  expect(dropIndex(258, GAPPED, ROW_H)).toBe(2)
  expect(dropIndex(330, GAPPED, ROW_H)).toBe(3)
  expect(dropIndex(380, GAPPED, ROW_H)).toBe(4)
})

// Every row reporting the same top is a measurement that tells us nothing - a list that is
// not laid out yet, or jsdom, where every rect is zero. There is no right answer, but
// there is a wrong one: NaN is committed as a move to a null index.
test('a measurement that says nothing still yields an index in range', () => {
  const flat = [100, 100, 100]
  expect(Number.isInteger(dropIndex(250, flat, 0))).toBe(true)
  expect(dropIndex(250, flat, 0)).toBeGreaterThanOrEqual(0)
  expect(dropIndex(250, flat, 0)).toBeLessThanOrEqual(2)
})
