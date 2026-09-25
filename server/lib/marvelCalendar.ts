import { shiftDays } from './releaseDay.js'

/**
 * Marvel's release calendar, read one week at a time.
 *
 * The page is server-rendered and embeds a JSON payload holding three sibling buckets:
 * the comics of the week, collected editions, and what is arriving on Marvel Unlimited.
 * Only the first is wanted - the MU bucket in particular carries dates months away from
 * the week asked for, so reading the wrong one fills the week with the wrong comics.
 *
 * A date RANGE paginates (measured: 35 returned of 75 reported), and there is no known
 * way to page it. One week at a time is always complete - the same reasoning the Latest
 * tab's spec used for Comic Vine in its §2.2. So this module only ever builds one-week
 * urls, and the route walks weeks.
 */

const CALENDAR = 'https://www.marvel.com/comics/calendar'
const BUCKET = '"allComicsReleases":'

/** Named exactly as routes/releases.ts and wikiRuns.ts name it, so all three tabs agree. */
export const MARVEL = 'Marvel'

/** One solicited issue. `headline` is Marvel's own text and is what the UI shows. */
export interface UpcomingIssue {
  /** Marvel's issue id, from the link path. Stable, and the row's key. */
  sourceId: string
  headline: string
  /** Derived from the headline, for ordering only. */
  seriesName: string
  /** Derived from the headline, for ordering only. Null for a one-shot. */
  number: string | null
  releaseDate: string
  coverUrl: string | null
  siteUrl: string
  creators: string | null
}

/**
 * The calendar url for one Wednesday, as a window three days either side of it.
 *
 * Marvel filters on its own release dates, and every issue measured fell on its
 * Wednesday; the window is slack so a date that lands a day out is still caught by the
 * week it belongs to rather than vanishing between two queries.
 */
export function calendarUrl(wednesday: string): string {
  const url = new URL(CALENDAR)
  url.searchParams.set('dateStart', shiftDays(wednesday, -3))
  url.searchParams.set('dateEnd', shiftDays(wednesday, 3))
  url.searchParams.set('tab', 'comic')
  url.searchParams.set('variants', 'false')
  return url.toString()
}

/**
 * The comics bucket, lifted out of the page by brace-matching from its key.
 *
 * A regex cannot do this: the object is deeply nested and holds braces inside strings.
 * Quotes and their escapes are tracked so a `{` inside a title cannot unbalance the scan.
 */
function comicsBucket(html: string): string {
  const at = html.indexOf(BUCKET)
  if (at < 0) throw new Error('Marvel calendar: no allComicsReleases bucket')

  // The brace has to be this bucket's OWN opening brace. Scanning forward for the next "{"
  // anywhere in the document instead would, on a payload rendering the comics bucket as "[]"
  // or null, walk straight into the next sibling bucket - and Marvel Unlimited's entries
  // carry /comics/issue/ links, so they pass every later check while their dates lie months
  // from the week asked for. Silent wrong data is worse than a loud failure.
  const after = at + BUCKET.length
  const gap = html.slice(after).search(/\S/)
  if (gap < 0 || html[after + gap] !== '{') {
    throw new Error('Marvel calendar: allComicsReleases is not an object')
  }
  const open = after + gap

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = open; i < html.length; i++) {
    const ch = html[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return html.slice(open, i + 1)
    }
  }
  throw new Error('Marvel calendar: unterminated allComicsReleases bucket')
}

/** "…/comics/issue/134736/slug" -> "134736". */
function issueId(link: string): string | null {
  return /\/comics\/issue\/(\d+)(?:\/|$)/.exec(link)?.[1] ?? null
}

/** "Invented Ongoing (2026) #12" -> "12". Null when there is no number, as for a one-shot. */
function issueNumber(headline: string): string | null {
  return /#\s*([^\s#]+)\s*$/.exec(headline)?.[1] ?? null
}

/** "Invented Ongoing (2026) #12" -> "Invented Ongoing". Ordering only, never displayed. */
function seriesOf(headline: string): string {
  return headline.replace(/\s*#\s*[^\s#]+\s*$/, '').replace(/\s*\(\d{4}[^)]*\)\s*$/, '').trim()
}

interface RawEntry {
  headline?: unknown
  releaseDate?: unknown
  isVariant?: unknown
  creators_shortlist?: unknown
  image?: { filename?: unknown }
  link?: { link?: unknown }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Every single issue in one week's page.
 *
 * An empty list is a real answer: a genuinely light week was measured at three issues, so
 * "few" can never signal a broken parser. A MISSING bucket is not an answer - it means
 * the page changed shape - and throws, so a structural change can never be recorded as a
 * real empty week and frozen into the cache.
 */
export function parseCalendar(html: string): UpcomingIssue[] {
  const parsed = JSON.parse(comicsBucket(html)) as { content?: unknown }
  const content = Array.isArray(parsed.content) ? (parsed.content as RawEntry[]) : []

  const issues: UpcomingIssue[] = []
  for (const raw of content) {
    // The url already asks for no variants; this is the belt to that braces.
    if (raw.isVariant) continue
    const link = str(raw.link?.link)
    const headline = str(raw.headline)
    const releaseDate = str(raw.releaseDate)
    if (!link || !headline || !releaseDate) continue
    const sourceId = issueId(link)
    if (!sourceId) continue

    issues.push({
      sourceId,
      headline,
      seriesName: seriesOf(headline),
      number: issueNumber(headline),
      releaseDate,
      coverUrl: str(raw.image?.filename),
      siteUrl: link,
      creators: str(raw.creators_shortlist),
    })
  }
  return sortUpcomingIssues(issues)
}

/**
 * How this app identifies itself to Marvel.
 *
 * Marvel refuses `fetchSourcePage`'s bare `comic-app/0.1 (...)` with a 403, and refuses a
 * bare `Mozilla/5.0` too (both measured 2026-09-25). The long-standing
 * `Mozilla/5.0 (compatible; <app>; <purpose>)` convention is accepted and still says
 * plainly who is calling and why - which is why it is used rather than a copied Chrome
 * string that would flatly claim to be a browser.
 */
export const MARVEL_USER_AGENT =
  'Mozilla/5.0 (compatible; comic-app/0.1; self-hosted personal comic library)'

/**
 * Fetch one calendar page.
 *
 * Deliberately NOT `fetchSourcePage`, which the other two release routes use: its
 * User-Agent is refused here. This is worth a module of its own precisely because every
 * test injects a fake fetcher - a route defaulting to the wrong one passes the whole
 * suite and returns nothing but 403s in the running app.
 */
export async function fetchCalendarPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': MARVEL_USER_AGENT } })
  if (!res.ok) throw new Error(`Marvel calendar ${res.status} ${res.statusText}`.trim())
  return res.text()
}

// SQLite's `CAST(x AS REAL)`, mirrored: read an optional sign and digits, stop at the
// first character that is not part of a number. Anything with no numeric prefix is 0.
function numericPrefix(s: string | null): number {
  if (s == null) return 0
  const m = /^\s*[+-]?\d+(\.\d+)?/.exec(s)
  return m ? Number(m[0]) : 0
}

/**
 * The one true ordering for a week, on every path that produces one - a fresh parse and a
 * cache read alike. A second implementation living on only one of those paths is exactly
 * what let a cold and a cached response disagree in models/releases.ts; this is the only
 * place that decides.
 */
export function sortUpcomingIssues(issues: UpcomingIssue[]): UpcomingIssue[] {
  // Deduped here rather than only in cacheUpcomingWeek: the route serves a fresh parse
  // directly, so a repeated entry rendered twice under the same React key on a cold load and
  // once on the cached load. models/releases.ts was bitten by exactly this when Comic Vine
  // repeated an id across pages, and fixed it in exactly this place - the single function
  // both the fresh and the cached path pass through.
  const seen = new Set<string>()
  const unique = issues.filter((i) => {
    if (seen.has(i.sourceId)) return false
    seen.add(i.sourceId)
    return true
  })
  return unique.sort((a, b) => (
    a.seriesName.localeCompare(b.seriesName)
    || (numericPrefix(a.number) - numericPrefix(b.number))
    || (a.number ?? '').localeCompare(b.number ?? '')
    || a.sourceId.localeCompare(b.sourceId)
  ))
}
