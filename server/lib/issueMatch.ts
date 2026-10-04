import { releaseKind } from './comicGrouping.js'
import type { ReleaseKind } from './comicGrouping.js'

/**
 * The cover months that may be posted under the year before. Comic Vine's cover date runs
 * ahead of the release the scraper sees - Venom #251 has a 2026-01 cover date and is
 * posted as "Venom #251 (2025)" - but only by a couple of months, so only an early-year
 * cover can cross into the previous year.
 *
 * Measured, not guessed: of the library's 701 unambiguous matches, 106 sit a year behind
 * the cover, every one with a January to March cover. The three that sat a year *ahead*
 * were all a different series, so the window never reaches forward.
 *
 * A flat ±1 year is what this replaced, and it could not tell a relaunch from the run
 * before it: Iron Man #4 with a 2026-06 cover matched both "Iron Man #4 (2025)" and
 * "Iron Man #4 (2026)", and two matches is no match.
 */
const LAST_EARLY_MONTH = 3

/**
 * The years a post of this issue may be listed under, or nothing for a cover date with
 * no year. A cover date with no month cannot rule out the early months, so it allows the
 * year before. Exported because the SQL that gathers candidates has to agree with the
 * filter that judges them.
 */
export function releaseYears(coverDate: string | null | undefined): { from: number; to: number } | null {
  const match = /^(\d{4})(?:-(\d{2}))?/.exec(String(coverDate ?? ''))
  if (!match) return null
  const year = Number(match[1])
  const month = match[2] ? Number(match[2]) : null
  const early = month === null || month <= LAST_EARLY_MONTH
  return { from: early ? year - 1 : year, to: year }
}

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
  /** Comic Vine's cover date, which is what decides the years a post may carry. */
  coverDate: string | null
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
  const years = releaseYears(issue.coverDate)
  if (!years) return null

  const hits = candidates.filter((c) =>
    c.number === issue.number
    && c.year !== null
    && c.year >= years.from && c.year <= years.to
    // A bundle or a collected edition is not a single issue, however its number parses.
    // A miniseries is: that kind separates an offshoot from its parent's numbering when
    // grouping a shelf, and "Avengers – Armageddon #2" is still one issue to download.
    // Reading the whole name as the key is what keeps the offshoot off the parent here.
    && SINGLE_ISSUE.has(releaseKind(c.title))
    && matchKey(c.title) === issue.matchKey
  )

  return hits.length === 1 ? hits[0]! : null
}
