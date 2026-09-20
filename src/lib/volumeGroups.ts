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

export interface SeriesGroup {
  /** Case-folded name: what two volumes of one series agree on. */
  key: string
  /** The series as it should be read, in the case the first volume spelled it. */
  name: string
  volumes: VolumeGroup[]
}

/**
 * A series' key, matching the rule the server groups editions by. A volume nobody has
 * given a series to stands under its own name rather than vanishing into a nameless group.
 */
function seriesKeyOf(book: ApiLibraryBook): { key: string; name: string } {
  const name = book.seriesName?.trim() || book.editionName
  return { key: name.toLowerCase(), name }
}

/**
 * The unread shelf, one entry per series instead of one per volume.
 *
 * Three runs of Batman are three volumes, and a shelf that draws each of them separately
 * spends three tiles saying "Batman" before it says anything else. Grouping them keeps the
 * volumes intact underneath — a series group holds VolumeGroups, not loose comics — so the
 * tile can unfold into exactly what the shelf used to show.
 *
 * Insertion order is kept at both levels, so the shelf reads in whatever order the server
 * chose.
 */
export function groupBySeries(books: ApiLibraryBook[]): SeriesGroup[] {
  const gathered = new Map<string, { name: string; books: ApiLibraryBook[] }>()
  for (const book of books) {
    const { key, name } = seriesKeyOf(book)
    const found = gathered.get(key)
    if (found) found.books.push(book)
    else gathered.set(key, { name, books: [book] })
  }
  return [...gathered].map(([key, { name, books: held }]) => ({
    key, name, volumes: groupByVolume(held),
  }))
}

export interface ArcGroup {
  name: string
  books: ApiLibraryBook[]
  /** How many series the arc reaches across - what makes it worth collapsing at all. */
  seriesCount: number
}

/**
 * The unread shelf gathered by story arc, with whatever the arcs did not claim handed back.
 *
 * An arc is the one grouping that crosses series: Armageddon runs through Avengers and
 * Captain America at once, and on a shelf grouped by series those are two tiles that never
 * say they are the same story. The tags come with the library's own metadata, so this asks
 * Comic Vine nothing.
 *
 * A comic tagged with two arcs appears under both. A tie-in belongs to both stories, and
 * picking one would hide it from the arc you are actually reading; the price is that the
 * arc counts sum to more than the shelf holds, which is true of the arcs themselves.
 */
export function groupByArc(books: ApiLibraryBook[]): { arcs: ArcGroup[]; rest: ApiLibraryBook[] } {
  const gathered = new Map<string, ApiLibraryBook[]>()
  const rest: ApiLibraryBook[] = []

  for (const book of books) {
    if (book.arcs.length === 0) { rest.push(book); continue }
    for (const arc of book.arcs) {
      const found = gathered.get(arc)
      if (found) found.push(book)
      else gathered.set(arc, [book])
    }
  }

  const arcs = [...gathered].map(([name, held]) => ({
    name,
    books: held,
    seriesCount: new Set(held.map((b) => seriesKeyOf(b).key)).size,
  }))
  return { arcs, rest }
}
