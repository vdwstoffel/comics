import { deriveSeriesName } from '../lib/seriesName.js'
import { listEditions } from './editions.js'
import type { EditionFilter } from './editions.js'
import type { Db, Edition } from '../types.js'

export interface Series {
  name: string
  editions: Edition[]
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
        bookCount: edition.bookCount ?? 0,
      })
    }
  }

  return [...series.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export function getSeries(
  db: Db,
  name: string,
  opts?: EditionFilter,
): Series | undefined {
  const wanted = name.trim().toLowerCase()
  return listSeries(db, opts).find((series) => series.name.toLowerCase() === wanted)
}
