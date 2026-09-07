import type { ApiBook } from '../api'

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

