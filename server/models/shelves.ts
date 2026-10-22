import { shelfKeyOf, volumeIdOfKey } from '../lib/shelfKey.js'
import { listEditions } from './editions.js'
import type { Db, Edition } from '../types.js'

export interface Shelf {
  key: string
  /**
   * The volume route target, and null when this shelf is one edition.
   *
   * One field carries the collapse rule: a shelf of one edition draws as that edition and
   * links to `/edition/:id`, because a tile that opens onto a single tile is a click that
   * buys nothing - the same rule the annuals tile already applies.
   */
  volumeId: number | null
  name: string
  editions: Edition[]
  bookCount: number
  /** The year the volume this shelf is of began. What a series orders its shelves by. */
  startYear: number | null
  siteUrl: string | null
  /**
   * True when an edition here holds the volume's own issues rather than a collection of
   * them. It is what decides whether the shelf draws a run with gaps in it or just lists
   * what it holds: seventy missing-issue tiles above thirteen trades would bury the
   * thing you opened the shelf for.
   */
  holdsIssues: boolean
  /**
   * A limited series rather than a run of its series, so the series page can put it
   * under its own heading.
   *
   * Only when EVERY edition here is one. A collected run gathers several editions, and
   * one trade line ticked by hand must not drag the whole run out of the runs.
   */
  limited: boolean
}

/** "The Amazing Spider-Man (2022)", or just the name when there is no year to add. */
function titled(name: string, startYear: number | null): string {
  return startYear ? `${name} (${startYear})` : name
}

interface ShelfName {
  name: string
  siteUrl: string | null
  startYear: number | null
}

/** What a collection says it is a collection OF. */
function asCollected(e: Edition): ShelfName | undefined {
  if (e.collectsVolumeId == null || !e.collectsCvName) return undefined
  return {
    name: titled(e.collectsCvName, e.collectsCvStartYear),
    siteUrl: e.collectsCvSiteUrl,
    startYear: e.collectsCvStartYear,
  }
}

/**
 * What a shelf is called, the Comic Vine page behind that name, and the year it sorts by.
 *
 * A shelf is of a volume, so it is named for that volume wherever one is known. An
 * edition that IS the volume names it best - Comic Vine's own name for the run - and
 * otherwise the collections say what they reprint.
 *
 * That holds for a shelf of one, which is the case worth stating: an omnibus is not
 * collapsed into anything, but it is still a run of Captain America rather than a book
 * called "by Rick Remender", and naming it for the run is what lets a series page read
 * 2013, 2018, 2025 instead of alphabetically by whoever wrote it. The edition's real
 * name is one click away, on its own page, which is where the book itself is.
 */
function describe(editions: Edition[], volumeId: number | null): ShelfName {
  if (editions.length === 1) {
    const [only] = editions
    return asCollected(only)
      ?? { name: only.name, siteUrl: only.cvSiteUrl, startYear: only.cvStartYear }
  }

  const owner = volumeId == null ? undefined : editions.find((e) => e.comicvineId === volumeId)
  if (owner?.cvName) {
    return { name: titled(owner.cvName, owner.cvStartYear), siteUrl: owner.cvSiteUrl, startYear: owner.cvStartYear }
  }

  for (const edition of editions) {
    const collected = asCollected(edition)
    if (collected) return collected
  }

  return { name: editions[0].name, siteUrl: editions[0].cvSiteUrl, startYear: editions[0].cvStartYear }
}

/**
 * Editions gathered onto the volumes they are of.
 *
 * `editions` is what goes ON the shelves. `all` is what the shelves ARE - whether one is
 * collapsed, what it is called, and whether it holds its volume's own issues. They are
 * two arguments because a caller may be showing a filtered slice of the library, and
 * none of those three facts may depend on the filter: a read-state filter that hid two
 * of three collections would otherwise turn "The Amazing Spider-Man (2022)" back into
 * "Amazing Spider-Man By Zeb Wells (2023)" on the very link the home shelf uses to
 * reach it. Pass `all` whenever `editions` is narrowed.
 *
 * Insertion order is kept at both levels, so the shelves read in whatever order the
 * caller's edition list chose - `listEditions` orders by name, and that is what the
 * series page draws.
 */
export function groupIntoShelves(editions: Edition[], all: Edition[] = editions): Shelf[] {
  const gathered = new Map<string, Edition[]>()
  for (const edition of editions) {
    const key = shelfKeyOf(edition)
    const found = gathered.get(key)
    if (found) found.push(edition)
    else gathered.set(key, [edition])
  }

  // Every edition the library holds under each key, filter or no filter.
  const whole = new Map<string, Edition[]>()
  for (const edition of all) {
    const key = shelfKeyOf(edition)
    const found = whole.get(key)
    if (found) found.push(edition)
    else whole.set(key, [edition])
  }

  return [...gathered].map(([key, held]) => {
    const volumeId = volumeIdOfKey(key)
    const full = whole.get(key) ?? held
    const { name, siteUrl, startYear } = describe(full, volumeId)
    return {
      key,
      // Null for a single edition: that is the collapse rule, in the one field that
      // every page reads it from. Decided on the whole shelf, never on the slice.
      volumeId: full.length > 1 ? volumeId : null,
      name,
      editions: held,
      bookCount: held.reduce((n, e) => n + (e.bookCount ?? 0), 0),
      startYear,
      siteUrl,
      holdsIssues: volumeId != null && full.some((e) => e.comicvineId === volumeId),
      limited: full.every((e) => e.limited),
    }
  })
}

/**
 * Edition id -> the volume route its books belong to, or null when it stands alone.
 *
 * Built from the WHOLE edition list, never from a filtered one: whether a shelf is
 * collapsed is a fact about the library, not about what a read-state filter happens to
 * be showing. A filter that hid one collection's books would otherwise un-collapse the
 * shelf for the rest.
 */
export function shelfVolumeIdsByEdition(db: Db): Map<number, number | null> {
  const byEdition = new Map<number, number | null>()
  for (const shelf of groupIntoShelves(listEditions(db))) {
    for (const edition of shelf.editions) byEdition.set(edition.id, shelf.volumeId)
  }
  return byEdition
}
