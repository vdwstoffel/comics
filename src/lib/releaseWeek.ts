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
