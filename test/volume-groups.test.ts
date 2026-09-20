import { test, expect } from 'vitest'
import { groupByVolume, groupBySeries, groupByArc } from '../src/lib/volumeGroups'
import type { ApiLibraryBook } from '../src/api'

const book = (
  id: number, editionId: number, editionName: string, seriesName: string | null = null,
): ApiLibraryBook => ({
  id, editionId, editionName, seriesName, arcs: [], title: `#${id}`, number: String(id),
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

// --- series ------------------------------------------------------------------

test('every volume of one series becomes a single group', () => {
  const groups = groupBySeries([
    book(1, 6, 'Batman (2012)', 'Batman'),
    book(2, 7, 'Batman (2016)', 'Batman'),
    book(3, 8, 'Batman (2025)', 'Batman'),
  ])

  expect(groups).toHaveLength(1)
  expect(groups[0].name).toBe('Batman')
  expect(groups[0].volumes.map((v) => v.editionName))
    .toEqual(['Batman (2012)', 'Batman (2016)', 'Batman (2025)'])
})

test('a series group keeps each volume\'s comics under that volume', () => {
  const groups = groupBySeries([
    book(1, 6, 'Batman (2012)', 'Batman'),
    book(2, 6, 'Batman (2012)', 'Batman'),
    book(3, 8, 'Batman (2025)', 'Batman'),
  ])

  expect(groups[0].volumes.map((v) => v.books.map((b) => b.id))).toEqual([[1, 2], [3]])
})

test('different series stay apart', () => {
  const groups = groupBySeries([
    book(1, 6, 'Batman (2012)', 'Batman'),
    book(2, 9, 'Venom (2025)', 'Venom'),
  ])

  expect(groups.map((g) => g.name)).toEqual(['Batman', 'Venom'])
})

// The server's own grouping matches series names case-insensitively; a shelf that did not
// would split one series in two the day an edition was saved with a different capital.
test('a series is one group whatever case its volumes were saved with', () => {
  const groups = groupBySeries([
    book(1, 6, 'Batman (2012)', 'Batman'),
    book(2, 8, 'Batman (2025)', 'batman'),
  ])

  expect(groups).toHaveLength(1)
  expect(groups[0].name).toBe('Batman')
})

// An edition nobody has given a series to still has to appear, and its own name is the
// only name it has.
test('a volume with no series of its own stands under its own name', () => {
  const groups = groupBySeries([book(1, 4, 'Knull (2026)', null)])

  expect(groups[0].name).toBe('Knull (2026)')
  expect(groups[0].volumes.map((v) => v.editionId)).toEqual([4])
})

test('groups keep the order their series first appeared', () => {
  const groups = groupBySeries([
    book(1, 9, 'Venom (2025)', 'Venom'),
    book(2, 6, 'Batman (2012)', 'Batman'),
    book(3, 8, 'Batman (2025)', 'Batman'),
  ])

  expect(groups.map((g) => g.name)).toEqual(['Venom', 'Batman'])
})

test('nothing in, no series out', () => {
  expect(groupBySeries([])).toEqual([])
})

// --- arcs --------------------------------------------------------------------

const inArc = (b: ApiLibraryBook, ...arcs: string[]): ApiLibraryBook => ({ ...b, arcs })

test('comics from different series in one arc become a single group', () => {
  const { arcs } = groupByArc([
    inArc(book(1, 2, 'Avengers: Armageddon (2026)', 'Avengers: Armageddon'), 'Armageddon'),
    inArc(book(2, 3, 'Captain America (2025)', 'Captain America'), 'Armageddon'),
  ])

  expect(arcs).toHaveLength(1)
  expect(arcs[0].name).toBe('Armageddon')
  expect(arcs[0].books.map((b) => b.id)).toEqual([1, 2])
})

test('an arc group counts the series it draws from', () => {
  const { arcs } = groupByArc([
    inArc(book(1, 2, 'Avengers: Armageddon (2026)', 'Avengers: Armageddon'), 'Armageddon'),
    inArc(book(2, 2, 'Avengers: Armageddon (2026)', 'Avengers: Armageddon'), 'Armageddon'),
    inArc(book(3, 3, 'Captain America (2025)', 'Captain America'), 'Armageddon'),
  ])

  expect(arcs[0].seriesCount).toBe(2)
})

// The shelf still has to account for every unread comic, so the ones carrying no arc are
// handed back rather than dropped - they go on being grouped by series.
test('a comic in no arc is left for the series shelf', () => {
  const { arcs, rest } = groupByArc([
    inArc(book(1, 2, 'Avengers: Armageddon (2026)', 'Avengers: Armageddon'), 'Armageddon'),
    book(2, 6, 'Batman (2012)', 'Batman'),
  ])

  expect(arcs.map((a) => a.name)).toEqual(['Armageddon'])
  expect(rest.map((b) => b.id)).toEqual([2])
})

test('different arcs stay apart', () => {
  const { arcs } = groupByArc([
    inArc(book(1, 2, 'Venom (2025)', 'Venom'), 'King in Black'),
    inArc(book(2, 3, 'Thor (2026)', 'Thor'), 'Armageddon'),
  ])

  expect(arcs.map((a) => a.name)).toEqual(['King in Black', 'Armageddon'])
})

// A tie-in genuinely belongs to both arcs it is tagged with, and hiding it from one of
// them would hide it from the arc you happen to be reading. The cost is that the arc
// counts sum to more than the shelf holds, which is true of the arcs themselves.
test('a comic tagged with two arcs appears under both', () => {
  const { arcs, rest } = groupByArc([
    inArc(book(1, 2, 'Venom (2025)', 'Venom'), 'King in Black', 'Armageddon'),
  ])

  expect(arcs.map((a) => a.name)).toEqual(['King in Black', 'Armageddon'])
  expect(arcs.every((a) => a.books.map((b) => b.id).includes(1))).toBe(true)
  expect(rest).toEqual([])
})

test('nothing in, no arcs out', () => {
  expect(groupByArc([])).toEqual({ arcs: [], rest: [] })
})
