import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { cacheArc, getCachedArc, findArcIssue } from '../server/models/arcCache.js'
import type { CvStoryArc } from '../server/lib/comicvine.js'

const DAY = 24 * 60 * 60 * 1000

// "Avengers" Armageddon as Comic Vine lists it, already in the running order
// getStoryArc sorted it into.
const ARC: CvStoryArc = {
  id: 61350,
  name: '"Avengers" Armageddon',
  deck: 'Everything hurtles toward Armageddon.',
  publisher: 'Marvel',
  siteUrl: 'https://cv/arc/61350',
  issues: [
    { id: 1150001, number: '11', volumeName: 'Captain America', coverDate: '2026-07-01', storeDate: '2026-05-13', siteUrl: 'https://cv/11' },
    { id: 1150002, number: '12', name: "Hell's Angel, Part 1", volumeName: 'Captain America', coverDate: '2026-08-01', storeDate: '2026-06-10', siteUrl: 'https://cv/12' },
    { id: 1150003, number: '13', volumeName: 'Captain America', coverDate: '2026-09-01', storeDate: '2026-07-08', siteUrl: 'https://cv/13' },
  ],
}

test('a cached arc comes back with its issues and the time it was read', () => {
  const db = openDb(':memory:')
  cacheArc(db, 61350, ARC, '2026-09-04T10:00:00.000Z')

  const cached = getCachedArc(db, 61350, DAY, new Date('2026-09-04T11:00:00.000Z'))

  expect(cached?.fetchedAt).toBe('2026-09-04T10:00:00.000Z')
  expect(cached?.arc).toEqual(ARC)
  db.close()
})

test('an arc nobody has read has no cache', () => {
  const db = openDb(':memory:')
  expect(getCachedArc(db, 999, DAY, new Date())).toBeUndefined()
  db.close()
})

// The running order is computed from dates when the arc is fetched. Storing the resolved
// position is the whole point: reading it back must not re-derive or reshuffle it.
test('a cached arc keeps the running order it was stored in', () => {
  const db = openDb(':memory:')
  // Stored deliberately out of id order, so id order and running order disagree.
  const reordered: CvStoryArc = {
    ...ARC,
    issues: [ARC.issues[2], ARC.issues[0], ARC.issues[1]],
  }
  cacheArc(db, 61350, reordered, '2026-09-04T10:00:00.000Z')

  const cached = getCachedArc(db, 61350, DAY, new Date('2026-09-04T11:00:00.000Z'))

  expect(cached?.arc.issues.map((i) => i.number)).toEqual(['13', '11', '12'])
  db.close()
})

// An arc that is still running gains issues, and a new one can land in the MIDDLE of the
// run. Rewriting the whole list is what keeps the positions after it correct.
test('caching an arc again replaces the issues it had, renumbering the run', () => {
  const db = openDb(':memory:')
  cacheArc(db, 61350, ARC, '2026-09-04T10:00:00.000Z')

  const inserted = { id: 1150004, number: '1', volumeName: 'Armageddon Prelude', coverDate: '2026-07-15', storeDate: '2026-05-27' }
  cacheArc(
    db,
    61350,
    { ...ARC, issues: [ARC.issues[0], inserted, ARC.issues[1], ARC.issues[2]] },
    '2026-09-05T10:00:00.000Z',
  )

  const cached = getCachedArc(db, 61350, DAY, new Date('2026-09-05T11:00:00.000Z'))

  expect(cached?.arc.issues.map((i) => i.id)).toEqual([1150001, 1150004, 1150002, 1150003])
  expect(cached?.fetchedAt).toBe('2026-09-05T10:00:00.000Z')
  db.close()
})

test('a cache older than the max age counts as no cache', () => {
  const db = openDb(':memory:')
  cacheArc(db, 61350, ARC, '2026-09-04T10:00:00.000Z')

  const fresh = getCachedArc(db, 61350, DAY, new Date('2026-09-05T09:59:00.000Z'))
  const stale = getCachedArc(db, 61350, DAY, new Date('2026-09-05T10:00:01.000Z'))

  expect(fresh?.arc.issues).toHaveLength(3)
  expect(stale).toBeUndefined()
  db.close()
})

// Serving a stale list beats serving nothing when Comic Vine will not answer.
test('an aged-out arc is still readable at any age', () => {
  const db = openDb(':memory:')
  cacheArc(db, 61350, ARC, '2026-01-01T10:00:00.000Z')

  const cached = getCachedArc(db, 61350, Infinity, new Date('2026-09-05T10:00:00.000Z'))

  expect(cached?.arc.issues).toHaveLength(3)
  expect(cached?.fetchedAt).toBe('2026-01-01T10:00:00.000Z')
  db.close()
})

// Without this, an arc Comic Vine lists nothing for would be refetched on every view
// forever, because "no rows" and "never asked" would look identical.
test('an arc with no issues still records that we asked', () => {
  const db = openDb(':memory:')
  cacheArc(db, 555, { id: 555, name: 'Empty', issues: [] }, '2026-09-04T10:00:00.000Z')

  const cached = getCachedArc(db, 555, DAY, new Date('2026-09-04T11:00:00.000Z'))

  expect(cached?.arc.issues).toEqual([])
  db.close()
})

// The volume an arc issue belongs to is what decides where a download of it lands, and an
// arc spans many volumes - the one it is named for plus every tie-in. Comic Vine's id for
// that volume is the only thing that identifies it; a name cannot tell two relaunches of
// "Captain America" apart.
test('a cached arc issue keeps the id of the volume it belongs to', () => {
  const db = openDb(':memory:')
  cacheArc(db, 61350, {
    ...ARC,
    issues: [{ ...ARC.issues[0], volumeId: 141487 }],
  }, '2026-09-04T10:00:00.000Z')

  const cached = getCachedArc(db, 61350, DAY, new Date('2026-09-04T11:00:00.000Z'))

  expect(cached?.arc.issues[0].volumeId).toBe(141487)
  db.close()
})

// Arcs cached before the column existed carry no volume id, and must still read back.
test('an arc issue with no volume id reads back without one', () => {
  const db = openDb(':memory:')
  cacheArc(db, 61350, ARC, '2026-09-04T10:00:00.000Z')

  const cached = getCachedArc(db, 61350, DAY, new Date('2026-09-04T11:00:00.000Z'))

  expect(cached?.arc.issues[0]).not.toHaveProperty('volumeId')
  db.close()
})

// The download route is handed a Comic Vine issue id and nothing else: the press came from
// a tile, which knows the issue but not which arc page it was drawn on.
test('a cached arc issue can be found by its Comic Vine id alone', () => {
  const db = openDb(':memory:')
  cacheArc(db, 61350, {
    ...ARC,
    issues: [{ ...ARC.issues[1], volumeId: 141487 }],
  }, '2026-09-04T10:00:00.000Z')

  const found = findArcIssue(db, 1150002)

  expect(found).toEqual({
    id: 1150002,
    number: '12',
    name: "Hell's Angel, Part 1",
    volumeName: 'Captain America',
    volumeId: 141487,
    coverDate: '2026-08-01',
    storeDate: '2026-06-10',
    siteUrl: 'https://cv/12',
  })
  db.close()
})

test('an issue in no cached arc is not found', () => {
  const db = openDb(':memory:')
  cacheArc(db, 61350, ARC, '2026-09-04T10:00:00.000Z')

  expect(findArcIssue(db, 999999)).toBeUndefined()
  db.close()
})

// An issue is found however old the arc holding it is: the press follows a page view, and
// that view is what filled the cache - refusing on age would refuse the button it drew.
test('an issue in an aged-out arc is still found', () => {
  const db = openDb(':memory:')
  cacheArc(db, 61350, ARC, '2025-01-01T10:00:00.000Z')

  expect(findArcIssue(db, 1150001)?.number).toBe('11')
  db.close()
})
