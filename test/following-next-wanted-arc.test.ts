import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { cacheArc } from '../server/models/arcCache.js'
import { saveArcOrder } from '../server/models/arcOrder.js'
import { addFollow } from '../server/models/follows.js'
import { nextWantedIssue } from '../server/services/following.js'

const ARC_ID = 56676

const ARC = {
  id: ARC_ID,
  name: 'Death Spiral',
  issues: [
    { id: 201, number: '1', volumeName: 'Daredevil', volumeId: 700, coverDate: '2015-03-01' },
    { id: 202, number: '2', volumeName: 'Daredevil', volumeId: 700, coverDate: '2015-04-01' },
    { id: 203, number: '9', volumeName: 'Elektra', volumeId: 800, coverDate: '2015-05-01' },
  ],
}

function seed() {
  const db = openDb(':memory:')
  cacheArc(db, ARC_ID, ARC)
  const dd = upsertEdition(db, { name: 'Daredevil (2014)', folder: 'Daredevil (2014)' })
  updateEdition(db, dd.id, { comicvineId: 700, cvName: 'Daredevil' })
  const follow = addFollow(db, 'arc', ARC_ID, 'Death Spiral')
  let copies = 0
  const own = (cvId: number, finished: boolean, editionId = dd.id) => {
    const b = insertBook(db, { editionId, filePath: `arc/${cvId}-${copies++}.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvId })
    if (finished) setProgress(db, b.id, { lastPage: 9, completed: true })
    return b
  }
  return { db, dd, follow, own }
}

test('the next part of the arc is what it wants', () => {
  const t = seed()
  t.own(201, true)
  const outcome = nextWantedIssue(t.db, t.follow)
  expect(outcome).toEqual({
    state: 'wanted',
    // number and coverDate are what findMatchForIssue bails on: dropping either would
    // silently disable every arc download.
    issue: expect.objectContaining({ id: 202, number: '2', coverDate: '2015-04-01' }),
    volumeName: 'Daredevil',
    editionName: 'Daredevil (2014)',
  })
})

// An arc crosses volumes: ownership is library-wide, not scoped to one edition.
test('a part you own in another edition still counts as owned', () => {
  const t = seed()
  const other = upsertEdition(t.db, { name: 'Elektra', folder: 'Elektra' })
  t.own(201, true)
  t.own(202, true)
  t.own(203, false, other.id)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('supplied')
})

// The tie-in's own volume decides where it lands, not the arc's spine.
test('a tie-in with no edition of its own falls back to its volume name', () => {
  const t = seed()
  t.own(201, true)
  t.own(202, true)
  const outcome = nextWantedIssue(t.db, t.follow)
  expect(outcome).toEqual({
    state: 'wanted',
    issue: expect.objectContaining({ id: 203 }),
    volumeName: 'Elektra',
    editionName: 'Elektra',
  })
})

test('an arc follows the order you arranged, not the one dates computed', () => {
  const t = seed()
  saveArcOrder(t.db, ARC_ID, [203, 201, 202])
  t.own(203, true)
  const outcome = nextWantedIssue(t.db, t.follow)
  expect(outcome.state).toBe('wanted')
  if (outcome.state === 'wanted') expect(outcome.issue.id).toBe(201)
})

test('an arc with nothing finished is dormant', () => {
  const t = seed()
  t.own(201, false)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('dormant')
})

test('an arc whose last part you finished is caught up', () => {
  const t = seed()
  t.own(201, true); t.own(202, true); t.own(203, true)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('caught-up')
})

test('an arc Comic Vine has never been asked about is caught up', () => {
  const t = seed()
  const follow = addFollow(t.db, 'arc', 99999, 'Unknown Arc')
  expect(nextWantedIssue(t.db, follow).state).toBe('caught-up')
})

// Read at any age on purpose: freshness is the sweep's job, and a stale cache that
// answered caught-up would stop an arc follow from ever downloading.
test('a stale arc cache still answers wanted', () => {
  const t = seed()
  cacheArc(t.db, ARC_ID, ARC, '2000-01-01T00:00:00Z')
  t.own(201, true)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('wanted')
})

// Two copies of one issue: a Map keyed by comicvine_id kept only the last row, so when
// just the other copy was finished the arc read it as unfinished (dormant).
test('a finished copy counts even when another copy of the issue is unfinished', () => {
  const t = seed()
  t.own(201, true)
  t.own(201, false)
  const outcome = nextWantedIssue(t.db, t.follow)
  expect(outcome.state).toBe('wanted')
})
