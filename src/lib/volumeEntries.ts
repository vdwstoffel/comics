import type { ApiBook, ApiEditionExtra, ApiVolumeIssue } from '../api'
import { tileLabel } from './tileLabel'

/**
 * One issue of the run as the volume page shows it, whichever of three places it came
 * from: Comic Vine's run, a book of yours Comic Vine does not list, or - for an edition
 * with no volume at all - the books alone.
 *
 * Flat on purpose. The carousel, the identity line, the detail block and the sidebar each
 * read a few fields of this, and three different shapes of "an issue" threaded through
 * four components is how the same comic ends up labelled two ways on one screen.
 */
export interface VolumeEntry {
  key: string
  /** `#12`, or a title or filename for a book with no number. */
  label: string
  owned: boolean
  /** Comic Vine's issue id. Absent for a book outside the run - there is nothing to get. */
  issueId?: number
  bookId?: number
  coverUrl?: string
  readState?: 'unread' | 'reading' | 'read'
  percent?: number
  /** Where the cover opens. Absent whenever there is no book behind the entry. */
  readTo?: string
  title?: string | null
  date?: string | null
  year?: number | null
  publisher?: string | null
  pageCount?: number
  /** Whether what is known about the comic is written into the file itself. */
  comicinfoSynced?: boolean
  summary?: string | null
  writer?: string | null
  penciller?: string | null
  /** Comic Vine's page for the issue, which is all a gap has to link to. */
  siteUrl?: string
  coverDate?: string
  match?: { indexId: number; title: string } | null
}

interface VolumeEntriesInput {
  issues: ApiVolumeIssue[]
  extras: ApiEditionExtra[]
  books: ApiBook[]
}

/** The fields an entry takes from a book, when there is a book to take them from. */
function fromBook(book: ApiBook): Partial<VolumeEntry> {
  return {
    bookId: book.id,
    coverUrl: `/api/books/${book.id}/thumbnail`,
    readTo: `/read/${book.id}`,
    readState: book.readState,
    percent: book.percent,
    title: book.title,
    date: book.date,
    year: book.year,
    publisher: book.publisher,
    pageCount: book.pageCount,
    comicinfoSynced: book.comicinfoSynced,
    summary: book.summary,
    writer: book.writer,
    penciller: book.penciller,
  }
}

/**
 * The run, in the order it should be walked: Comic Vine's issues first, then the comics
 * you hold that it does not list, then - if there was no run at all - just your comics.
 *
 * An issue the run calls owned whose book is not in `books` keeps its place but loses its
 * cover and its link. That is not a defensive crouch: the page's book list is filtered by
 * `?status=`, so "owned, but not in this list" is an ordinary state, and a tile linking to
 * a book the page does not hold would be a broken image above a dead link.
 */
export function volumeEntries({ issues, extras, books }: VolumeEntriesInput): VolumeEntry[] {
  const byId = new Map(books.map((b) => [b.id, b]))

  const run: VolumeEntry[] = issues.map((issue) => {
    const book = issue.bookId != null ? byId.get(issue.bookId) : undefined
    return {
      key: `issue-${issue.id}`,
      label: `#${issue.number ?? '?'}`,
      owned: issue.owned,
      issueId: issue.id,
      siteUrl: issue.siteUrl,
      coverDate: issue.coverDate,
      match: issue.match,
      // Comic Vine's story title is the gap's only name; a book of your own overrides it
      // below, because what the file says it is beats what the catalogue says it is.
      title: issue.name,
      ...(book ? fromBook(book) : {}),
    }
  })

  const outside: VolumeEntry[] = extras.map((extra) => {
    const book = byId.get(extra.bookId)
    return {
      key: `extra-${extra.bookId}`,
      label: tileLabel(book, extra.number, extra.title),
      owned: true,
      title: extra.title,
      ...(book ? fromBook(book) : {}),
    }
  })

  if (run.length > 0 || outside.length > 0) return [...run, ...outside]

  // No volume, or a volume Comic Vine would not give us: the comics themselves are the
  // whole run as far as this page can tell.
  return books.map((book) => ({
    key: `book-${book.id}`,
    label: tileLabel(book),
    owned: true,
    ...fromBook(book),
  }))
}
