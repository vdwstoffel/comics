import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { cacheVolumeIssues, getCachedVolumeIssues } from '../server/models/volumeIssues.js'

const DAY = 24 * 60 * 60 * 1000

// Venom (2025) as Comic Vine lists it: legacy numbering, #250 up.
const ISSUES = [
  { id: 1136140, number: '250', name: 'Naked and Afraid', coverDate: '2025-12-01', siteUrl: 'https://cv/250' },
  { id: 1143327, number: '251', coverDate: '2026-01-01', siteUrl: 'https://cv/251' },
]

test('a cached volume comes back with its issues and the time it was read', () => {
  const db = openDb(':memory:')
  cacheVolumeIssues(db, 167333, ISSUES, '2026-09-04T10:00:00.000Z')

  const cached = getCachedVolumeIssues(db, 167333, DAY, new Date('2026-09-04T11:00:00.000Z'))

  expect(cached?.fetchedAt).toBe('2026-09-04T10:00:00.000Z')
  expect(cached?.issues).toEqual(ISSUES)
  db.close()
})

test('a volume nobody has read has no cache', () => {
  const db = openDb(':memory:')
  expect(getCachedVolumeIssues(db, 999, DAY, new Date())).toBeUndefined()
  db.close()
})

// Re-reading a running volume must replace its list, not pile a second copy on top.
test('caching a volume again replaces the issues it had', () => {
  const db = openDb(':memory:')
  cacheVolumeIssues(db, 167333, ISSUES, '2026-09-04T10:00:00.000Z')
  cacheVolumeIssues(db, 167333, [...ISSUES, { id: 1146711, number: '252' }], '2026-09-05T10:00:00.000Z')

  const cached = getCachedVolumeIssues(db, 167333, DAY, new Date('2026-09-05T11:00:00.000Z'))

  expect(cached?.issues.map((i) => i.number)).toEqual(['250', '251', '252'])
  expect(cached?.fetchedAt).toBe('2026-09-05T10:00:00.000Z')
  db.close()
})

test('a cache older than the max age counts as no cache', () => {
  const db = openDb(':memory:')
  cacheVolumeIssues(db, 167333, ISSUES, '2026-09-04T10:00:00.000Z')

  const fresh = getCachedVolumeIssues(db, 167333, DAY, new Date('2026-09-05T09:59:00.000Z'))
  const stale = getCachedVolumeIssues(db, 167333, DAY, new Date('2026-09-05T10:00:01.000Z'))

  expect(fresh?.issues).toHaveLength(2)
  expect(stale).toBeUndefined()
  db.close()
})

// Without this, a volume Comic Vine lists nothing for would be refetched on every view
// forever, because "no rows" and "never asked" would look identical.
test('a volume with no issues still records that we asked', () => {
  const db = openDb(':memory:')
  cacheVolumeIssues(db, 555, [], '2026-09-04T10:00:00.000Z')

  const cached = getCachedVolumeIssues(db, 555, DAY, new Date('2026-09-04T11:00:00.000Z'))

  expect(cached).toBeDefined()
  expect(cached?.issues).toEqual([])
  db.close()
})

// Stale is still better than nothing when Comic Vine will not answer, so the raw read
// has to be reachable without the age rule.
test('a stale cache can still be read when asked for at any age', () => {
  const db = openDb(':memory:')
  cacheVolumeIssues(db, 167333, ISSUES, '2020-01-01T00:00:00.000Z')

  const cached = getCachedVolumeIssues(db, 167333, Infinity, new Date())

  expect(cached?.issues).toHaveLength(2)
  expect(cached?.fetchedAt).toBe('2020-01-01T00:00:00.000Z')
  db.close()
})

test('issues come back in issue-number order, not insertion order', () => {
  const db = openDb(':memory:')
  cacheVolumeIssues(db, 1, [
    { id: 3, number: '10' }, { id: 1, number: '1' }, { id: 2, number: '2' },
  ], '2026-09-04T10:00:00.000Z')

  const cached = getCachedVolumeIssues(db, 1, DAY, new Date('2026-09-04T11:00:00.000Z'))

  expect(cached?.issues.map((i) => i.number)).toEqual(['1', '2', '10'])
  db.close()
})
