import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  cacheUpcomingWeek, getCachedUpcomingWeek, getFreshUpcomingWeek, pruneUpcomingBefore,
  UPCOMING_MAX_AGE_MS,
} from '../server/models/upcoming.js'
import type { UpcomingIssue } from '../server/lib/marvelCalendar.js'

const issue = (sourceId: string, headline: string, number: string | null): UpcomingIssue => ({
  sourceId, headline, seriesName: headline.replace(/\s*#.*$/, ''), number,
  releaseDate: '2026-09-30', coverUrl: 'https://cdn.marvel.com/x/a.jpg',
  siteUrl: `https://www.marvel.com/comics/issue/${sourceId}/x`, creators: 'Invented',
})

const ISSUES = [issue('1', 'Invented Alpha #1', '1'), issue('2', 'Invented Beta #3', '3')]

test('a cached week round-trips', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-25T12:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)
  expect(held?.fetchedAt).toBe('2026-09-25T12:00:00.000Z')
  expect(held?.issues).toEqual(ISSUES)
})

// The whole reason upcoming_week is a separate table: a week Marvel has announced nothing
// for still has to record that we asked, or "no rows" and "never asked" are the same
// thing and it refetches forever.
test('an empty week is remembered as asked-and-empty, not as never asked', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-12-02', 'Marvel', [], '2026-09-25T12:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-12-02', 'Marvel', Infinity)
  expect(held).toBeDefined()
  expect(held?.issues).toEqual([])
  expect(getCachedUpcomingWeek(db, '2026-12-09', 'Marvel', Infinity)).toBeUndefined()
})

test('caching a week again replaces what it held', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-25T12:00:00.000Z')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', [ISSUES[0]!], '2026-09-25T13:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)
  expect(held?.issues).toHaveLength(1)
  expect(held?.fetchedAt).toBe('2026-09-25T13:00:00.000Z')
})

// Review Focus 2: Marvel repeating an entry inside one week would collide on the
// composite primary key and abort the insert, losing the ENTIRE week rather than the
// duplicate. Comic Vine did exactly this to the Latest tab - see cacheRelease's comment.
test('a repeated sourceId inside one week does not abort the week', () => {
  const db = openDb(':memory:')
  const dupe = [ISSUES[0]!, ISSUES[1]!, { ...ISSUES[0]!, headline: 'Invented Alpha #1 again' }]
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', dupe, '2026-09-25T12:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)
  expect(held?.issues).toHaveLength(2)
  expect(held?.issues.map((i) => i.sourceId).sort()).toEqual(['1', '2'])
})

// Two publishers must keep their own fetch stamps, or fetching Marvel would mark DC
// fresh and DC would never be read again.
test('each publisher keeps its own week and its own stamp', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-25T12:00:00.000Z')
  cacheUpcomingWeek(db, '2026-09-30', 'DC Comics', [ISSUES[0]!], '2026-09-25T18:00:00.000Z')
  expect(getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)?.issues).toHaveLength(2)
  const dc = getCachedUpcomingWeek(db, '2026-09-30', 'DC Comics', Infinity)
  expect(dc?.issues).toHaveLength(1)
  expect(dc?.fetchedAt).toBe('2026-09-25T18:00:00.000Z')
})

// Review Focus 4: the TTL boundary. Solicitations change, so nothing here is permanent -
// this is the sharpest departure from the Latest tab, where a past day is settled forever.
test('a week is fresh up to the age limit and stale one millisecond past it', () => {
  const db = openDb(':memory:')
  const at = new Date('2026-09-25T12:00:00.000Z')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, at.toISOString())

  const exactly = new Date(at.getTime() + UPCOMING_MAX_AGE_MS)
  expect(getFreshUpcomingWeek(db, '2026-09-30', 'Marvel', exactly)).toBeDefined()

  const past = new Date(at.getTime() + UPCOMING_MAX_AGE_MS + 1)
  expect(getFreshUpcomingWeek(db, '2026-09-30', 'Marvel', past)).toBeUndefined()
})

// A stale week is still readable at any age - whatever we hold beats nothing when Marvel
// is unreachable.
test('a stale week is still there to be read at any age', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-01T12:00:00.000Z')
  const now = new Date('2026-09-25T12:00:00.000Z')
  expect(getFreshUpcomingWeek(db, '2026-09-30', 'Marvel', now)).toBeUndefined()
  expect(getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity, now)?.issues).toHaveLength(2)
})

// Review Focus 6: nothing else ever deletes from these tables, so without pruning they
// grow forever.
test('weeks now in the past are pruned, and future weeks are left alone', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-16', 'Marvel', ISSUES, '2026-09-10T12:00:00.000Z')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-25T12:00:00.000Z')

  pruneUpcomingBefore(db, '2026-09-30')

  expect(getCachedUpcomingWeek(db, '2026-09-16', 'Marvel', Infinity)).toBeUndefined()
  expect(getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)?.issues).toHaveLength(2)
  const rows = db.prepare('SELECT COUNT(*) AS n FROM upcoming_issue').get() as { n: number }
  expect(rows.n).toBe(2)
})

test('a cache read comes back in the one true order, whatever order it went in', () => {
  const db = openDb(':memory:')
  const unsorted = [issue('9', 'Invented Zeta #10', '10'), issue('8', 'Invented Zeta #9', '9')]
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', unsorted, '2026-09-25T12:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)
  expect(held?.issues.map((i) => i.number)).toEqual(['9', '10'])
})
