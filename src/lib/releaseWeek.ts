/**
 * `2026-09-09` -> `Wednesday 9 September 2026`.
 *
 * Parsed as UTC at midday: the day has no timezone, and reading it locally would move a
 * Wednesday to the Tuesday before it for anyone west of Greenwich. Shared so the releases
 * page and a volume's Coming soon list can never name the same week two different ways.
 */
export function writeOutDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/**
 * `2026-09-09` -> `9 Sep 2026`.
 *
 * The same day as writeOutDay, for places where the date is a footnote rather than the
 * heading it is on the releases page. The weekday goes because every comic ships on a
 * Wednesday: a column of them spends a word a row saying what the list already implies.
 */
export function writeOutShortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}
