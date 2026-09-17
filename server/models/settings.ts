import type { Db } from '../types.js'

/**
 * How many downloads may run at once.
 *
 * The ceiling is calibrated to the Comic Vine budget rather than to the file host:
 * each download builds its own throttled client, so N downloads make N times the
 * requests. Five is comfortable against 200 an hour; it is also low enough that a
 * mistyped number cannot open twenty connections to a scraped file host.
 */
export const CONCURRENCY_MIN = 1
export const CONCURRENCY_MAX = 5
export const CONCURRENCY_DEFAULT = 1

const CONCURRENCY_KEY = 'download_concurrency'

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

/**
 * The pool size. Clamped on read as well as on write: a row put there by hand, or
 * written by a future version with a wider range, must not make the pool take
 * unbounded work. Anything unparseable reads as the default rather than NaN.
 */
export function getDownloadConcurrency(db: Db): number {
  const raw = getSetting(db, CONCURRENCY_KEY)
  const n = Number(raw)
  if (raw == null || !Number.isFinite(n)) return CONCURRENCY_DEFAULT
  return Math.min(Math.max(Math.trunc(n), CONCURRENCY_MIN), CONCURRENCY_MAX)
}

/** False, and nothing written, when `n` is not a whole number inside the range. */
export function setDownloadConcurrency(db: Db, n: number): boolean {
  if (!Number.isInteger(n) || n < CONCURRENCY_MIN || n > CONCURRENCY_MAX) return false
  setSetting(db, CONCURRENCY_KEY, String(n))
  return true
}

const COMIC_VINE_KEY = 'comic_vine_api_key'

/**
 * The Comic Vine key as it stands right now.
 *
 * The empty string when unset rather than `undefined`: every guard in the app asks
 * `if (!key)`, and the two shapes would read identically at those sites while differing
 * everywhere else.
 */
export function getComicVineKey(db: Db): string {
  return getSetting(db, COMIC_VINE_KEY) ?? ''
}

/** Trimmed on the way in - a pasted key carries whitespace, and a trailing newline in a
 *  query string is a rejected key with no visible cause. The empty string clears it. */
export function setComicVineKey(db: Db, key: string): void {
  setSetting(db, COMIC_VINE_KEY, key.trim())
}
