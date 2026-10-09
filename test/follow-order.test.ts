import { test, expect } from 'vitest'
import { sortFollows } from '../src/lib/followOrder'
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
