import type { ApiLibraryBook } from '../api'

export interface VolumeGroup {
  editionId: number
  editionName: string
  /** The shelf these books are on, and what it is called. */
  shelfKey: string
  shelfName: string
  /** Where the shelf lives when it is more than one edition; null when it is not. */
  shelfVolumeId: number | null
  books: ApiLibraryBook[]
}

/**
 * The unread shelf, one entry per volume instead of one per comic.
 *
 * Grouped by shelf rather than by adjacency. The server already sorts its answer by
 * series then issue number, so a volume's comics do arrive together and a fold over
 * neighbours would work today — but it would quietly split a volume in two the day that
 * sort changed, and the map costs nothing to be right either way.
 *
 * The key is the shelf, not the edition: Comic Vine gives each collected-edition line a
 * volume of its own, so thirteen trades of one run arrive under three edition ids and
 * would otherwise draw as three tiles of the thing they are one of.
 *
 * Insertion order is kept, so the shelf reads in whatever order the server chose.
 */
/**
 * The order a collected run reads in: by date, undated last, ties on id.
 *
 * The same rule the volume shelf uses, and for the same reason - trade numbering
 * collides across collection lines. Wells & Romita hold volumes 1-3, Zeb Wells hold
 * 4-12, and The 8 Deaths of Spider-Man is its own volume "1" despite collecting the
 * END of the run. The server orders the library by issue number, which would put that
 * last book first and have the home tile's cover open the finale.
 */
function byDate(a: ApiLibraryBook, b: ApiLibraryBook): number {
  if (a.date === b.date) return a.id - b.id
  if (!a.date) return 1
  if (!b.date) return -1
  return a.date.localeCompare(b.date) || a.id - b.id
}

export function groupByVolume(books: ApiLibraryBook[]): VolumeGroup[] {
  const groups = new Map<string, VolumeGroup>()
  for (const book of books) {
    const group = groups.get(book.shelfKey)
    if (group) group.books.push(book)
    else {
      groups.set(book.shelfKey, {
        // The first book's edition, which is what an uncollapsed shelf links to and
        // what a collapsed one falls back to if it somehow has no volume.
        editionId: book.editionId,
        editionName: book.editionName,
        shelfKey: book.shelfKey,
        shelfName: book.shelfName,
        shelfVolumeId: book.shelfVolumeId,
        books: [book],
      })
    }
  }
  // Only a collapsed shelf is re-ordered. A single volume's books arrive in the server's
  // issue order, which is right for it and is what every existing shelf expects.
  for (const group of groups.values()) {
    if (group.shelfVolumeId != null) group.books.sort(byDate)
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
