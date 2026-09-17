import { test, expect } from 'vitest'
import { groupByVolume } from '../src/lib/volumeGroups'
import type { ApiLibraryBook } from '../src/api'

const book = (id: number, editionId: number, editionName: string): ApiLibraryBook => ({
  id, editionId, editionName, title: `#${id}`, number: String(id),
  pageCount: 20, comicinfoSynced: false, readState: 'unread', percent: 0,
})

test('books of one volume become a single group', () => {
  const groups = groupByVolume([
    book(1, 9, 'Venom (2025)'),
    book(2, 9, 'Venom (2025)'),
  ])

  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({ editionId: 9, editionName: 'Venom (2025)' })
  expect(groups[0].books.map((b) => b.id)).toEqual([1, 2])
})

test('different volumes stay apart', () => {
  const groups = groupByVolume([book(1, 9, 'Venom (2025)'), book(2, 4, 'Knull (2026)')])

  expect(groups.map((g) => g.editionName)).toEqual(['Venom (2025)', 'Knull (2026)'])
})

// The server sorts by series then issue number, so a volume's books do arrive together.
// Grouping by identity rather than by adjacency means a change to that sort reorders the
// shelf without silently splitting a volume into two tiles.
test('a volume is one group even when its books do not arrive together', () => {
  const groups = groupByVolume([
    book(1, 9, 'Venom (2025)'),
    book(2, 4, 'Knull (2026)'),
    book(3, 9, 'Venom (2025)'),
  ])

  expect(groups).toHaveLength(2)
  expect(groups[0].books.map((b) => b.id)).toEqual([1, 3])
})

// Whatever order the server chose is the order you read in, so the shelf keeps it.
test('groups keep the order their volumes first appeared', () => {
  const groups = groupByVolume([
    book(1, 4, 'Knull (2026)'),
    book(2, 9, 'Venom (2025)'),
  ])

  expect(groups.map((g) => g.editionId)).toEqual([4, 9])
})

test('nothing in, nothing out', () => {
  expect(groupByVolume([])).toEqual([])
})
