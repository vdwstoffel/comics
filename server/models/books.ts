import { BOOK_STATE_SQL, listEditions } from './editions.js'
import { deriveReadState } from './progress.js'
import { groupIntoShelves } from './shelves.js'
import type { FilterState, BookWithProgress } from './progress.js'
import type { Db, Book } from '../types.js'

interface BookRow {
  id: number
  edition_id: number
  file_path: string
  title: string | null
  number: string | null
  page_count: number
  file_size: number
  writer: string | null
  penciller: string | null
  summary: string | null
  date: string | null
  comicvine_id: number | null
  comicinfo_synced: number
  added_at: string
  year: number | null
  cover_url: string | null
  cv_site_url: string | null
  publisher: string | null
}

function toBook(row: BookRow | undefined): Book | undefined {
  if (!row) return undefined
  return {
    id: row.id, editionId: row.edition_id, filePath: row.file_path,
    title: row.title ?? null, number: row.number ?? null,
    pageCount: row.page_count, fileSize: row.file_size,
    writer: row.writer ?? null, penciller: row.penciller ?? null,
    summary: row.summary ?? null, date: row.date ?? null,
    comicvineId: row.comicvine_id ?? null,
    comicinfoSynced: !!row.comicinfo_synced, addedAt: row.added_at,
    year: row.year ?? null, coverUrl: row.cover_url ?? null, cvSiteUrl: row.cv_site_url ?? null,
    publisher: row.publisher ?? null,
  }
}

export interface InsertBookInput {
  editionId: number
  filePath: string
  title?: string | null
  number?: string | null
  pageCount: number
  fileSize: number
  writer?: string | null
  penciller?: string | null
  summary?: string | null
  date?: string | null
  addedAt?: string
}

export function insertBook(db: Db, d: InsertBookInput): Book | undefined {
  const info = db.prepare(`
    INSERT INTO book (edition_id, file_path, title, number, page_count, file_size,
                      writer, penciller, summary, date, added_at)
    VALUES (@editionId, @filePath, @title, @number, @pageCount, @fileSize,
            @writer, @penciller, @summary, @date, @addedAt)
  `).run({
    editionId: d.editionId, filePath: d.filePath, title: d.title ?? null, number: d.number ?? null,
    pageCount: d.pageCount, fileSize: d.fileSize, writer: d.writer ?? null,
    penciller: d.penciller ?? null, summary: d.summary ?? null, date: d.date ?? null,
    addedAt: d.addedAt ?? new Date().toISOString(),
  })
  return getBook(db, info.lastInsertRowid)
}

export function getBook(db: Db, id: number | bigint): Book | undefined {
  return toBook(db.prepare('SELECT * FROM book WHERE id = ?').get(id) as BookRow | undefined)
}

export function findBookByPath(db: Db, filePath: string): Book | undefined {
  return toBook(db.prepare('SELECT * FROM book WHERE file_path = ?').get(filePath) as BookRow | undefined)
}

/**
 * A book as the library shelf needs it: the book, its progress, and the volume and series
 * holding it. Both names come from the edition rather than the book because that is where
 * they live; carrying them here is what lets the shelf group by volume and by series
 * without a second request per group.
 */
export interface LibraryBook extends BookWithProgress {
  editionName: string
  /**
   * The shelf this comic belongs to, and what that shelf is called. Three paperback
   * lines of one run are three editions and one shelf, and the home page groups on this
   * rather than on the edition so the run draws as one tile there too.
   */
  shelfKey: string
  shelfName: string
  /** The volume route for the shelf, or null when its edition stands alone. */
  shelfVolumeId: number | null
  /** Null for an edition nobody has given a series to - the shelf falls back to the
   *  volume's own name, which is a decision about tiles rather than about the data. */
  seriesName: string | null
  /** The story arcs this comic is tagged with, in the order they were written. Empty for
   *  the many comics that carry none. */
  arcs: string[]
  /**
   * Why this comic is in a search's results. Present only when the search had words in it:
   * a shelf has no reason to give, and every shelf in the app reads this function.
   */
  matched?: MatchReason
}

/**
 * The narrowest true thing about a match, in the order name, number, credit, run. 'run' is
 * last because it means nothing on the comic itself matched - it came in with its edition -
 * and ranking it above a credit would hide the one reason the results page ever prints.
 */
export type MatchReason = 'name' | 'number' | 'run' | { role: string; name: string }

/**
 * Book id -> the story arcs it is tagged with.
 *
 * One query for the whole library rather than one per book: the tags are already indexed
 * by kind, there are a handful of them per comic, and the shelf needs them for every row
 * it is about to draw. Grouping the shelf by arc is a question about the library, so it
 * is answered here and never by asking Comic Vine.
 */
function arcsByBook(db: Db): Map<number, string[]> {
  const rows = db
    .prepare("SELECT book_id, value FROM book_tag WHERE kind = 'story_arc' ORDER BY id")
    .all() as Array<{ book_id: number; value: string }>

  const arcs = new Map<number, string[]>()
  for (const { book_id: bookId, value } of rows) {
    const found = arcs.get(bookId)
    if (found) found.push(value)
    else arcs.set(bookId, [value])
  }
  return arcs
}

// Each term is nine bound parameters, so eight stay far inside SQLite's historical
// 999-variable ceiling. This build allows more, but the cap should not depend on that.
// Eight is also more words than anyone types on purpose, so a pasted sentence searches on
// its first eight rather than growing the query a group per word.
const MAX_TERMS = 8

/**
 * The words of a search: trimmed, split on whitespace, blanks dropped, and no more than
 * MAX_TERMS of them. A box that was cleared yields none, which is how an empty search
 * ends up meaning "the whole shelf" without being a case of its own.
 */
export function searchTerms(q: string): string[] {
  return q.split(/\s+/).filter(Boolean).slice(0, MAX_TERMS)
}

/**
 * A term as a LIKE pattern that means what was typed. The query is a person's text, not a
 * pattern: left alone, "%" would match the whole library and "100%" would be a search for
 * "100". The backslash is among the characters escaped because it is the escape
 * character itself.
 */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`
}

// What a word can be found in. The run's own names are here beside the comic's, so a run
// that matches brings every issue in it - which is what the join to edition already gives.
const SEARCH_COLUMNS = [
  'e.name', 'e.series_name', 'e.cv_name', 'e.collects_cv_name',
  'b.title', 'b.writer', 'b.penciller',
]
const LIKE = "LIKE ? ESCAPE '\\'"

/**
 * One group of alternatives per term, to be ANDed with the rest of the WHERE: every word
 * has to be found, though not in the same field, so "hickman xmen" narrows.
 *
 * The credits are read from book_credit as well as from the writer and penciller columns
 * on the book. Which of the two a comic has depends on how it was imported, and a creator
 * found on one comic but missed on the one beside it would have no explanation on screen.
 */
function termClause(term: string): { sql: string; params: unknown[] } {
  const like = likePattern(term)
  // An all-digits term is an issue number, and "251" must not find #1251. So it is
  // compared to the number exactly, in place of the substring match every other term gets
  // there - while still matching as text everywhere else, so a run called "2000 AD" is
  // not lost to the rule.
  const isNumber = /^\d+$/.test(term)
  const alternatives = [
    ...SEARCH_COLUMNS.map((column) => `${column} ${LIKE}`),
    `EXISTS (SELECT 1 FROM book_credit c WHERE c.book_id = b.id AND c.name ${LIKE})`,
  ]
  const params: unknown[] = alternatives.map(() => like)
  if (isNumber) { alternatives.push('b.number = ?'); params.push(term) }
  else { alternatives.push(`b.number ${LIKE}`); params.push(like) }
  return { sql: `(${alternatives.join(' OR ')})`, params }
}

/**
 * Book id -> the first credit that one of the terms was found in.
 *
 * One query for the whole library, like arcsByBook, rather than one per result. Only
 * book_credit is read here; the writer and penciller columns are on the row already and
 * are checked where the reason is chosen.
 */
export function creditsMatching(db: Db, terms: string[]): Map<number, { name: string; role: string }> {
  const credits = new Map<number, { name: string; role: string }>()
  if (!terms.length) return credits

  const rows = db
    .prepare(`SELECT book_id, name, role FROM book_credit
              WHERE ${terms.map(() => `name ${LIKE}`).join(' OR ')} ORDER BY id`)
    .all(...terms.map(likePattern)) as Array<{ book_id: number; name: string; role: string }>

  for (const { book_id: bookId, name, role } of rows) {
    if (!credits.has(bookId)) credits.set(bookId, { name, role })
  }
  return credits
}

/**
 * Every book in the library matching a read state, a publisher and/or a search.
 *
 * The rail carries the first two at once, so they narrow together — a view honouring only
 * one would misdescribe what it is showing. The state fragments come from BOOK_STATE_SQL,
 * the same ones the sidebar counts with, so "unread" cannot come to mean one thing in the
 * rail and another in the grid. A search narrows alongside them; with no words in it
 * there is nothing to add, and the query is exactly the one every shelf has always run.
 *
 * Ordered by series then issue number: this is the "what do I read next" list, so it
 * reads in the order you would read it.
 */
export function listLibraryBooks(
  db: Db,
  { readState, publisher, q }: { readState?: FilterState; publisher?: string; q?: string },
): LibraryBook[] {
  const clauses: string[] = []
  const params: unknown[] = []

  if (readState) clauses.push(BOOK_STATE_SQL[readState])
  if (publisher === '__unknown__') clauses.push('e.publisher IS NULL')
  else if (publisher) { clauses.push('e.publisher = ?'); params.push(publisher) }
  const terms = searchTerms(q ?? '')
  for (const term of terms) {
    const clause = termClause(term)
    clauses.push(clause.sql)
    params.push(...clause.params)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT b.*, e.series_name AS series_name, e.name AS edition_name
              FROM book b
              JOIN edition e ON e.id = b.edition_id
              LEFT JOIN read_progress p ON p.book_id = b.id
              ${where}`)
    .all(...params) as Array<BookRow & { series_name: string | null; edition_name: string }>

  const arcs = arcsByBook(db)
  const credits = creditsMatching(db, terms)
  // Built from the whole library, never from the filtered rows above: whether a shelf is
  // collapsed is a fact about which editions exist, not about which of their books a
  // read-state filter happens to be showing.
  const shelves = new Map<number, { key: string; name: string; volumeId: number | null }>()
  for (const shelf of groupIntoShelves(listEditions(db))) {
    for (const edition of shelf.editions) {
      shelves.set(edition.id, { key: shelf.key, name: shelf.name, volumeId: shelf.volumeId })
    }
  }

  return rows
    .sort((a, b) => {
      const series = String(a.series_name ?? '').localeCompare(String(b.series_name ?? ''), undefined, { sensitivity: 'base' })
      if (series !== 0) return series
      return String(a.number ?? a.file_path).localeCompare(String(b.number ?? b.file_path), undefined, { numeric: true })
    })
    .map((r) => ({
      ...deriveReadState(db, toBook(r) as Book),
      editionName: r.edition_name,
      seriesName: r.series_name?.trim() || null,
      arcs: arcs.get(r.id) ?? [],
      // An edition with no shelf cannot happen - every edition is on one - but a book
      // standing under its own volume's name is the honest fallback if one ever does.
      shelfKey: shelves.get(r.edition_id)?.key ?? `edition:${r.edition_id}`,
      shelfName: shelves.get(r.edition_id)?.name ?? r.edition_name,
      shelfVolumeId: shelves.get(r.edition_id)?.volumeId ?? null,
      ...(terms.length ? { matched: matchReason(r, terms, credits.get(r.id)) } : {}),
    }))
}

/**
 * Which of the comic's own fields the words were found in, else 'run'. The ComicInfo
 * writer and penciller columns count as credits beside book_credit, because the search
 * itself finds a creator in either - a comic found that way must not be reported as
 * having come in with its run.
 */
function matchReason(
  book: BookRow, terms: string[], credit: { name: string; role: string } | undefined,
): MatchReason {
  const title = (book.title ?? '').toLowerCase()
  if (terms.some((t) => title.includes(t.toLowerCase()))) return 'name'
  // The same exact-versus-substring rule termClause applies to the number.
  const number = (book.number ?? '').toLowerCase()
  if (number && terms.some((t) => (/^\d+$/.test(t) ? number === t : number.includes(t.toLowerCase())))) return 'number'
  if (credit) return credit
  for (const [role, name] of [['writer', book.writer], ['penciller', book.penciller]] as const) {
    if (name && terms.some((t) => name.toLowerCase().includes(t.toLowerCase()))) return { role, name }
  }
  return 'run'
}

export function listBooksByEdition(db: Db, editionId: number, readState?: FilterState): Book[] {
  const filter = readState ? `AND ${BOOK_STATE_SQL[readState]}` : ''
  return (db
    .prepare(`SELECT b.* FROM book b
              LEFT JOIN read_progress p ON p.book_id = b.id
              WHERE b.edition_id = ? ${filter}`)
    .all(editionId) as BookRow[])
    .map((r) => toBook(r) as Book)
    .sort((a, b) => String(a.number ?? a.filePath).localeCompare(String(b.number ?? b.filePath), undefined, { numeric: true }))
}


/**
 * Every book on a shelf: the books of several editions, read as one run.
 *
 * Ordered by date, which is the only thing that orders them. Trade numbering collides
 * across collection lines - "by Wells and Romita Jr." holds volumes 1-3 and "By Zeb
 * Wells" holds 4-12, which chain, but "The 8 Deaths of Spider-Man" is its own volume 1 -
 * so a shelf sorted by number would put the last story first.
 *
 * An undated book goes last rather than to the front, where a null would sort it, and
 * ties break on id so the order never changes between two reads of the same shelf.
 */
export function listBooksByShelf(db: Db, editionIds: number[], readState?: FilterState): Book[] {
  if (!editionIds.length) return []
  const filter = readState ? `AND ${BOOK_STATE_SQL[readState]}` : ''
  const holes = editionIds.map(() => '?').join(',')
  return (db
    .prepare(`SELECT b.* FROM book b
              LEFT JOIN read_progress p ON p.book_id = b.id
              WHERE b.edition_id IN (${holes}) ${filter}`)
    .all(...editionIds) as BookRow[])
    .map((r) => toBook(r) as Book)
    .sort((a, b) => {
      if (a.date === b.date) return a.id - b.id
      if (!a.date) return 1
      if (!b.date) return -1
      return a.date.localeCompare(b.date) || a.id - b.id
    })
}

const BOOK_FIELDS: Record<string, string> = {
  title: 'title', number: 'number', writer: 'writer', penciller: 'penciller',
  summary: 'summary', date: 'date', comicvineId: 'comicvine_id', comicinfoSynced: 'comicinfo_synced',
  year: 'year', coverUrl: 'cover_url', cvSiteUrl: 'cv_site_url', publisher: 'publisher',
}

export type BookUpdate = Partial<{
  title: string | null
  number: string | null
  writer: string | null
  penciller: string | null
  summary: string | null
  date: string | null
  comicvineId: number | null
  comicinfoSynced: boolean
  year: number | null
  coverUrl: string | null
  cvSiteUrl: string | null
  publisher: string | null
}>

export function updateBook(db: Db, id: number | bigint, fields: BookUpdate): Book | undefined {
  const sets: string[] = [], vals: unknown[] = []
  for (const [k, col] of Object.entries(BOOK_FIELDS)) {
    if (k in fields) {
      const v = (fields as Record<string, unknown>)[k]
      sets.push(`${col} = ?`); vals.push(k === 'comicinfoSynced' ? (v ? 1 : 0) : v)
    }
  }
  if (sets.length) db.prepare(`UPDATE book SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return getBook(db, id)
}

export function setBookEdition(db: Db, bookId: number, editionId: number, filePath: string): Book {
  db.prepare('UPDATE book SET edition_id = ?, file_path = ? WHERE id = ?').run(editionId, filePath, bookId)
  return getBook(db, bookId) as Book
}

export function deleteBook(db: Db, id: number): void {
  db.prepare('DELETE FROM book WHERE id = ?').run(id)
}
