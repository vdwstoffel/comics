import { test, expect, beforeEach, afterEach } from 'vitest'
import { openDb } from '../server/db.js'
import type { Db } from '../server/types.js'
import type { CvVolume } from '../server/lib/comicvine.js'
import {
  cacheVolumeRecord,
  getCachedVolumeRecord,
  getVolumeCached,
  VOLUME_RECORD_CACHE_MAX_AGE_MS,
} from '../server/models/volumeRecord.js'

const VOLUME: CvVolume = {
  name: 'Avengers',
  publisher: 'Marvel',
  summary: 'Earth\'s mightiest heroes.',
  descriptionHtml: '<p>Earth\'s mightiest heroes.</p>',
  startYear: 2013,
  siteUrl: 'https://comicvine.gamespot.com/avengers/4050-42/',
}

let db: Db
beforeEach(() => { db = openDb(':memory:') })
afterEach(() => { db.close() })

test('a cached record comes back whole', () => {
  cacheVolumeRecord(db, 42, VOLUME)
  expect(getCachedVolumeRecord(db, 42)).toEqual(VOLUME)
})

// detectCollects reads descriptionHtml off a volume, so a cache that dropped it would
// hand that caller a silently thinner record than the live fetch does.
test('the markup description survives the round trip', () => {
  cacheVolumeRecord(db, 42, VOLUME)
  expect(getCachedVolumeRecord(db, 42)?.descriptionHtml).toBe(VOLUME.descriptionHtml)
})

test('an absent field stays absent rather than becoming null', () => {
  cacheVolumeRecord(db, 7, { name: 'Thin' })
  const held = getCachedVolumeRecord(db, 7)
  expect(held).toEqual({ name: 'Thin' })
  expect('startYear' in held!).toBe(false)
})

test('a volume never asked about is undefined', () => {
  expect(getCachedVolumeRecord(db, 999)).toBeUndefined()
})

test('a record past its max age is not served', () => {
  const then = new Date('2026-10-01T00:00:00.000Z')
  cacheVolumeRecord(db, 42, VOLUME, then.toISOString())
  const later = new Date(then.getTime() + VOLUME_RECORD_CACHE_MAX_AGE_MS + 1000)
  expect(getCachedVolumeRecord(db, 42, VOLUME_RECORD_CACHE_MAX_AGE_MS, later)).toBeUndefined()
})

test('Infinity reads a record at any age', () => {
  const then = new Date('2020-01-01T00:00:00.000Z')
  cacheVolumeRecord(db, 42, VOLUME, then.toISOString())
  expect(getCachedVolumeRecord(db, 42, Infinity, new Date())).toEqual(VOLUME)
})

test('getVolumeCached makes one fetch for two calls with the same id', async () => {
  let calls = 0
  const cv = { getVolume: async () => { calls++; return VOLUME } }
  expect(await getVolumeCached(db, cv, 42)).toEqual(VOLUME)
  expect(await getVolumeCached(db, cv, 42)).toEqual(VOLUME)
  expect(calls).toBe(1)
})

test('getVolumeCached serves a stale record when Comic Vine throws', async () => {
  cacheVolumeRecord(db, 42, VOLUME, new Date('2020-01-01T00:00:00.000Z').toISOString())
  const cv = { getVolume: async () => { throw new Error('Comic Vine HTTP 500') } }
  expect(await getVolumeCached(db, cv, 42)).toEqual(VOLUME)
})

test('getVolumeCached is undefined when Comic Vine throws and nothing is held', async () => {
  const cv = { getVolume: async () => { throw new Error('Comic Vine HTTP 500') } }
  expect(await getVolumeCached(db, cv, 42)).toBeUndefined()
})

test('a second cache of the same volume replaces the first', () => {
  cacheVolumeRecord(db, 42, VOLUME)
  cacheVolumeRecord(db, 42, { name: 'Renamed' })
  expect(getCachedVolumeRecord(db, 42)).toEqual({ name: 'Renamed' })
})
