import { seriesKey, releaseKind } from './comicGrouping.js'

/**
 * How far a scraped year may sit from a Comic Vine cover year and still be the same
 * issue. Comic Vine's cover date runs ahead of the release the scraper sees - Venom
 * #251 has a 2026-01 cover date and is posted as "Venom #251 (2025)".
 *
 * Measured, not guessed: across the library's 32 missing issues, ±0 loses five real
 * matches and ±2 admits twelve ambiguities. ±1 is the only value that resolves every
 * issue without admitting one. Exported because the SQL window that gathers candidates
 * has to agree with the filter that judges them.
 */
export const YEAR_SLACK = 1

/** A Comic Vine issue the library does not have, reduced to what the rule reads. */
export interface MissingIssue {
  seriesKey: string
  /** Already through parseNumber, so both sides of the comparison are normalised. */
  number: string
  coverYear: number | null
}

/** A scraped index row, reduced to what the rule reads. */
export interface IndexCandidate {
  id: number
  title: string
  number: string | null
  year: number | null
}

/**
 * The one index row that is this issue, or nothing.
 *
 * Nothing means either no candidate qualified or several did, and the caller cannot
 * tell which - because neither licenses a download. A wrong match here downloads the
 * wrong comic into a run, so the rule refuses wherever it cannot be certain: "Venom #1"
 * exists for the 2016, 2018 and 2021 volumes, and no amount of ranking makes a guess
 * between them honest.
 */
export function matchIssue(candidates: IndexCandidate[], issue: MissingIssue): IndexCandidate | null {
  const { coverYear } = issue
  if (coverYear === null) return null

  const hits = candidates.filter((c) =>
    c.number === issue.number
    && c.year !== null
    && Math.abs(c.year - coverYear) <= YEAR_SLACK
    // A bundle or a collected edition is not a single issue, however its number parses.
    && releaseKind(c.title) === 'issue'
    && seriesKey(c.title) === issue.seriesKey
  )

  return hits.length === 1 ? hits[0]! : null
}
