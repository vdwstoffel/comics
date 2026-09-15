import { test, expect } from 'vitest'
import { mostRecentWednesday, previousWednesday } from '../server/lib/releaseDay.js'

// New comic day is Wednesday, so every day of a week resolves to the same one.
test('every day of the week resolves to that week Wednesday', () => {
  const week = {
    '2026-09-09': '2026-09-09', // Wed - itself
    '2026-09-10': '2026-09-09', // Thu
    '2026-09-11': '2026-09-09', // Fri
    '2026-09-12': '2026-09-09', // Sat
    '2026-09-13': '2026-09-09', // Sun
    '2026-09-14': '2026-09-09', // Mon
    '2026-09-15': '2026-09-09', // Tue
    '2026-09-16': '2026-09-16', // Wed again - the next one
  }
  for (const [today, expected] of Object.entries(week)) {
    expect(mostRecentWednesday(new Date(`${today}T12:00:00Z`))).toBe(expected)
  }
})

// A local timezone behind UTC would otherwise read the instant as the previous day.
test('the day is read in UTC, not the local timezone', () => {
  expect(mostRecentWednesday(new Date('2026-09-09T00:30:00Z'))).toBe('2026-09-09')
  expect(mostRecentWednesday(new Date('2026-09-09T23:30:00Z'))).toBe('2026-09-09')
})

test('the Wednesday before crosses a month boundary', () => {
  expect(mostRecentWednesday(new Date('2026-10-02T12:00:00Z'))).toBe('2026-09-30')
})

test('the Wednesday before crosses a year boundary', () => {
  expect(mostRecentWednesday(new Date('2027-01-01T12:00:00Z'))).toBe('2026-12-30')
})

test('previousWednesday steps back exactly one week', () => {
  expect(previousWednesday('2026-09-09')).toBe('2026-09-02')
  expect(previousWednesday('2026-01-06')).toBe('2025-12-30')
})
