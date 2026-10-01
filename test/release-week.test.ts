import { test, expect } from 'vitest'
import { writeOutDay, writeOutShortDay } from '../src/lib/releaseWeek'

test('a week is written out in full', () => {
  expect(writeOutDay('2026-10-07')).toBe('Wednesday, 7 October 2026')
})

// Every comic ships on a Wednesday, so a list of them spends a word a row saying so. The
// short form is for a column beside the comic, where the date is a footnote.
test('the short form drops the weekday and shortens the month', () => {
  expect(writeOutShortDay('2026-10-07')).toBe('7 Oct 2026')
})

// Same midday-UTC reading as the long form: read locally, a Wednesday becomes the Tuesday
// before it for anyone west of Greenwich.
test('the short form names the same day as the long one', () => {
  expect(writeOutShortDay('2026-01-01')).toBe('1 Jan 2026')
})
