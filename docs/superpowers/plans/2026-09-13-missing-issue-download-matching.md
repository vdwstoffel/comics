# Missing-Issue Download Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every missing issue on an edition page a one-press download, offered only when exactly one scraped index row can be that issue.

**Architecture:** A pure matching function decides whether a Comic Vine issue and a scraped index row are the same comic. A thin service runs it against the database. The edition's issue list carries the result per missing issue, and a new endpoint re-runs the match at press time before starting the existing downloader with the edition and issue id already known.

**Tech Stack:** TypeScript (strict, NodeNext on the server), Fastify, better-sqlite3, React + Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-13-missing-issue-download-matching-design.md`

## Global Constraints

- **The matching rule is exactly four conditions** (spec §3): `releaseKind(title) === 'issue'`; numbers equal after `parseNumber` normalises both sides; `|row.year − coverYear| ≤ 1`; `seriesKey(row.title) === seriesKey(edition.cvName)`.
- **Zero matches and several matches are both `null`.** Callers must not be able to tell them apart.
- **Key on `edition.cvName`, never `edition.name`.** Edition names are hand-editable (`Vol 7`, `Unsorted`).
- **The download path must never call `cv.search()`** (spec §4.3.1). Task 3 has a test asserting no `/search/` request is made.
- **One year-slack constant.** `YEAR_SLACK` is defined once in `issueMatch.ts` and used by both the SQL window and the filter, so they cannot drift.
- Tests never touch the network: inject `fetchImpl`/`fetchPage`, or stub `globalThis.fetch`.
- Run `npm run typecheck` before every commit. It is `tsc --noEmit -p tsconfig.json`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `server/lib/issueMatch.ts` (new) | The pure rule. No database, no I/O. |
| `server/services/issueMatching.ts` (new) | Runs the rule against `comic_index`. The only place the candidate SQL lives. |
| `server/db.ts` (modify) | One index: `idx_comic_index_number_year`. |
| `server/routes/editions.ts` (modify) | `match` on the issues response; the new download endpoint; a `fetchPage` option so tests stay offline. |
| `server/index.ts` (modify) | Nothing — `editionRoutes` is already registered with defaults. |
| `src/api.ts` (modify) | `match` on `ApiVolumeIssue`; `downloadMissingIssue` client call. |
| `src/pages/Edition.tsx` (modify) | `Get` / `Find` on a missing tile. |
| `src/styles.css` (modify) | `.volume-issue` wrapper and its two actions. |

---

### Task 1: The pure matching rule

**Files:**
- Create: `server/lib/issueMatch.ts`
- Test: `test/issue-match.test.ts`

**Interfaces:**
- Consumes: `seriesKey(title: string): string` and `releaseKind(title: string): ReleaseKind` from `server/lib/comicGrouping.js`.
- Produces: `YEAR_SLACK: number`, `interface MissingIssue`, `interface IndexCandidate`, `matchIssue(candidates: IndexCandidate[], issue: MissingIssue): IndexCandidate | null`.

- [ ] **Step 1: Write the failing tests**

Create `test/issue-match.test.ts`:

```ts
import { test, expect } from 'vitest'
import { matchIssue } from '../server/lib/issueMatch.js'
import type { IndexCandidate } from '../server/lib/issueMatch.js'

/** A scraped index row, with only the fields the rule reads. */
function row(id: number, title: string, number: string | null, year: number | null): IndexCandidate {
  return { id, title, number, year }
}

const VENOM_250 = row(1, 'Venom #250 (2025)', '250', 2025)

test('one candidate that satisfies every condition is the match', () => {
  const hit = matchIssue([VENOM_250], { seriesKey: 'venom', number: '250', coverYear: 2025 })
  expect(hit?.id).toBe(1)
})

test('no candidate at all is no match', () => {
  expect(matchIssue([], { seriesKey: 'venom', number: '250', coverYear: 2025 })).toBeNull()
})

// Comic Vine cover dates run ahead of the release the scraper sees: Venom #251 has a
// 2026-01 cover date and is listed as "Venom #251 (2025)".
test('a scraped year one behind the cover year still matches', () => {
  const hit = matchIssue([row(1, 'Venom #251 (2025)', '251', 2025)], { seriesKey: 'venom', number: '251', coverYear: 2026 })
  expect(hit?.id).toBe(1)
})

test('a scraped year one ahead of the cover year still matches', () => {
  const hit = matchIssue([row(1, 'Venom #251 (2026)', '251', 2026)], { seriesKey: 'venom', number: '251', coverYear: 2025 })
  expect(hit?.id).toBe(1)
})

test('two years apart is too far to be the same issue', () => {
  expect(matchIssue([row(1, 'Venom #251 (2023)', '251', 2023)], { seriesKey: 'venom', number: '251', coverYear: 2025 })).toBeNull()
})

// The whole safety property: the real two-candidate case from the index.
test('two candidates within the window are no match, not a guess', () => {
  const hits = matchIssue(
    [row(1, 'Venom #3 (2017)', '003', 2017), row(2, 'Venom #3 (2018)', '003', 2018)],
    { seriesKey: 'venom', number: '003', coverYear: 2017 },
  )
  expect(hits).toBeNull()
})

test('a different series with the same number does not match', () => {
  expect(matchIssue([row(1, 'All-New Venom #1 (2025)', '001', 2025)], { seriesKey: 'venom', number: '001', coverYear: 2025 })).toBeNull()
})

test('a leading "The" does not separate a series from itself', () => {
  const hit = matchIssue([row(1, 'The Mighty Thor #700 (2017)', '700', 2017)], { seriesKey: 'mighty thor', number: '700', coverYear: 2017 })
  expect(hit?.id).toBe(1)
})

// A post holding #1-85 is not issue #1, however its number parses.
test('a bundle of many issues does not match a single issue', () => {
  expect(matchIssue([row(1, 'Venom #1 – 85 (2025)', '001', 2025)], { seriesKey: 'venom', number: '001', coverYear: 2025 })).toBeNull()
})

test('a collected edition does not match a single issue', () => {
  expect(matchIssue([row(1, 'Venom Vol. 1 (TPB) (2025)', '001', 2025)], { seriesKey: 'venom', number: '001', coverYear: 2025 })).toBeNull()
})

test('a row with no year can never be matched', () => {
  expect(matchIssue([row(1, 'Venom #250 (2025)', '250', null)], { seriesKey: 'venom', number: '250', coverYear: 2025 })).toBeNull()
})

test('an issue with no cover year can never be matched', () => {
  expect(matchIssue([VENOM_250], { seriesKey: 'venom', number: '250', coverYear: null })).toBeNull()
})

test('a row with no number can never be matched', () => {
  expect(matchIssue([row(1, 'Venom (2025)', null, 2025)], { seriesKey: 'venom', number: '250', coverYear: 2025 })).toBeNull()
})

test('the one match is found among candidates that do not qualify', () => {
  const hit = matchIssue(
    [
      row(2, 'All-New Venom #250 (2025)', '250', 2025),   // wrong series
      VENOM_250,                                           // id 1, the answer
      row(3, 'Venom #250 – 261 (2025)', '250', 2025),      // a bundle, not one issue
    ],
    { seriesKey: 'venom', number: '250', coverYear: 2025 },
  )
  expect(hit?.id).toBe(1)
  expect(hit?.title).toBe('Venom #250 (2025)')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/issue-match.test.ts`
Expected: FAIL — `Failed to load url ../server/lib/issueMatch.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `server/lib/issueMatch.ts`:

```ts
import { seriesKey, releaseKind } from './comicGrouping.js'

/**
 * How far a scraped year may sit from a Comic Vine cover year and still be the same
 * issue. Comic Vine's cover date runs ahead of the release the scraper sees - Venom
 * #251 has a 2026-01 cover date and is posted as "Venom #251 (2025)".
 *
 * Measured, not guessed: across the library's 32 missing issues, ±0 loses five real
 * matches and ±2 admits twelve ambiguities. ±1 is the only value that resolves every
 * issue without admitting one. Exported because the SQL window that gathers candidates
 * has to agree with the filter that judges them.
 */
export const YEAR_SLACK = 1

/** A Comic Vine issue the library does not have, reduced to what the rule reads. */
export interface MissingIssue {
  seriesKey: string
  /** Already through parseNumber, so both sides of the comparison are normalised. */
  number: string
  coverYear: number | null
}

/** A scraped index row, reduced to what the rule reads. */
export interface IndexCandidate {
  id: number
  title: string
  number: string | null
  year: number | null
}

/**
 * The one index row that is this issue, or nothing.
 *
 * Nothing means either no candidate qualified or several did, and the caller cannot
 * tell which - because neither licenses a download. A wrong match here downloads the
 * wrong comic into a run, so the rule refuses wherever it cannot be certain: "Venom #1"
 * exists for the 2016, 2018 and 2021 volumes, and no amount of ranking makes a guess
 * between them honest.
 */
export function matchIssue(candidates: IndexCandidate[], issue: MissingIssue): IndexCandidate | null {
  const { coverYear } = issue
  if (coverYear === null) return null

  const hits = candidates.filter((c) =>
    c.number === issue.number
    && c.year !== null
    && Math.abs(c.year - coverYear) <= YEAR_SLACK
    // A bundle or a collected edition is not a single issue, however its number parses.
    && releaseKind(c.title) === 'issue'
    && seriesKey(c.title) === issue.seriesKey
  )

  return hits.length === 1 ? hits[0]! : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/issue-match.test.ts`
Expected: PASS, 14 tests.

Then `npm run typecheck` — expected: no output.

- [ ] **Step 5: Commit**

```bash
git add server/lib/issueMatch.ts test/issue-match.test.ts
git commit -m "feat: rule deciding whether a scraped row is a missing issue"
```

---

### Task 2: Carry the match on the edition's issue list

**Files:**
- Create: `server/services/issueMatching.ts`
- Modify: `server/db.ts` (SCHEMA, beside the `comic_index` index)
- Modify: `server/routes/editions.ts` (the `/api/editions/:id/issues` handler)
- Modify: `src/api.ts` (`ApiVolumeIssue`)
- Test: `test/routes-editions-issues.test.ts` (append)

**Interfaces:**
- Consumes: `matchIssue`, `YEAR_SLACK`, `IndexCandidate` from Task 1; `seriesKey` from `comicGrouping.js`; `parseNumber` from `comicTitle.js`; `CvVolumeIssue` from `comicvine.js`.
- Produces: `interface IssueMatch { indexId: number; title: string }` and `findMatchForIssue(db: Db, volumeName: string | null, issue: CvVolumeIssue): IssueMatch | null` — Task 3 calls the same function.

- [ ] **Step 1: Write the failing tests**

Append to `test/routes-editions-issues.test.ts`. `seedVenom`, `app`, `stubCv` and `VOLUME_ISSUES` already exist in that file; `VOLUME_ISSUES` holds Venom #250 (cover 2025-12), #251 (2026-01) and #255 (2026-05), and `seedVenom` leaves #255 owned.

```ts
/* ── matching missing issues to the scraped index ──────────────────────────── */

/** Put a scraped row in the index. Titles are what the rule reads, so they are real ones. */
function indexRow(db: ReturnType<typeof openDb>, title: string, number: string | null, year: number | null) {
  return db.prepare(
    "INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)"
  ).run(title, `https://x.test/${title}`, 'Marvel Comics', number, year, '2026-09-13T00:00:00.000Z').lastInsertRowid as number
}

test('a missing issue with one possible scraped row carries that match', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { cvName: 'Venom' })
  const rowId = indexRow(db, 'Venom #250 (2025)', '250', 2025)
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  const issue = body.issues.find((i: { number: string }) => i.number === '250')
  expect(issue.match).toEqual({ indexId: rowId, title: 'Venom #250 (2025)' })
  await server.close(); db.close()
})

test('a missing issue with two possible rows carries no match', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { cvName: 'Venom' })
  indexRow(db, 'Venom #250 (2025)', '250', 2025)
  indexRow(db, 'Venom #250 (2026)', '250', 2026)
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(body.issues.find((i: { number: string }) => i.number === '250').match).toBeNull()
  await server.close(); db.close()
})

test('an issue you own is not matched against the index', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { cvName: 'Venom' })
  indexRow(db, 'Venom #255 (2026)', '255', 2026)
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  const owned = body.issues.find((i: { number: string }) => i.number === '255')
  expect(owned.owned).toBe(true)
  expect(owned.match).toBeUndefined()
  await server.close(); db.close()
})

// cvName is Comic Vine's name for the volume. Without it there is nothing trustworthy
// to key on - the edition's own name may be "Vol 7" or "Unsorted".
test('an edition with no Comic Vine name matches nothing', async () => {
  const db = openDb(':memory:')
  const { edition } = seedVenom(db)
  updateEdition(db, edition.id, { cvName: null })
  indexRow(db, 'Venom #250 (2025)', '250', 2025)
  stubCv()
  const server = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(body.issues.find((i: { number: string }) => i.number === '250').match).toBeNull()
  await server.close(); db.close()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/routes-editions-issues.test.ts`
Expected: FAIL — the first two with `expected undefined to equal { indexId: …, title: … }` / `expected undefined to be null`.

- [ ] **Step 3: Add the index**

In `server/db.ts`, inside the `SCHEMA` template string, directly after the existing `CREATE INDEX IF NOT EXISTS idx_comic_index_category ON comic_index(category);` line:

```sql
-- Gathers the handful of rows that could be a given missing issue. Without it each
-- lookup scans all 67,300 rows; with it, matching a whole edition's missing run costs
-- 31ms instead of 149ms.
CREATE INDEX IF NOT EXISTS idx_comic_index_number_year ON comic_index(number, year);
```

- [ ] **Step 4: Write the matching service**

Create `server/services/issueMatching.ts`:

```ts
import { seriesKey } from '../lib/comicGrouping.js'
import { parseNumber } from '../lib/comicTitle.js'
import { matchIssue, YEAR_SLACK } from '../lib/issueMatch.js'
import type { IndexCandidate } from '../lib/issueMatch.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'
import type { Db } from '../types.js'

/** Which scraped row is this issue, for the page that offers to download it. */
export interface IssueMatch {
  indexId: number
  title: string
}

// Narrowed by number and year so only a handful of rows are read and judged in JS;
// seriesKey is a function and cannot be expressed in SQL. Rows with no number or year
// can never satisfy the rule, and the comparisons exclude them here rather than later.
const CANDIDATES = `SELECT id, title, number, year FROM comic_index
                    WHERE number = ? AND year BETWEEN ? AND ?`

/**
 * The one scraped row that is this Comic Vine issue, or nothing.
 *
 * `volumeName` is Comic Vine's name for the volume - never the edition's own name,
 * which is hand-editable and may be "Vol 7" or "Unsorted" and describe no series at all.
 */
export function findMatchForIssue(
  db: Db,
  volumeName: string | null,
  issue: CvVolumeIssue,
): IssueMatch | null {
  if (!volumeName?.trim() || !issue.number) return null

  const coverYear = issue.coverDate ? Number(String(issue.coverDate).slice(0, 4)) : NaN
  if (!Number.isInteger(coverYear)) return null

  // Both sides of the number comparison go through the same normaliser, so "5", "05"
  // and "005" are one value.
  const number = parseNumber(`#${issue.number}`)
  if (!number) return null

  const candidates = db
    .prepare(CANDIDATES)
    .all(number, coverYear - YEAR_SLACK, coverYear + YEAR_SLACK) as IndexCandidate[]

  const hit = matchIssue(candidates, { seriesKey: seriesKey(volumeName), number, coverYear })
  return hit ? { indexId: hit.id, title: hit.title } : null
}
```

- [ ] **Step 5: Carry the match on the response**

In `server/routes/editions.ts`, add to the imports:

```ts
import { findMatchForIssue } from '../services/issueMatching.js'
```

In the `/api/editions/:id/issues` handler, replace the block that builds `issues`:

```ts
    const byCvId = new Map(books.filter((b) => b.comicvineId).map((b) => [b.comicvineId as number, b]))
    const issues = volumeIssues.map((issue) => {
      const book = byCvId.get(issue.id)
      return book ? { ...issue, owned: true, bookId: book.id } : { ...issue, owned: false }
    })
```

with:

```ts
    const byCvId = new Map(books.filter((b) => b.comicvineId).map((b) => [b.comicvineId as number, b]))
    const issues = volumeIssues.map((issue) => {
      const book = byCvId.get(issue.id)
      if (book) return { ...issue, owned: true, bookId: book.id }
      // Only what you are missing is worth matching; a match for a comic you already
      // have would be computed and thrown away.
      return { ...issue, owned: false, match: findMatchForIssue(app.db, edition.cvName, issue) }
    })
```

- [ ] **Step 6: Add the field to the client type**

In `src/api.ts`, extend `ApiVolumeIssue`:

```ts
export interface ApiVolumeIssue {
  id: number
  number?: string
  name?: string | null
  coverDate?: string
  siteUrl?: string
  owned: boolean
  bookId?: number
  /** The one scraped row that is this issue, when there is exactly one. Present only on
   *  issues you do not own; null when nothing matched or several things did. */
  match?: { indexId: number; title: string } | null
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/routes-editions-issues.test.ts`
Expected: PASS, all tests including the four new ones.

Then `npm run typecheck` — expected: no output.

- [ ] **Step 8: Commit**

```bash
git add server/services/issueMatching.ts server/db.ts server/routes/editions.ts src/api.ts test/routes-editions-issues.test.ts
git commit -m "feat: tell an edition which missing issues the index can supply"
```

---

### Task 3: The one-press download endpoint

**Files:**
- Modify: `server/routes/editions.ts` (route options + new endpoint)
- Test: `test/routes-editions-download-issue.test.ts` (new)

**Interfaces:**
- Consumes: `findMatchForIssue` from Task 2; `getCachedVolumeIssues` from `models/volumeIssues.js`; `comicIndexById` from `models/comicIndex.js`; `parseDownloadLink(html: string, postUrl: string): string | null` from `lib/comicPostPage.js`; `fetchSourcePage(url: string): Promise<string>` from `lib/comicIndexSource.js`; `app.downloader.start({ url, edition, issueId })`.
- Produces: `POST /api/editions/:id/issues/:cvIssueId/download` → `202 { started, status }`.

- [ ] **Step 1: Write the failing tests**

Create `test/routes-editions-download-issue.test.ts`:

```ts
import { test, expect } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import type { Config } from '../server/config.js'

const POST_HTML = '<div class="aio-button-center"><a href="https://dl.test/venom-250.cbz">DOWNLOAD NOW</a></div>'

/** Every Comic Vine url the server asks for, so the no-search invariant is testable. */
let cvUrls: string[] = []

function server(db: ReturnType<typeof openDb>, html: string | null = POST_HTML) {
  cvUrls = []
  globalThis.fetch = (async (url: string) => {
    cvUrls.push(String(url))
    return { ok: true, json: async () => ({ results: [] }) }
  }) as never

  const started: unknown[] = []
  const app = Fastify()
  app.decorate('db', db)
  app.decorate('config', { comicsDir: '/tmp/comics', thumbsDir: '/tmp/thumbs', comicVineApiKey: 'k' } as Config)
  app.decorate('downloader', {
    start(req: unknown) { started.push(req); return { started: true, status: { running: true }, done: Promise.resolve() } },
    status() { return { running: false } },
  })
  return { app, started, fetchPage: async () => { if (html === null) throw new Error('nope'); return html } }
}

function seed(db: ReturnType<typeof openDb>) {
  const edition = upsertEdition(db, { name: 'Venom (2025)', folder: 'Venom/Venom (2025)', seriesName: 'Venom' })
  updateEdition(db, edition.id, { comicvineId: 167333, cvName: 'Venom' })
  cacheVolumeIssues(db, 167333, [{ id: 1136140, number: '250', coverDate: '2025-12-01' }], '2026-09-13T00:00:00.000Z')
  const indexId = db.prepare(
    "INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)"
  ).run('Venom #250 (2025)', 'https://x.test/post/250', 'Marvel Comics', '250', 2025, '2026-09-13T00:00:00.000Z').lastInsertRowid as number
  return { edition, indexId }
}

test('pressing get starts the download in this edition, for this issue', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(res.statusCode).toBe(202)
  expect(started).toEqual([{ url: 'https://dl.test/venom-250.cbz', edition: 'Venom (2025)', issueId: 1136140 }])
  await app.close(); db.close()
})

// The invariant from spec §4.3.1. A name-based search cannot identify an issue of a
// relaunched title; searching Comic Vine for "Captain America #4" does not return the
// 2025 issue at all. This path knows the id, and must never fall back to searching.
test('pressing get never searches Comic Vine by name', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(cvUrls.filter((u) => u.includes('/search/'))).toEqual([])
  await app.close(); db.close()
})

test('a match that has become ambiguous refuses rather than guessing', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  db.prepare("INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)")
    .run('Venom #250 (2026)', 'https://x.test/post/250b', 'Marvel Comics', '250', 2026, '2026-09-13T00:00:00.000Z')
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(res.statusCode).toBe(409)
  expect(started).toEqual([])
  await app.close(); db.close()
})

test('an issue that is not in this volume is not downloadable from it', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/999999/download` })

  expect(res.statusCode).toBe(404)
  expect(started).toEqual([])
  await app.close(); db.close()
})

test('a post with no direct link says so rather than starting nothing', async () => {
  const db = openDb(':memory:')
  const { edition } = seed(db)
  const { app, started, fetchPage } = server(db, '<p>mirrors only</p>')
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(res.statusCode).toBe(404)
  expect(started).toEqual([])
  await app.close(); db.close()
})

test('an edition with no volume has nothing to download against', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Unsorted', folder: 'Unsorted' })
  const { app, fetchPage } = server(db)
  await app.register(editionRoutes, { fetchPage })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1136140/download` })

  expect(res.statusCode).toBe(404)
  await app.close(); db.close()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/routes-editions-download-issue.test.ts`
Expected: FAIL — `expected 404 to be 202` on the first test (the route does not exist).

- [ ] **Step 3: Add the route option and the endpoint**

In `server/routes/editions.ts`, add to the imports:

```ts
import { comicIndexById } from '../models/comicIndex.js'
import { parseDownloadLink } from '../lib/comicPostPage.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
```

Change the module signature so tests never reach the network:

```ts
export interface EditionRouteOpts {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
}

export default async function editionRoutes(app: App, opts: EditionRouteOpts = {}) {
  const { fetchPage = fetchSourcePage } = opts
```

Add the endpoint directly after the `/api/editions/:id/issues` handler:

```ts
  /**
   * Download the one scraped release that is this missing issue, into this edition.
   *
   * The match is decided again here rather than taken from the page. A tile rendered
   * before a scrape could otherwise act on a row that has since moved, so the rule that
   * showed the button is the rule that acts - and a match that has become ambiguous in
   * the interval refuses instead of proceeding.
   *
   * The issue id is carried into the download, which is what makes this the one import
   * path where Comic Vine's identity for a comic is known rather than inferred from a
   * filename. Nothing here may fall back to searching Comic Vine by name: that search
   * cannot tell a dozen relaunches of "Captain America" apart, and a fallback would
   * quietly reintroduce exactly that failure.
   */
  app.post<{ Params: { id: string; cvIssueId: string } }>(
    '/api/editions/:id/issues/:cvIssueId/download',
    async (req, reply) => {
      const edition = getEdition(app.db, Number(req.params.id))
      if (!edition) return reply.code(404).send({ error: 'edition not found' })
      if (!edition.comicvineId) return reply.code(404).send({ error: 'edition has no volume' })

      // Any age: a press only follows a page view that filled this cache, and a
      // published issue's number and cover date do not change.
      const held = getCachedVolumeIssues(app.db, edition.comicvineId, Infinity)
      const issue = held?.issues.find((i) => i.id === Number(req.params.cvIssueId))
      if (!issue) return reply.code(404).send({ error: 'issue not in this volume' })

      const match = findMatchForIssue(app.db, edition.cvName, issue)
      if (!match) return reply.code(409).send({ error: 'no unique match for that issue' })

      const row = comicIndexById(app.db, match.indexId)
      if (!row) return reply.code(409).send({ error: 'no unique match for that issue' })

      let url: string | null = null
      try {
        url = parseDownloadLink(await fetchPage(row.url), row.url)
      } catch {
        return reply.code(502).send({ error: 'could not read that post' })
      }
      if (!url) return reply.code(404).send({ error: 'no download link on that post' })

      const { started, status } = app.downloader.start({ url, edition: edition.name, issueId: issue.id })
      if (!started) return reply.code(409).send({ started, status })
      return reply.code(202).send({ started, status })
    },
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/routes-editions-download-issue.test.ts`
Expected: PASS, 6 tests.

Then the whole suite, because `editionRoutes` gained a parameter: `npm test`
Expected: PASS — existing `await server.register(editionRoutes)` calls still work, since `opts` defaults.

Then `npm run typecheck` — expected: no output.

- [ ] **Step 5: Commit**

```bash
git add server/routes/editions.ts test/routes-editions-download-issue.test.ts
git commit -m "feat: download a missing issue straight into its edition"
```

---

### Task 4: Get and Find on a missing tile

**Files:**
- Modify: `src/api.ts` (client call)
- Modify: `src/pages/Edition.tsx` (`VolumeIssue`)
- Modify: `src/styles.css`
- Test: `test/Edition.test.tsx` (append)

**Interfaces:**
- Consumes: `ApiVolumeIssue.match` from Task 2; the endpoint from Task 3.
- Produces: `api.downloadMissingIssue(editionId, cvIssueId)`.

- [ ] **Step 1: Write the failing tests**

Append to `test/Edition.test.tsx`. `mockFetchWithIssues`, `renderPage` and `VOLUME_ISSUES` already exist there.

```ts
/* ── Getting a missing issue ───────────────────────────────────────────────── */

const MATCHED = {
  ...VOLUME_ISSUES,
  fetchedAt: '2026-09-04T10:00:00.000Z',
  issues: [
    { id: 1, number: '1', owned: false, match: { indexId: 77, title: 'Venom #1 (2025)' } },
    { id: 2, number: '2', owned: false, match: null },
  ],
  extras: [],
  owned: 0,
  total: 2,
}

test('a missing issue the index can supply offers to get it', async () => {
  mockFetchWithIssues(MATCHED)
  renderPage()
  expect(await screen.findByRole('button', { name: /Get #1/i })).toBeInTheDocument()
})

test('a missing issue with no certain match offers to find it instead', async () => {
  mockFetchWithIssues(MATCHED)
  renderPage()
  const find = await screen.findByRole('link', { name: /Find #2/i })
  expect(find).toHaveAttribute('href', expect.stringContaining('/search?q='))
})

test('a missing issue with no certain match offers no get button', async () => {
  mockFetchWithIssues(MATCHED)
  renderPage()
  await screen.findByRole('button', { name: /Get #1/i })
  expect(screen.queryByRole('button', { name: /Get #2/i })).not.toBeInTheDocument()
})

test('pressing get asks the server to download that issue into this edition', async () => {
  mockFetchWithIssues(MATCHED)
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Get #1/i }))
  await waitFor(() => {
    expect(posted.some((p) => p.url.includes('/api/editions/9/issues/1/download'))).toBe(true)
  })
})
```

If `posted`, `fireEvent` or `waitFor` are not already imported or populated in that file, mirror how `test/SearchComics.test.tsx` records POSTs: push `{ url, body }` into a module-level array inside the `globalThis.fetch` stub when `init?.method === 'POST'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/Edition.test.tsx`
Expected: FAIL — `Unable to find role="button" and name /Get #1/i`.

- [ ] **Step 3: Add the client call**

In `src/api.ts`, beside `getEditionIssues`:

```ts
  /** Download the one scraped release that is this missing issue, into this edition. */
  downloadMissingIssue: (editionId: string | number, cvIssueId: number) =>
    json<{ started: boolean }>(`/api/editions/${editionId}/issues/${cvIssueId}/download`, { method: 'POST' }),
```

Check how `json` takes options in that file — if other POST helpers pass `{ method: 'POST', body, headers }`, follow the same shape and send no body.

- [ ] **Step 4: Render the two actions**

In `src/pages/Edition.tsx`, add `useMutation` to the existing `@tanstack/react-query` import if absent, and replace the `VolumeIssue` component:

```tsx
/**
 * One issue of the run: the comic if you have it, otherwise its place in the run and a
 * way to fill it.
 *
 * A missing issue shows no art - a cover is a spoiler for a comic you have not read -
 * and offers `Get` only when exactly one scraped release can be this issue. Anything
 * less certain offers `Find`, which opens the search with the series and year filled
 * in so you choose by eye. The button never guesses; that is the whole point of it.
 */
function VolumeIssue({ issue, book, editionId, seriesName }: {
  issue: ApiVolumeIssue
  book?: ApiBook
  editionId: string
  seriesName: string
}) {
  const qc = useQueryClient()
  const label = `#${issue.number ?? '?'}`

  const get = useMutation({
    mutationFn: () => api.downloadMissingIssue(editionId, issue.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['download'] }),
  })

  if (issue.owned && issue.bookId != null) {
    return (
      <CoverTile
        to={`/book/${issue.bookId}`}
        img={`/api/books/${issue.bookId}/thumbnail`}
        title={book?.title || issue.name || label}
        subtitle={label}
        readState={book?.readState}
        percent={book?.percent}
      />
    )
  }

  const findParams = new URLSearchParams({ q: seriesName })
  if (issue.coverDate) findParams.set('yearFrom', String(issue.coverDate).slice(0, 4))

  return (
    <div className="volume-issue">
      <CoverTile href={issue.siteUrl} title={label} subtitle="Missing" />
      {issue.match ? (
        <button
          type="button"
          className="btn btn-ghost volume-issue__get"
          disabled={get.isPending}
          onClick={() => get.mutate()}
          title={issue.match.title}
        >
          {get.isPending ? 'Getting…' : `↓ Get ${label}`}
        </button>
      ) : (
        <Link className="volume-issue__find" to={`/search?${findParams}`}>
          {`Find ${label} ↗`}
        </Link>
      )}
      {get.isError && <span className="volume-issue__error">Could not get that one.</span>}
    </div>
  )
}
```

At the call site (around line 298), pass the two new props:

```tsx
<VolumeIssue
  key={issue.id}
  issue={issue}
  book={bookById.get(issue.bookId ?? -1)}
  editionId={id!}
  seriesName={data.edition.seriesName?.trim() || data.edition.cvName || data.edition.name}
/>
```

- [ ] **Step 5: Add the styles**

Append to `src/styles.css`, after the `.tile-grid` block:

```css
/* A missing issue and the one action that can fill it. The wrapper takes the grid cell
   the tile used to, so the run's layout is unchanged. */
.volume-issue {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.volume-issue__get,
.volume-issue__find {
  align-self: start;
  font-size: 0.8125rem;
  padding: 2px 8px;
  color: var(--muted);
  text-decoration: none;
}

.volume-issue__find:hover,
.volume-issue__get:hover:not(:disabled) {
  color: var(--text);
}

.volume-issue__error {
  font-size: 0.75rem;
  color: var(--danger, #f87171);
}
```

If `--danger` is not a variable in this stylesheet, use whatever the existing error colour is — check `.search-comics__error`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/Edition.test.tsx`
Expected: PASS.

Then `npm test` and `npm run typecheck` — expected: all pass, no type output.

- [ ] **Step 7: Build and rebuild the container**

```bash
npm run build
docker compose up -d --build
```

Then check it by hand at `http://localhost:8090`: open **Venom (2025)**, confirm missing issues show `↓ Get`, and that pressing one reports in the download bar and the issue becomes owned.

- [ ] **Step 8: Commit**

```bash
git add src/api.ts src/pages/Edition.tsx src/styles.css test/Edition.test.tsx
git commit -m "feat: get a missing issue in one press from its edition"
```

---

## Self-Review

**Spec coverage.** §3 rule → Task 1. §4.1 pure module → Task 1. §4.2 issues response + skip-owned + skip-no-cvName → Task 2. §4.3 endpoint, all six steps → Task 3. §4.3.1 id-only invariant → Task 3 Step 1, second test. §4.4 frontend → Task 4. §6 safety: property 1 → Task 1 ambiguity tests; property 2 → Task 3 ambiguity test; property 3 (`dedupeDestPath`) is existing behaviour, relied on and not re-implemented. §7 schema → Task 2 Step 3. §8 testing → spread across all four tasks.

**Placeholders.** None: every step carries the code or the exact command. Two steps say "check how the existing file does X" (the `json` POST shape, the error colour variable) — those are lookups in the file being edited, not deferred decisions.

**Type consistency.** `IndexCandidate` and `MissingIssue` (Task 1) are consumed unchanged by `findMatchForIssue` (Task 2). `IssueMatch { indexId, title }` is produced in Task 2 and consumed by Task 3 and by `ApiVolumeIssue.match` in Task 4. `YEAR_SLACK` is defined once in Task 1 and used by Task 2's SQL window. `findMatchForIssue(db, volumeName, issue)` has the same three arguments at both call sites.
