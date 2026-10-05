import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { addFollow } from '../server/models/follows.js'
import { nextWantedIssue } from '../server/services/following.js'
import type { CvVolumeIssue } from '../server/lib/comicvine.js'

const ISSUES = [
  { id: 101, number: '1', coverDate: '2020-01-01' },
  { id: 102, number: '2', coverDate: '2020-02-01' },
  { id: 103, number: '3', coverDate: '2020-03-01' },
]

/** An edition matched to Comic Vine volume 500, with the issue list already cached. */
function seed(issues: CvVolumeIssue[] = ISSUES) {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Iron Man', folder: 'Iron Man' })
  updateEdition(db, edition.id, { comicvineId: 500, cvName: 'Iron Man' })
  cacheVolumeIssues(db, 500, issues)
  const follow = addFollow(db, 'volume', edition.id, 'Iron Man')
  const own = (cvId: number, finished: boolean) => {
    const b = insertBook(db, { editionId: edition.id, filePath: `Iron Man/${cvId}.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvId })
    if (finished) setProgress(db, b.id, { lastPage: 9, completed: true })
    return b
  }
  return { db, edition, follow, own }
}

test('the issue after the last one you finished is what it wants', () => {
  const t = seed()
  t.own(101, true)
  expect(nextWantedIssue(t.db, t.follow)).toEqual({
    state: 'wanted',
    issue: expect.objectContaining({ id: 102, number: '2' }),
    volumeName: 'Iron Man',
    editionName: 'Iron Man',
  })
})

test('a run with nothing finished is dormant', () => {
  const t = seed()
  t.own(101, false)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('dormant')
})

test('a run whose next issue you already own is supplied', () => {
  const t = seed()
  t.own(101, true)
  t.own(102, false)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('supplied')
})

test('a run whose last issue you have finished is caught up', () => {
  const t = seed()
  t.own(101, true); t.own(102, true); t.own(103, true)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('caught-up')
})

// The anchor is the LAST finished issue, not the first gap (spec §3.1).
test('a gap behind you is left behind', () => {
  const t = seed()
  t.own(101, true)
  t.own(103, true)
  // #2 is missing, but #3 is finished, so the run has moved past it.
  expect(nextWantedIssue(t.db, t.follow).state).toBe('caught-up')
})

test('an issue abandoned halfway reads as supplied, since it is itself the unread one', () => {
  const t = seed()
  t.own(101, true)
  const b = t.own(102, false)
  setProgress(t.db, b.id, { lastPage: 4, completed: false })
  expect(nextWantedIssue(t.db, t.follow).state).toBe('supplied')
})

test('a follow whose edition is gone is unresolved', () => {
  const t = seed()
  const follow = addFollow(t.db, 'volume', 9999, 'Ghost')
  expect(nextWantedIssue(t.db, follow).state).toBe('unresolved')
})

test('an edition never matched to Comic Vine is unresolved', () => {
  const t = seed()
  const bare = upsertEdition(t.db, { name: 'Unsorted', folder: 'Unsorted' })
  const follow = addFollow(t.db, 'volume', bare.id, 'Unsorted')
  expect(nextWantedIssue(t.db, follow).state).toBe('unresolved')
})

test('a volume with no cached issue list is caught up until a refresh fills it', () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Thor', folder: 'Thor' })
  updateEdition(db, edition.id, { comicvineId: 600, cvName: 'Thor' })
  const follow = addFollow(db, 'volume', edition.id, 'Thor')
  expect(nextWantedIssue(db, follow).state).toBe('caught-up')
})

// Review Focus 2: Comic Vine lists unnumbered issues, and the match rule cannot use one.
test('an unnumbered next issue is still wanted, and carries no number to match on', () => {
  const t = seed([
    { id: 101, number: '1', coverDate: '2020-01-01' },
    { id: 102, coverDate: '2020-02-01' },
  ])
  t.own(101, true)
  const outcome = nextWantedIssue(t.db, t.follow)
  expect(outcome.state).toBe('wanted')
  if (outcome.state === 'wanted') expect(outcome.issue.number).toBeUndefined()
})
