import { test, expect } from 'vitest'
import { sortFollows, bandOf, monthOf, oldestMonth } from '../src/lib/followOrder'
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

// --- Sorting Available by cover date. Only that band moves: Coming soon is already in
// date order and No date yet has none to sort on.

const byDate = (items: OrderableFollow[]): string[] => sortFollows(items, 'date').map((i) => i.follow.name)

test('by cover date, the oldest comic comes first', () => {
  expect(byDate([
    item('Avengers', 'supplied', { hasTile: true, coverDate: '2026-11' }),
    item('Batman', 'supplied', { hasTile: true, coverDate: '2027-01' }),
    item('Thor', 'supplied', { hasTile: true, coverDate: '2026-07' }),
  ])).toEqual(['Thor', 'Avengers', 'Batman'])
})

// Available reads "this comic exists", so by date an issue that is out takes its place
// among the runs by its own cover date rather than waiting behind all of them.
test('by cover date, an issue that is out sits among the runs by its own date', () => {
  expect(byDate([
    item('Avengers', 'supplied', { hasTile: true, coverDate: '2026-11' }),
    item('Thor', 'wanted', { coverDate: '2027-01' }),
    item('Venom', 'supplied', { hasTile: true, coverDate: '2026-07' }),
  ])).toEqual(['Venom', 'Avengers', 'Thor'])
})

test('by cover date, a month shared by two runs falls back to their names', () => {
  expect(byDate([
    item('venom', 'supplied', { hasTile: true, coverDate: '2026-11' }),
    item('Avengers', 'supplied', { hasTile: true, coverDate: '2026-11' }),
  ])).toEqual(['Avengers', 'venom'])
})

test('by cover date, a run with no date goes to the end of Available, not past it', () => {
  expect(byDate([
    item('Iron Man', 'caught-up', { soon: { state: 'next', week: '2026-10-28' } }),
    item('Avengers', 'supplied', { hasTile: true }),
    item('Venom', 'supplied', { hasTile: true, coverDate: '2026-07' }),
  ])).toEqual(['Venom', 'Avengers', 'Iron Man'])
})

test('by cover date, the other two bands keep their own order', () => {
  expect(byDate([
    item('Zatanna', 'caught-up', { soon: { state: 'none' } }),
    item('Blade', 'caught-up', { soon: { state: 'none' } }),
    item('Thor', 'caught-up', { soon: { state: 'next', week: '2026-11-18' } }),
    item('Daredevil', 'caught-up', { soon: { state: 'next', week: '2026-10-14' } }),
  ])).toEqual(['Daredevil', 'Thor', 'Blade', 'Zatanna'])
})

test('by name is still the order when nothing is asked for', () => {
  expect(names([
    item('Venom', 'supplied', { hasTile: true, coverDate: '2027-01' }),
    item('Avengers', 'supplied', { hasTile: true, coverDate: '2026-07' }),
  ])).toEqual(['Avengers', 'Venom'])
})

// Comic Vine dates a want to the day and a comic's own file to the month. Compared as
// they come, `2027-01` sorts before `2027-01-01` and the same month splits in two.
test('a cover date is read to the month, whatever it was written to', () => {
  expect(monthOf('2027-01-01')).toBe('2027-01')
  expect(monthOf('2027-01')).toBe('2027-01')
  expect(monthOf(null)).toBeUndefined()
  expect(monthOf('')).toBeUndefined()
})

// The oldest unread comic is the one on the run's cover and the one you would open next,
// so it is the date the run is sorted on.
test('a run is dated by its oldest comic', () => {
  expect(oldestMonth(['2027-01-15', null, '2026-07-01', '2026-11'])).toBe('2026-07')
  expect(oldestMonth([null, undefined])).toBeUndefined()
})
