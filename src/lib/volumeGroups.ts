import type { ApiLibraryBook } from '../api'

export interface VolumeGroup {
  editionId: number
  editionName: string
  books: ApiLibraryBook[]
}

/**
 * The unread shelf, one entry per volume instead of one per comic.
 *
 * Grouped by edition id rather than by adjacency. The server already sorts its answer by
 * series then issue number, so a volume's comics do arrive together and a fold over
 * neighbours would work today — but it would quietly split a volume in two the day that
 * sort changed, and the map costs nothing to be right either way.
 *
 * Insertion order is kept, so the shelf reads in whatever order the server chose.
 */
export function groupByVolume(books: ApiLibraryBook[]): VolumeGroup[] {
  const groups = new Map<number, VolumeGroup>()
  for (const book of books) {
    const group = groups.get(book.editionId)
    if (group) group.books.push(book)
    else groups.set(book.editionId, { editionId: book.editionId, editionName: book.editionName, books: [book] })
  }
  return [...groups.values()]
}
