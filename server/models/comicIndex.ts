import { parseComicTitle } from '../lib/comicTitle.js'
import { seriesKey, releaseKind, displayName } from '../lib/comicGrouping.js'
import type { ReleaseKind } from '../lib/comicGrouping.js'
import { splitRuns, runRows } from '../lib/comicRuns.js'
import type { IssueRun } from '../lib/comicRuns.js'

const KINDS: ReleaseKind[] = ['issue', 'miniseries', 'bundle', 'collection', 'other']
import type { Db, ComicIndexEntry, ComicIndexRow } from '../types.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** Fewer rows than this and a series is not worth a heading of its own. */
const SMALL_GROUP_MIN = 3
/** Reserved: seriesKey lowercases real titles, so nothing can collide with it. */
export const OTHER_KEY = '__other__'
const OTHER_NAME = 'Other'

interface Row {
  id: number
  title: string
  url: string
  category: string
  number: string | null
  year: number | null
  imported_at: string
}

function toRow(row: Row): ComicIndexRow {
  return {
    id: row.id, title: row.title, url: row.url, category: row.category,
    number: row.number, year: row.year, importedAt: row.imported_at,
  }
}

export interface UpsertResult {
  inserted: number
  updated: number
  unchanged: number
}

/**
 * Additive import: a url the db has not seen is inserted, a known url whose title
 * changed is updated in place (keeping its original imported_at), and anything identical
 * is left alone. Rows absent from `entries` are never removed.
 *
 * number/year are derived from the title here rather than supplied by callers, so no
 * row can reach the table without them.
 *
 * A post is often listed in several category panes at once - the weekly packs appear
 * under DC, Marvel and Others - so `category` records where it was FIRST seen and is
 * never rewritten afterwards. Treating it as mutable made every run rewrite those rows
 * with whichever pane happened to be scraped last. Repeats within one batch are counted
 * as unchanged so the totals still add up to the number of entries seen.
 */
export function upsertComicIndex(db: Db, entries: ComicIndexEntry[]): UpsertResult {
  const find = db.prepare('SELECT id, title, number, year FROM comic_index WHERE url = ?')
  const insert = db.prepare(
    'INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)'
  )
  const update = db.prepare(
    'UPDATE comic_index SET title = ?, number = ?, year = ? WHERE id = ?'
  )

  const run = db.transaction((batch: ComicIndexEntry[]) => {
    const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 }
    const now = new Date().toISOString()
    const seen = new Set<string>()
    for (const entry of batch) {
      const title = entry.title.trim()
      const url = entry.url.trim()
      if (!title || !url) continue

      // First sighting in this batch wins; later panes listing the same post are noise.
      if (seen.has(url)) {
        result.unchanged++
        continue
      }
      seen.add(url)
      const { number, year } = parseComicTitle(title)
      const existing = find.get(url) as
        | { id: number; title: string; number: string | null; year: number | null }
        | undefined
      if (!existing) {
        insert.run(title, url, entry.category, number, year, now)
        result.inserted++
      } else if (
        existing.title !== title || existing.number !== number || existing.year !== year
      ) {
        update.run(title, number, year, existing.id)
        result.updated++
      } else {
        result.unchanged++
      }
    }
    return result
  })

  return run(entries)
}

/**
 * Turn free text into an FTS5 prefix query: every word must match, in any order.
 * Only letters and digits survive tokenising, so punctuation and FTS operators in
 * user input ("Batman: Year One", `"quoted"`, `*`) can never reach the parser.
 */
export function buildMatchQuery(q: string): string | null {
  const tokens = q.match(/[\p{L}\p{N}]+/gu)
  if (!tokens?.length) return null
  return tokens.map((t) => `"${t}"*`).join(' AND ')
}

export interface SearchOpts {
  q: string
  category?: string
  yearFrom?: number
  yearTo?: number
  limit?: number
  offset?: number
  /** Narrow to one series bucket, as returned by groupComicIndex. */
  series?: string
  /** Narrow to one kind of release within that bucket. */
  kind?: ReleaseKind
  /** Narrow to one run of issues within that series, by its key. */
  run?: string
}

export interface ComicIndexGroup {
  key: string
  name: string
  total: number
  kinds: Record<ReleaseKind, number>
  /** The series' issues broken into runs; empty when its numbering cannot be trusted. */
  runs: IssueRun[]
}

/**
 * Compose the optional filters into one WHERE fragment. Rows with a null year fall out
 * of a bounded query on their own, since `NULL >= 2015` is NULL rather than true.
 */
function buildFilter(
  { category, yearFrom, yearTo }: Pick<SearchOpts, 'category' | 'yearFrom' | 'yearTo'>
): { sql: string; params: (string | number)[] } {
  const clauses: string[] = []
  const params: (string | number)[] = []

  if (category) {
    clauses.push('ci.category = ?')
    params.push(category)
  }
  // Reversed bounds are a typo, not a request for nothing.
  const from = yearFrom !== undefined && yearTo !== undefined ? Math.min(yearFrom, yearTo) : yearFrom
  const to = yearFrom !== undefined && yearTo !== undefined ? Math.max(yearFrom, yearTo) : yearTo
  if (from !== undefined) {
    clauses.push('ci.year >= ?')
    params.push(from)
  }
  if (to !== undefined) {
    clauses.push('ci.year <= ?')
    params.push(to)
  }

  return { sql: clauses.length ? `AND ${clauses.join(' AND ')}` : '', params }
}

const COLUMNS = 'ci.id, ci.title, ci.url, ci.category, ci.number, ci.year, ci.imported_at'

const ORDER_BY = `ORDER BY CASE WHEN instr(ci.title, '#') > 0
                              THEN substr(ci.title, 1, instr(ci.title, '#') - 1)
                              ELSE ci.title END COLLATE NOCASE,
                         ci.year IS NULL,
                         ci.year,
                         CAST(ci.number AS REAL),
                         ci.number,
                         ci.title COLLATE NOCASE`

/**
 * Every row a search matches, in catalog order and with no window applied.
 *
 * Grouping needs the whole set: a count per series is wrong if it only counts the fifty
 * rows that happen to be on this page. The series and kind of a row are derived from its
 * title in JS, not stored, so those two filters cannot be pushed into SQL either. On this
 * index — 67k rows, a one-letter query matching 16k of them — reading the lot costs
 * ~17ms and grouping it ~53ms, which is cheaper than a schema migration would be worth.
 */
function allMatching(db: Db, opts: SearchOpts): ComicIndexRow[] {
  const match = buildMatchQuery(opts.q)
  if (!match) return []
  const { sql: filter, params } = buildFilter(opts)
  return (db
    .prepare(`SELECT ${COLUMNS}
              FROM comic_index_fts
              JOIN comic_index ci ON ci.id = comic_index_fts.rowid
              WHERE comic_index_fts MATCH ? ${filter}
              ${ORDER_BY}`)
    .all(match, ...params) as Row[])
    .map(toRow)
}

/**
 * Collapse a search into one entry per series, largest first.
 *
 * The paging window here counts GROUPS, not rows: "load more" on a grouped list should
 * bring more headings, not more issues of a series already listed.
 */
interface Bucket {
  rows: ComicIndexRow[]
  kinds: Record<ReleaseKind, number>
}

function bucketRows(rows: ComicIndexRow[]): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>()
  for (const row of rows) {
    const key = seriesKey(row.title)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { rows: [], kinds: { issue: 0, miniseries: 0, bundle: 0, collection: 0, other: 0 } }
      buckets.set(key, bucket)
    }
    bucket.rows.push(row)
    bucket.kinds[releaseKind(row.title)]++
  }
  return buckets
}

/** Only single issues belong to a run; a collection or a bundle is not part of one. */
const issueRowsOf = (rows: ComicIndexRow[]) => rows.filter((r) => releaseKind(r.title) === 'issue')

/**
 * The series too thin to deserve a heading. Two or more of them are worth sweeping
 * together; a single one is not, since an "Other" holding one series has only renamed it.
 */
function strayKeys(buckets: ReturnType<typeof bucketRows>): Set<string> {
  const stray = [...buckets.entries()].filter(([, b]) => b.rows.length < SMALL_GROUP_MIN)
  return stray.length > 1 ? new Set(stray.map(([key]) => key)) : new Set()
}

export function groupComicIndex(
  db: Db,
  opts: SearchOpts,
): { groups: ComicIndexGroup[]; totalGroups: number; totalResults: number } {
  const rows = allMatching(db, opts)
  if (!rows.length) return { groups: [], totalGroups: 0, totalResults: 0 }

  const buckets = bucketRows(rows)
  const stray = strayKeys(buckets)

  const named: { group: ComicIndexGroup; rows: ComicIndexRow[] }[] = []
  const otherRows: ComicIndexRow[] = []
  const other: ComicIndexGroup = {
    key: OTHER_KEY, name: OTHER_NAME, total: 0,
    kinds: { issue: 0, miniseries: 0, bundle: 0, collection: 0, other: 0 }, runs: [],
  }
  for (const [key, bucket] of buckets) {
    if (stray.has(key)) {
      other.total += bucket.rows.length
      for (const kind of KINDS) other.kinds[kind] += bucket.kinds[kind]
      otherRows.push(...bucket.rows)
      continue
    }
    named.push({
      rows: bucket.rows,
      group: {
        key,
        name: displayName(bucket.rows.map((r) => r.title)),
        total: bucket.rows.length,
        kinds: bucket.kinds,
        runs: [],
      },
    })
  }
  // Name breaks ties so the order is the same every time the same search is run.
  named.sort((a, b) => b.group.total - a.group.total || a.group.name.localeCompare(b.group.name))
  // Last whatever its size: it is the leftovers, not the biggest thing you searched for.
  const all = named.concat(other.total ? [{ group: other, rows: otherRows }] : [])

  const size = Math.min(Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)), MAX_LIMIT)
  const from = Math.max(0, Math.floor(opts.offset ?? 0))
  const page = all.slice(from, from + size)
  // Runs are worked out for the page being sent, not for every series a broad query
  // matched — a one-letter search finds thousands of series and shows fifty.
  const groups = page.map(({ group, rows: bucketRowsForGroup }) => ({
    ...group,
    runs: splitRuns(issueRowsOf(bucketRowsForGroup)),
  }))
  return { groups, totalGroups: all.length, totalResults: rows.length }
}

/**
 * Results are ordered as a catalog, not by relevance: series name, then year, then issue
 * number. Year outranks the number so a relaunched series reads as one run after another
 * rather than issue #1 of every era, then issue #2 of every era. Every row already
 * matches every search term (the query ANDs its prefixes), so bm25 rank mostly tracked
 * title length - which pushed "#11" ahead of "#1 (2015)". CAST to REAL is what keeps #999
 * before #1000 and sorts negative issues first.
 *
 * `year IS NULL` leads the year keys because SQLite sorts NULL first by default, which
 * would file every undated post ahead of the dated runs of its own series.
 */
export function searchComicIndex(
  db: Db,
  opts: SearchOpts
): { results: ComicIndexRow[]; total: number } {
  const { q, category, yearFrom, yearTo, limit = DEFAULT_LIMIT, offset = 0, series, kind, run } = opts
  const match = buildMatchQuery(q)
  if (!match) return { results: [], total: 0 }

  const size = Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT)
  const from = Math.max(0, Math.floor(offset))

  // Expanding one group. Both keys are derived in JS, so the filtering and the window
  // happen here rather than in SQL.
  if (series || kind || run) {
    const all = allMatching(db, opts)
    // "Other" is not a series, it is whichever series were too thin to list separately,
    // so which rows belong to it can only be known after grouping the whole set.
    const stray = series === OTHER_KEY ? strayKeys(bucketRows(all)) : null
    let rows = all.filter((row) =>
      (!series || (stray ? stray.has(seriesKey(row.title)) : seriesKey(row.title) === series))
      && (!kind || releaseKind(row.title) === kind))
    // Which issues are in a run is decided by re-deriving the series' runs, for the same
    // reason "Other" is: it is a fact about the whole series, not about one row.
    if (run) rows = runRows(issueRowsOf(rows), run) as ComicIndexRow[]
    return { results: rows.slice(from, from + size), total: rows.length }
  }

  const { sql: filter, params: filterParams } = buildFilter({ category, yearFrom, yearTo })
  const params = [match, ...filterParams]

  const total = (db
    .prepare(`SELECT COUNT(*) AS n
              FROM comic_index_fts
              JOIN comic_index ci ON ci.id = comic_index_fts.rowid
              WHERE comic_index_fts MATCH ? ${filter}`)
    .get(...params) as { n: number }).n

  const results = (db
    .prepare(`SELECT ${COLUMNS}
              FROM comic_index_fts
              JOIN comic_index ci ON ci.id = comic_index_fts.rowid
              WHERE comic_index_fts MATCH ? ${filter}
              ${ORDER_BY}
              LIMIT ? OFFSET ?`)
    .all(...params, size, from) as Row[])
    .map(toRow)

  return { results, total }
}

export function comicIndexCategories(db: Db): { name: string; count: number }[] {
  return db
    .prepare(`SELECT category AS name, COUNT(*) AS count
              FROM comic_index
              GROUP BY category
              ORDER BY count DESC, name COLLATE NOCASE`)
    .all() as { name: string; count: number }[]
}

export function comicIndexTotal(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM comic_index').get() as { n: number }).n
}

/** One indexed post by row id, or undefined when the id is not in the table. */
export function comicIndexById(db: Db, id: number): ComicIndexRow | undefined {
  const row = db
    .prepare(`SELECT id, title, url, category, number, year, imported_at
              FROM comic_index WHERE id = ?`)
    .get(id) as Row | undefined
  return row ? toRow(row) : undefined
}
