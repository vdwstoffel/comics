/**
 * Where Find sends you for one issue: the index search, with the series and a year floor
 * filled in so you can choose the right post by eye.
 *
 * The floor is the subtle part, and the reason this is a function rather than two lines
 * at each call site. Comic Vine's cover date runs ahead of the scraped release year -
 * Venom #251 carries a 2026-01 cover date but is posted as "Venom #251 (2025)" - so a
 * floor set to the cover year exactly filters out the very row Find exists to surface.
 * It is backed off by the same one year the server's matching rule tolerates (YEAR_SLACK
 * in server/lib/issueMatch.ts, deliberately not imported: src/ never reaches into server/).
 */
export function findIssueHref(seriesName: string, coverDate?: string): string {
  const params = new URLSearchParams({ q: seriesName })
  const coverYear = coverDate ? Number(String(coverDate).slice(0, 4)) : NaN
  if (Number.isInteger(coverYear)) params.set('yearFrom', String(coverYear - 1))
  return `/search?${params}`
}
