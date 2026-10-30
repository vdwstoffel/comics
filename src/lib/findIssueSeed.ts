/**
 * What Find looks for on behalf of one missing issue: the series, and a floor on the
 * release year.
 *
 * Two subtleties, which is why this is a function rather than two lines at each call site.
 *
 * The floor is backed off by a year. Comic Vine's cover date runs ahead of the scraped
 * release year - Venom #251 carries a 2026-01 cover date but is posted as
 * "Venom #251 (2025)" - so a floor set to the cover year exactly filters out the very row
 * Find exists to surface. One year is the same slack the server's matching rule tolerates
 * (YEAR_SLACK in server/lib/issueMatch.ts, deliberately not imported: src/ never reaches
 * into server/).
 *
 * The issue number is deliberately absent. The index is searched with FTS prefix tokens
 * ANDed together, so "Thor 2" becomes `"thor"* AND "2"*` - and `"2"*` matches 2024, 2025
 * and 2026 as readily as it matches 2. Measured against the live index it removed 16 rows
 * of 503, and none at all once the year floor applied. It reads as precision and is not.
 */
export interface IssueSeed {
  q: string
  yearFrom?: number
}

export function findIssueSeed(seriesName: string, coverDate?: string): IssueSeed {
  const coverYear = coverDate ? Number(String(coverDate).slice(0, 4)) : NaN
  return Number.isInteger(coverYear)
    ? { q: seriesName, yearFrom: coverYear - 1 }
    : { q: seriesName }
}

/**
 * The same search as a url, for the one place the dialog still hands you off: an index
 * that turns out not to hold the comic at all. Scraping lives on the search page, so a
 * dead end there is the one case where leaving is the right answer.
 */
export function searchHref({ q, yearFrom }: IssueSeed): string {
  const params = new URLSearchParams({ q })
  if (yearFrom !== undefined) params.set('yearFrom', String(yearFrom))
  return `/search?${params}`
}
