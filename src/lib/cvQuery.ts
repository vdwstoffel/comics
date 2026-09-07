/**
 * Build the Comic Vine search a book opens with.
 *
 * Comic Vine's search matches volumes, so "Amazing Spider-Man #11" finds the issue and
 * "Death to the Task Master" does not - the issue title is deliberately unused. A file
 * imported without a ComicInfo.xml has neither title nor number in the database, which
 * leaves its name the only thing left to read them off.
 */

import type { ApiBook, ApiEdition } from '../api'

// Trailing "(2025)", "(Digital)", "(Shan-Empire)" and their bracketed cousins.
const RELEASE_TAG_RE = /\s*(\([^)]*\)|\[[^\]]*\])\s*$/

// A number closing the name, preceded by a space or standing alone, so the "02" of an
// omnibus "v02" is left where it is. The dotted suffix carries 16.1 and 1.MU.
const TRAILING_NUMBER_RE = /^(?:(.*\S)\s+)?(\d+(?:\.\w+)?)$/

// Leading zeros are a file-name padding convention, not part of the issue number.
const PADDED_NUMBER_RE = /^(-?)0*(\d+)(\.\w+)?$/

function fileStem(fileName: string | undefined): string {
  const base = (fileName ?? '').split('/').pop() ?? ''
  const stem = base.replace(/\.[^.]+$/, '')
  let cleaned = stem
  while (RELEASE_TAG_RE.test(cleaned)) cleaned = cleaned.replace(RELEASE_TAG_RE, '')
  return cleaned.trim()
}

function normalizeNumber(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  const parts = PADDED_NUMBER_RE.exec(trimmed)
  if (!parts) return trimmed
  const [, sign, digits, suffix = ''] = parts
  return `${sign}${digits}${suffix}`
}

/**
 * The same query, built from a file name alone.
 *
 * Before an upload there is no book row to read - only the file you picked - and the
 * pre-upload search must parse that name exactly as the post-upload one does, or the two
 * would disagree about the same file. `series` is anything already known about where the
 * comic belongs; without it the name in the file has to serve.
 */
export function cvQueryFromFileName(fileName: string, series?: string | null): string {
  const stem = fileStem(fileName)
  const [, nameFromFile = '', numberFromFile = ''] = TRAILING_NUMBER_RE.exec(stem) ?? []

  const number = normalizeNumber(numberFromFile)
  const seriesName = series?.trim() || nameFromFile.trim()

  // A collection has no issue number to search by, so its file name - which reads as a
  // title once the release tags are gone - is a better query than the series alone.
  if (!number) return stem || seriesName
  return [seriesName, `#${number}`].filter(Boolean).join(' ')
}

export function buildCvQuery(book: ApiBook, edition: ApiEdition | undefined): string {
  const fileName = (book.filePath ?? '').split('/').pop() ?? ''
  const stem = fileStem(fileName)
  const [, nameFromFile = '', numberFromFile = ''] = TRAILING_NUMBER_RE.exec(stem) ?? []

  const number = normalizeNumber(book.number) || normalizeNumber(numberFromFile)
  const editionName = edition?.name?.trim() ?? ''
  const series = edition?.seriesName?.trim() || nameFromFile.trim() || editionName

  if (!number) return stem || series
  return [series, `#${number}`].filter(Boolean).join(' ')
}
