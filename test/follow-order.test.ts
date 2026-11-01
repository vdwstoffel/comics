import { test, expect } from 'vitest'
import { sortFollows, bandOf } from '../src/lib/followOrder'
import type { OrderableFollow } from '../src/lib/followOrder'
import type { ApiFollow } from '../src/api'

function item(
  name: string,
  state: ApiFollow['state'],
  extra: Partial<Omit<OrderableFollow, 'follow'>> = {},
): OrderableFollow {
  return {
    follow: { kind: 'volume', refId: 1, name, state },
    hasTile: false,
    soon: { state: 'pending' },
    ...extra,
  }
}

const names = (items: OrderableFollow[]): string[] => sortFollows(items).map((i) => i.follow.name)

test('a follow with comics on the shelf comes before one waiting on a date', () => {
  expect(names([
    item('Daredevil', 'caught-up', { soon: { state: 'next', week: '2026-10-14' } }),
    item('Venom', 'supplied', { hasTile: true }),
  ])).toEqual(['Venom', 'Daredevil'])
})

test('an issue that is out but not posted sits between the shelf and the dated waits', () => {
  expect(names([
    item('Daredevil', 'caught-up', { soon: { state: 'next', week: '2026-10-14' } }),
    item('Thor', 'wanted'),
    item('Venom', 'supplied', { hasTile: true }),
  ])).toEqual(['Venom', 'Thor', 'Daredevil'])
})

test('dated waits run soonest first', () => {
  expect(names([
    item('Thor', 'caught-up', { soon: { state: 'next', week: '2026-11-18' } }),
    item('Daredevil', 'caught-up', { soon: { state: 'next', week: '2026-10-14' } }),
    item('Venom', 'caught-up', { soon: { state: 'next', week: '2026-10-28' } }),
  ])).toEqual(['Daredevil', 'Venom', 'Thor'])
})

test('a follow with no date to show sorts below every dated one', () => {
  expect(names([
    item('Avengers', 'caught-up', { soon: { state: 'none' } }),
    item('Blade', 'dormant'),
    item('Zatanna', 'caught-up', { soon: { state: 'next', week: '2026-11-18' } }),
  ])).toEqual(['Zatanna', 'Avengers', 'Blade'])
})

test('a calendar that has not answered yet is not a date', () => {
  expect(names([
    item('Avengers', 'caught-up', { soon: { state: 'pending' } }),
    item('Zatanna', 'caught-up', { soon: { state: 'next', week: '2026-11-18' } }),
  ])).toEqual(['Zatanna', 'Avengers'])
})

test('names break a tie without regard to case', () => {
  expect(names([
    item('venom', 'caught-up', { soon: { state: 'none' } }),
    item('Avengers', 'caught-up', { soon: { state: 'none' } }),
    item('blade', 'caught-up', { soon: { state: 'none' } }),
  ])).toEqual(['Avengers', 'blade', 'venom'])
})

test('two runs landing the same week keep their alphabetical order', () => {
  const week = '2026-10-14'
  expect(names([
    item('Venom', 'caught-up', { soon: { state: 'next', week } }),
    item('Avengers', 'caught-up', { soon: { state: 'next', week } }),
  ])).toEqual(['Avengers', 'Venom'])
})

// followStatus prints `Next:` for a caught-up follow alone. Ranking a dormant follow by a
// solicitation would file it among the dated rows while its tile shows no date at all.
test('a dormant follow is not dated by a solicitation the page never shows', () => {
  expect(names([
    item('Avengers', 'dormant', { soon: { state: 'next', week: '2026-10-14' } }),
    item('Blade', 'caught-up', { soon: { state: 'next', week: '2026-11-18' } }),
  ])).toEqual(['Blade', 'Avengers'])
})

test('the shelf it was handed is left as it was', () => {
  const items = [
    item('Venom', 'caught-up', { soon: { state: 'none' } }),
    item('Avengers', 'supplied', { hasTile: true }),
  ]
  sortFollows(items)
  expect(items.map((i) => i.follow.name)).toEqual(['Venom', 'Avengers'])
})

test('a follow with comics on the shelf is available', () => {
  expect(bandOf(item('Venom', 'supplied', { hasTile: true }))).toBe('available')
})

test('a caught-up follow the calendar has dated is coming soon', () => {
  expect(bandOf(item('Venom', 'caught-up', { soon: { state: 'next', week: '2026-10-14' } })))
    .toBe('coming')
})

// Published, just not here. The heading reads "this comic exists", and it keeps its
// place behind the runs you can actually open - which is sortFollows' business, not this.
test('an issue that is out but not posted is available', () => {
  expect(bandOf(item('Thor', 'wanted'))).toBe('available')
})

test('a follow with nothing to show and no date is undated', () => {
  expect(bandOf(item('Avengers', 'caught-up', { soon: { state: 'none' } }))).toBe('undated')
  expect(bandOf(item('Blade', 'dormant'))).toBe('undated')
})

// Same rule as the ordering: a tile that shows no date may not be filed under one.
test('a dormant follow is not dated by a solicitation the page never shows', () => {
  expect(bandOf(item('Avengers', 'dormant', { soon: { state: 'next', week: '2026-10-14' } })))
    .toBe('undated')
})

test('a calendar that has not answered yet is not a date', () => {
  expect(bandOf(item('Avengers', 'caught-up', { soon: { state: 'pending' } }))).toBe('undated')
})

// Grouping the sorted shelf by band must not reorder anything inside a band, which is the
// whole reason tiers 1 and 3 may share one heading.
test('grouping the sorted shelf by band leaves each band in its sorted order', () => {
  const sorted = sortFollows([
    item('Avengers', 'caught-up', { soon: { state: 'none' } }),
    item('Iron Man', 'caught-up', { soon: { state: 'next', week: '2026-10-28' } }),
    item('Thor', 'wanted'),
    item('Venom', 'supplied', { hasTile: true }),
  ])
  const band = (name: 'available' | 'coming' | 'undated') => (
    sorted.filter((i) => bandOf(i) === name).map((i) => i.follow.name)
  )
  expect(band('available')).toEqual(['Venom', 'Thor'])
  expect(band('coming')).toEqual(['Iron Man'])
  expect(band('undated')).toEqual(['Avengers'])
})
