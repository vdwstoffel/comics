import { test, expect } from 'vitest'
import { sortArcIssues, applySavedOrder } from '../server/lib/arcOrder.js'

/** An issue as the running order sees it: an id, a series, a number and the day it shipped. */
const issue = (id: number, volumeName: string, number: string, storeDate: string) =>
  ({ id, volumeName, number, storeDate, coverDate: '2026-11-01' })

test('the series an arc is named for reads before a tie-in sharing its Wednesday', () => {
  const batgirl = issue(1191011, 'Batgirl', '23', '2026-09-02')
  const batman = issue(1191012, 'Batman', '13', '2026-09-02')

  const sorted = sortArcIssues([batgirl, batman], '"Batman" Bad Seeds')

  expect(sorted.map((i) => i.volumeName)).toEqual(['Batman', 'Batgirl'])
})

// The family rank only breaks ties. A crossover reads in the order it reached the shops.
test('a tie-in that shipped first reads before the title the arc is named for', () => {
  const ivy = issue(1169615, 'Poison Ivy', '45', '2026-06-03')
  const batman = issue(1191012, 'Batman', '13', '2026-09-02')

  const sorted = sortArcIssues([batman, ivy], '"Batman" Bad Seeds')

  expect(sorted.map((i) => i.volumeName)).toEqual(['Poison Ivy', 'Batman'])
})

// Cover dates run about two months ahead of on-sale dates. An arc where only some issues
// carry a store date has to pick one scale and stay on it, or the two halves interleave.
test('an arc where only some issues carry a store date sorts on cover dates throughout', () => {
  const early = { id: 1, volumeName: 'Batman', number: '1', coverDate: '2026-06-01', storeDate: '2026-04-01' }
  const late = { id: 2, volumeName: 'Batman', number: '2', coverDate: '2026-09-01' }

  const sorted = sortArcIssues([late, early], '"Batman" Bad Seeds')

  expect(sorted.map((i) => i.id)).toEqual([1, 2])
})

test('an issue Comic Vine never dated goes last rather than first', () => {
  const dated = { id: 1, volumeName: 'Batman', number: '1', coverDate: '2026-06-01' }
  const undated = { id: 2, volumeName: 'Batman', number: '2' }

  const sorted = sortArcIssues([undated, dated], '"Batman" Bad Seeds')

  expect(sorted.map((i) => i.id)).toEqual([1, 2])
})

// A mini the crossover spawned carries the family in its name. It belongs with the spine,
// not out among the tie-ins - and alphabetical order alone will not put it there, because
// Batgirl sorts ahead of every Batman book there is.
test('a book the family named reads before a tie-in that sorts ahead of it alphabetically', () => {
  const batgirl = issue(1191011, 'Batgirl', '23', '2026-09-09')
  const central = issue(1192025, 'Batman: Bad Seeds - Gotham Central', '1', '2026-09-09')

  const sorted = sortArcIssues([batgirl, central], '"Batman" Bad Seeds')

  expect(sorted.map((i) => i.volumeName)).toEqual(['Batman: Bad Seeds - Gotham Central', 'Batgirl'])
})

// Two issues of one series on one Wednesday happens with a double-ship. Text order would
// put #10 between #1 and #2.
test('two issues of the same series on one Wednesday read in numeric order', () => {
  const ten = issue(1, 'Batman', '10', '2026-09-02')
  const two = issue(2, 'Batman', '2', '2026-09-02')

  const sorted = sortArcIssues([ten, two], '"Batman" Bad Seeds')

  expect(sorted.map((i) => i.number)).toEqual(['2', '10'])
})

// With no issue detail at all every comparison above lands here, which is the id order
// Comic Vine handed us. Stable beats arbitrary.
test('issues with nothing to sort on keep Comic Vine id order', () => {
  const later = { id: 9999999 }
  const earlier = { id: 1156915 }

  const sorted = sortArcIssues([later, earlier], '"Batman" Bad Seeds')

  expect(sorted.map((i) => i.id)).toEqual([1156915, 9999999])
})

test('the order you saved is the order you get back', () => {
  const batman = issue(1, 'Batman', '13', '2026-09-02')
  const batgirl = issue(2, 'Batgirl', '23', '2026-09-02')
  const nightwing = issue(3, 'Nightwing', '142', '2026-09-16')

  // Saved deliberately against the computed order, which is what a hand reorder is.
  const ordered = applySavedOrder([batman, batgirl, nightwing], [3, 2, 1])

  expect(ordered.map((i) => i.id)).toEqual([3, 2, 1])
})

// A running arc gains issues after you have arranged it. Appending them would drop a
// tie-in Comic Vine backfilled at the bottom of a run it belongs in the middle of.
test('an issue added since you reordered lands in its own week', () => {
  const ivy = issue(1, 'Poison Ivy', '45', '2026-06-03')
  const batman = issue(2, 'Batman', '13', '2026-09-02')
  const nightwing = issue(3, 'Nightwing', '142', '2026-09-16')

  const ordered = applySavedOrder([ivy, batman, nightwing], [1, 3])

  expect(ordered.map((i) => i.id)).toEqual([1, 2, 3])
})

test('with nothing saved the computed order stands', () => {
  const ivy = issue(1, 'Poison Ivy', '45', '2026-06-03')
  const batman = issue(2, 'Batman', '13', '2026-09-02')

  expect(applySavedOrder([ivy, batman], []).map((i) => i.id)).toEqual([1, 2])
})

test('an undated issue added since you reordered goes last, not first', () => {
  const ivy = issue(1, 'Poison Ivy', '45', '2026-06-03')
  const batman = issue(2, 'Batman', '13', '2026-09-02')
  const undated = { id: 3, volumeName: 'Batwoman', number: '7' }

  const ordered = applySavedOrder([ivy, batman, undated], [1, 2])

  expect(ordered.map((i) => i.id)).toEqual([1, 2, 3])
})
