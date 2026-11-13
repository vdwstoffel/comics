import type { ApiBook, ApiVolumeIssue } from '../api'

/**
 * What an issue of the run is called on its tile: "#12", or "Annual #1" for one of the
 * run's annuals. Never a bare number for an annual - it sits among the run's own issues,
 * and "#1" there reads as the run's #1.
 */
export function runIssueLabel(issue: Pick<ApiVolumeIssue, 'number' | 'annual'>): string {
  return `${issue.annual ? 'Annual ' : ''}#${issue.number ?? '?'}`
}

/**
 * What to call a comic on a tile. A comic that has not been matched yet has neither a
 * title nor an issue number, and "#?" says nothing about which comic it is — so the
 * filename you uploaded stands in until Comic Vine fills the rest in.
 */
export function tileLabel(book: ApiBook | undefined, fallbackNumber?: string | null, fallbackTitle?: string | null): string {
  const title = book?.title || fallbackTitle
  if (title) return title
  const number = book?.number ?? fallbackNumber
  if (number) return `#${number}`
  const file = book?.filePath
  if (file) return file.split('/').pop()!.replace(/\.[^.]+$/, '')
  return 'Untitled'
}

