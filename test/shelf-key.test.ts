import { test, expect } from 'vitest'
import { shelfKeyOf, volumeIdOfKey } from '../server/lib/shelfKey.js'

test('a collection keys on what it reprints, a run on itself', () => {
  expect(shelfKeyOf({ id: 84, comicvineId: 150443, collectsVolumeId: 142577 })).toBe('volume:142577')
  expect(shelfKeyOf({ id: 16, comicvineId: 163325, collectsVolumeId: null })).toBe('volume:163325')
})

test('an edition Comic Vine knows nothing about keys on itself alone', () => {
  expect(shelfKeyOf({ id: 7, comicvineId: null, collectsVolumeId: null })).toBe('edition:7')
})

// Review Focus 3: a mis-confirm can point an edition at its own volume.
test('a self-referencing link yields one key, not two', () => {
  expect(shelfKeyOf({ id: 9, comicvineId: 142577, collectsVolumeId: 142577 })).toBe('volume:142577')
})

test('a volume key carries its number back out, an edition key does not', () => {
  expect(volumeIdOfKey('volume:142577')).toBe(142577)
  expect(volumeIdOfKey('edition:7')).toBeNull()
})
