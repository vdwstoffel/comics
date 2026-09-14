# Latest Releases Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Latest` tab showing the most recent Wednesday's Marvel and DC releases as a grid of covers, with owned issues marked and the rest offering one-press download.

**Architecture:** A release day is fetched from Comic Vine once (2 `/issues/` pages + 2 `/volumes/` batches to learn publishers), filtered to Marvel and DC, and stored in two new SQLite tables. Every later visit reads the database. Owned/missing and the download match reuse `ownedIssueIds` and `findMatchForIssue` unchanged; the four-step download derivation is extracted from the editions route into a service both routes call.

**Tech Stack:** TypeScript throughout. Fastify + better-sqlite3 on the server, React + react-router + TanStack Query on the client, Vitest + Testing Library for tests.

**Spec:** `docs/superpowers/specs/2026-09-14-latest-releases-tab-design.md`

## Global Constraints

- **TypeScript, not JavaScript.** Every new file is `.ts` or `.tsx`. Server imports carry the `.js` extension (`../types.js`) because the server build is ESM; client imports do not.
- **Publisher strings are exact:** `'Marvel'` and `'DC Comics'`. No fuzzy matching, no imprint expansion.
- **Dates are `YYYY-MM-DD` strings, never `Date` objects in storage or transport.** Comic Vine's `store_date` is a plain date with no timezone; treating it as an instant shifts it across a day boundary.
- **`src/` never imports from `server/`.** Shared constants are duplicated with a comment saying why, as `Edition.tsx` already does for `YEAR_SLACK`.
- **Comic Vine caps a list response at 100** regardless of `limit`. The existing constant is `LIST_PAGE` in `server/lib/comicvine.ts`.
- **Run tests with `npx vitest run <file>`.** The whole suite is `npx vitest run` and currently passes 977 tests across 75 files.
- **Typecheck with `npx tsc --noEmit -p tsconfig.json` (client) and `-p tsconfig.server.json` (server).** Both must be clean.
- **Never test against the live library.** Tests use `openDb(':memory:')` and throwaway filenames.
- **Commit after every task.** Do not squash tasks together.

---

### Task 1: The release day is a pure function of the clock

**Files:**
- Create: `server/lib/releaseDay.ts`
- Test: `test/release-day.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mostRecentWednesday(now: Date): string` and `previousWednesday(day: string): string`, both `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing test**

Create `test/release-day.test.ts`:

```ts
import { test, expect } from 'vitest'
import { mostRecentWednesday, previousWednesday } from '../server/lib/releaseDay.js'

// New comic day is Wednesday, so every day of a week resolves to the same one.
test('every day of the week resolves to that week Wednesday', () => {
  const week = {
    '2026-09-09': '2026-09-09', // Wed - itself
    '2026-09-10': '2026-09-09', // Thu
    '2026-09-11': '2026-09-09', // Fri
    '2026-09-12': '2026-09-09', // Sat
    '2026-09-13': '2026-09-09', // Sun
    '2026-09-14': '2026-09-09', // Mon
    '2026-09-15': '2026-09-09', // Tue
    '2026-09-16': '2026-09-16', // Wed again - the next one
  }
  for (const [today, expected] of Object.entries(week)) {
    expect(mostRecentWednesday(new Date(`${today}T12:00:00Z`))).toBe(expected)
  }
})

// A local timezone behind UTC would otherwise read the instant as the previous day.
test('the day is read in UTC, not the local timezone', () => {
  expect(mostRecentWednesday(new Date('2026-09-09T00:30:00Z'))).toBe('2026-09-09')
  expect(mostRecentWednesday(new Date('2026-09-09T23:30:00Z'))).toBe('2026-09-09')
})

test('the Wednesday before crosses a month boundary', () => {
  expect(mostRecentWednesday(new Date('2026-10-02T12:00:00Z'))).toBe('2026-09-30')
})

test('the Wednesday before crosses a year boundary', () => {
  expect(mostRecentWednesday(new Date('2027-01-01T12:00:00Z'))).toBe('2026-12-30')
})

test('previousWednesday steps back exactly one week', () => {
  expect(previousWednesday('2026-09-09')).toBe('2026-09-02')
  expect(previousWednesday('2026-01-06')).toBe('2025-12-30')
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/release-day.test.ts`
Expected: FAIL — cannot resolve `../server/lib/releaseDay.js`.

- [ ] **Step 3: Write the implementation**

Create `server/lib/releaseDay.ts`:

```ts
/**
 * Which day's releases the Latest tab shows.
 *
 * New comic day is Wednesday, so the day is computed rather than searched for: asking
 * Comic Vine "what was the last day with releases" would cost a request per day scanned
 * and usually land on a Marvel Infinity Comic, which ships daily.
 *
 * Dates are `YYYY-MM-DD` strings throughout. Comic Vine's `store_date` is a plain date
 * with no timezone, so every read here is UTC - reading it locally would shift the day
 * for anyone west of Greenwich.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const WEDNESDAY = 3 // Date#getUTCDay: Sunday is 0

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Today when today is Wednesday, otherwise the Wednesday before it. */
export function mostRecentWednesday(now: Date): string {
  const back = (now.getUTCDay() - WEDNESDAY + 7) % 7
  return iso(new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back,
  )))
}

/** One week earlier. Used for the single fallback when a Wednesday holds nothing. */
export function previousWednesday(day: string): string {
  return iso(new Date(new Date(`${day}T00:00:00Z`).getTime() - 7 * DAY_MS))
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/release-day.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/releaseDay.ts test/release-day.test.ts
git commit -m "feat: compute the release day, which is always a Wednesday"
```

---

### Task 2: Extract the id-chunking helper

`getStoryArc`'s `issueDetails` batches ids 100 at a time. Task 3 needs the same shape for volumes. Extract the chunking now so Task 3 does not write a second copy. This is a pure refactor: no test changes, and the existing `getStoryArc` tests are the proof it changed nothing.

**Files:**
- Modify: `server/lib/comicvine.ts`
- Test: `test/comicvine.test.ts` (unchanged — it must keep passing)

**Interfaces:**
- Consumes: the existing private `get(path, params)` closure inside `createComicVine`.
- Produces: a private `byIds(path, fieldList, ids): Promise<Map<number, CvResult>>` closure, used by `issueDetails` now and `getVolumePublishers` in Task 3.

- [ ] **Step 1: Confirm the existing tests pass before touching anything**

Run: `npx vitest run test/comicvine.test.ts`
Expected: PASS, 42 tests. If this is not green, stop — the refactor has no baseline.

- [ ] **Step 2: Replace `issueDetails` with the general helper**

In `server/lib/comicvine.ts`, replace the whole `issueDetails` function with:

```ts
  /**
   * Fetch a set of records by id, keyed by id. One request per 100 ids, because Comic
   * Vine caps a list response at 100 however many the filter names - an 86-issue
   * crossover is one call, not 86 against a one-per-second throttle.
   *
   * A chunk that fails is skipped rather than thrown: every caller treats this as an
   * enrichment, and whatever the other chunks returned beats losing the lot.
   */
  async function byIds(path: string, fieldList: string, ids: number[]): Promise<Map<number, CvResult>> {
    const found = new Map<number, CvResult>()
    for (let i = 0; i < ids.length; i += LIST_PAGE) {
      try {
        const data = await get(path, {
          filter: `id:${ids.slice(i, i + LIST_PAGE).join('|')}`,
          field_list: fieldList,
          limit: String(LIST_PAGE),
        })
        for (const row of (Array.isArray(data.results) ? data.results : []) as CvResult[]) {
          if (row.id != null) found.set(row.id, row)
        }
      } catch {
        // Whatever the other chunks returned still beats losing everything.
      }
    }
    return found
  }
```

- [ ] **Step 3: Point `getStoryArc` at it**

In `getStoryArc`, change the one call site:

```ts
      const detail = await byIds('/issues/', ARC_ISSUE_FIELDS, issues.map((i) => i.id))
```

- [ ] **Step 4: Run the tests — they must still pass, unchanged**

Run: `npx vitest run test/comicvine.test.ts`
Expected: PASS, 42 tests. The two that matter most are `getStoryArc looks up every issue detail in one batched request` and `getStoryArc splits an arc of more than a hundred issues across requests`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/comicvine.ts
git commit -m "refactor: extract the id-chunking helper from the arc issue lookup"
```

---

### Task 3: Comic Vine client learns to list a day and resolve publishers

**Files:**
- Modify: `server/lib/comicvine.ts`
- Test: `test/comicvine.test.ts`

**Interfaces:**
- Consumes: `byIds` from Task 2; the existing `get`, `LIST_PAGE`, `CvResult`.
- Produces:
  - `CvReleaseIssue { id: number; number?: string; name?: string; coverDate?: string; storeDate?: string; volumeId: number; volumeName?: string; coverUrl?: string; siteUrl?: string }`
  - `listIssuesOnSale(day: string): Promise<CvReleaseIssue[]>`
  - `getVolumePublishers(ids: number[]): Promise<Map<number, string | undefined>>`

- [ ] **Step 1: Write the failing tests**

Append to `test/comicvine.test.ts`:

```ts
// --- releases ----------------------------------------------------------------

function onSaleRow(id: number, volumeId: number, volumeName: string, number: string) {
  return {
    id, issue_number: number, name: null,
    cover_date: '2026-11-01', store_date: '2026-09-09',
    image: { small_url: `cover-${id}.jpg`, thumb_url: `thumb-${id}.jpg` },
    site_detail_url: `https://cv/${id}`,
    volume: { id: volumeId, name: volumeName },
  }
}

test('listIssuesOnSale maps the fields a release tile renders', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([['/issues/', {
      results: [onSaleRow(1192026, 176900, 'Black Cat', '14')],
      number_of_total_results: 1,
    }]]),
  })
  const [issue] = await cv.listIssuesOnSale('2026-09-09')
  expect(issue).toEqual({
    id: 1192026, number: '14', coverDate: '2026-11-01', storeDate: '2026-09-09',
    volumeId: 176900, volumeName: 'Black Cat',
    coverUrl: 'cover-1192026.jpg', siteUrl: 'https://cv/1192026',
  })
})

// The day is both ends of the filter: Comic Vine's store_date filter is a range.
test('listIssuesOnSale asks for one day and for the cover art', async () => {
  const urls: string[] = []
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => ({ results: [], number_of_total_results: 0 }) }
    },
  })
  await cv.listIssuesOnSale('2026-09-09')
  const params = new URL(urls[0]).searchParams
  expect(params.get('filter')).toBe('store_date:2026-09-09|2026-09-09')
  // Covers are the point of the page, and they come back on this same call.
  expect(params.get('field_list')).toContain('image')
})

// A real Wednesday is 116 issues and the page cap is 100.
test('listIssuesOnSale pages a day that does not fit in one response', async () => {
  const rows = Array.from({ length: 116 }, (_, n) => onSaleRow(1000 + n, 50, 'Big', String(n + 1)))
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: async (url: string) => {
      const offset = Number(new URL(url).searchParams.get('offset') ?? 0)
      return { ok: true, json: async () => ({
        results: rows.slice(offset, offset + 100), number_of_total_results: 116,
      }) }
    },
  })
  expect(await cv.listIssuesOnSale('2026-09-09')).toHaveLength(116)
})

test('getVolumePublishers maps each volume to its publisher', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([['/volumes/', { results: [
      { id: 91078, publisher: { name: 'DC Comics' } },
      { id: 167333, publisher: { name: 'Marvel' } },
    ] }]]),
  })
  const pubs = await cv.getVolumePublishers([91078, 167333])
  expect(pubs.get(91078)).toBe('DC Comics')
  expect(pubs.get(167333)).toBe('Marvel')
})

// A volume in the map with no publisher is different from a volume not in the map:
// the first was asked about and had none, the second was never asked.
test('getVolumePublishers keeps a volume Comic Vine credits to nobody', async () => {
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: mockFetch([['/volumes/', { results: [{ id: 42 }] }]]),
  })
  const pubs = await cv.getVolumePublishers([42])
  expect(pubs.has(42)).toBe(true)
  expect(pubs.get(42)).toBeUndefined()
})

test('getVolumePublishers batches a hundred ids per request', async () => {
  const urls: string[] = []
  const cv = createComicVine({
    apiKey: 'k', now: () => 0,
    fetchImpl: async (url: string) => {
      urls.push(url)
      const ids = new URL(url).searchParams.get('filter')!.replace('id:', '').split('|')
      return { ok: true, json: async () => ({
        results: ids.map((id) => ({ id: Number(id), publisher: { name: 'Marvel' } })),
      }) }
    },
  })
  const pubs = await cv.getVolumePublishers(Array.from({ length: 150 }, (_, n) => 1000 + n))
  expect(urls).toHaveLength(2)
  expect(new URL(urls[0]).searchParams.get('filter')!.split('|')).toHaveLength(100)
  expect(new URL(urls[1]).searchParams.get('filter')!.split('|')).toHaveLength(50)
  expect(pubs.size).toBe(150)
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/comicvine.test.ts`
Expected: FAIL — `cv.listIssuesOnSale is not a function`.

- [ ] **Step 3: Add the field list and the result type**

In `server/lib/comicvine.ts`, beside the other field-list constants:

```ts
// What a release tile renders. `image` is here because covers are the point of the
// Latest tab, and they come back on the same request that lists the day - see the
// exception recorded in src/pages/Releases.tsx.
const RELEASE_FIELDS = 'id,issue_number,name,cover_date,store_date,image,site_detail_url,volume'
// Publisher is not on an issue record and /issues/ has no publisher filter, so the
// Marvel/DC split costs one batched volume lookup per day.
const VOLUME_PUBLISHER_FIELDS = 'id,publisher'
```

Beside `CvVolumeIssue`:

```ts
/** An issue as the Latest tab lists it: one day's on-sale comics. */
export interface CvReleaseIssue {
  id: number
  number?: string
  name?: string
  coverDate?: string
  storeDate?: string
  volumeId: number
  volumeName?: string
  coverUrl?: string
  siteUrl?: string
}
```

- [ ] **Step 4: Declare both methods on the client interface**

Add to `ComicVineClient`:

```ts
  listIssuesOnSale(day: string): Promise<CvReleaseIssue[]>
  getVolumePublishers(ids: number[]): Promise<Map<number, string | undefined>>
```

- [ ] **Step 5: Implement both**

Inside the object `createComicVine` returns, after `listVolumeIssues`:

```ts
    async listIssuesOnSale(day) {
      const issues: CvReleaseIssue[] = []
      let offset = 0
      let total = Infinity

      // Paged one day at a time rather than over a date range: rows sharing a store_date
      // have no deterministic tiebreak, so a range paged by offset returns some rows
      // twice and skips others (measured: 26 of 300). One day has an exact total.
      while (offset < total) {
        const data = await get('/issues/', {
          filter: `store_date:${day}|${day}`,
          field_list: RELEASE_FIELDS,
          limit: String(LIST_PAGE),
          offset: String(offset),
        })
        const page = (Array.isArray(data.results) ? data.results : []) as CvResult[]
        total = data.number_of_total_results ?? page.length
        for (const r of page) {
          if (r.id == null || r.volume?.id == null) continue
          issues.push({
            id: r.id,
            ...(r.issue_number == null ? {} : { number: r.issue_number }),
            ...(r.name == null ? {} : { name: r.name }),
            ...(r.cover_date == null ? {} : { coverDate: r.cover_date }),
            ...(r.store_date == null ? {} : { storeDate: r.store_date }),
            volumeId: r.volume.id,
            ...(r.volume.name == null ? {} : { volumeName: r.volume.name }),
            // small_url reads as a cover in a grid; thumb_url is a 104x160 avatar.
            ...((r.image?.small_url || r.image?.thumb_url) == null
              ? {} : { coverUrl: r.image?.small_url || r.image?.thumb_url }),
            ...(r.site_detail_url == null ? {} : { siteUrl: r.site_detail_url }),
          })
        }
        // A page that comes back empty would otherwise spin forever against a wrong total.
        if (page.length === 0) break
        offset += page.length
      }

      return issues
    },
    async getVolumePublishers(ids) {
      const rows = await byIds('/volumes/', VOLUME_PUBLISHER_FIELDS, ids)
      // Every id that came back is in the map, publisher or not: "asked and had none"
      // must stay distinguishable from "never asked".
      return new Map([...rows].map(([id, r]) => [id, r.publisher?.name]))
    },
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run test/comicvine.test.ts`
Expected: PASS, 48 tests.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add server/lib/comicvine.ts test/comicvine.test.ts
git commit -m "feat: list a day of releases and resolve volume publishers"
```

---

### Task 4: Schema and the release cache model

**Files:**
- Modify: `server/db.ts`
- Create: `server/models/releases.ts`
- Test: `test/models-releases.test.ts`

**Interfaces:**
- Consumes: `CvReleaseIssue` from Task 3; `Db` from `server/types.js`.
- Produces:
  - `ReleaseIssue = CvReleaseIssue & { publisher: string }`
  - `CachedRelease { issues: ReleaseIssue[]; fetchedAt: string }`
  - `cacheRelease(db, day, issues: ReleaseIssue[], now?): void`
  - `getCachedRelease(db, day, maxAgeMs, now?): CachedRelease | undefined`
  - `findReleaseIssue(db, cvIssueId): ReleaseIssue | undefined`
  - `TODAY_MAX_AGE_MS`

- [ ] **Step 1: Write the failing test**

Create `test/models-releases.test.ts`:

```ts
import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  cacheRelease, getCachedRelease, findReleaseIssue, TODAY_MAX_AGE_MS,
} from '../server/models/releases.js'
import type { ReleaseIssue } from '../server/models/releases.js'

const ISSUES: ReleaseIssue[] = [
  { id: 1192026, number: '14', publisher: 'Marvel', volumeId: 176900, volumeName: 'Black Cat',
    coverDate: '2026-11-01', storeDate: '2026-09-09', coverUrl: 'c1.jpg', siteUrl: 'https://cv/1' },
  { id: 1191941, number: '1102', publisher: 'DC Comics', volumeId: 91078, volumeName: 'Action Comics',
    coverDate: '2026-11-01', storeDate: '2026-09-09', coverUrl: 'c2.jpg', siteUrl: 'https://cv/2' },
]

test('a cached day round-trips', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-14T12:00:00.000Z')
  const held = getCachedRelease(db, '2026-09-09', Infinity)
  expect(held?.fetchedAt).toBe('2026-09-14T12:00:00.000Z')
  expect(held?.issues).toHaveLength(2)
  expect(held?.issues.find((i) => i.id === 1192026)).toEqual(ISSUES[0])
})

// The whole reason release_day is a separate table. Without it a Wednesday with no
// Marvel or DC issues - a normal outcome once you filter to two publishers - is
// indistinguishable from one never fetched, and it refetches forever.
test('a day fetched with nothing returns an empty list, not undefined', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', [], '2026-09-14T12:00:00.000Z')
  const held = getCachedRelease(db, '2026-09-09', Infinity)
  expect(held).toBeDefined()
  expect(held?.issues).toEqual([])
})

test('a day never fetched returns undefined', () => {
  const db = openDb(':memory:')
  expect(getCachedRelease(db, '2026-09-09', Infinity)).toBeUndefined()
})

// A past Wednesday does not change, so the route reads it at Infinity and it is never
// refetched. Today is still filling in, so it expires.
test('maxAgeMs expires a day, and Infinity never does', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-14T00:00:00.000Z')
  const later = new Date('2026-09-14T12:00:00.000Z')
  expect(getCachedRelease(db, '2026-09-09', TODAY_MAX_AGE_MS, later)).toBeUndefined()
  expect(getCachedRelease(db, '2026-09-09', Infinity, later)).toBeDefined()
})

test('refetching a day replaces what was held rather than doubling it', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-14T00:00:00.000Z')
  cacheRelease(db, '2026-09-09', [ISSUES[0]], '2026-09-14T06:00:00.000Z')
  const held = getCachedRelease(db, '2026-09-09', Infinity)
  expect(held?.issues).toHaveLength(1)
  expect(held?.fetchedAt).toBe('2026-09-14T06:00:00.000Z')
})

test('an issue can be found by its Comic Vine id, for the download press', () => {
  const db = openDb(':memory:')
  cacheRelease(db, '2026-09-09', ISSUES, '2026-09-14T00:00:00.000Z')
  expect(findReleaseIssue(db, 1192026)?.volumeName).toBe('Black Cat')
  expect(findReleaseIssue(db, 9999999)).toBeUndefined()
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/models-releases.test.ts`
Expected: FAIL — cannot resolve `../server/models/releases.js`.

- [ ] **Step 3: Add the two tables**

In `server/db.ts`, append inside the `SCHEMA` template literal, before the closing backtick:

```sql
-- The release days we have asked Comic Vine about. Separate from the issues for the
-- reason volume_cache is separate: a Wednesday we hold no issues for still has to record
-- that we asked, or "no rows" and "never asked" are the same thing and it refetches
-- forever. Filtering to two publishers makes an empty day a normal outcome rather than a
-- rare one, so this matters more here, not less.
CREATE TABLE IF NOT EXISTS release_day (
  day        TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL
);

-- Marvel and DC issues only. The publisher is carried on the row rather than joined from
-- the volume, so reading a day is one query: there is no separate publisher table,
-- because with a day cached forever it would save about one request a week.
CREATE TABLE IF NOT EXISTS release_issue (
  day         TEXT NOT NULL,
  cv_issue_id INTEGER NOT NULL,
  publisher   TEXT NOT NULL,
  volume_id   INTEGER NOT NULL,
  volume_name TEXT,
  number      TEXT,
  name        TEXT,
  cover_date  TEXT,
  cover_url   TEXT,
  site_url    TEXT,
  PRIMARY KEY (day, cv_issue_id)
);
```

- [ ] **Step 4: Write the model**

Create `server/models/releases.ts`:

```ts
import type { CvReleaseIssue } from '../lib/comicvine.js'
import type { Db } from '../types.js'

/**
 * How long the *current* day's releases are trusted. A Wednesday in the past does not
 * change and is read at Infinity; today is still filling in, and an early-morning visit
 * that caught three issues of an eventual twenty must not hold them forever.
 */
export const TODAY_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** A release issue as stored: Comic Vine's fields plus the publisher we resolved. */
export type ReleaseIssue = CvReleaseIssue & { publisher: string }

export interface CachedRelease {
  issues: ReleaseIssue[]
  fetchedAt: string
}

interface Row {
  cv_issue_id: number
  publisher: string
  volume_id: number
  volume_name: string | null
  number: string | null
  name: string | null
  cover_date: string | null
  store_date?: string | null
  cover_url: string | null
  site_url: string | null
  day?: string
}

const SELECT = `SELECT cv_issue_id, publisher, volume_id, volume_name, number, name,
                       cover_date, cover_url, site_url, day
                FROM release_issue`

function toIssue(r: Row): ReleaseIssue {
  return {
    id: r.cv_issue_id,
    publisher: r.publisher,
    volumeId: r.volume_id,
    ...(r.volume_name == null ? {} : { volumeName: r.volume_name }),
    ...(r.number == null ? {} : { number: r.number }),
    ...(r.name == null ? {} : { name: r.name }),
    ...(r.cover_date == null ? {} : { coverDate: r.cover_date }),
    // The day IS the store date - that is what the row was selected by.
    ...(r.day == null ? {} : { storeDate: r.day }),
    ...(r.cover_url == null ? {} : { coverUrl: r.cover_url }),
    ...(r.site_url == null ? {} : { siteUrl: r.site_url }),
  }
}

/**
 * Replace everything held for a day and stamp when it was read. One transaction, so a
 * half-written day can never be served as if it were complete.
 */
export function cacheRelease(
  db: Db,
  day: string,
  issues: ReleaseIssue[],
  now = new Date().toISOString(),
): void {
  const clear = db.prepare('DELETE FROM release_issue WHERE day = ?')
  const insert = db.prepare(
    `INSERT INTO release_issue
       (day, cv_issue_id, publisher, volume_id, volume_name, number, name,
        cover_date, cover_url, site_url)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  const stamp = db.prepare(
    'INSERT INTO release_day (day, fetched_at) VALUES (?,?) ' +
    'ON CONFLICT(day) DO UPDATE SET fetched_at = excluded.fetched_at',
  )

  db.transaction(() => {
    clear.run(day)
    const seen = new Set<number>()
    for (const issue of issues) {
      // Comic Vine has been known to repeat an id across pages; the primary key would
      // reject the second one and abort the whole day.
      if (seen.has(issue.id)) continue
      seen.add(issue.id)
      insert.run(
        day, issue.id, issue.publisher, issue.volumeId, issue.volumeName ?? null,
        issue.number ?? null, issue.name ?? null, issue.coverDate ?? null,
        issue.coverUrl ?? null, issue.siteUrl ?? null,
      )
    }
    stamp.run(day, now)
  })()
}

/**
 * What we hold for a day, or nothing when we never asked or the answer aged out. An
 * empty `issues` with a `fetchedAt` means we asked and that day had no Marvel or DC
 * releases - which is a normal outcome and must not trigger a refetch.
 */
export function getCachedRelease(
  db: Db,
  day: string,
  maxAgeMs: number,
  now = new Date(),
): CachedRelease | undefined {
  const stamp = db
    .prepare('SELECT fetched_at FROM release_day WHERE day = ?')
    .get(day) as { fetched_at: string } | undefined
  if (!stamp) return undefined

  if (Number.isFinite(maxAgeMs)) {
    if (now.getTime() - new Date(stamp.fetched_at).getTime() > maxAgeMs) return undefined
  }

  const rows = db
    .prepare(`${SELECT} WHERE day = ? ORDER BY publisher, volume_name, CAST(number AS REAL), number`)
    .all(day) as Row[]

  return { fetchedAt: stamp.fetched_at, issues: rows.map(toIssue) }
}

/**
 * One issue by its Comic Vine id, whatever day it was released. Read at any age: a
 * download press only ever follows a page view that filled this cache, and a published
 * issue's number and cover date do not change.
 */
export function findReleaseIssue(db: Db, cvIssueId: number): ReleaseIssue | undefined {
  const row = db.prepare(`${SELECT} WHERE cv_issue_id = ? LIMIT 1`).get(cvIssueId) as Row | undefined
  return row ? toIssue(row) : undefined
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run test/models-releases.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Check the schema change did not disturb anything**

Run: `npx vitest run test/db.test.ts test/models-releases.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/db.ts server/models/releases.ts test/models-releases.test.ts
git commit -m "feat: cache a day of Marvel and DC releases"
```

---

### Task 5: `GET /api/releases`

**Files:**
- Create: `server/routes/releases.ts`
- Modify: `server/index.ts` (register the route)
- Test: `test/routes-releases.test.ts`

**Interfaces:**
- Consumes: `mostRecentWednesday`/`previousWednesday` (Task 1), `listIssuesOnSale`/`getVolumePublishers` (Task 3), `cacheRelease`/`getCachedRelease`/`TODAY_MAX_AGE_MS` (Task 4), plus the existing `ownedIssueIds` from `server/models/arcs.js` and `findMatchForIssue` from `server/services/issueMatching.js`.
- Produces: `GET /api/releases` returning `{ day, fetchedAt, stale?, unavailable?, publishers: [{ name, issues }] }`.

- [ ] **Step 1: Write the failing test**

Create `test/routes-releases.test.ts`:

```ts
import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import releaseRoutes from '../server/routes/releases.js'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { cacheRelease } from '../server/models/releases.js'
import type { Config } from '../server/config.js'

// 2026-09-14 is a Monday, so the most recent Wednesday is 2026-09-09. The clock is faked
// rather than injected: the route reads `new Date()` directly, and a seam in production
// code that exists only for a test is a seam worth not having.
const NOW = new Date('2026-09-14T12:00:00.000Z')

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

function issueRow(id: number, volumeId: number, volumeName: string, number: string) {
  return {
    id, issue_number: number, name: null,
    cover_date: '2026-11-01', store_date: '2026-09-09',
    image: { small_url: `cover-${id}.jpg` },
    site_detail_url: `https://cv/${id}`,
    volume: { id: volumeId, name: volumeName },
  }
}

const DAY_ISSUES = {
  results: [
    issueRow(1192026, 176900, 'Black Cat', '14'),
    issueRow(1191941, 91078, 'Action Comics', '1102'),
    issueRow(1192263, 53817, 'Weekly Shonen Sunday', '3970'),
  ],
  number_of_total_results: 3,
}

const PUBLISHERS = {
  results: [
    { id: 176900, publisher: { name: 'Marvel' } },
    { id: 91078, publisher: { name: 'DC Comics' } },
    { id: 53817, publisher: { name: 'Shogakukan' } },
  ],
}

function recordingFetch(routes: Array<[string, unknown]>) {
  const urls: string[] = []
  const impl = async (url: string) => {
    urls.push(url)
    for (const [needle, body] of routes) if (url.includes(needle)) return { ok: true, json: async () => body }
    throw new Error(`unexpected url ${url}`)
  }
  return { urls, impl }
}

async function setup(routes: Array<[string, unknown]> = [], apiKey = 'test-key') {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { comicVineApiKey: apiKey } as Config)
  const { urls, impl } = recordingFetch(routes)
  const origFetch = globalThis.fetch
  globalThis.fetch = impl as unknown as typeof fetch
  await app.register(releaseRoutes)

  const edition = upsertEdition(db, { name: 'Black Cat', folder: 'Black Cat' })
  const mk = (path: string, cvId: number) => {
    const b = insertBook(db, { editionId: edition.id, filePath: path, pageCount: 1, fileSize: 100 })!
    updateBook(db, b.id, { comicvineId: cvId })
    return b
  }
  return { app, db, urls, mk, cleanup: async () => { globalThis.fetch = origFetch; await app.close() } }
}

const LIVE: Array<[string, unknown]> = [['/issues/', DAY_ISSUES], ['/volumes/', PUBLISHERS]]

test('the page shows the most recent Wednesday', async () => {
  const t = await setup(LIVE)
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    expect(res.statusCode).toBe(200)
    expect(res.json().day).toBe('2026-09-09')
  } finally { await t.cleanup() }
})

test('everything that is not Marvel or DC is dropped', async () => {
  const t = await setup(LIVE)
  try {
    const { publishers } = (await t.app.inject({ url: '/api/releases' })).json()
    expect(publishers.map((p: { name: string }) => p.name)).toEqual(['Marvel', 'DC Comics'])
    const all = publishers.flatMap((p: { issues: unknown[] }) => p.issues)
    expect(all).toHaveLength(2)
    expect(JSON.stringify(all)).not.toContain('Shonen')
  } finally { await t.cleanup() }
})

test('a second visit costs no Comic Vine requests', async () => {
  const t = await setup(LIVE)
  try {
    await t.app.inject({ url: '/api/releases' })
    const afterFirst = t.urls.length
    await t.app.inject({ url: '/api/releases' })
    expect(t.urls.length).toBe(afterFirst)
  } finally { await t.cleanup() }
})

test('refresh=1 asks again', async () => {
  const t = await setup(LIVE)
  try {
    await t.app.inject({ url: '/api/releases' })
    const afterFirst = t.urls.length
    await t.app.inject({ url: '/api/releases?refresh=1' })
    expect(t.urls.length).toBeGreaterThan(afterFirst)
  } finally { await t.cleanup() }
})

test('an issue you own is marked and carries its book id', async () => {
  const t = await setup(LIVE)
  const book = t.mk('Black Cat/14.cbz', 1192026)
  try {
    const { publishers } = (await t.app.inject({ url: '/api/releases' })).json()
    const marvel = publishers.find((p: { name: string }) => p.name === 'Marvel')
    expect(marvel.issues[0]).toMatchObject({ id: 1192026, owned: true, bookId: book.id })
  } finally { await t.cleanup() }
})

// A match for a comic you already have would be computed and thrown away.
test('a match is computed only for an issue you do not own', async () => {
  const t = await setup(LIVE)
  t.mk('Black Cat/14.cbz', 1192026)
  try {
    const { publishers } = (await t.app.inject({ url: '/api/releases' })).json()
    const owned = publishers.find((p: { name: string }) => p.name === 'Marvel').issues[0]
    const missing = publishers.find((p: { name: string }) => p.name === 'DC Comics').issues[0]
    expect(owned.match).toBeUndefined()
    expect(missing).toHaveProperty('match')
  } finally { await t.cleanup() }
})

// Early on a Wednesday, before Comic Vine has been updated.
test('a Wednesday with nothing falls back to the week before', async () => {
  const empty = { results: [], number_of_total_results: 0 }
  const urls: string[] = []
  const t = await setup([])
  globalThis.fetch = (async (url: string) => {
    urls.push(url)
    if (url.includes('/volumes/')) return { ok: true, json: async () => PUBLISHERS }
    const day = new URL(url).searchParams.get('filter')
    return { ok: true, json: async () => (day?.includes('2026-09-09') ? empty : DAY_ISSUES) }
  }) as unknown as typeof fetch
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    expect(res.json().day).toBe('2026-09-02')
  } finally { await t.cleanup() }
})

test('the fallback runs once, not forever', async () => {
  const t = await setup([['/issues/', { results: [], number_of_total_results: 0 }], ['/volumes/', { results: [] }]])
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    expect(res.statusCode).toBe(200)
    expect(res.json().publishers.flatMap((p: { issues: unknown[] }) => p.issues)).toEqual([])
    expect(t.urls.filter((u) => u.includes('/issues/'))).toHaveLength(2)
  } finally { await t.cleanup() }
})

// A day cached as empty must fall back too, not just an empty fetch.
test('a day cached as empty falls back as well', async () => {
  const t = await setup(LIVE)
  cacheRelease(t.db, '2026-09-09', [], NOW.toISOString())
  try {
    expect((await t.app.inject({ url: '/api/releases' })).json().day).toBe('2026-09-02')
  } finally { await t.cleanup() }
})

test('a cached day is served when Comic Vine will not answer', async () => {
  const t = await setup(LIVE)
  try {
    await t.app.inject({ url: '/api/releases' })
    globalThis.fetch = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    const res = await t.app.inject({ url: '/api/releases?refresh=1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().stale).toBe(true)
    expect(res.json().publishers.flatMap((p: { issues: unknown[] }) => p.issues)).toHaveLength(2)
  } finally { await t.cleanup() }
})

test('nothing cached and Comic Vine down says so rather than erroring', async () => {
  const t = await setup([])
  globalThis.fetch = (async () => { throw new Error('offline') }) as unknown as typeof fetch
  try {
    const res = await t.app.inject({ url: '/api/releases' })
    expect(res.statusCode).toBe(200)
    expect(res.json().unavailable).toBe(true)
  } finally { await t.cleanup() }
})

test('the page 400s when no API key is configured', async () => {
  const t = await setup(LIVE, '')
  try {
    expect((await t.app.inject({ url: '/api/releases' })).statusCode).toBe(400)
  } finally { await t.cleanup() }
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/routes-releases.test.ts`
Expected: FAIL — cannot resolve `../server/routes/releases.js`.

- [ ] **Step 3: Write the route**

Create `server/routes/releases.ts`:

```ts
import { createComicVine } from '../lib/comicvine.js'
import { mostRecentWednesday, previousWednesday } from '../lib/releaseDay.js'
import {
  cacheRelease, getCachedRelease, TODAY_MAX_AGE_MS,
} from '../models/releases.js'
import type { ReleaseIssue } from '../models/releases.js'
import { ownedIssueIds } from '../models/arcs.js'
import { findMatchForIssue } from '../services/issueMatching.js'
import type { App } from '../types.js'

/** The two publishers the tab is for. Exact strings: Comic Vine's own names. */
const SHOWN = ['Marvel', 'DC Comics'] as const

interface Query { refresh?: string }

export default async function releaseRoutes(app: App) {
  app.get<{ Querystring: Query }>('/api/releases', async (req, reply) => {
    if (!app.config.comicVineApiKey) {
      return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    }
    const refresh = req.query?.refresh === '1'
    const now = new Date()
    const today = now.toISOString().slice(0, 10)

    let unavailable = false
    let stale = false

    /** A day's Marvel and DC issues, from the database if we hold them, else from Comic Vine. */
    async function resolve(day: string): Promise<{ issues: ReleaseIssue[]; fetchedAt: string } | null> {
      // A past Wednesday does not change, so it is read at any age and never refetched.
      // Today is still filling in and expires - see TODAY_MAX_AGE_MS.
      const maxAge = day < today ? Infinity : TODAY_MAX_AGE_MS
      if (!refresh) {
        const held = getCachedRelease(app.db, day, maxAge)
        if (held) return held
      }

      const cv = createComicVine({ apiKey: app.config.comicVineApiKey })
      try {
        const all = await cv.listIssuesOnSale(day)
        const publishers = await cv.getVolumePublishers([...new Set(all.map((i) => i.volumeId))])
        const kept = all.flatMap((issue) => {
          const publisher = publishers.get(issue.volumeId)
          // A volume whose publisher we failed to learn fails the filter and drops out.
          // Nothing is written for it, so the next uncached fetch asks again.
          return publisher && (SHOWN as readonly string[]).includes(publisher)
            ? [{ ...issue, publisher }]
            : []
        })
        const fetchedAt = now.toISOString()
        cacheRelease(app.db, day, kept, fetchedAt)
        return { issues: kept, fetchedAt }
      } catch {
        // Whatever we hold beats nothing, however old it is.
        const anyAge = getCachedRelease(app.db, day, Infinity)
        if (anyAge) { stale = true; return anyAge }
        unavailable = true
        return null
      }
    }

    let day = mostRecentWednesday(now)
    let held = await resolve(day)

    // Early on a Wednesday, before Comic Vine has been updated, the latest day is empty.
    // Step back exactly once: two empty Wednesdays report empty rather than recursing.
    if (!unavailable && held && held.issues.length === 0) {
      const earlier = previousWednesday(day)
      const fallback = await resolve(earlier)
      if (fallback && fallback.issues.length > 0) { day = earlier; held = fallback }
    }

    const owned = ownedIssueIds(app.db)
    const decorate = (issue: ReleaseIssue) => {
      const bookId = owned.get(issue.id)
      if (bookId != null) return { ...issue, owned: true, bookId }
      // Only what you are missing is worth matching; a match for a comic you already
      // have would be computed and thrown away.
      return {
        ...issue,
        owned: false,
        match: findMatchForIssue(app.db, issue.volumeName ?? null, {
          id: issue.id, number: issue.number, coverDate: issue.coverDate,
        }),
      }
    }

    const issues = held?.issues ?? []
    return {
      day,
      fetchedAt: held?.fetchedAt ?? null,
      ...(stale ? { stale: true } : {}),
      ...(unavailable ? { unavailable: true } : {}),
      publishers: SHOWN.map((name) => ({
        name,
        issues: issues.filter((i) => i.publisher === name).map(decorate),
      })),
    }
  })
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/routes-releases.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Register the route**

In `server/index.ts`, beside the other registrations:

```ts
  await app.register(releaseRoutes)
```

with `import releaseRoutes from './routes/releases.js'` at the top.

- [ ] **Step 6: Typecheck and run the whole server suite**

Run: `npx tsc --noEmit -p tsconfig.server.json && npx vitest run test/routes-releases.test.ts test/health.test.ts`
Expected: no typecheck output; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/releases.ts server/index.ts test/routes-releases.test.ts
git commit -m "feat: serve the latest Wednesday of Marvel and DC releases"
```

---

### Task 6: Extract the download derivation into a service

The four steps between "a match exists" and "the downloader starts" — re-match, read the index row, fetch the post, parse the link — live inline in the editions route. Task 7 needs them too. Extract first; the editions route's existing tests are the proof nothing changed.

**Files:**
- Create: `server/services/issueDownload.ts`
- Modify: `server/routes/editions.ts`
- Test: `test/routes-editions-download-issue.test.ts` (existing — must keep passing)

**Interfaces:**
- Consumes: `findMatchForIssue`, `comicIndexById`, `fetchPage`, `parseDownloadLink`, `app.downloader` — all exactly as `server/routes/editions.ts` imports them today.
- Produces: `startIssueDownload(app, { volumeName, editionName, issue }): Promise<IssueDownloadResult>` where `IssueDownloadResult` is `{ ok: true; status: DownloadStatus }` or `{ ok: false; code: 404 | 409 | 502; error: string }`.

- [ ] **Step 1: Run the editions download tests to establish the baseline**

Run: `npx vitest run test/routes-editions-download-issue.test.ts`
Expected: PASS. Note the count — it must be identical at the end of this task.

- [ ] **Step 2: Write the service**

Create `server/services/issueDownload.ts`:

```ts
import { findMatchForIssue } from './issueMatching.js'
import { comicIndexById } from '../models/comicIndex.js'
import { fetchPage } from './comicIndexScraper.js'
import { parseDownloadLink } from '../lib/comicPostPage.js'
import type { DownloadStatus } from './downloader.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'
import type { App } from '../types.js'

export type IssueDownloadResult =
  | { ok: true; status: DownloadStatus }
  | { ok: false; code: 404 | 409 | 502; error: string }

/**
 * Everything between "this issue is missing" and "the downloader is running": re-derive
 * the match, read the scraped row, fetch the post, parse the link out of it, start.
 *
 * The match is re-derived here rather than taken from the client. The page that offered
 * the button computed one, but the index can be rescraped between the render and the
 * press, and a download the server did not decide on is a download nobody checked.
 *
 * `volumeName` is Comic Vine's name for the volume and is what the match keys on.
 * `editionName` is where the file lands - the same thing for the Latest tab, but an
 * edition's own hand-editable name when the press came from an edition page.
 */
export async function startIssueDownload(
  app: App,
  { volumeName, editionName, issue }: {
    volumeName: string | null
    editionName: string
    issue: CvVolumeIssue
  },
): Promise<IssueDownloadResult> {
  const match = findMatchForIssue(app.db, volumeName, issue)
  if (!match) return { ok: false, code: 409, error: 'no unique match for that issue' }

  const row = comicIndexById(app.db, match.indexId)
  if (!row) return { ok: false, code: 409, error: 'no unique match for that issue' }

  let url: string | null = null
  try {
    url = parseDownloadLink(await fetchPage(row.url), row.url)
  } catch {
    return { ok: false, code: 502, error: 'could not read that post' }
  }
  if (!url) return { ok: false, code: 404, error: 'no download link on that post' }

  const { started, status } = app.downloader.start({ url, edition: editionName, issueId: issue.id })
  if (!started) return { ok: false, code: 409, error: 'a download is already running' }
  return { ok: true, status }
}
```

**Note:** the import paths for `comicIndexById`, `fetchPage` and `parseDownloadLink` must be copied verbatim from the top of `server/routes/editions.ts` — do not guess them.

- [ ] **Step 3: Rewrite the editions route to call it**

In `server/routes/editions.ts`, replace the body of the download handler after the `issue` lookup with:

```ts
      const result = await startIssueDownload(app, {
        volumeName: edition.cvName,
        editionName: edition.name,
        issue,
      })
      if (!result.ok) {
        // A refused start still reports the runner's state, as it always did.
        if (result.error === 'a download is already running') {
          return reply.code(409).send({ started: false, status: app.downloader.status() })
        }
        return reply.code(result.code).send({ error: result.error })
      }
      return reply.code(202).send({ started: true, status: result.status })
```

Add `import { startIssueDownload } from '../services/issueDownload.js'` and remove any imports that are now unused.

- [ ] **Step 4: Run the editions tests — same count, still green**

Run: `npx vitest run test/routes-editions-download-issue.test.ts`
Expected: PASS, the same number of tests as Step 1. If any fails, the extraction changed behaviour — fix the service, not the test.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add server/services/issueDownload.ts server/routes/editions.ts
git commit -m "refactor: extract the issue download derivation into a service"
```

---

### Task 7: `POST /api/releases/issues/:cvIssueId/download`

**Files:**
- Modify: `server/routes/releases.ts`
- Test: `test/routes-releases-download.test.ts`

**Interfaces:**
- Consumes: `findReleaseIssue` (Task 4), `startIssueDownload` (Task 6).
- Produces: `POST /api/releases/issues/:cvIssueId/download` → 202 `{ started, status }`, or 404/409/502.

- [ ] **Step 1: Write the failing test**

Create `test/routes-releases-download.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import releaseRoutes from '../server/routes/releases.js'
import { openDb } from '../server/db.js'
import { cacheRelease } from '../server/models/releases.js'
import type { ReleaseIssue } from '../server/models/releases.js'
import type { Config } from '../server/config.js'

const ISSUE: ReleaseIssue = {
  id: 1192026, number: '14', publisher: 'Marvel', volumeId: 176900,
  volumeName: 'Black Cat', coverDate: '2026-11-01', storeDate: '2026-09-09',
  coverUrl: 'c.jpg', siteUrl: 'https://cv/1',
}

async function setup() {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { comicVineApiKey: 'test-key' } as Config)
  const start = vi.fn(() => ({ started: true, status: { running: true } }))
  app.decorate('downloader', { start, status: () => ({ running: false }) } as never)
  await app.register(releaseRoutes)

  // One index row that can only be Black Cat #14. Cover date 2026-11 and the scraped
  // year 2026 are within the matcher's one-year tolerance. `category` and `imported_at`
  // are NOT NULL on this table, so both have to be supplied even though neither matters here.
  db.prepare(
    `INSERT INTO comic_index (title, url, category, imported_at, number, year)
     VALUES (?,?,?,?,?,?)`,
  ).run('Black Cat #14 (2026)', 'https://index/black-cat-14', 'comics', '2026-09-14', '14', 2026)

  cacheRelease(db, '2026-09-09', [ISSUE], '2026-09-14T12:00:00.000Z')
  return { app, db, start, cleanup: async () => { await app.close() } }
}

test('an issue with no cached release day 404s', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/releases/issues/9999999/download' })
    expect(res.statusCode).toBe(404)
  } finally { await t.cleanup() }
})

// The new edition is named exactly as Comic Vine names the volume. That is what makes
// a download from this tab predictable when you own nothing of the series.
test('the download lands under the volume name', async () => {
  const t = await setup()
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true, status: 200,
    text: async () => '<a href="https://files/black-cat-14.cbz">Download</a>',
  })) as unknown as typeof fetch
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/releases/issues/1192026/download' })
    expect(res.statusCode).toBe(202)
    expect(t.start).toHaveBeenCalledWith(
      expect.objectContaining({ edition: 'Black Cat', issueId: 1192026 }),
    )
  } finally { globalThis.fetch = origFetch; await t.cleanup() }
})

test('an unreadable post reports 502 rather than starting anything', async () => {
  const t = await setup()
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error('offline') }) as unknown as typeof fetch
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/releases/issues/1192026/download' })
    expect(res.statusCode).toBe(502)
    expect(t.start).not.toHaveBeenCalled()
  } finally { globalThis.fetch = origFetch; await t.cleanup() }
})
```

**Note:** the `comic_index` column list above was checked against the real schema
(`title`, `url`, `category`, `imported_at` are NOT NULL; `number` and `year` were added
later and are nullable). Do not drop `category` or `imported_at` — the insert fails without them.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/routes-releases-download.test.ts`
Expected: FAIL — 404 on the POST route, which does not exist yet.

- [ ] **Step 3: Add the route**

Append inside `releaseRoutes` in `server/routes/releases.ts`:

```ts
  /**
   * Get an issue from the Latest tab. Unlike the edition equivalent there is no edition
   * to land in - this tab shows series you may own nothing of - so the file goes under
   * Comic Vine's name for the volume, which creates that edition if it does not exist.
   */
  app.post<{ Params: { cvIssueId: string } }>(
    '/api/releases/issues/:cvIssueId/download',
    async (req, reply) => {
      // Any age: a press only follows a page view that filled this cache, and a
      // published issue's number and cover date do not change.
      const issue = findReleaseIssue(app.db, Number(req.params.cvIssueId))
      if (!issue) return reply.code(404).send({ error: 'issue not in any cached release day' })

      const volumeName = issue.volumeName ?? null
      const result = await startIssueDownload(app, {
        volumeName,
        editionName: volumeName ?? 'Unsorted',
        issue: { id: issue.id, number: issue.number, coverDate: issue.coverDate },
      })
      if (!result.ok) {
        if (result.error === 'a download is already running') {
          return reply.code(409).send({ started: false, status: app.downloader.status() })
        }
        return reply.code(result.code).send({ error: result.error })
      }
      return reply.code(202).send({ started: true, status: result.status })
    },
  )
```

Add to the imports at the top of the file:

```ts
import { findReleaseIssue } from '../models/releases.js'
import { startIssueDownload } from '../services/issueDownload.js'
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/routes-releases-download.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/routes/releases.ts test/routes-releases-download.test.ts
git commit -m "feat: get a new release in one press"
```

---

### Task 8: Extract `MissingIssueTile`

**Files:**
- Create: `src/components/MissingIssueTile.tsx`
- Modify: `src/pages/Edition.tsx`
- Test: `test/Edition.test.tsx` (existing — must keep passing), `test/MissingIssueTile.test.tsx` (new)

**Interfaces:**
- Consumes: `CoverTile`.
- Produces: `MissingIssueTile({ label, siteUrl, hasMatch, matchTitle, findTo, coverUrl, onGet, pending, failed })`.

- [ ] **Step 1: Establish the baseline**

Run: `npx vitest run test/Edition.test.tsx`
Expected: PASS. Note the count.

- [ ] **Step 2: Write the component test**

Create `test/MissingIssueTile.test.tsx`:

```tsx
import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import MissingIssueTile from '../src/components/MissingIssueTile'

const base = {
  label: '#14', siteUrl: 'https://cv/14', findTo: '/search?q=Black+Cat',
  hasMatch: false, onGet: () => {}, pending: false, failed: false,
}

const draw = (props: Partial<ComponentProps<typeof MissingIssueTile>> = {}) =>
  render(<MemoryRouter><MissingIssueTile {...base} {...props} /></MemoryRouter>)

test('a matched issue offers to get it', () => {
  draw({ hasMatch: true, matchTitle: 'Black Cat #14 (2026)' })
  expect(screen.getByRole('button', { name: /Get #14/ })).toBeInTheDocument()
})

// The button never guesses: anything less than one certain row sends you to search.
test('an unmatched issue offers to find it instead', () => {
  draw({ hasMatch: false })
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByRole('link', { name: /Find #14/ })).toHaveAttribute('href', '/search?q=Black+Cat')
})

test('pressing get calls the handler once', async () => {
  const onGet = vi.fn()
  draw({ hasMatch: true, onGet })
  await userEvent.click(screen.getByRole('button'))
  expect(onGet).toHaveBeenCalledTimes(1)
})

test('a failed press reports on its own tile', () => {
  draw({ hasMatch: true, failed: true })
  expect(screen.getByText(/Could not get that one/i)).toBeInTheDocument()
})

// The releases tab passes a cover; an edition page does not.
test('cover art is drawn when one is given and absent when not', () => {
  const { unmount } = draw({ hasMatch: false, coverUrl: 'https://cv/cover.jpg' })
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cv/cover.jpg')
  unmount()
  draw({ hasMatch: false })
  expect(screen.queryByRole('img')).toBeNull()
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/MissingIssueTile.test.tsx`
Expected: FAIL — cannot resolve `../src/components/MissingIssueTile`.

- [ ] **Step 4: Write the component**

Create `src/components/MissingIssueTile.tsx`:

```tsx
import { Link } from 'react-router-dom'
import CoverTile from './CoverTile'

interface MissingIssueTileProps {
  label: string
  siteUrl?: string
  /** Exactly one scraped row can be this issue. Anything less certain offers Find. */
  hasMatch: boolean
  /** The scraped title, shown on hover so you can see what would be fetched. */
  matchTitle?: string
  /** Where Find goes: the search, with the series and year filled in. */
  findTo: string
  /**
   * Cover art, when the page has any to show. An edition page passes none - a cover is a
   * spoiler for a comic you have not read - but the Latest tab passes one, because every
   * issue there is unread and a shop window with no art is not a shop window.
   */
  coverUrl?: string
  onGet: () => void
  pending: boolean
  failed: boolean
}

/**
 * An issue you do not have, and the way to fill it. Shared by the edition page and the
 * Latest tab so the two offer the same thing in the same words.
 */
export default function MissingIssueTile({
  label, siteUrl, hasMatch, matchTitle, findTo, coverUrl, onGet, pending, failed,
}: MissingIssueTileProps) {
  return (
    <div className="volume-issue">
      <CoverTile href={siteUrl} img={coverUrl} title={label} subtitle="Missing" />
      {hasMatch ? (
        <button
          type="button"
          className="btn btn-ghost volume-issue__get"
          disabled={pending}
          onClick={onGet}
          title={matchTitle}
        >
          {pending ? 'Getting…' : `↓ Get ${label}`}
        </button>
      ) : (
        <Link className="volume-issue__find" to={findTo}>{`Find ${label} ↗`}</Link>
      )}
      {failed && <span className="volume-issue__error">Could not get that one.</span>}
    </div>
  )
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run test/MissingIssueTile.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Rewire `Edition.tsx`**

Replace the `return (<div className="volume-issue">…</div>)` block at the end of `VolumeIssue` with:

```tsx
  return (
    <MissingIssueTile
      label={label}
      siteUrl={issue.siteUrl}
      hasMatch={issue.match != null}
      matchTitle={issue.match?.title}
      findTo={`/search?${findParams}`}
      onGet={() => get.mutate()}
      pending={get.isPending}
      failed={get.isError}
    />
  )
```

Add `import MissingIssueTile from '../components/MissingIssueTile'` and drop any import left unused.

- [ ] **Step 7: Run the Edition tests — same count, still green**

Run: `npx vitest run test/Edition.test.tsx test/MissingIssueTile.test.tsx`
Expected: PASS, with `Edition.test.tsx` at the same count as Step 1.

- [ ] **Step 8: Commit**

```bash
git add src/components/MissingIssueTile.tsx src/pages/Edition.tsx test/MissingIssueTile.test.tsx
git commit -m "refactor: share the missing-issue tile between the edition page and elsewhere"
```

---

### Task 9: The Latest tab

**Files:**
- Create: `src/pages/Releases.tsx`
- Modify: `src/api.ts`, `src/App.tsx`
- Test: `test/Releases.test.tsx`

**Interfaces:**
- Consumes: `MissingIssueTile` (Task 8), `GET /api/releases` (Task 5), `POST /api/releases/issues/:id/download` (Task 7).
- Produces: the `/releases` route and its `Latest` header link.

- [ ] **Step 1: Add the API types and calls**

In `src/api.ts`, beside `ApiArcIssue`:

```ts
export interface ApiReleaseIssue {
  id: number
  number?: string
  name?: string
  volumeId: number
  volumeName?: string
  coverUrl?: string
  siteUrl?: string
  owned: boolean
  /** Present only when owned — the issue in your library. */
  bookId?: number
  /** Only for an issue you do not own; null when no single scraped row can be it. */
  match?: { indexId: number; title: string } | null
}

export interface ApiReleases {
  day: string
  fetchedAt: string | null
  stale?: boolean
  unavailable?: boolean
  publishers: Array<{ name: string; issues: ApiReleaseIssue[] }>
}
```

and in the `api` object:

```ts
  getReleases: () => json<ApiReleases>('/api/releases'),

  downloadRelease: (cvIssueId: number) =>
    json<{ started: boolean }>(`/api/releases/issues/${cvIssueId}/download`, { method: 'POST' }),
```

- [ ] **Step 2: Write the failing page test**

Create `test/Releases.test.tsx`:

```tsx
import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Releases from '../src/pages/Releases'

const RELEASES = {
  day: '2026-09-09',
  fetchedAt: '2026-09-14T12:00:00.000Z',
  publishers: [
    { name: 'Marvel', issues: [
      { id: 1192026, number: '14', volumeName: 'Black Cat', volumeId: 176900,
        coverUrl: 'https://cv/bc14.jpg', siteUrl: 'https://cv/1',
        owned: true, bookId: 79 },
      { id: 1192030, number: '27', volumeName: 'Wolverine', volumeId: 1111,
        coverUrl: 'https://cv/w27.jpg', siteUrl: 'https://cv/2',
        owned: false, match: { indexId: 5, title: 'Wolverine #27 (2026)' } },
    ] },
    { name: 'DC Comics', issues: [
      { id: 1191941, number: '1102', volumeName: 'Action Comics', volumeId: 91078,
        coverUrl: 'https://cv/ac.jpg', siteUrl: 'https://cv/3',
        owned: false, match: null },
    ] },
  ],
}

function stub(body: unknown) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch
}

beforeEach(() => stub(RELEASES))

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/releases']}>
        <Routes><Route path="/releases" element={<Releases />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('the page names the day it is showing', async () => {
  draw()
  expect(await screen.findByRole('heading', { name: /Latest releases/i })).toBeInTheDocument()
  expect(screen.getByText(/9 September 2026/)).toBeInTheDocument()
})

test('both publishers get their own section', async () => {
  draw()
  expect(await screen.findByRole('heading', { name: 'Marvel' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'DC Comics' })).toBeInTheDocument()
})

test('an issue is labelled with its series and number', async () => {
  draw()
  expect(await screen.findByText('Black Cat #14')).toBeInTheDocument()
})

test('an issue you own links into your library', async () => {
  draw()
  const link = await screen.findByRole('link', { name: /Black Cat #14/ })
  expect(link).toHaveAttribute('href', '/book/79')
})

// This page is a shop window, and every issue on it is one you do not own. The arc
// page's spoiler rule would blank it entirely - see the exception in Releases.tsx.
test('covers are shown, including for issues you do not own', async () => {
  draw()
  const link = await screen.findByRole('link', { name: /Wolverine #27/ })
  expect(within(link).getByRole('img')).toHaveAttribute('src', 'https://cv/w27.jpg')
})

test('a matched missing issue offers to get it', async () => {
  draw()
  expect(await screen.findByRole('button', { name: /Get Wolverine #27/ })).toBeInTheDocument()
})

test('an unmatched missing issue offers to find it', async () => {
  draw()
  expect(await screen.findByRole('link', { name: /Find Action Comics #1102/ })).toBeInTheDocument()
})

test('a day Comic Vine could not answer for says so', async () => {
  stub({ ...RELEASES, unavailable: true, publishers: [] })
  draw()
  expect(await screen.findByText(/could not reach Comic Vine/i)).toBeInTheDocument()
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/Releases.test.tsx`
Expected: FAIL — cannot resolve `../src/pages/Releases`.

- [ ] **Step 4: Write the page**

Create `src/pages/Releases.tsx`:

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiReleaseIssue } from '../api'
import CoverTile from '../components/CoverTile'
import MissingIssueTile from '../components/MissingIssueTile'

/** `2026-09-09` -> `Wednesday 9 September 2026`. Parsed as UTC: the day has no timezone. */
function writeOutDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

function label(issue: ApiReleaseIssue): string {
  const series = issue.volumeName ?? 'Unknown series'
  return issue.number ? `${series} #${issue.number}` : series
}

/**
 * One comic out this week.
 *
 * Cover art is shown here even though you do not own most of these, which is the opposite
 * of what the arc page does - there, a cover is a spoiler for a comic you have not read.
 * The exception is deliberate: every issue on a releases page is one you have not read,
 * so that rule would blank the whole page, and a shop window with no art is not a shop
 * window. The rule still stands where it was written; this page is not a reading list.
 */
function ReleaseIssue({ issue }: { issue: ApiReleaseIssue }) {
  const qc = useQueryClient()
  const text = label(issue)

  const get = useMutation({
    mutationFn: () => api.downloadRelease(issue.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['download'] }),
  })

  if (issue.owned && issue.bookId != null) {
    return (
      <CoverTile
        to={`/book/${issue.bookId}`}
        img={`/api/books/${issue.bookId}/thumbnail`}
        title={text}
        subtitle="In your library"
      />
    )
  }

  const findParams = new URLSearchParams({ q: issue.volumeName ?? '' })
  return (
    <MissingIssueTile
      label={text}
      siteUrl={issue.siteUrl}
      coverUrl={issue.coverUrl}
      hasMatch={issue.match != null}
      matchTitle={issue.match?.title}
      findTo={`/search?${findParams}`}
      onGet={() => get.mutate()}
      pending={get.isPending}
      failed={get.isError}
    />
  )
}

export default function Releases() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['releases'],
    queryFn: api.getReleases,
    retry: false,
  })

  return (
    <>
      <h1 className="page-title">Latest releases</h1>
      {isLoading && <p>Loading…</p>}
      {isError && <p>{"Couldn't load the latest releases."}</p>}
      {data && (
        <>
          <p className="arc-detail__meta">{writeOutDay(data.day)}</p>
          {data.unavailable && <p>We could not reach Comic Vine, so there is nothing to show yet.</p>}
          {data.stale && <p className="arc-detail__meta">Showing what we last saw.</p>}
          {data.publishers.map((publisher) => (
            <section key={publisher.name}>
              <h2 className="page-title">{publisher.name}</h2>
              <div className="tile-grid arc-issue-grid">
                {publisher.issues.map((issue) => <ReleaseIssue key={issue.id} issue={issue} />)}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  )
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run test/Releases.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Add the tab and the route**

In `src/App.tsx`, add `import Releases from './pages/Releases'`, put `Latest` first in the header nav:

```tsx
          <Link to="/releases" className="app-header__link">Latest</Link>
          <Link to="/search" className="app-header__link">Search</Link>
```

and add the route beside the others:

```tsx
      <Route path="/releases" element={<Layout><Releases /></Layout>} />
```

`Layout`, not `LibraryLayout`: the rail filters the library by publisher and read state, and neither means anything on a page that is not the library.

- [ ] **Step 7: Typecheck and run the client suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run test/Releases.test.tsx test/App.test.tsx`
Expected: no typecheck output; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Releases.tsx src/api.ts src/App.tsx test/Releases.test.tsx
git commit -m "feat: add the Latest tab"
```

---

### Task 10: Full verification and a real run

**Files:** none changed unless something fails.

- [ ] **Step 1: Run the entire suite**

Run: `npx vitest run`
Expected: PASS. The baseline before this work was 977 tests across 75 files; this plan adds roughly 40 across 6 new files. Zero failures.

- [ ] **Step 2: Typecheck both projects**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json`
Expected: no output from either.

- [ ] **Step 3: Rebuild the container**

Run: `docker compose up -d --build`
Expected: `Container comic-app Started`.

- [ ] **Step 4: Hit the real endpoint**

```bash
PORT=$(docker compose port comic-app 3000 | cut -d: -f2)
curl -s "http://localhost:$PORT/api/releases" | python3 -m json.tool | head -40
```

Expected: `"day"` is the most recent Wednesday, and `publishers` holds a Marvel section and a DC Comics section. Against the data measured on 2026-09-14 that day is `2026-09-09` with 12 Marvel and 10 DC issues.

- [ ] **Step 5: Confirm the second call costs nothing**

```bash
time curl -s "http://localhost:$PORT/api/releases" > /dev/null
```

Expected: well under a second. The first call takes ~4s (4 throttled Comic Vine requests); this one reads SQLite.

- [ ] **Step 6: Commit anything Step 1–5 forced**

If every step passed, there is nothing to commit and the feature is done.

---

## Notes for the executor

- **The spec is the argument, this plan is the order.** When a step and the spec disagree, the spec wins — say so rather than guessing.
- **Tasks 2, 6 and 8 are refactors with no new behaviour.** Their proof is that existing tests pass unchanged and at the same count. If you find yourself editing an existing test in one of those tasks, stop: the extraction changed behaviour it should not have.
- **Comic Vine allows 200 requests an hour.** Task 10 costs about 4. Do not loop the live endpoint while debugging — use `?refresh=1` deliberately, not repeatedly.
- **Do not test against the real library.** Every test here uses `openDb(':memory:')`.
