/**
 * Reading a comic's identity off its file name.
 *
 * One parser, because two of them drift. Before this existed the rule lived inlined in
 * `cvQuery.ts`'s two query builders, which was fine while a file name was only ever turned
 * into a search string. Bulk add matches on the same number, and a bulk screen that
 * disagreed with the Upload page about what `Avengers 024.NOW` is would be the worst kind
 * of bug: invisible until it files the wrong comic.
 *
 * What the names actually look like, from the library's own folders:
 *
 *   Avengers 020 (2013) (Digital) (Zone-Empire).cbr   → Avengers, 20
 *   Avengers 024.NOW (2014) (Digital) (Zone-Empire).cbr → Avengers, 24.now
 *   Amazing Spider-Man 016.1 (2015).cbz               → Amazing Spider-Man, 16.1
 *   Avengers Omnibus.cbz                              → Avengers Omnibus, null
 */

// Trailing "(2025)", "(Digital)", "(Shan-Empire)" and their bracketed cousins.
const RELEASE_TAG_RE = /\s*(\([^)]*\)|\[[^\]]*\])\s*$/

// A number closing the name, preceded by a space or standing alone, so the "02" of an
// omnibus "v02" is left where it is. The dotted suffix carries 16.1 and 1.MU.
const TRAILING_NUMBER_RE = /^(?:(.*\S)\s+)?(\d+(?:\.\w+)?)$/

// Leading zeros are a file-name padding convention, not part of the issue number.
const PADDED_NUMBER_RE = /^(-?)0*(\d+)(\.\w+)?$/

/**
 * ":" and the spaced dashes, the separators the two sources disagree about - a scrape
 * writes "Avengers – Armageddon" where Comic Vine writes "Avengers: Armageddon". A hyphen
 * with no spaces around it is part of a word instead and is left alone, because
 * "Spider-Man" and "All-New Venom" are real distinctions.
 */
const SEPARATORS = /\s*[:–—]\s*|\s+-\s+/g

/** A trailing "(TPB)", "(One Shot)", "(2011)" — repeated, since titles stack them. */
const TRAILING_PARENS = /\s*\([^)]*\)\s*$/

/** The file name with its directories and extension gone, and its release tags stripped. */
function fileStem(fileName: string | undefined): string {
  const base = (fileName ?? '').split('/').pop() ?? ''
  const stem = base.replace(/\.[^.]+$/, '')
  let cleaned = stem
  while (RELEASE_TAG_RE.test(cleaned)) cleaned = cleaned.replace(RELEASE_TAG_RE, '')
  return cleaned.trim()
}

/**
 * An issue number in the one form both sides of a comparison can use: no padding, no
 * surrounding space, and lower case, so a file's "24.NOW" and a Comic Vine "24.now" are
 * one number. Null for anything blank, which is not the same as "0".
 *
 * Comic Vine's `number` is a free-text string and comes through here too — a comparison
 * where only one side is normalised is the bug this function exists to prevent.
 */
export function normalizeIssueNumber(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const parts = PADDED_NUMBER_RE.exec(trimmed)
  if (!parts) return trimmed.toLowerCase()
  const [, sign, digits, suffix = ''] = parts
  return `${sign}${digits}${suffix}`.toLowerCase()
}

/**
 * The number without its dotted suffix — "24" from "24.now" — or nothing when there is no
 * suffix to drop.
 *
 * Only ever a fallback. `.NOW`, `.LR` and `.DEATH` were Marvel's cover branding and Comic
 * Vine files those issues under the bare number, but `16.1` and `1.MU` are real Comic Vine
 * issue numbers in their own right. Trying the exact number first is what keeps the two
 * apart; see `claimForVolume`.
 */
export function baseIssueNumber(n: string): string | null {
  const dot = n.indexOf('.')
  return dot > 0 ? n.slice(0, dot) : null
}

/**
 * The series two names agree on, or do not.
 *
 * This is a DELIBERATE COPY of `matchKey` in `server/lib/issueMatch.ts`. Nothing under
 * `src/` reaches into `server/`, and `src/lib/annuals.ts` already carries the same
 * duplication for the same reason. Change one, look at the other.
 *
 * Deliberately not a "series" that drops the subtitle: matching needs the whole name,
 * because the subtitle is the part that says which series it is. "Avengers – Armageddon"
 * must not key to "Avengers", or an offshoot's #2 would be claimed by its parent.
 */
export function seriesKey(title: string): string {
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

export interface ParsedComicName {
  /** The name with release tags and the trailing number removed: "Avengers". */
  series: string
  /** Normalised, so "020" and "24.NOW" arrive as "20" and "24.now". Null when there is none. */
  number: string | null
}

/**
 * What a comic's file name says it is.
 *
 * A collection has no trailing number, and that is reported as null rather than guessed
 * at: a file we cannot number is one we cannot match, and saying so is the whole point.
 */
export function parseComicFileName(fileName: string): ParsedComicName {
  const stem = fileStem(fileName)
  const [, nameFromFile = '', numberFromFile = ''] = TRAILING_NUMBER_RE.exec(stem) ?? []
  const number = normalizeIssueNumber(numberFromFile)
  // With no trailing number the whole stem is the name - "Avengers Omnibus" is a title,
  // not a series with a missing number.
  return { series: (number === null ? stem : nameFromFile).trim(), number }
}
