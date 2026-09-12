import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  cacheVolumeSearch, getCachedVolumeSearch, VOLUME_SEARCH_CACHE_MAX_AGE_MS,
} from '../server/models/volumeSearch.js'
import type { CvVolumeMatch } from '../server/lib/comicvine.js'

const MATCHES: CvVolumeMatch[] = [
  {
    id: 86113, name: 'Mighty Thor', startYear: 2016, publisher: 'Marvel',
    issueCount: 30, deck: 'Jane Foster lifts the hammer.',
    thumbnail: 't.jpg', siteUrl: 'https://comicvine.gamespot.com/mighty-thor/4050-86113/',
  },
  { id: 39763, name: 'The Mighty Thor', startYear: 2011, publisher: 'Marvel', issueCount: 23 },
]

test('a cached volume search comes back with every field it went in with', () => {
  const db = openDb(':memory:')
  cacheVolumeSearch(db, 'the mighty thor', MATCHES)

  expect(getCachedVolumeSearch(db, 'the mighty thor')?.volumes).toEqual(MATCHES)
  db.close()
})

test('a search never made is absent rather than empty', () => {
  const db = openDb(':memory:')

  expect(getCachedVolumeSearch(db, 'the mighty thor')).toBeUndefined()
  db.close()
})

test("a search Comic Vine matched nothing for is remembered, so it is not asked again", () => {
  const db = openDb(':memory:')
  cacheVolumeSearch(db, 'nothing at all', [])

  expect(getCachedVolumeSearch(db, 'nothing at all')).toMatchObject({ volumes: [] })
  db.close()
})

test('Comic Vine relevance order survives the round trip', () => {
  const db = openDb(':memory:')
  cacheVolumeSearch(db, 'the mighty thor', MATCHES)

  expect(getCachedVolumeSearch(db, 'the mighty thor')?.volumes.map((v) => v.id)).toEqual([86113, 39763])
  db.close()
})

test('an answer older than the cache age is not served', () => {
  const db = openDb(':memory:')
  const then = new Date('2026-09-01T00:00:00.000Z')
  cacheVolumeSearch(db, 'the mighty thor', MATCHES, then.toISOString())

  const later = new Date(then.getTime() + VOLUME_SEARCH_CACHE_MAX_AGE_MS + 1000)
  expect(getCachedVolumeSearch(db, 'the mighty thor', VOLUME_SEARCH_CACHE_MAX_AGE_MS, later)).toBeUndefined()
  db.close()
})

test('an aged-out answer can still be read at any age, for when Comic Vine will not answer', () => {
  const db = openDb(':memory:')
  const then = new Date('2026-09-01T00:00:00.000Z')
  cacheVolumeSearch(db, 'the mighty thor', MATCHES, then.toISOString())

  const later = new Date(then.getTime() + VOLUME_SEARCH_CACHE_MAX_AGE_MS + 1000)
  expect(getCachedVolumeSearch(db, 'the mighty thor', Infinity, later)?.volumes).toEqual(MATCHES)
  db.close()
})

test('re-asking replaces the previous answer rather than appending to it', () => {
  const db = openDb(':memory:')
  cacheVolumeSearch(db, 'the mighty thor', MATCHES)
  cacheVolumeSearch(db, 'the mighty thor', [{ id: 44149, name: 'The Mighty Thor', startYear: 2011 }])

  expect(getCachedVolumeSearch(db, 'the mighty thor')?.volumes.map((v) => v.id)).toEqual([44149])
  db.close()
})

test('two series keep their own answers', () => {
  const db = openDb(':memory:')
  cacheVolumeSearch(db, 'the mighty thor', MATCHES)
  cacheVolumeSearch(db, 'batman', [{ id: 42, name: 'Batman', startYear: 2011 }])

  expect(getCachedVolumeSearch(db, 'batman')?.volumes.map((v) => v.id)).toEqual([42])
  expect(getCachedVolumeSearch(db, 'the mighty thor')?.volumes.map((v) => v.id)).toEqual([86113, 39763])
  db.close()
})

test('the series name is matched however it was capitalised or spaced', () => {
  const db = openDb(':memory:')
  cacheVolumeSearch(db, 'The Mighty Thor', MATCHES)

  expect(getCachedVolumeSearch(db, '  the   MIGHTY thor ')?.volumes).toEqual(MATCHES)
  db.close()
})
