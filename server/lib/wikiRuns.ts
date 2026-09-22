import { load } from 'cheerio'
import type { Cheerio, CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'

export type RunKind = 'ongoing' | 'limited'

/** One currently-published series, as Wikipedia lists it. */
export interface RunningSeries {
  title: string
  kind: RunKind
  /** The issue range as printed: "#1–", "#1–5", "#957–1102". */
  issues: string | null
  pubYear: number | null
  /** An announced final issue, as printed. Filled on few rows, and worth knowing. */
  endsOn: string | null
}

const WIKI_API = 'https://en.wikipedia.org/w/api.php'
const WIKI_ARTICLE = 'https://en.wikipedia.org/wiki/'

/**
 * The two publishers, named exactly as `SHOWN` in routes/releases.ts names them, so both
 * tabs of the Releases page agree on what a publisher is called.
 */
export const WIKI_PAGES = [
  { publisher: 'Marvel', page: 'List_of_current_Marvel_Comics_publications' },
  { publisher: 'DC Comics', page: 'List_of_current_DC_Comics_publications' },
] as const

/**
 * The article body alone, as JSON. Asking the API rather than fetching the article URL
 * keeps the skin - nav, sidebar, footer - out of what we parse, and halves the bytes
 * (measured 2026-09-22: 121KB against 251KB for Marvel).
 */
export function apiUrl(page: string): string {
  const url = new URL(WIKI_API)
  url.searchParams.set('action', 'parse')
  url.searchParams.set('page', page)
  url.searchParams.set('prop', 'text')
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  return url.toString()
}

/** The human page, for the attribution link under each table. */
export function articleUrl(page: string): string {
  return WIKI_ARTICLE + page
}

/**
 * The html out of the api envelope.
 *
 * A MediaWiki error is reported in a 200 response with an `error` member, so a failure
 * has to be recognised here or it would parse to zero rows and read as "this publisher
 * stopped publishing" rather than as the failure it is.
 */
export function parseRunsJson(body: string): string {
  const json = JSON.parse(body) as { parse?: { text?: string }; error?: { code?: string; info?: string } }
  if (json.error) throw new Error(`wikipedia api: ${json.error.code ?? 'error'} ${json.error.info ?? ''}`.trim())
  const html = json.parse?.text
  if (typeof html !== 'string') throw new Error('wikipedia api: no parse.text in response')
  return html
}

/** The h2s worth keeping, and the kind each one gives its rows. */
const SECTIONS: Record<string, RunKind> = {
  'ongoing series': 'ongoing',
  'limited series': 'limited',
}

/** Column headers we read, mapped to the field they fill. */
const COLUMNS: Record<string, 'title' | 'issues' | 'pubYear' | 'endsOn'> = {
  'title': 'title',
  'issues': 'issues',
  'pub. year': 'pubYear',
  'date of final issue': 'endsOn',
}

/**
 * An element's text with the furniture removed: the `[edit]` link Wikipedia hangs off
 * every heading, and the reference superscripts inside cells - without which a year
 * reads as "2025[4]" and parses to nothing.
 */
function cleanText($: CheerioAPI, el: AnyNode): string {
  const copy = $(el).clone()
  copy.find('.mw-editsection, sup.reference, style').remove()
  return copy.text().replace(/\s+/g, ' ').trim()
}

/** Empty cells come back as null, so "not stated" is never an empty string. */
function orNull(s: string): string | null {
  return s === '' ? null : s
}

/**
 * Where each field sits in this table, by header name rather than by position.
 *
 * The four tables do not share a column layout - DC's upcoming-ongoing table has no
 * Issues column at all - so `cells[2]` is the year in some tables and something else in
 * others. Reading by name is what keeps a layout change from silently filling a field
 * with the wrong column's text.
 */
function headerIndex($: CheerioAPI, row: Cheerio<AnyNode>): Map<string, number> {
  const index = new Map<string, number>()
  row.find('th, td').each((i, cell) => {
    const field = COLUMNS[cleanText($, cell).toLowerCase()]
    if (field && !index.has(field)) index.set(field, i)
  })
  return index
}

/**
 * Every currently-published series on one of the two Wikipedia pages.
 *
 * Tables are selected by walking headings and tables in document order and keeping only
 * what sits under an *Ongoing series* / *Limited series* h2 and an *Active* h3. Selecting
 * by position instead ("the first and third table") would break the first time a section
 * is added - and break silently, serving the Upcoming tables as though those comics were
 * already out.
 */
export function parseRunsHtml(html: string): RunningSeries[] {
  const $ = load(html)
  const series: RunningSeries[] = []
  let kind: RunKind | undefined
  let active = false

  $('h2, h3, table.wikitable').each((_, el) => {
    const tag = ('tagName' in el ? el.tagName : '').toLowerCase()

    if (tag === 'h2') {
      kind = SECTIONS[cleanText($, el).toLowerCase()]
      active = false
      return
    }
    if (tag === 'h3') {
      active = cleanText($, el).toLowerCase() === 'active'
      return
    }
    if (!kind || !active) return

    const rows = $(el).find('tr')
    const index = headerIndex($, rows.first())
    const titleAt = index.get('title')
    if (titleAt == null) return

    const at = (cells: Cheerio<AnyNode>, field: string): string | null => {
      const i = index.get(field)
      if (i == null) return null
      const cell = cells.get(i)
      // A row shorter than the header - one real row on the DC limited table is - has no
      // cell here at all. Null, rather than whatever the last cell happened to hold.
      return cell ? orNull(cleanText($, cell)) : null
    }

    rows.slice(1).each((_i, tr) => {
      const cells = $(tr).find('th, td')
      // The imprint groupings (Black Label, Absolute, Vertigo) are full-width single-cell
      // rows inside the table, not headings. Parsed as series they become rows titled
      // "Black Label" with every other field empty.
      if (cells.length < 2) return

      const title = at(cells, 'title')
      if (!title) return

      const year = at(cells, 'pubYear')
      const pubYear = year && /^\d{4}$/.test(year) ? Number(year) : null

      series.push({
        title,
        kind: kind as RunKind,
        issues: at(cells, 'issues'),
        pubYear,
        endsOn: at(cells, 'endsOn'),
      })
    })
  })

  return series
}
