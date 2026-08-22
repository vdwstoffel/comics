import { deriveGroupName } from '../lib/seriesGroup.js'
import { listSeries } from './series.js'
import type { Db, Series } from '../types.js'

export interface SeriesGroup {
  name: string
  series: Series[]
  bookCount: number
}

/**
 * Fill group_name for series that have none, leaving hand-set values alone.
 * Returns how many rows changed, so a caller can log a one-off migration.
 */
export function backfillSeriesGroups(db: Db): number {
  const rows = db
    .prepare("SELECT id, name FROM series WHERE group_name IS NULL OR TRIM(group_name) = ''")
    .all() as Array<{ id: number; name: string }>

  const update = db.prepare('UPDATE series SET group_name = ? WHERE id = ?')
  const run = db.transaction((pending: typeof rows) => {
    for (const row of pending) update.run(deriveGroupName(row.name), row.id)
  })
  run(rows)

  return rows.length
}

/** A series with no group of its own stands alone rather than vanishing. */
function keyOf(series: Series): string {
  return (series.groupName?.trim() || series.name).toLowerCase()
}

export function listSeriesGroups(db: Db, opts?: { publisher?: string }): SeriesGroup[] {
  const groups = new Map<string, SeriesGroup>()

  // listSeries already applies the publisher filter and orders by name.
  for (const series of listSeries(db, opts)) {
    const key = keyOf(series)
    const group = groups.get(key)
    if (group) {
      group.series.push(series)
      group.bookCount += series.bookCount ?? 0
    } else {
      groups.set(key, {
        name: series.groupName?.trim() || series.name,
        series: [series],
        bookCount: series.bookCount ?? 0,
      })
    }
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export function getSeriesGroup(
  db: Db,
  name: string,
  opts?: { publisher?: string },
): SeriesGroup | undefined {
  const wanted = name.trim().toLowerCase()
  return listSeriesGroups(db, opts).find((group) => group.name.toLowerCase() === wanted)
}
