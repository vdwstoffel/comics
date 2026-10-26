/**
 * Build the Comic Vine search a book opens with.
 *
 * Comic Vine's search matches volumes, so "Amazing Spider-Man #11" finds the issue and
 * "Death to the Task Master" does not - the issue title is deliberately unused. A file
 * imported without a ComicInfo.xml has neither title nor number in the database, which
 * leaves its name the only thing left to read them off.
 *
 * The reading of the file name itself lives in `comicFileParse.ts`, shared with the bulk
 * matcher. It used to be inlined here twice; a bulk screen and this page disagreeing about
 * what `Avengers 024.NOW` is would be invisible until it filed the wrong comic.
 */

import { parseComicFileName, normalizeIssueNumber } from './comicFileParse'
import type { ApiBook, ApiEdition } from '../api'

/**
 * The query, built from a file name alone.
 *
 * Before an upload there is no book row to read - only the file you picked - and the
 * pre-upload search must parse that name exactly as the post-upload one does, or the two
 * would disagree about the same file. `series` is anything already known about where the
 * comic belongs; without it the name in the file has to serve.
 */
export function cvQueryFromFileName(fileName: string, series?: string | null): string {
  const { series: nameFromFile, number } = parseComicFileName(fileName)
  const seriesName = series?.trim() || nameFromFile

  // A collection has no issue number to search by, so its file name - which reads as a
  // title once the release tags are gone - is a better query than the series alone.
  // parseComicFileName hands back the whole stem as the series in exactly that case.
  if (!number) return nameFromFile || seriesName
  return [seriesName, `#${number}`].filter(Boolean).join(' ')
}

export function buildCvQuery(book: ApiBook, edition: ApiEdition | undefined): string {
  const fileName = (book.filePath ?? '').split('/').pop() ?? ''
  const { series: nameFromFile, number: numberFromFile } = parseComicFileName(fileName)

  const number = normalizeIssueNumber(book.number) || numberFromFile
  const editionName = edition?.name?.trim() ?? ''
  const series = edition?.seriesName?.trim() || nameFromFile || editionName

  if (!number) return nameFromFile || series
  return [series, `#${number}`].filter(Boolean).join(' ')
}
