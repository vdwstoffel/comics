/**
 * Which day's releases the Latest tab shows.
 *
 * New comic day is Wednesday, so the day is computed rather than searched for: asking
 * Comic Vine "what was the last day with releases" would cost a request per day scanned
 * and usually land on a Marvel Infinity Comic, which ships daily.
 *
 * Dates are `YYYY-MM-DD` strings throughout. Comic Vine's `store_date` is a plain date
 * with no timezone, so every read here is UTC - reading it locally would shift the day
 * for anyone west of Greenwich.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const WEDNESDAY = 3 // Date#getUTCDay: Sunday is 0

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Today when today is Wednesday, otherwise the Wednesday before it. */
export function mostRecentWednesday(now: Date): string {
  const back = (now.getUTCDay() - WEDNESDAY + 7) % 7
  return iso(new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back,
  )))
}

/** One week earlier. Used for the single fallback when a Wednesday holds nothing. */
export function previousWednesday(day: string): string {
  return iso(new Date(new Date(`${day}T00:00:00Z`).getTime() - 7 * DAY_MS))
}

/** A plain date moved by whole days, in UTC. */
export function shiftDays(day: string, delta: number): string {
  return iso(new Date(new Date(`${day}T00:00:00Z`).getTime() + delta * DAY_MS))
}

/**
 * The next `count` Wednesdays, starting with the one AFTER the day the Latest tab shows.
 *
 * Anchored on mostRecentWednesday rather than on `now` so the two tabs can never both
 * claim the same Wednesday: on a Wednesday the Latest tab is showing today, and today is
 * not something to look forward to.
 */
export function upcomingWednesdays(now: Date, count: number): string[] {
  const current = mostRecentWednesday(now)
  return Array.from({ length: count }, (_, i) => shiftDays(current, (i + 1) * 7))
}
