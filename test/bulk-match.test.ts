import { test, expect } from 'vitest'
import { isComicFile, buildRows, claimForVolume, availableIssues, assignIssue } from '../src/lib/bulkMatch'
import type { BulkIssue, BulkVolume, BulkRow } from '../src/lib/bulkMatch'

const issue = (id: number, number: string | null, over: Partial<BulkIssue> = {}): BulkIssue => ({
  id, number, ...over,
})

const volume = (over: Partial<BulkVolume> = {}): BulkVolume => ({
  volumeId: 42,
  name: 'Avengers',
  startYear: 2013,
  editionId: 7,
  issues: [issue(1, '20'), issue(2, '21'), issue(3, '24'), issue(4, '16.1')],
  ...over,
})

const rows = (...names: string[]): BulkRow[] => buildRows(names)
const stateOf = (rs: BulkRow[], fileName: string) => rs.find((r) => r.fileName === fileName)!

test('a plain numbered file is matched to its issue', () => {
  const out = claimForVolume(rows('Avengers 020 (2013) (Digital).cbr'), volume())
  const row = stateOf(out, 'Avengers 020 (2013) (Digital).cbr')
  expect(row.state).toBe('matched')
  expect(row.issue?.id).toBe(1)
})

// The regression this whole rule exists for. Avengers (2013) really does have a #1, and
// matching on the number alone hands it this file with a confident, wrong answer.
test('the series must agree: Avengers does not claim Avengers World 001', () => {
  const out = claimForVolume(rows('Avengers World 001 (2014) (Digital).cbr'), volume({
    issues: [issue(9, '1')],
  }))
  expect(stateOf(out, 'Avengers World 001 (2014) (Digital).cbr').state).toBe('unplaced')
})

test('a leading "the" on the volume does not stop a match', () => {
  const out = claimForVolume(rows('Uncanny X-Men 001.cbz'), volume({
    name: 'The Uncanny X-Men', issues: [issue(9, '1')],
  }))
  expect(stateOf(out, 'Uncanny X-Men 001.cbz').state).toBe('matched')
})

test('an annual keys to the annual volume, not the run', () => {
  const run = claimForVolume(rows('Avengers Annual 001 (2014).cbr'), volume())
  expect(stateOf(run, 'Avengers Annual 001 (2014).cbr').state).toBe('unplaced')

  const annual = claimForVolume(run, volume({
    volumeId: 99, name: 'Avengers Annual', editionId: null, issues: [issue(50, '1')],
  }))
  const row = stateOf(annual, 'Avengers Annual 001 (2014).cbr')
  expect(row.state).toBe('matched')
  expect(row.issue?.id).toBe(50)
})

test('an exact dotted number wins and does not collapse to its base', () => {
  const out = claimForVolume(rows('Amazing Spider-Man 016.1 (2015).cbz'), volume({
    name: 'Amazing Spider-Man', issues: [issue(4, '16.1'), issue(5, '16')],
  }))
  expect(stateOf(out, 'Amazing Spider-Man 016.1 (2015).cbz').issue?.id).toBe(4)
})

// Marvel's branding: Comic Vine files this as plain #24.
test('024.NOW falls back to the base number and matches #24', () => {
  const out = claimForVolume(rows('Avengers 024.NOW (2014) (Digital).cbr'), volume())
  const row = stateOf(out, 'Avengers 024.NOW (2014) (Digital).cbr')
  expect(row.state).toBe('matched')
  expect(row.issue?.id).toBe(3)
})

test('the base-number fallback refuses when another file matched that issue exactly', () => {
  const out = claimForVolume(
    rows('Avengers 024.NOW (2014).cbr', 'Avengers 024 (2014).cbr'),
    volume(),
  )
  expect(stateOf(out, 'Avengers 024 (2014).cbr').issue?.id).toBe(3)
  // Claimed by the volume - its series agrees - but with no issue, so it gets a picker
  // rather than being stranded in the leftovers.
  const loser = stateOf(out, 'Avengers 024.NOW (2014).cbr')
  expect(loser.state).toBe('needs-issue')
  expect(loser.volumeId).toBe(42)
  expect(loser.issue).toBe(null)
})

// "Two matches is no match", the rule the download matcher already follows.
test('two files resolving to one issue leave both without it', () => {
  const out = claimForVolume(rows('Avengers 020 (2013).cbr', 'Avengers 020 (2013).cbz'), volume())
  expect(out.every((r) => r.state === 'needs-issue')).toBe(true)
  expect(out.every((r) => r.issue === null)).toBe(true)
})

test('a file with no number is unplaced, not matched to a null-numbered issue', () => {
  const out = claimForVolume(rows('Avengers Omnibus.cbz'), volume({
    issues: [issue(8, null)],
  }))
  expect(stateOf(out, 'Avengers Omnibus.cbz').state).toBe('unplaced')
})

test('an issue whose number is null matches nothing', () => {
  const out = claimForVolume(rows('Avengers 020.cbr'), volume({ issues: [issue(8, null)] }))
  const row = stateOf(out, 'Avengers 020.cbr')
  expect(row.state).toBe('needs-issue')
  expect(row.issue).toBe(null)
})

test('a copy in this volume\'s edition is owned-here, and skipped by default', () => {
  const out = claimForVolume(rows('Avengers 020 (2013).cbr'), volume({
    issues: [issue(1, '20', { owned: true, bookId: 5, ownedIn: { editionId: 7, editionName: 'Avengers (2013)' } })],
  }))
  const row = stateOf(out, 'Avengers 020 (2013).cbr')
  expect(row.state).toBe('owned-here')
  expect(row.replace).toBe(false)
})

// The one the user chose: a stray from an old scan is what you ran the batch to fix.
test('a copy filed elsewhere is owned-elsewhere, and replaces by default', () => {
  const out = claimForVolume(rows('Avengers 020 (2013).cbr'), volume({
    issues: [issue(1, '20', { owned: true, bookId: 5, ownedIn: { editionId: 99, editionName: 'Unsorted' } })],
  }))
  const row = stateOf(out, 'Avengers 020 (2013).cbr')
  expect(row.state).toBe('owned-elsewhere')
  expect(row.replace).toBe(true)
})

test('a later search cannot steal a row an earlier one matched', () => {
  const first = claimForVolume(rows('Avengers 020 (2013).cbr'), volume())
  const second = claimForVolume(first, volume({ volumeId: 77, issues: [issue(70, '20')] }))
  const row = stateOf(second, 'Avengers 020 (2013).cbr')
  expect(row.volumeId).toBe(42)
  expect(row.issue?.id).toBe(1)
})

test('a second search is offered only the files still unplaced', () => {
  const first = claimForVolume(
    rows('Avengers 020 (2013).cbr', 'Avengers Annual 001 (2014).cbr'),
    volume(),
  )
  const second = claimForVolume(first, volume({
    volumeId: 99, name: 'Avengers Annual', editionId: null, issues: [issue(50, '1')],
  }))
  expect(stateOf(second, 'Avengers 020 (2013).cbr').volumeId).toBe(42)
  expect(stateOf(second, 'Avengers Annual 001 (2014).cbr').volumeId).toBe(99)
})

test('isComicFile accepts either extension in any case and nothing else', () => {
  expect(isComicFile('Avengers 020.CBR')).toBe(true)
  expect(isComicFile('Avengers 020.cbz')).toBe(true)
  expect(isComicFile('readme.txt')).toBe(false)
  expect(isComicFile('cover.jpg')).toBe(false)
})

test('a non-comic is built as an ignored row, never matched', () => {
  const out = claimForVolume(rows('Avengers 020 (2013).cbr', 'readme.txt'), volume())
  expect(stateOf(out, 'readme.txt').state).toBe('ignored')
  expect(stateOf(out, 'readme.txt').issue).toBe(null)
})

// Two folders, the same release. The table keys on this, so a collision would drop a row.
test('two picked files with the identical name get distinct keys', () => {
  const out = buildRows(['Avengers 020.cbr', 'Avengers 020.cbr'])
  expect(out[0].key).not.toBe(out[1].key)
})

test('a file whose series agrees but whose number is not in the volume needs an issue', () => {
  const out = claimForVolume(rows('Avengers 999 (2014).cbr'), volume())
  const row = stateOf(out, 'Avengers 999 (2014).cbr')
  expect(row.state).toBe('needs-issue')
  expect(row.volumeId).toBe(42)
})

test('a file of another series is not claimed at all, so it has no volume to pick from', () => {
  const out = claimForVolume(rows('Avengers World 001.cbr'), volume())
  const row = stateOf(out, 'Avengers World 001.cbr')
  expect(row.state).toBe('unplaced')
  expect(row.volumeId).toBe(null)
})

test('the picker is offered only the issues no row has taken', () => {
  const out = claimForVolume(rows('Avengers 020 (2013).cbr', 'Avengers 999 (2014).cbr'), volume())
  expect(availableIssues(out, volume()).map((i) => i.id)).toEqual([2, 3, 4])
})

test('assigning an issue by hand matches the row', () => {
  const v = volume()
  const out = claimForVolume(rows('Avengers 999 (2014).cbr'), v)
  const picked = assignIssue(out, out[0].key, v.issues[1], v)
  expect(picked[0].state).toBe('matched')
  expect(picked[0].issue?.id).toBe(2)
})

test('assigning an issue the library already holds elsewhere ticks replace', () => {
  const owned = issue(2, '21', { owned: true, bookId: 9, ownedIn: { editionId: 99, editionName: 'Unsorted' } })
  const v = volume({ issues: [issue(1, '20'), owned] })
  const out = claimForVolume(rows('Avengers 999 (2014).cbr'), v)
  const picked = assignIssue(out, out[0].key, owned, v)
  expect(picked[0].state).toBe('owned-elsewhere')
  expect(picked[0].replace).toBe(true)
})

// §5.4's motivating case, and the one the guard used to disable: six strays in Unsorted
// are the ONLY copies, so the library has no edition for the volume at all. With
// editionId null every one of them read as "already yours" and was skipped.
test('a copy elsewhere is owned-elsewhere even when the volume has no edition yet', () => {
  const out = claimForVolume(rows('Avengers 020 (2013).cbr'), volume({
    editionId: null,
    issues: [issue(1, '20', { owned: true, bookId: 5, ownedIn: { editionId: 99, editionName: 'Unsorted' } })],
  }))
  const row = stateOf(out, 'Avengers 020 (2013).cbr')
  expect(row.state).toBe('owned-elsewhere')
  expect(row.replace).toBe(true)
})

test('assigning an issue held elsewhere ticks replace when the volume has no edition', () => {
  const owned = issue(2, '21', { owned: true, bookId: 9, ownedIn: { editionId: 99, editionName: 'Unsorted' } })
  const v = volume({ editionId: null, issues: [issue(1, '20'), owned] })
  const out = claimForVolume(rows('Avengers 999 (2014).cbr'), v)
  const picked = assignIssue(out, out[0].key, owned, v)
  expect(picked[0].state).toBe('owned-elsewhere')
})

// A folder spanning a relaunch. The 2013 volume claims both files on series alone, and
// #10 cannot be numbered in it - so the 2016 volume, which really has that issue, must
// still be able to take it. Otherwise the only affordance left is a picker offering the
// 2013 issues, and the user pairs #10 with 2013's #2.
test('a later volume can still take a row the first could not number', () => {
  const v2013 = volume({ volumeId: 42, issues: [issue(1, '1'), issue(2, '2')] })
  const v2016 = volume({ volumeId: 77, startYear: 2016, editionId: null, issues: [issue(70, '10'), issue(71, '11')] })

  const first = claimForVolume(rows('Avengers 001.cbr', 'Avengers 010.cbr'), v2013)
  expect(stateOf(first, 'Avengers 010.cbr').state).toBe('needs-issue')

  const second = claimForVolume(first, v2016)
  const moved = stateOf(second, 'Avengers 010.cbr')
  expect(moved.state).toBe('matched')
  expect(moved.volumeId).toBe(77)
  expect(moved.issue?.id).toBe(70)
})

// The other half of that rule: reconsidering needs-issue rows must not let a later
// search touch one that is already properly matched.
test('a later volume still cannot steal a row that was matched', () => {
  const v2013 = volume({ volumeId: 42, issues: [issue(1, '1')] })
  const v2016 = volume({ volumeId: 77, editionId: null, issues: [issue(70, '1')] })
  const first = claimForVolume(rows('Avengers 001.cbr'), v2013)
  const second = claimForVolume(first, v2016)
  expect(stateOf(second, 'Avengers 001.cbr').volumeId).toBe(42)
})
