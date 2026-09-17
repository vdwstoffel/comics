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
