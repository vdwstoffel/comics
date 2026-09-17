import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  getSetting, setSetting, getDownloadConcurrency, setDownloadConcurrency,
  CONCURRENCY_DEFAULT, CONCURRENCY_MIN, CONCURRENCY_MAX,
  getComicVineKey, setComicVineKey,
} from '../server/models/settings.js'

const db = () => openDb(':memory:')

test('a setting round-trips', () => {
  const d = db()
  setSetting(d, 'colour', 'green')
  expect(getSetting(d, 'colour')).toBe('green')
})

test('setting the same key again replaces it rather than failing', () => {
  const d = db()
  setSetting(d, 'colour', 'green')
  setSetting(d, 'colour', 'blue')
  expect(getSetting(d, 'colour')).toBe('blue')
})

test('a key that was never set reads as undefined', () => {
  expect(getSetting(db(), 'nothing')).toBeUndefined()
})

// An install that never opens the control must behave exactly as it does today.
test('concurrency defaults to one when the row is absent', () => {
  expect(getDownloadConcurrency(db())).toBe(CONCURRENCY_DEFAULT)
  expect(CONCURRENCY_DEFAULT).toBe(1)
})

test('concurrency round-trips through the typed pair', () => {
  const d = db()
  expect(setDownloadConcurrency(d, 3)).toBe(true)
  expect(getDownloadConcurrency(d)).toBe(3)
})

test('both ends of the range are accepted', () => {
  const d = db()
  expect(setDownloadConcurrency(d, CONCURRENCY_MIN)).toBe(true)
  expect(getDownloadConcurrency(d)).toBe(1)
  expect(setDownloadConcurrency(d, CONCURRENCY_MAX)).toBe(true)
  expect(getDownloadConcurrency(d)).toBe(5)
})

// The dropdown is convenience. This is the guard.
test('a value outside the range is refused and writes nothing', () => {
  const d = db()
  setDownloadConcurrency(d, 3)
  for (const bad of [0, -1, 6, 99, 2.5, NaN, Infinity]) {
    expect(setDownloadConcurrency(d, bad)).toBe(false)
  }
  expect(getDownloadConcurrency(d)).toBe(3)
})

// A row put there by hand, or by a future version with a different range, must not
// make the pool take unbounded work.
test('a stored value outside the range is clamped on read', () => {
  const d = db()
  setSetting(d, 'download_concurrency', '99')
  expect(getDownloadConcurrency(d)).toBe(CONCURRENCY_MAX)
  setSetting(d, 'download_concurrency', '0')
  expect(getDownloadConcurrency(d)).toBe(CONCURRENCY_MIN)
})

test('a stored value that is not a number falls back to the default', () => {
  const d = db()
  setSetting(d, 'download_concurrency', 'three')
  expect(getDownloadConcurrency(d)).toBe(CONCURRENCY_DEFAULT)
})

test('a fresh install has no Comic Vine key, reported as the empty string', () => {
  const d = openDb(':memory:')
  expect(getComicVineKey(d)).toBe('')
})

test('a Comic Vine key round-trips', () => {
  const d = openDb(':memory:')
  setComicVineKey(d, 'abc123')
  expect(getComicVineKey(d)).toBe('abc123')
})

// A key pasted out of a web page arrives with whitespace, and a trailing newline in a
// query string is a rejected key with no visible cause.
test('whitespace around a pasted key is trimmed away', () => {
  const d = openDb(':memory:')
  setComicVineKey(d, '  abc123\n')
  expect(getComicVineKey(d)).toBe('abc123')
})

test('the empty string clears the key rather than storing a blank one', () => {
  const d = openDb(':memory:')
  setComicVineKey(d, 'abc123')
  setComicVineKey(d, '')
  expect(getComicVineKey(d)).toBe('')
})
