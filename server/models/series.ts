import { deriveSeriesName, LEADING_ARTICLE } from '../lib/seriesName.js'
import { listEditions } from './editions.js'
import { groupIntoShelves } from './shelves.js'
import type { EditionFilter } from './editions.js'
import type { Shelf } from './shelves.js'
import type { Db, Edition } from '../types.js'

export interface Series {
  name: string
  editions: Edition[]
  /**
   * The same editions, gathered onto the volumes they are of. Three trade lines
   * reprinting one run are three editions and one shelf, which is what the page draws.
   * `editions` is left exactly as it was: everything that already reads it still can.
   */
  shelves: Shelf[]
  bookCount: number
}

/**
 * Fill series_name for editions that have none, leaving hand-set values alone.
 * Returns how many rows changed, so a caller can log a one-off migration.
 */
export function backfillSeriesNames(db: Db): number {
  const rows = db
    .prepare("SELECT id, name FROM edition WHERE series_name IS NULL OR TRIM(series_name) = ''")
    .all() as Array<{ id: number; name: string }>

  const update = db.prepare('UPDATE edition SET series_name = ? WHERE id = ?')
  const run = db.transaction((pending: typeof rows) => {
    for (const row of pending) update.run(deriveSeriesName(row.name), row.id)
  })
  run(rows)

  return rows.length
}

/** An edition with no series of its own stands alone rather than vanishing. */
function keyOf(edition: Edition): string {
  return (edition.seriesName?.trim() || edition.name).toLowerCase()
}

// "The Amazing Spider-Man" belongs under A, where a reader looks for it - so the sort
// key drops a leading article, by the same rule that decides whether two spellings are
// one series. The stored name keeps it: Comic Vine's name is the name.
export function seriesSortKey(name: string): string {
  return name.replace(LEADING_ARTICLE, '')
}

/**
 * A series' shelves, oldest run first.
 *
 * By year rather than by name, because the name of a collection is the name of a
 * paperback line and tells you nothing about where its run sits: "Captain America by
 * Rick Remender Omnibus" and "by Ta-Nehisi Coates Omnibus" file under B and T, five
 * years apart, between which sits the 2025 run. Named for their volumes and ordered by
 * them, the same three shelves read 2013, 2018, 2025 - which is the order you would
 * read them in.
 *
 * A shelf Comic Vine has told us nothing about has no year to place it by, so it goes
 * last rather than to the front where a missing year would sort it.
 */
function shelfOrder(shelves: Shelf[]): Shelf[] {
  return [...shelves].sort((a, b) => {
    if (a.startYear !== b.startYear) {
      if (a.startYear == null) return 1
      if (b.startYear == null) return -1
      return a.startYear - b.startYear
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export function listSeries(db: Db, opts?: EditionFilter): Series[] {
  const series = new Map<string, Series>()

  // listEditions already applies the publisher/read-state filters and orders by name.
  for (const edition of listEditions(db, opts)) {
    const key = keyOf(edition)
    const found = series.get(key)
    if (found) {
      found.editions.push(edition)
      found.bookCount += edition.bookCount ?? 0
    } else {
      series.set(key, {
        name: edition.seriesName?.trim() || edition.name,
        editions: [edition],
        shelves: [],
        bookCount: edition.bookCount ?? 0,
      })
    }
  }

  // Shelved once the series is whole: a shelf is a fact about every edition in the
  // series at once, so it cannot be built an edition at a time on the way in.
  //
  // Whether a shelf is collapsed and what it is called come from the unfiltered library,
  // so a read-state filter narrows which volumes are listed without turning a collected
  // run back into the separate paperback lines it was gathered from.
  const all = opts ? listEditions(db) : undefined
  for (const one of series.values()) one.shelves = shelfOrder(groupIntoShelves(one.editions, all))

  return [...series.values()].sort((a, b) => {
    const byKey = seriesSortKey(a.name).localeCompare(seriesSortKey(b.name), undefined, { sensitivity: 'base' })
    // Two names that differ only by their article still need a stable order.
    return byKey || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export function getSeries(
  db: Db,
  name: string,
  opts?: EditionFilter,
): Series | undefined {
  const wanted = name.trim().toLowerCase()
  return listSeries(db, opts).find((series) => series.name.toLowerCase() === wanted)
}
