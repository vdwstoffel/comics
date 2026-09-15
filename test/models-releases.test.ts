import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  cacheRelease, getCachedRelease, getFreshRelease, findReleaseIssue, sortReleaseIssues,
  TODAY_MAX_AGE_MS,
} from '../server/models/releases.js'
import type { ReleaseIssue } from '../server/models/releases.js'

const ISSUES: ReleaseIssue[] = [
  { id: 1192026, number: '14', publisher: 'Marvel', volumeId: 176900, volumeName: 'Black Cat',
    coverDate: '2026-11-01', storeDate: '2026-09-09', coverUrl: 'c1.jpg', siteUrl: 'https://cv/1' },
  { id: 1191941, number: '1102', publisher: 'DC Comics', volumeId: 91078, volumeName: 'Action Comics',
    coverDate: '2026-11-01', storeDate: '2026-09-09', coverUrl: 'c2.jpg', siteUrl: 'https://cv/2' },
]

test('a cached day round-trips', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-14T12:00:00.000Z')
  const held = getCachedRelease(db, '2026-09-09', Infinity)
  expect(held?.fetchedAt).toBe('2026-09-14T12:00:00.000Z')
  expect(held?.issues).toHaveLength(2)
  expect(held?.issues.find((i) => i.id === 1192026)).toEqual(ISSUES[0])
})

// The whole reason release_day is a separate table. Without it a Wednesday with no
// Marvel or DC issues - a normal outcome once you filter to two publishers - is
// indistinguishable from one never fetched, and it refetches forever.
test('a day fetched with nothing returns an empty list, not undefined', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', [], '2026-09-14T12:00:00.000Z')
  const held = getCachedRelease(db, '2026-09-09', Infinity)
  expect(held).toBeDefined()
  expect(held?.issues).toEqual([])
})

test('a day never fetched returns undefined', () => {
  const db = openDb(':memory:')
  expect(getCachedRelease(db, '2026-09-09', Infinity)).toBeUndefined()
})

// A past Wednesday does not change, so the route reads it at Infinity and it is never
// refetched. Today is still filling in, so it expires.
test('maxAgeMs expires a day, and Infinity never does', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-14T00:00:00.000Z')
  const later = new Date('2026-09-14T12:00:00.000Z')
  expect(getCachedRelease(db, '2026-09-09', TODAY_MAX_AGE_MS, later)).toBeUndefined()
  expect(getCachedRelease(db, '2026-09-09', Infinity, later)).toBeDefined()
})

test('refetching a day replaces what was held rather than doubling it', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-14T00:00:00.000Z')
  cacheRelease(db, '2026-09-09', [ISSUES[0]], '2026-09-14T06:00:00.000Z')
  const held = getCachedRelease(db, '2026-09-09', Infinity)
  expect(held?.issues).toHaveLength(1)
  expect(held?.fetchedAt).toBe('2026-09-14T06:00:00.000Z')
})

test('an issue can be found by its Comic Vine id, for the download press', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-14T00:00:00.000Z')
  expect(findReleaseIssue(db, 1192026)?.volumeName).toBe('Black Cat')
  expect(findReleaseIssue(db, 9999999)).toBeUndefined()
})

// --- getFreshRelease: permanence is keyed on WHEN we fetched, not on the day being past.
// Comic Vine carries no future store_dates, so a Wednesday fills in on or after that
// Wednesday: a snapshot taken during the day itself may be a partial one, and treating
// "the day is now in the past" as "the snapshot is final" froze it at UTC midnight.

test('a day fetched during that same day is refetched the next morning', () => {
  const db = openDb(':memory:')
  // Wednesday 20:00: Comic Vine held only some of the day's eventual issues.
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-09T20:00:00.000Z')
  const thursday = new Date('2026-09-10T09:00:00.000Z')
  expect(getFreshRelease(db, '2026-09-09', thursday)).toBeUndefined()
  // Not trusted is not the same as not held: the stale path can still serve it.
  expect(getCachedRelease(db, '2026-09-09', Infinity, thursday)).toBeDefined()
})

test('a day fetched during that same day is still trusted for the next few hours', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-09T20:00:00.000Z')
  expect(getFreshRelease(db, '2026-09-09', new Date('2026-09-09T21:00:00.000Z'))).toBeDefined()
})

test('a day fetched after the day ended is final at any age', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-10T09:00:00.000Z')
  const monthsLater = new Date('2027-01-01T00:00:00.000Z')
  expect(getFreshRelease(db, '2026-09-09', monthsLater)?.issues).toHaveLength(2)
})

// The worse variant of the same bug: an evening fetch that came back with nothing was
// stamped as a genuinely quiet Wednesday, and from the next UTC day the route fell back
// to the week before - for good, with neither `stale` nor `unavailable` to show for it.
test('an empty day fetched during that same day is refetched, not frozen empty', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', [], '2026-09-09T20:00:00.000Z')
  expect(getFreshRelease(db, '2026-09-09', new Date('2026-09-10T09:00:00.000Z'))).toBeUndefined()
})

// An empty day that was fetched after the day ended really is quiet, and must not
// refetch forever - that is what release_day exists for.
test('an empty day fetched after the day ended stays empty rather than refetching', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', [], '2026-09-10T09:00:00.000Z')
  const held = getFreshRelease(db, '2026-09-09', new Date('2026-09-20T09:00:00.000Z'))
  expect(held).toBeDefined()
  expect(held?.issues).toEqual([])
})

test('a day never fetched is not fresh either', () => {
  const db = openDb(':memory:')
  expect(getFreshRelease(db, '2026-09-09', new Date('2026-09-14T12:00:00.000Z'))).toBeUndefined()
})

// Comic Vine has been known to repeat an id across pages. cacheRelease already had to
// defend against it (the primary key would reject the second row and abort the day), so
// the cached path was silently deduped while a cold response rendered the id twice.
// Deduping in sortReleaseIssues is what gives both paths the same defence.
test('sortReleaseIssues drops a repeated id, keeping the first', () => {
  const twice = [ISSUES[0], ISSUES[1], { ...ISSUES[0], number: 'wrong' }]
  const sorted = sortReleaseIssues(twice)
  expect(sorted.map((i) => i.id)).toEqual([1191941, 1192026])
  expect(sorted.find((i) => i.id === 1192026)?.number).toBe('14')
})
