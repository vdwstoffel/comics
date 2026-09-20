import { releaseKind } from './comicGrouping.js'
import type { ReleaseKind } from './comicGrouping.js'

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

/**
 * The series two names agree on, or do not.
 *
 * Deliberately not `seriesKey`, which files a title under the series it is *displayed*
 * with and drops the subtitle to do it: "Avengers – Armageddon #2" keys as "avengers"
 * there, which is right for grouping a shelf and useless as proof of identity. Matching
 * needs the whole name, because the subtitle is the part that says which series it is.
 *
 * What the two sources do disagree about is punctuation - the scrape writes
 * "Avengers – Armageddon" where Comic Vine writes "Avengers: Armageddon" - so every
 * separator folds to a space. A hyphen inside a word is left alone: it holds
 * "Spider-Man" and "All-New Venom" together, and those are real distinctions.
 */
const SEPARATORS = /\s*[:–—]\s*|\s+-\s+/g
/** A trailing "(TPB)", "(One Shot)", "(2011)" — repeated, since titles stack them. */
const TRAILING_PARENS = /\s*\([^)]*\)\s*$/

export function matchKey(title: string): string {
  const beforeNumber = title.includes('#') ? title.slice(0, title.indexOf('#')) : title
  let name = beforeNumber.trim()
  // Stacked, so "(TPB) (2011)" comes off entirely rather than one layer per pass.
  let shorter = name.replace(TRAILING_PARENS, '')
  while (shorter !== name && shorter.trim()) {
    name = shorter
    shorter = name.replace(TRAILING_PARENS, '')
  }
  const key = name.replace(SEPARATORS, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^the\s+/i, '').toLowerCase()
  // Stripping everything away would let two unrelated titles key alike and match.
  return key || title.trim().toLowerCase()
}

/** A Comic Vine issue the library does not have, reduced to what the rule reads. */
export interface MissingIssue {
  /** Already through matchKey, so both sides of the comparison are normalised. */
  matchKey: string
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

/** The kinds of post that are one issue you can download, as opposed to a set of them. */
const SINGLE_ISSUE = new Set<ReleaseKind>(['issue', 'miniseries'])

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
    // A miniseries is: that kind separates an offshoot from its parent's numbering when
    // grouping a shelf, and "Avengers – Armageddon #2" is still one issue to download.
    // Reading the whole name as the key is what keeps the offshoot off the parent here.
    && SINGLE_ISSUE.has(releaseKind(c.title))
    && matchKey(c.title) === issue.matchKey
  )

  return hits.length === 1 ? hits[0]! : null
}
