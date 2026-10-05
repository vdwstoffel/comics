import { test, expect } from 'vitest'
import { followStatus } from '../src/lib/followStatus'
import type { ApiFollow } from '../src/api'

const base: ApiFollow = { kind: 'volume', refId: 1, name: 'Iron Man', state: 'dormant' }

test('a follow waiting on an issue nobody has posted says which one', () => {
  expect(followStatus({ ...base, state: 'wanted', want: { id: 2, number: '7', name: null }, queued: false }))
    .toBe('#7 is out — not posted yet')
})

test('a follow whose issue is on its way says so instead', () => {
  expect(followStatus({ ...base, state: 'wanted', want: { id: 2, number: '7', name: null }, queued: true }))
    .toBe('Getting #7')
})

test('an issue with no number is still described', () => {
  expect(followStatus({ ...base, state: 'wanted', want: { id: 2, number: null, name: null }, queued: true }))
    .toBe('Getting the next issue')
})

test('a caught-up follow is waiting on an announcement', () => {
  expect(followStatus({ ...base, state: 'caught-up' })).toBe('Waiting on the next issue to be announced')
})

test('a dormant follow explains what would start it', () => {
  expect(followStatus({ ...base, state: 'dormant' }))
    .toBe('Nothing read yet — finish an issue to pull the next')
})

test('a supplied follow has nothing to say', () => {
  expect(followStatus({ ...base, state: 'supplied' })).toBe('')
})

test('not queued with no number says the issue is out', () => {
  expect(followStatus({ ...base, state: 'wanted', want: { id: 2, number: null, name: null }, queued: false }))
    .toBe('The next issue is out — not posted yet')
})

test('wanted without a want object does not crash', () => {
  expect(followStatus({ ...base, state: 'wanted', queued: false }))
    .toBe('The next issue is out — not posted yet')
})

test('queued but undefined queued flag is treated as not queued', () => {
  expect(followStatus({ ...base, state: 'wanted', want: { id: 2, number: '7', name: null } }))
    .toBe('#7 is out — not posted yet')
})

test('a caught-up follow says when the next issue lands', () => {
  expect(followStatus({ ...base, state: 'caught-up' }, { state: 'next', week: '2026-10-28' }))
    .toBe('Next: 28 Oct 2026')
})

test('a caught-up follow nobody has solicited says there is no more to tell', () => {
  expect(followStatus({ ...base, state: 'caught-up' }, { state: 'none' }))
    .toBe('Waiting on the next issue — no further details')
})

test('a caught-up follow claims nothing while the calendar is still loading', () => {
  expect(followStatus({ ...base, state: 'caught-up' }, { state: 'pending' }))
    .toBe('Waiting on the next issue to be announced')
})

test('a solicitation does not change what any other state says', () => {
  const soon = { state: 'next' as const, week: '2026-10-28' }
  expect(followStatus({ ...base, state: 'dormant' }, soon))
    .toBe('Nothing read yet — finish an issue to pull the next')
  expect(followStatus({ ...base, state: 'supplied' }, soon)).toBe('')
})
