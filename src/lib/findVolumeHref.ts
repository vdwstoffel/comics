/**
 * Where Find sends you for a whole volume: the index search, with the volume's name and
 * a window around the year it launched.
 *
 * Comic Vine gives a volume a start year and no end year, so there is no honest way to
 * bound a run from its own record - The Amazing Spider-Man (1963) ran to 1998 and says
 * only "1963". The window is drawn around the launch instead, which is the part of a run
 * you go looking for first, and it is widened by a year on each side for the same reason
 * the issue search backs its floor off: the scraped release year and Comic Vine's year
 * disagree by about that much (see findIssueHref).
 */
export function findVolumeHref(name: string, startYear?: number): string {
  const params = new URLSearchParams({ q: name })
  if (startYear != null && Number.isInteger(startYear)) {
    params.set('yearFrom', String(startYear - 1))
    params.set('yearTo', String(startYear + 1))
  }
  return `/search?${params}`
}
