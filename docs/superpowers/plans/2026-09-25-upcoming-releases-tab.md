# Upcoming Releases Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Upcoming tab to the Releases page showing Marvel's solicited single issues for the coming weeks, read from Marvel's own release calendar and cached per week in SQLite.

**Architecture:** A pure parser (`marvelCalendar.ts`) turns one week's calendar HTML into issues with no I/O. A model (`models/upcoming.ts`) caches each week under a 12-hour TTL. A route (`routes/upcoming.ts`) asks for the next ten Wednesdays, serves fresh cache and fetches the rest at concurrency 3, and returns publisher-grouped weeks. The Releases page gains a third tab that renders those weeks as cover grids.

**Tech Stack:** TypeScript, Fastify 5, better-sqlite3, React 19, TanStack Query, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-25-upcoming-releases-tab-design.md`

## Global Constraints

- **Branch:** `upcoming-releases-tab`. Already created, spec already committed on it.
- **No test may touch the network.** Every route takes an injectable `fetchPage`, exactly as `ReleaseRouteOpts` and `RunningRouteOpts` do.
- **Test payloads are synthetic, never captures of the live page.** Series names in tests are invented. This is the convention `test/wiki-runs.test.ts` sets and states its reasoning for: a real capture pins that week's solicitations and rots weekly; a synthetic one pins structure.
- **Dates are `YYYY-MM-DD` strings read in UTC throughout**, as `server/lib/releaseDay.ts` already documents. Reading them locally shifts the day for anyone west of Greenwich.
- **No new dependencies.** `cheerio` is present but unnecessary here — the payload is JSON embedded in the HTML, not markup to traverse.
- **The route must not require a Comic Vine key.** It reads Marvel. `/api/releases/running` is the precedent.
- **Marvel requires a browser-shaped User-Agent.** Verified 2026-09-25: this app's own UA (`comic-app/0.1 (self-hosted personal comic library)`) and a bare `Mozilla/5.0` both get **403**; `Mozilla/5.0 (compatible; comic-app/0.1; self-hosted personal comic library)` gets 200. So this feature must NOT reuse `fetchSourcePage` — it ships its own fetcher. See Review Focus 1.
- **Publisher names are exactly `'Marvel'` and `'DC Comics'`**, matching `SHOWN` in `routes/releases.ts` and `WIKI_PAGES` in `wikiRuns.ts`, so all three tabs agree.
- **Commit style:** conventional, lowercase, e.g. `feat: show what Marvel is publishing next`. End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Run the full suite before each commit:** `npm test`. Type check with `npm run typecheck`.
- **After the final task, rebuild the container:** `docker compose up -d --build`.

## Two deliberate departures from the spec

Both are corrections found while planning. They are listed here so a reviewer sees them rather than finding a silent mismatch.

1. **`upcoming_week`'s primary key is `(week, publisher)`, not `week` alone.** The spec's §4.2 gives `week TEXT PRIMARY KEY`, but every issue row carries a publisher so DC can be added without a migration. With a single-column key, adding DC later would make Marvel and DC share one `fetched_at` per week, so fetching one would mark the other fresh. The composite key is what actually delivers §4.2's stated intent.

2. **No new `UpcomingTile` component.** The spec's §4.5 calls for one because `MissingIssueTile` is built around a Get button. That reasoning is right, but `CoverTile` already accepts `href` for an external destination plus `img`, `title` and `subtitle` — which is exactly the read-only tile needed. Adding a component that only forwards props to `CoverTile` is the kind of layer YAGNI exists to prevent.

## Review Focus

These are the failure modes the spec implies that no task's happy path would exercise. Each has a test in the task that owns the code.

1. **Marvel 403s the app's own User-Agent.** `fetchSourcePage` — the fetcher both existing release routes use — sends `comic-app/0.1 (...)`, which Marvel rejects outright. Because every test injects a fake `fetchPage`, a route defaulting to it would pass the entire suite and return nothing but errors against the live site. This is the one failure here that ships green. Task 2 owns the fetcher and pins the UA shape.
2. **A duplicate `sourceId` inside one week** aborts the whole week's insert on the composite primary key, silently losing every issue for that week. This repo already hit exactly this with Comic Vine repeating an id across pages — see the comment in `cacheRelease`. Deduped in Task 3, tested there.
3. **A one-shot headline with no `#N`** (`Invented Special (2026)`) must parse with `number: null` and still be shown, not skipped. Tested in Task 2.
4. **The 12-hour TTL boundary** — a week cached exactly 12 hours ago is still fresh; one millisecond older is not. An off-by-one here silently refetches ten weeks on every page load. Tested in Task 3.
5. **The concurrency cap** — nothing in a happy-path test would notice ten simultaneous requests to marvel.com. Tested in Task 4 by recording peak in-flight count.
6. **Past weeks are pruned** — without it `upcoming_issue` grows forever, since no row is ever otherwise deleted. Tested in Task 3.

---

## File Structure

**Create:**
- `server/lib/marvelCalendar.ts` — URL building and payload parsing. Pure, no I/O.
- `server/models/upcoming.ts` — cache read/write, freshness, pruning.
- `server/routes/upcoming.ts` — `GET /api/releases/upcoming`.
- `test/marvel-calendar.test.ts`, `test/models-upcoming.test.ts`, `test/routes-upcoming.test.ts`

**Modify:**
- `server/lib/releaseDay.ts` — add `shiftDays`, `upcomingWednesdays`
- `server/db.ts` — two tables in `SCHEMA`
- `server/index.ts` — import and register the route
- `src/api.ts` — types and `getUpcoming`
- `src/pages/Releases.tsx` — third tab and its panel
- `test/release-day.test.ts`, `test/Releases.test.tsx` — new cases

---

### Task 1: Date arithmetic for upcoming Wednesdays

**Files:**
- Modify: `server/lib/releaseDay.ts`
- Test: `test/release-day.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `shiftDays(day: string, delta: number): string` and `upcomingWednesdays(now: Date, count: number): string[]`. Task 2 uses `shiftDays`; Task 4 uses `upcomingWednesdays`.

- [ ] **Step 1: Write the failing tests**

Append to `test/release-day.test.ts`:

```ts
import { shiftDays, upcomingWednesdays } from '../server/lib/releaseDay.js'

test('shiftDays moves a plain date forward and back in UTC', () => {
  expect(shiftDays('2026-09-30', 3)).toBe('2026-10-03')
  expect(shiftDays('2026-09-30', -3)).toBe('2026-09-27')
})

test('shiftDays crosses a year boundary', () => {
  expect(shiftDays('2026-12-30', 7)).toBe('2027-01-06')
})

// The tab shows what is coming, so it must start after the Wednesday the Latest tab
// is already showing - never repeat it.
test('upcomingWednesdays starts after the most recent Wednesday', () => {
  // A Friday. mostRecentWednesday is 2026-09-23, so upcoming starts 2026-09-30.
  const weeks = upcomingWednesdays(new Date('2026-09-25T10:00:00Z'), 3)
  expect(weeks).toEqual(['2026-09-30', '2026-10-07', '2026-10-14'])
})

// On a Wednesday the Latest tab shows today, so today is not "upcoming".
test('upcomingWednesdays skips today when today is Wednesday', () => {
  const weeks = upcomingWednesdays(new Date('2026-09-30T10:00:00Z'), 2)
  expect(weeks).toEqual(['2026-10-07', '2026-10-14'])
})

test('upcomingWednesdays crosses a year boundary', () => {
  const weeks = upcomingWednesdays(new Date('2026-12-28T10:00:00Z'), 3)
  expect(weeks).toEqual(['2026-12-30', '2027-01-06', '2027-01-13'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/release-day.test.ts`
Expected: FAIL — `shiftDays` and `upcomingWednesdays` are not exported.

- [ ] **Step 3: Implement**

Append to `server/lib/releaseDay.ts`:

```ts
/** A plain date moved by whole days, in UTC. */
export function shiftDays(day: string, delta: number): string {
  return iso(new Date(new Date(`${day}T00:00:00Z`).getTime() + delta * DAY_MS))
}

/**
 * The next `count` Wednesdays, starting with the one AFTER the day the Latest tab shows.
 *
 * Anchored on mostRecentWednesday rather than on `now` so the two tabs can never both
 * claim the same Wednesday: on a Wednesday the Latest tab is showing today, and today is
 * not something to look forward to.
 */
export function upcomingWednesdays(now: Date, count: number): string[] {
  const current = mostRecentWednesday(now)
  return Array.from({ length: count }, (_, i) => shiftDays(current, (i + 1) * 7))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/release-day.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add server/lib/releaseDay.ts test/release-day.test.ts
git commit -m "feat: work out which Wednesdays are still to come

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The Marvel calendar parser

**Files:**
- Create: `server/lib/marvelCalendar.ts`
- Test: `test/marvel-calendar.test.ts`

**Interfaces:**
- Consumes: `shiftDays` from Task 1.
- Produces:
  - `interface UpcomingIssue { sourceId: string; headline: string; seriesName: string; number: string | null; releaseDate: string; coverUrl: string | null; siteUrl: string; creators: string | null }`
  - `calendarUrl(wednesday: string): string`
  - `parseCalendar(html: string): UpcomingIssue[]` — throws when the bucket is absent
  - `sortUpcomingIssues(issues: UpcomingIssue[]): UpcomingIssue[]`
  - `MARVEL = 'Marvel'`
  - `MARVEL_USER_AGENT: string`
  - `fetchCalendarPage(url: string): Promise<string>` — the live fetcher Task 4 defaults to

- [ ] **Step 1: Write the failing tests**

Create `test/marvel-calendar.test.ts`:

```ts
import { test, expect } from 'vitest'
import {
  calendarUrl, parseCalendar, sortUpcomingIssues, MARVEL, MARVEL_USER_AGENT,
} from '../server/lib/marvelCalendar.js'

/**
 * Synthetic, not a capture of the live page: the titles are invented, so these tests pin
 * the payload's *structure* and rot only when Marvel changes it rather than every week
 * when the solicitations move on.
 *
 * Every oddity below was measured against the real calendar on 2026-09-25 (see the design
 * spec, §3): three sibling buckets of which only the first is wanted, a variant that must
 * be excluded, an entry with no cover, a one-shot with no issue number, and an entry with
 * no link that cannot be keyed.
 */
function payload(inner: string): string {
  return `<html><body><script>window.x={"page":{"allComicsReleases":${inner},`
    + `"allCollectionsReleases":{"total":1,"content":[{"headline":"INVENTED OMNIBUS (Trade Paperback)",`
    + `"releaseDate":"2026-09-30","isVariant":0,"link":{"link":"https://www.marvel.com/comics/collection/1/x"}}]},`
    + `"allMUReleases":{"total":1,"content":[{"headline":"Invented MU (2026) #1","releaseDate":"2026-07-08",`
    + `"isVariant":0,"link":{"link":"https://www.marvel.com/comics/issue/999/mu"}}]}}}</script></body></html>`
}

const ENTRY = {
  creators_shortlist: 'Invented, Writer',
  headline: 'Invented Ongoing (2026) #12',
  isVariant: 0,
  releaseDate: '2026-09-30',
  image: { filename: 'https://cdn.marvel.com/x/a.jpg' },
  link: { link: 'https://www.marvel.com/comics/issue/134736/invented_ongoing_2026_12' },
}

const bucket = (content: unknown[]) =>
  payload(JSON.stringify({ total: content.length, content }))

test('builds a one-week url around the Wednesday, comics only, no variants', () => {
  const url = new URL(calendarUrl('2026-09-30'))
  expect(url.origin + url.pathname).toBe('https://www.marvel.com/comics/calendar')
  expect(url.searchParams.get('dateStart')).toBe('2026-09-27')
  expect(url.searchParams.get('dateEnd')).toBe('2026-10-03')
  expect(url.searchParams.get('tab')).toBe('comic')
  expect(url.searchParams.get('variants')).toBe('false')
})

test('reads every field from a comics entry', () => {
  const [issue] = parseCalendar(bucket([ENTRY]))
  expect(issue).toEqual({
    sourceId: '134736',
    headline: 'Invented Ongoing (2026) #12',
    seriesName: 'Invented Ongoing',
    number: '12',
    releaseDate: '2026-09-30',
    coverUrl: 'https://cdn.marvel.com/x/a.jpg',
    siteUrl: 'https://www.marvel.com/comics/issue/134736/invented_ongoing_2026_12',
    creators: 'Invented, Writer',
  })
})

// The collections and Marvel Unlimited buckets sit beside the one we want, and the MU
// bucket carries dates months away from the week asked for. Reading the wrong bucket
// would fill the week with comics that are not coming out then, or at all.
test('ignores the collections and Marvel Unlimited buckets', () => {
  const issues = parseCalendar(bucket([ENTRY]))
  expect(issues).toHaveLength(1)
  expect(issues[0]!.headline).toBe('Invented Ongoing (2026) #12')
})

test('drops variants even though the url already asks for none', () => {
  const variant = { ...ENTRY, isVariant: 1, link: { link: 'https://www.marvel.com/comics/issue/2/v' } }
  expect(parseCalendar(bucket([ENTRY, variant]))).toHaveLength(1)
})

// Review Focus 3: a one-shot has no "#N". It is a real comic and must still be shown.
test('a headline with no issue number parses with a null number and is kept', () => {
  const oneShot = {
    ...ENTRY,
    headline: 'Invented Special (2026)',
    link: { link: 'https://www.marvel.com/comics/issue/555/invented_special' },
  }
  const [issue] = parseCalendar(bucket([oneShot]))
  expect(issue!.number).toBeNull()
  expect(issue!.seriesName).toBe('Invented Special')
  expect(issue!.headline).toBe('Invented Special (2026)')
})

test('skips an entry with no link, which has no stable key', () => {
  const { link: _drop, ...noLink } = ENTRY
  expect(parseCalendar(bucket([ENTRY, noLink]))).toHaveLength(1)
})

test('skips an entry with no release date', () => {
  const { releaseDate: _drop, ...noDate } = ENTRY
  const undated = { ...noDate, link: { link: 'https://www.marvel.com/comics/issue/3/u' } }
  expect(parseCalendar(bucket([ENTRY, undated]))).toHaveLength(1)
})

test('a missing cover or creator list reads as null, not as a skipped issue', () => {
  const bare = {
    headline: 'Invented Bare (2026) #1',
    releaseDate: '2026-09-30',
    isVariant: 0,
    link: { link: 'https://www.marvel.com/comics/issue/77/invented_bare' },
  }
  const [issue] = parseCalendar(bucket([bare]))
  expect(issue!.coverUrl).toBeNull()
  expect(issue!.creators).toBeNull()
})

// An empty week is a real answer - the spec measured a three-issue week, so "few" never
// means "broken". Only a MISSING bucket means the page changed shape.
test('an empty content list parses to no issues rather than throwing', () => {
  expect(parseCalendar(bucket([]))).toEqual([])
})

test('a payload with no comics bucket throws rather than reading as an empty week', () => {
  expect(() => parseCalendar('<html><body>nothing here</body></html>')).toThrow()
})

test('orders by series then issue number, numerically', () => {
  const make = (headline: string, sourceId: string) => ({
    sourceId, headline, seriesName: headline.replace(/\s*#.*$/, ''),
    number: headline.split('#')[1] ?? null, releaseDate: '2026-09-30',
    coverUrl: null, siteUrl: `https://www.marvel.com/comics/issue/${sourceId}/x`, creators: null,
  })
  const sorted = sortUpcomingIssues([
    make('Invented Beta #2', '3'), make('Invented Alpha #10', '2'), make('Invented Alpha #9', '1'),
  ])
  expect(sorted.map((i) => i.headline)).toEqual([
    'Invented Alpha #9', 'Invented Alpha #10', 'Invented Beta #2',
  ])
})

test('names the publisher exactly as the other two tabs name it', () => {
  expect(MARVEL).toBe('Marvel')
})

/**
 * Review Focus 1. Marvel answers this app's own User-Agent - and a bare "Mozilla/5.0" -
 * with a 403, and answers the conventional "(compatible; ...)" form with the page. Every
 * other test in the suite injects a fake fetcher, so nothing else would ever notice a
 * route wired to the wrong one.
 */
test('identifies itself in the form Marvel accepts, without claiming to be a browser', () => {
  expect(MARVEL_USER_AGENT).toMatch(/^Mozilla\/5\.0 \(compatible;/)
  expect(MARVEL_USER_AGENT).toContain('comic-app')
  expect(MARVEL_USER_AGENT).not.toMatch(/Chrome|Safari|Firefox/)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/marvel-calendar.test.ts`
Expected: FAIL — cannot resolve `../server/lib/marvelCalendar.js`.

- [ ] **Step 3: Implement**

Create `server/lib/marvelCalendar.ts`:

```ts
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
  const open = html.indexOf('{', at + BUCKET.length)
  if (open < 0) throw new Error('Marvel calendar: malformed allComicsReleases bucket')

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
  return [...issues].sort((a, b) => (
    a.seriesName.localeCompare(b.seriesName)
    || (numericPrefix(a.number) - numericPrefix(b.number))
    || (a.number ?? '').localeCompare(b.number ?? '')
    || a.sourceId.localeCompare(b.sourceId)
  ))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/marvel-calendar.test.ts`
Expected: PASS, all 12 cases.

- [ ] **Step 5: Commit**

```bash
git add server/lib/marvelCalendar.ts test/marvel-calendar.test.ts
git commit -m "feat: read one week of Marvel's release calendar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The week cache

**Files:**
- Modify: `server/db.ts` (inside the `SCHEMA` template, after the `release_issue` block)
- Create: `server/models/upcoming.ts`
- Test: `test/models-upcoming.test.ts`

**Interfaces:**
- Consumes: `UpcomingIssue`, `sortUpcomingIssues` from Task 2.
- Produces:
  - `UPCOMING_MAX_AGE_MS: number`
  - `interface CachedUpcomingWeek { issues: UpcomingIssue[]; fetchedAt: string }`
  - `cacheUpcomingWeek(db: Db, week: string, publisher: string, issues: UpcomingIssue[], now?: string): void`
  - `getCachedUpcomingWeek(db: Db, week: string, publisher: string, maxAgeMs: number, now?: Date): CachedUpcomingWeek | undefined`
  - `getFreshUpcomingWeek(db: Db, week: string, publisher: string, now?: Date): CachedUpcomingWeek | undefined`
  - `pruneUpcomingBefore(db: Db, day: string): void`

- [ ] **Step 1: Write the failing tests**

Create `test/models-upcoming.test.ts`:

```ts
import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  cacheUpcomingWeek, getCachedUpcomingWeek, getFreshUpcomingWeek, pruneUpcomingBefore,
  UPCOMING_MAX_AGE_MS,
} from '../server/models/upcoming.js'
import type { UpcomingIssue } from '../server/lib/marvelCalendar.js'

const issue = (sourceId: string, headline: string, number: string | null): UpcomingIssue => ({
  sourceId, headline, seriesName: headline.replace(/\s*#.*$/, ''), number,
  releaseDate: '2026-09-30', coverUrl: 'https://cdn.marvel.com/x/a.jpg',
  siteUrl: `https://www.marvel.com/comics/issue/${sourceId}/x`, creators: 'Invented',
})

const ISSUES = [issue('1', 'Invented Alpha #1', '1'), issue('2', 'Invented Beta #3', '3')]

test('a cached week round-trips', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-25T12:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)
  expect(held?.fetchedAt).toBe('2026-09-25T12:00:00.000Z')
  expect(held?.issues).toEqual(ISSUES)
})

// The whole reason upcoming_week is a separate table: a week Marvel has announced nothing
// for still has to record that we asked, or "no rows" and "never asked" are the same
// thing and it refetches forever.
test('an empty week is remembered as asked-and-empty, not as never asked', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-12-02', 'Marvel', [], '2026-09-25T12:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-12-02', 'Marvel', Infinity)
  expect(held).toBeDefined()
  expect(held?.issues).toEqual([])
  expect(getCachedUpcomingWeek(db, '2026-12-09', 'Marvel', Infinity)).toBeUndefined()
})

test('caching a week again replaces what it held', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-25T12:00:00.000Z')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', [ISSUES[0]!], '2026-09-25T13:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)
  expect(held?.issues).toHaveLength(1)
  expect(held?.fetchedAt).toBe('2026-09-25T13:00:00.000Z')
})

// Review Focus 2: Marvel repeating an entry inside one week would collide on the
// composite primary key and abort the insert, losing the ENTIRE week rather than the
// duplicate. Comic Vine did exactly this to the Latest tab - see cacheRelease's comment.
test('a repeated sourceId inside one week does not abort the week', () => {
  const db = openDb(':memory:')
  const dupe = [ISSUES[0]!, ISSUES[1]!, { ...ISSUES[0]!, headline: 'Invented Alpha #1 again' }]
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', dupe, '2026-09-25T12:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)
  expect(held?.issues).toHaveLength(2)
  expect(held?.issues.map((i) => i.sourceId).sort()).toEqual(['1', '2'])
})

// Two publishers must keep their own fetch stamps, or fetching Marvel would mark DC
// fresh and DC would never be read again.
test('each publisher keeps its own week and its own stamp', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-25T12:00:00.000Z')
  cacheUpcomingWeek(db, '2026-09-30', 'DC Comics', [ISSUES[0]!], '2026-09-25T18:00:00.000Z')
  expect(getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)?.issues).toHaveLength(2)
  const dc = getCachedUpcomingWeek(db, '2026-09-30', 'DC Comics', Infinity)
  expect(dc?.issues).toHaveLength(1)
  expect(dc?.fetchedAt).toBe('2026-09-25T18:00:00.000Z')
})

// Review Focus 4: the TTL boundary. Solicitations change, so nothing here is permanent -
// this is the sharpest departure from the Latest tab, where a past day is settled forever.
test('a week is fresh up to the age limit and stale one millisecond past it', () => {
  const db = openDb(':memory:')
  const at = new Date('2026-09-25T12:00:00.000Z')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, at.toISOString())

  const exactly = new Date(at.getTime() + UPCOMING_MAX_AGE_MS)
  expect(getFreshUpcomingWeek(db, '2026-09-30', 'Marvel', exactly)).toBeDefined()

  const past = new Date(at.getTime() + UPCOMING_MAX_AGE_MS + 1)
  expect(getFreshUpcomingWeek(db, '2026-09-30', 'Marvel', past)).toBeUndefined()
})

// A stale week is still readable at any age - whatever we hold beats nothing when Marvel
// is unreachable.
test('a stale week is still there to be read at any age', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-01T12:00:00.000Z')
  const now = new Date('2026-09-25T12:00:00.000Z')
  expect(getFreshUpcomingWeek(db, '2026-09-30', 'Marvel', now)).toBeUndefined()
  expect(getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity, now)?.issues).toHaveLength(2)
})

// Review Focus 6: nothing else ever deletes from these tables, so without pruning they
// grow forever.
test('weeks now in the past are pruned, and future weeks are left alone', () => {
  const db = openDb(':memory:')
  cacheUpcomingWeek(db, '2026-09-16', 'Marvel', ISSUES, '2026-09-10T12:00:00.000Z')
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', ISSUES, '2026-09-25T12:00:00.000Z')

  pruneUpcomingBefore(db, '2026-09-30')

  expect(getCachedUpcomingWeek(db, '2026-09-16', 'Marvel', Infinity)).toBeUndefined()
  expect(getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)?.issues).toHaveLength(2)
  const rows = db.prepare('SELECT COUNT(*) AS n FROM upcoming_issue').get() as { n: number }
  expect(rows.n).toBe(2)
})

test('a cache read comes back in the one true order, whatever order it went in', () => {
  const db = openDb(':memory:')
  const unsorted = [issue('9', 'Invented Zeta #10', '10'), issue('8', 'Invented Zeta #9', '9')]
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', unsorted, '2026-09-25T12:00:00.000Z')
  const held = getCachedUpcomingWeek(db, '2026-09-30', 'Marvel', Infinity)
  expect(held?.issues.map((i) => i.number)).toEqual(['9', '10'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/models-upcoming.test.ts`
Expected: FAIL — cannot resolve `../server/models/upcoming.js`.

- [ ] **Step 3: Add the tables**

In `server/db.ts`, inside the `SCHEMA` template literal, immediately after the
`CREATE TABLE IF NOT EXISTS release_issue (...);` block and before the
`download_queue` comment, insert:

```sql
-- The upcoming weeks we have asked Marvel about. Separate from the issues for the same
-- reason release_day is separate from release_issue: a week Marvel has announced nothing
-- for still has to record that we asked, or "no rows" and "never asked" are the same
-- thing and it refetches forever.
--
-- Keyed by publisher as well as week, not by week alone: each publisher is fetched on its
-- own, so one stamp per week would let a Marvel fetch mark DC fresh.
CREATE TABLE IF NOT EXISTS upcoming_week (
  week       TEXT NOT NULL,
  publisher  TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (week, publisher)
);

-- Solicited issues, which is to say promises rather than facts: dates slip and issues are
-- cancelled, so nothing here is ever read as permanent the way a past release_day is.
-- `release_date` is kept beside `week` rather than assumed equal to it - every issue
-- measured fell on its Wednesday, but grouping by what Marvel actually said costs one
-- column and cannot be wrong.
CREATE TABLE IF NOT EXISTS upcoming_issue (
  week         TEXT NOT NULL,
  publisher    TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  headline     TEXT NOT NULL,
  series_name  TEXT NOT NULL,
  number       TEXT,
  release_date TEXT NOT NULL,
  cover_url    TEXT,
  site_url     TEXT NOT NULL,
  creators     TEXT,
  PRIMARY KEY (week, publisher, source_id)
);
```

- [ ] **Step 4: Implement the model**

Create `server/models/upcoming.ts`:

```ts
import { sortUpcomingIssues } from '../lib/marvelCalendar.js'
import type { UpcomingIssue } from '../lib/marvelCalendar.js'
import type { Db } from '../types.js'

/**
 * How long a cached week is trusted.
 *
 * Every week here is a solicitation, and a solicitation changes until it ships - a date
 * slips, an issue is cancelled. This is the sharpest difference from models/releases.ts,
 * where a day fetched after it ended is final and read at any age. Nothing upcoming is
 * ever final, so everything expires.
 */
export const UPCOMING_MAX_AGE_MS = 12 * 60 * 60 * 1000

export interface CachedUpcomingWeek {
  issues: UpcomingIssue[]
  fetchedAt: string
}

interface Row {
  source_id: string
  headline: string
  series_name: string
  number: string | null
  release_date: string
  cover_url: string | null
  site_url: string
  creators: string | null
}

const SELECT = `SELECT source_id, headline, series_name, number, release_date,
                       cover_url, site_url, creators
                FROM upcoming_issue`

function toIssue(r: Row): UpcomingIssue {
  return {
    sourceId: r.source_id,
    headline: r.headline,
    seriesName: r.series_name,
    number: r.number,
    releaseDate: r.release_date,
    coverUrl: r.cover_url,
    siteUrl: r.site_url,
    creators: r.creators,
  }
}

/** Age arithmetic, in one place: an infinite budget is never exceeded. */
function withinAge(fetchedAt: string, maxAgeMs: number, now: Date): boolean {
  if (!Number.isFinite(maxAgeMs)) return true
  return now.getTime() - new Date(fetchedAt).getTime() <= maxAgeMs
}

/**
 * Replace everything held for one publisher's week and stamp when it was read. One
 * transaction, so a half-written week can never be served as a whole one.
 */
export function cacheUpcomingWeek(
  db: Db,
  week: string,
  publisher: string,
  issues: UpcomingIssue[],
  now = new Date().toISOString(),
): void {
  const clear = db.prepare('DELETE FROM upcoming_issue WHERE week = ? AND publisher = ?')
  const insert = db.prepare(
    `INSERT INTO upcoming_issue
       (week, publisher, source_id, headline, series_name, number, release_date,
        cover_url, site_url, creators)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  const stamp = db.prepare(
    'INSERT INTO upcoming_week (week, publisher, fetched_at) VALUES (?,?,?) ' +
    'ON CONFLICT(week, publisher) DO UPDATE SET fetched_at = excluded.fetched_at',
  )

  db.transaction(() => {
    clear.run(week, publisher)
    const seen = new Set<string>()
    for (const issue of issues) {
      // Marvel has been seen to repeat an entry; the primary key would reject the second
      // one and abort the whole week. The Latest tab learned this from Comic Vine.
      if (seen.has(issue.sourceId)) continue
      seen.add(issue.sourceId)
      insert.run(
        week, publisher, issue.sourceId, issue.headline, issue.seriesName,
        issue.number, issue.releaseDate, issue.coverUrl, issue.siteUrl, issue.creators,
      )
    }
    stamp.run(week, publisher, now)
  })()
}

/**
 * What we hold for a publisher's week, or nothing when we never asked or it aged out. An
 * empty `issues` with a `fetchedAt` means we asked and Marvel has announced nothing for
 * that week - a normal outcome near the horizon, and not a reason to refetch.
 */
export function getCachedUpcomingWeek(
  db: Db,
  week: string,
  publisher: string,
  maxAgeMs: number,
  now = new Date(),
): CachedUpcomingWeek | undefined {
  const stamp = db
    .prepare('SELECT fetched_at FROM upcoming_week WHERE week = ? AND publisher = ?')
    .get(week, publisher) as { fetched_at: string } | undefined
  if (!stamp) return undefined
  if (!withinAge(stamp.fetched_at, maxAgeMs, now)) return undefined

  // Ordering lives in sortUpcomingIssues, never in SQL - see its comment for why a second
  // implementation of the same ordering is the bug this avoids.
  const rows = db
    .prepare(`${SELECT} WHERE week = ? AND publisher = ?`)
    .all(week, publisher) as Row[]

  return { fetchedAt: stamp.fetched_at, issues: sortUpcomingIssues(rows.map(toIssue)) }
}

/** What we hold, if it can still be trusted. The one place the TTL is applied. */
export function getFreshUpcomingWeek(
  db: Db,
  week: string,
  publisher: string,
  now = new Date(),
): CachedUpcomingWeek | undefined {
  return getCachedUpcomingWeek(db, week, publisher, UPCOMING_MAX_AGE_MS, now)
}

/**
 * Drop every week before `day`, for every publisher.
 *
 * Nothing else ever deletes from these tables, so without this they grow without bound.
 * A week that has arrived is no longer upcoming - the Latest tab owns it from then on.
 */
export function pruneUpcomingBefore(db: Db, day: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM upcoming_issue WHERE week < ?').run(day)
    db.prepare('DELETE FROM upcoming_week WHERE week < ?').run(day)
  })()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/models-upcoming.test.ts test/db.test.ts`
Expected: PASS — all 9 new cases, and the existing schema test unaffected.

- [ ] **Step 6: Commit**

```bash
git add server/db.ts server/models/upcoming.ts test/models-upcoming.test.ts
git commit -m "feat: cache a week of upcoming comics, but never permanently

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The route

**Files:**
- Create: `server/routes/upcoming.ts`
- Modify: `server/index.ts`
- Test: `test/routes-upcoming.test.ts`

**Interfaces:**
- Consumes: `upcomingWednesdays` (Task 1), `calendarUrl` / `parseCalendar` / `MARVEL` / `UpcomingIssue` (Task 2), the whole of `models/upcoming.ts` (Task 3).
- Produces: default-exported Fastify plugin `upcomingRoutes(app, opts)` where
  `opts: { fetchPage?: (url: string) => Promise<string>; now?: () => Date }`, serving
  `GET /api/releases/upcoming` with body
  `{ publishers: Array<{ name: string; weeks: Array<{ week: string; issues: UpcomingIssue[] }>; unsupported?: true; unavailable?: true }>; staleWeeks?: string[] }`.

- [ ] **Step 1: Write the failing tests**

Create `test/routes-upcoming.test.ts`:

```ts
import { test, expect } from 'vitest'
import Fastify from 'fastify'
import upcomingRoutes from '../server/routes/upcoming.js'
import { openDb } from '../server/db.js'
import { cacheUpcomingWeek } from '../server/models/upcoming.js'
import type { Config } from '../server/config.js'
import type { Db } from '../server/types.js'

const NOW = new Date('2026-09-25T10:00:00Z') // a Friday; upcoming starts 2026-09-30

/** One week's page, shaped like the real one. Titles invented - see marvel-calendar.test. */
function page(entries: Array<{ id: string; headline: string; date: string }>): string {
  const content = entries.map((e) => ({
    headline: e.headline,
    releaseDate: e.date,
    isVariant: 0,
    creators_shortlist: 'Invented',
    image: { filename: `https://cdn.marvel.com/x/${e.id}.jpg` },
    link: { link: `https://www.marvel.com/comics/issue/${e.id}/x` },
  }))
  return `<html><script>window.x={"allComicsReleases":${
    JSON.stringify({ total: content.length, content })},"allCollectionsReleases":{"total":0,"content":[]}}</script></html>`
}

/** The Wednesday a calendar url is asking about: dateStart is always the Wednesday - 3. */
function weekOf(url: string): string {
  const start = new URL(url).searchParams.get('dateStart')!
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 3)
  return d.toISOString().slice(0, 10)
}

async function setup(fetchPage: (url: string) => Promise<string>): Promise<{ app: ReturnType<typeof Fastify>; db: Db }> {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  await app.register(upcomingRoutes, { fetchPage, now: () => NOW })
  return { app, db }
}

/** Answers every week with one invented issue, and records which urls were asked for. */
function everyWeek() {
  const urls: string[] = []
  const fetchPage = async (url: string) => {
    urls.push(url)
    const week = weekOf(url)
    return page([{ id: `i${week}`, headline: `Invented Ongoing (2026) #1`, date: week }])
  }
  return { urls, fetchPage }
}

test('serves upcoming weeks, nearest first, starting after this week', async () => {
  const { fetchPage } = everyWeek()
  const { app } = await setup(fetchPage)
  const res = await app.inject({ method: 'GET', url: '/api/releases/upcoming' })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  const marvel = body.publishers.find((p: { name: string }) => p.name === 'Marvel')
  expect(marvel.weeks[0].week).toBe('2026-09-30')
  const weeks = marvel.weeks.map((w: { week: string }) => w.week)
  expect([...weeks].sort()).toEqual(weeks)
  expect(marvel.weeks[0].issues[0].headline).toBe('Invented Ongoing (2026) #1')
})

// Not behind the Comic Vine key check: this reads Marvel, so the tab works on a fresh
// install with no key entered. /api/releases/running sets the precedent.
test('answers with no Comic Vine key configured', async () => {
  const { fetchPage } = everyWeek()
  const { app } = await setup(fetchPage)
  const res = await app.inject({ method: 'GET', url: '/api/releases/upcoming' })
  expect(res.statusCode).toBe(200)
  expect(res.json().publishers[0].weeks.length).toBeGreaterThan(0)
})

test('DC keeps its tab and is marked unsupported rather than empty', async () => {
  const { fetchPage } = everyWeek()
  const { app } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()

  expect(body.publishers.map((p: { name: string }) => p.name)).toEqual(['Marvel', 'DC Comics'])
  const dc = body.publishers[1]
  expect(dc.unsupported).toBe(true)
  expect(dc.weeks).toEqual([])
})

test('a fresh cached week is served without fetching it', async () => {
  const { urls, fetchPage } = everyWeek()
  const { app, db } = await setup(fetchPage)
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', [{
    sourceId: '1', headline: 'Invented Cached (2026) #7', seriesName: 'Invented Cached',
    number: '7', releaseDate: '2026-09-30', coverUrl: null,
    siteUrl: 'https://www.marvel.com/comics/issue/1/x', creators: null,
  }], NOW.toISOString())

  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()
  expect(urls.map(weekOf)).not.toContain('2026-09-30')
  expect(body.publishers[0].weeks[0].issues[0].headline).toBe('Invented Cached (2026) #7')
})

// Review Focus 5: nothing on a happy path would notice ten simultaneous requests.
test('never has more than three requests to Marvel in flight', async () => {
  let inFlight = 0
  let peak = 0
  const fetchPage = async (url: string) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight--
    const week = weekOf(url)
    return page([{ id: `i${week}`, headline: 'Invented Ongoing (2026) #1', date: week }])
  }
  const { app } = await setup(fetchPage)
  await app.inject({ method: 'GET', url: '/api/releases/upcoming' })
  expect(peak).toBeLessThanOrEqual(3)
  expect(peak).toBeGreaterThan(1)
})

test('one failing week does not blank the others, and is named stale', async () => {
  const fetchPage = async (url: string) => {
    const week = weekOf(url)
    if (week === '2026-10-07') throw new Error('network is down')
    return page([{ id: `i${week}`, headline: 'Invented Ongoing (2026) #1', date: week }])
  }
  const { app } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()

  const weeks = body.publishers[0].weeks.map((w: { week: string }) => w.week)
  expect(weeks).toContain('2026-09-30')
  // The failed week keeps its place in the run rather than vanishing from the middle of
  // the calendar - it is empty, and named as stale, which is a different thing from a
  // week that was never announced.
  expect(weeks).toContain('2026-10-07')
  const failed = body.publishers[0].weeks.find((w: { week: string }) => w.week === '2026-10-07')
  expect(failed.issues).toEqual([])
  expect(body.staleWeeks).toContain('2026-10-07')
})

test('a failing week falls back to what is cached, at any age', async () => {
  // Every OTHER week must return a real issue: a load where every week that succeeded
  // came back empty is the structural-change case, which refuses to cache at all and
  // would mask the fallback this test is about.
  const fetchPage = async (url: string) => {
    const week = weekOf(url)
    if (week === '2026-09-30') throw new Error('network is down')
    return page([{ id: `i${week}`, headline: 'Invented Ongoing (2026) #1', date: week }])
  }
  const { app, db } = await setup(fetchPage)
  cacheUpcomingWeek(db, '2026-09-30', 'Marvel', [{
    sourceId: '1', headline: 'Invented Old (2026) #1', seriesName: 'Invented Old',
    number: '1', releaseDate: '2026-09-30', coverUrl: null,
    siteUrl: 'https://www.marvel.com/comics/issue/1/x', creators: null,
  }], '2026-09-01T12:00:00.000Z') // long stale

  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()
  expect(body.publishers[0].weeks[0].issues[0].headline).toBe('Invented Old (2026) #1')
  expect(body.staleWeeks).toContain('2026-09-30')
})

// The horizon: Marvel solicits about nine weeks out, so the tail is genuinely empty and
// the page must end there rather than showing a run of empty headings.
test('trailing empty weeks are dropped', async () => {
  const fetchPage = async (url: string) => {
    const week = weekOf(url)
    if (week > '2026-10-14') return page([])
    return page([{ id: `i${week}`, headline: 'Invented Ongoing (2026) #1', date: week }])
  }
  const { app } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()
  const weeks = body.publishers[0].weeks.map((w: { week: string }) => w.week)
  expect(weeks[weeks.length - 1]).toBe('2026-10-14')
})

// A three-issue week is real (measured), so "few" never means "broken". Only EVERY week
// coming back empty means the payload changed shape - and that must not be cached, or the
// emptiness sticks for twelve hours.
test('every week empty is reported as unavailable and is not cached', async () => {
  const fetchPage = async () => page([])
  const { app, db } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()

  expect(body.publishers[0].unavailable).toBe(true)
  expect(body.publishers[0].weeks).toEqual([])
  const rows = db.prepare('SELECT COUNT(*) AS n FROM upcoming_week').get() as { n: number }
  expect(rows.n).toBe(0)
})

test('a payload that changed shape is not cached as an empty week', async () => {
  const fetchPage = async () => '<html><body>Marvel redesigned the page</body></html>'
  const { app, db } = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/upcoming' })).json()

  expect(body.publishers[0].unavailable).toBe(true)
  const rows = db.prepare('SELECT COUNT(*) AS n FROM upcoming_week').get() as { n: number }
  expect(rows.n).toBe(0)
})

test('weeks now in the past are pruned on the way through', async () => {
  const { fetchPage } = everyWeek()
  const { app, db } = await setup(fetchPage)
  cacheUpcomingWeek(db, '2026-09-16', 'Marvel', [], '2026-09-10T12:00:00.000Z')

  await app.inject({ method: 'GET', url: '/api/releases/upcoming' })

  const gone = db.prepare('SELECT COUNT(*) AS n FROM upcoming_week WHERE week = ?').get('2026-09-16') as { n: number }
  expect(gone.n).toBe(0)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/routes-upcoming.test.ts`
Expected: FAIL — cannot resolve `../server/routes/upcoming.js`.

- [ ] **Step 3: Implement the route**

Create `server/routes/upcoming.ts`:

```ts
import { upcomingWednesdays } from '../lib/releaseDay.js'
import { calendarUrl, parseCalendar, fetchCalendarPage, MARVEL } from '../lib/marvelCalendar.js'
import type { UpcomingIssue } from '../lib/marvelCalendar.js'
import {
  cacheUpcomingWeek, getCachedUpcomingWeek, getFreshUpcomingWeek, pruneUpcomingBefore,
} from '../models/upcoming.js'
import type { App } from '../types.js'

/**
 * How many Wednesdays ahead to ask about. Marvel was measured solicitating about nine
 * weeks out, and the boundary rolls forward as new solicitations drop; ten covers it with
 * room to grow. Weeks past the horizon come back empty and are dropped from the answer.
 */
const WEEKS_AHEAD = 10

/**
 * How many requests to Marvel may be in flight at once. A cold load is ten pages of about
 * 330KB; three at a time keeps it to a couple of seconds without hammering a site that is
 * doing us a favour by being readable at all.
 */
const CONCURRENCY = 3

/** The publishers this tab names, in the order the other two tabs name them. */
const SHOWN = [MARVEL, 'DC Comics'] as const

export interface UpcomingRouteOpts {
  /** Injected so tests never touch the network, exactly as the other release routes do. */
  fetchPage?: (url: string) => Promise<string>
  /** Injected so tests can pin "today". */
  now?: () => Date
}

interface Week {
  week: string
  issues: UpcomingIssue[]
}

/** Run `fn` over `items` with at most `limit` in flight, keeping input order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]!) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export default async function upcomingRoutes(app: App, opts: UpcomingRouteOpts = {}) {
  // fetchCalendarPage, NOT fetchSourcePage: Marvel answers that one's User-Agent with a
  // 403. Nothing in the test suite can catch this, because every test injects fetchPage.
  const { fetchPage = fetchCalendarPage, now = () => new Date() } = opts

  /**
   * What Marvel says is coming over the next weeks.
   *
   * Deliberately NOT behind the Comic Vine key check that guards `/api/releases`: this
   * reads Marvel and has nothing to do with Comic Vine, so the tab works on a fresh
   * install with no key entered - the same choice `/api/releases/running` makes.
   */
  app.get('/api/releases/upcoming', async () => {
    const today = now()
    const weeks = upcomingWednesdays(today, WEEKS_AHEAD)

    // A week that has arrived is no longer upcoming; the Latest tab owns it. Without this
    // the tables grow forever, because nothing else ever deletes from them.
    pruneUpcomingBefore(app.db, weeks[0]!)

    const held = new Map<string, UpcomingIssue[]>()
    const stale = new Set<string>()
    const toFetch: string[] = []

    for (const week of weeks) {
      const fresh = getFreshUpcomingWeek(app.db, week, MARVEL, today)
      if (fresh) held.set(week, fresh.issues)
      else toFetch.push(week)
    }

    const fetched = await pool(toFetch, CONCURRENCY, async (week) => ({
      week,
      issues: parseCalendar(await fetchPage(calendarUrl(week))),
    }))

    // A genuinely light week is real - three issues was measured - so "few" can never mean
    // "broken". But every week coming back empty means the payload changed shape, and
    // caching that would freeze the emptiness in for twelve hours. A week that THREW never
    // reaches here at all, so an all-failed load is caught by the same guard.
    const succeeded = fetched.filter((r) => r.status === 'fulfilled')
    const structural = succeeded.length > 0 && succeeded.every(
      (r) => (r as PromiseFulfilledResult<Week>).value.issues.length === 0,
    )

    for (let i = 0; i < fetched.length; i++) {
      const week = toFetch[i]!
      const result = fetched[i]!
      if (result.status === 'fulfilled' && !structural) {
        cacheUpcomingWeek(app.db, week, MARVEL, result.value.issues, today.toISOString())
        held.set(week, result.value.issues)
        continue
      }
      if (result.status === 'rejected') {
        app.log.warn({ err: result.reason, week }, 'Marvel calendar read failed')
      }
      // Whatever we hold beats nothing, however old it is - and say that it is old.
      const anyAge = getCachedUpcomingWeek(app.db, week, MARVEL, Infinity, today)
      if (anyAge) held.set(week, anyAge.issues)
      stale.add(week)
    }

    // Marvel's horizon: the tail of the window is genuinely empty, and a run of empty
    // headings reads as a page that failed to finish rather than as the end of the news.
    const ordered: Week[] = weeks.map((week) => ({ week, issues: held.get(week) ?? [] }))
    while (ordered.length > 0 && ordered[ordered.length - 1]!.issues.length === 0) ordered.pop()

    const unavailable = structural || (ordered.length === 0 && stale.size > 0)

    return {
      publishers: SHOWN.map((name) => (
        name === MARVEL
          ? {
            name,
            weeks: unavailable ? [] : ordered,
            ...(unavailable ? { unavailable: true } : {}),
          }
          // DC has no forward-looking source: its site exposes nothing beyond the current
          // week outside a private GraphQL endpoint. `unsupported` is a different thing
          // from an empty list, and the difference is the point - an empty list would read
          // as "DC has announced nothing for two months", which is never what it means.
          : { name, weeks: [], unsupported: true as const }
      )),
      ...(stale.size > 0 ? { staleWeeks: [...stale].sort() } : {}),
    }
  })
}
```

- [ ] **Step 4: Register the route**

In `server/index.ts`, add the import beside the other route imports:

```ts
import upcomingRoutes from './routes/upcoming.js'
```

and register it immediately after `runningRoutes`:

```ts
  await app.register(upcomingRoutes)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/routes-upcoming.test.ts`
Expected: PASS, all 11 cases.

- [ ] **Step 6: Check types and the whole suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; every test passes.

- [ ] **Step 7: Commit**

```bash
git add server/routes/upcoming.ts server/index.ts test/routes-upcoming.test.ts
git commit -m "feat: serve the weeks of comics Marvel has announced

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The Upcoming tab

**Files:**
- Modify: `src/api.ts`, `src/pages/Releases.tsx`
- Test: `test/Releases.test.tsx`

**Interfaces:**
- Consumes: `GET /api/releases/upcoming` from Task 4.
- Produces: `api.getUpcoming()` and the `tab=upcoming` panel. Nothing else consumes these.

- [ ] **Step 1: Write the failing tests**

In `test/Releases.test.tsx`, add the fixture beside `RELEASES` and `RUNNING`:

```tsx
const UPCOMING = {
  publishers: [
    { name: 'Marvel', weeks: [
      { week: '2026-09-30', issues: [
        { sourceId: '134736', headline: 'Invented Ongoing (2026) #12',
          seriesName: 'Invented Ongoing', number: '12', releaseDate: '2026-09-30',
          coverUrl: 'https://cdn.marvel.com/x/a.jpg',
          siteUrl: 'https://www.marvel.com/comics/issue/134736/x', creators: 'Invented, Writer' },
      ] },
      { week: '2026-10-07', issues: [
        { sourceId: '134737', headline: 'Invented Special (2026)',
          seriesName: 'Invented Special', number: null, releaseDate: '2026-10-07',
          coverUrl: null, siteUrl: 'https://www.marvel.com/comics/issue/134737/x',
          creators: null },
      ] },
    ] },
    { name: 'DC Comics', weeks: [], unsupported: true },
  ],
}
```

Replace the existing `stub` helper with this version, which adds a third parameter and
one branch. The new branch must sit **before** the generic fallthrough, for the same
reason the `running` branch already does: this path starts with `/api/releases` too.

```tsx
function stub(body: unknown, running: unknown = RUNNING, upcoming: unknown = UPCOMING) {
  globalThis.fetch = vi.fn(async (url: string) => {
    // Releases now reads useDownload() too, to know which missing issues are queued.
    if (String(url).includes('/api/downloads')) {
      return { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
    }
    // Before the generic branch: this path starts with /api/releases too.
    if (String(url).includes('/api/releases/running')) {
      return { ok: true, json: async () => running }
    }
    if (String(url).includes('/api/releases/upcoming')) {
      return { ok: true, json: async () => upcoming }
    }
    return { ok: true, json: async () => body }
  }) as unknown as typeof fetch
}
```

Then add these cases. They use the file's existing `draw(entry)` helper, which renders
the page at a given url:

```tsx
test('the upcoming tab lists each announced week, nearest first', async () => {
  stub(RELEASES)
  draw('/releases?tab=upcoming')

  expect(await screen.findByText('Wednesday 30 September 2026')).toBeInTheDocument()
  expect(screen.getByText('Wednesday 7 October 2026')).toBeInTheDocument()
  expect(screen.getByText('Invented Ongoing (2026) #12')).toBeInTheDocument()
})

// The headline is Marvel's own text and is shown verbatim. The derived number is padded
// for sorting ("2" becomes "002") and must never reach the screen.
test('shows the headline verbatim, including a one-shot with no issue number', async () => {
  stub(RELEASES)
  draw('/releases?tab=upcoming')
  expect(await screen.findByText('Invented Special (2026)')).toBeInTheDocument()
})

test('an upcoming comic links out to Marvel and offers no way to get it', async () => {
  stub(RELEASES)
  draw('/releases?tab=upcoming')

  const link = await screen.findByRole('link', { name: /Invented Ongoing/ })
  expect(link).toHaveAttribute('href', 'https://www.marvel.com/comics/issue/134736/x')
  expect(screen.queryByRole('button', { name: /Get/ })).not.toBeInTheDocument()
})

// An empty week list under DC's name would read as "DC has announced nothing for two
// months". It means we have no source for DC, which is a different statement.
test('DC says it has no source rather than showing an empty list', async () => {
  stub(RELEASES)
  draw('/releases?tab=upcoming')

  fireEvent.click(await screen.findByRole('tab', { name: 'DC Comics' }))
  expect(await screen.findByText(/don't have a source for upcoming DC Comics releases/i))
    .toBeInTheDocument()
})

test('names where the announcements stop', async () => {
  stub(RELEASES)
  draw('/releases?tab=upcoming')
  expect(await screen.findByText(/hasn't announced anything beyond/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/Releases.test.tsx`
Expected: FAIL — the upcoming tab does not exist.

- [ ] **Step 3: Add the API client types and call**

In `src/api.ts`, after the `ApiRunning` interface:

```ts
/** One solicited issue. `headline` is Marvel's own text, and is what the tile shows. */
export interface ApiUpcomingIssue {
  sourceId: string
  headline: string
  /** Derived for ordering only — never displayed. */
  seriesName: string
  /** Derived for ordering only, and null for a one-shot. Never displayed. */
  number: string | null
  releaseDate: string
  coverUrl: string | null
  siteUrl: string
  creators: string | null
}

export interface ApiUpcomingWeek {
  /** The Wednesday, `YYYY-MM-DD`. */
  week: string
  issues: ApiUpcomingIssue[]
}

export interface ApiUpcoming {
  publishers: Array<{
    name: string
    weeks: ApiUpcomingWeek[]
    /** No forward-looking source exists for this publisher. Not the same as empty. */
    unsupported?: boolean
    /** We have a source and could not read it. */
    unavailable?: boolean
  }>
  /** Weeks served from an older copy because the fetch failed. */
  staleWeeks?: string[]
}
```

and beside `getRunning`:

```ts
  getUpcoming: () => json<ApiUpcoming>('/api/releases/upcoming'),
```

- [ ] **Step 4: Add the tab**

In `src/pages/Releases.tsx`, add the panel component after `CurrentlyRunning`:

```tsx
/**
 * What Marvel has announced for the coming weeks, from Marvel's own calendar.
 *
 * Solicitations, not facts: a date can slip and an issue can be cancelled, so the server
 * never holds a week for long. Nothing here offers a Get - the comic does not exist yet -
 * which is why these tiles are CoverTile directly rather than MissingIssueTile.
 */
function Upcoming() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['releases-upcoming'],
    queryFn: api.getUpcoming,
    retry: false,
    // The server caches each week for twelve hours, so a refetch on every window focus
    // would mostly be a round trip to be told the same thing. Set here rather than on the
    // QueryClient, which would quietly change how every other query refetches.
    staleTime: 5 * 60_000,
  })

  const publishers = data?.publishers ?? []
  const names = publishers.map((p) => p.name)
  const { current, select } = usePublisher(names)
  const shown = publishers.find((p) => p.name === current)
  const last = shown?.weeks[shown.weeks.length - 1]

  return (
    <>
      {isLoading && <p>Loading…</p>}
      {isError && <p>{"Couldn't reach Marvel, so there is nothing to show here yet."}</p>}
      {current && shown && (
        <>
          <PublisherTabs names={names} current={current} onSelect={select} />
          {shown.unsupported ? (
            <p className="arc-detail__meta">
              {`We don't have a source for upcoming ${shown.name} releases yet, so this tab only covers Marvel for now.`}
            </p>
          ) : shown.unavailable ? (
            <p className="arc-detail__meta">
              {`Couldn't read ${shown.name}'s release calendar.`}
            </p>
          ) : (
            <>
              {data?.staleWeeks?.length ? (
                <p className="arc-detail__meta">
                  Some weeks may be out of date — Marvel did not answer in full.
                </p>
              ) : null}
              {shown.weeks.map((w) => (
                <section key={w.week}>
                  <h2 className="arc-detail__meta">{writeOutDay(w.week)}</h2>
                  {w.issues.length === 0 ? (
                    <p className="arc-detail__meta">Nothing announced for this week.</p>
                  ) : (
                    <div className="tile-grid arc-issue-grid">
                      {w.issues.map((issue) => (
                        <CoverTile
                          key={issue.sourceId}
                          href={issue.siteUrl}
                          img={issue.coverUrl ?? undefined}
                          title={issue.headline}
                          subtitle={issue.creators ?? undefined}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
              {last && (
                <p className="arc-detail__meta">
                  {`Marvel hasn't announced anything beyond ${writeOutDay(last.week)} yet.`}
                </p>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}
```

Extend `TABS`:

```tsx
const TABS = [
  { id: 'week', label: 'This week' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'running', label: 'Currently running' },
] as const
```

Replace the `tab` read and the panel switch at the bottom of the file:

```tsx
  const raw = params.get('tab')
  const tab = raw === 'running' || raw === 'upcoming' ? raw : 'week'
```

```tsx
      {tab === 'week' && <ThisWeek />}
      {tab === 'upcoming' && <Upcoming />}
      {tab === 'running' && <CurrentlyRunning />}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/Releases.test.tsx`
Expected: PASS — the five new cases and every pre-existing one, including the tab-switch
cases that assert `pub` survives a view change.

- [ ] **Step 6: Check types and the whole suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; every test passes.

- [ ] **Step 7: Commit**

```bash
git add src/api.ts src/pages/Releases.tsx test/Releases.test.tsx
git commit -m "feat: show what Marvel is publishing in the weeks ahead

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Rebuild the container**

```bash
docker compose up -d --build
```

Then open the app, go to Latest releases → Upcoming, and confirm: weeks appear nearest
first with covers, switching to DC shows the no-source line, and the closing line names
the last announced week.

**This step is not optional.** It is the only check in the whole plan that exercises a
real request to Marvel — every test injects a fake fetcher. If the tab loads with real
covers, the User-Agent is right. If it shows "Couldn't reach Marvel", check the server
log for a 403 and re-read Review Focus 1.

---

## Done when

- `npm test` and `npm run typecheck` both pass.
- The Upcoming tab lists Marvel's announced weeks with covers, nearest first.
- Switching to DC explains there is no source rather than showing an empty list.
- A second load of the tab inside twelve hours makes no request to Marvel.
- The tab has been seen working against the live site, not only against tests.
- The container has been rebuilt and the tab checked in the running app.

Merging is out of scope for this plan; bring the branch into `main` with
`git merge --squash` when you are happy with it.
