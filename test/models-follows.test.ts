import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  addFollow, getFollow, listFollows, removeFollow, removeFollowsForEdition,
} from '../server/models/follows.js'

test('a follow can be added and read back', () => {
  const db = openDb(':memory:')
  const added = addFollow(db, 'volume', 7, 'Iron Man', '2026-10-04T10:00:00.000Z')
  expect(added).toEqual({ kind: 'volume', refId: 7, name: 'Iron Man', createdAt: '2026-10-04T10:00:00.000Z' })
  expect(getFollow(db, 'volume', 7)).toEqual(added)
})

test('following the same thing twice is idempotent and refreshes the name', () => {
  const db = openDb(':memory:')
  addFollow(db, 'volume', 7, 'Iron Man', '2026-10-04T10:00:00.000Z')
  addFollow(db, 'volume', 7, 'Iron Man (2020)', '2026-10-05T10:00:00.000Z')
  expect(listFollows(db)).toHaveLength(1)
  expect(getFollow(db, 'volume', 7)?.name).toBe('Iron Man (2020)')
  // The day you first followed it is the day it says, not the day you pressed again.
  expect(getFollow(db, 'volume', 7)?.createdAt).toBe('2026-10-04T10:00:00.000Z')
})

test('a volume and an arc with the same id are different follows', () => {
  const db = openDb(':memory:')
  addFollow(db, 'volume', 42, 'Daredevil')
  addFollow(db, 'arc', 42, 'Shadowland')
  expect(listFollows(db)).toHaveLength(2)
})

test('removing a follow reports whether there was one', () => {
  const db = openDb(':memory:')
  addFollow(db, 'arc', 56676, 'Death Spiral')
  expect(removeFollow(db, 'arc', 56676)).toBe(true)
  expect(removeFollow(db, 'arc', 56676)).toBe(false)
  expect(listFollows(db)).toEqual([])
})

// Review Focus 1: the polymorphic key means ref_id alone is not an identity.
test('dropping an edition leaves an arc that happens to share its id alone', () => {
  const db = openDb(':memory:')
  addFollow(db, 'volume', 42, 'Daredevil')
  addFollow(db, 'arc', 42, 'Shadowland')
  removeFollowsForEdition(db, 42)
  expect(listFollows(db)).toEqual([
    expect.objectContaining({ kind: 'arc', refId: 42, name: 'Shadowland' }),
  ])
})
