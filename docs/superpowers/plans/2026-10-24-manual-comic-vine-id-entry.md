# Manual Comic Vine id entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind a comic to its Comic Vine record by typing the id, refresh a bound record on demand, and keep a Settings list of what was linked by hand and what Comic Vine still owes it.

**Architecture:** Every change converges on `applyIssueToBook`, the one service all three match paths (library match, manual entry, upload) already pass through. It stops writing nulls over existing data, learns to bind an id when the read fails, reports what changed, and records manual entries. The UI additions are thin layers over the existing apply route.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React 19, TanStack Query, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-24-manual-comic-vine-id-entry-design.md`

## Global Constraints

- **Empty means `v == null || v.trim() === ''`** — not `undefined`. Comic Vine returns JSON `null` for unset strings and `''` for `issue_number`.
- **A cover url whose filename matches `blank` or `missing` counts as empty.** One predicate; the spec records it as unreproduced (§3.1).
- **`comicvineId` and `cvSiteUrl` are always written**, thin record or not.
- **Comic Vine signals a nonexistent id as HTTP 200 with `status_code: 101`**, never HTTP 404 (spec §3.4).
- **Never test against `./data`** — the live library. Tests use `openDb(':memory:')` and `mkdtempSync`, per `test/apply-issue.test.ts`.
- Iterate with the touched test files plus `npm run typecheck`. Full `npm test` before merge, never per task (`CLAUDE.md`).
- Finish with `docker compose up -d --build`; the app serves at **http://localhost:8090**.

## Review Focus

1. **Re-entering a different id for a book that already has an entry** — the row must update in place and keep its original `created_at`, not duplicate or reset. (Task 6)
2. **`cv_missing` null or unparseable** — a row written before this column existed, or corrupted; Settings must render it as "not yet read", never crash the page. (Task 6, Task 12)
3. **Comic Vine answers `status_code: 1` with `results: []`** — a deleted record. Must be treated as "no such issue" like 101, not as a thin record that binds. (Task 7)
4. **The volume fetch fails while the issue read succeeds** — already best-effort in the service; the entry must still be filed and the issue metadata still applied. (Task 7)
5. **Issue URL variants** — `http://`, no trailing slash, uppercase host, a `?` query or `#` fragment. All must parse to the same id. (Task 1)

---

### Task 1: The id parser

**Files:**
- Create: `src/lib/cvIssueId.ts`
- Test: `test/cv-issue-id.test.ts`

**Interfaces:**
- Produces: `parseCvIssueId(input: string): { ok: true; id: number } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test**

```ts
test.each([
  ['https://comicvine.gamespot.com/amazing-spider-man-halloween-special-1/4000-1197227/', 1197227],
  ['http://comicvine.gamespot.com/x/4000-1197227/', 1197227],
  ['COMICVINE.GAMESPOT.COM/x/4000-1197227', 1197227],
  ['https://comicvine.gamespot.com/x/4000-1197227/?foo=1#bar', 1197227],
  ['  4000-1197227  ', 1197227],
  ['1197227', 1197227],
])('parses %s', (input, id) => {
  expect(parseCvIssueId(input)).toEqual({ ok: true, id })
})

test('rejects a volume link by name', () => {
  const r = parseCvIssueId('https://comicvine.gamespot.com/amazing-spider-man-halloween-special/4050-177664/')
  expect(r).toEqual({ ok: false, error: 'That is a volume link. Paste the link to a single issue.' })
})

test.each(['4005-1443', '4045-56676'])('rejects other resource prefix %s', (input) => {
  expect(parseCvIssueId(input).ok).toBe(false)
})

test.each(['', '   ', 'nonsense', '0', '-5', 'https://example.com/4000-1'])('rejects %s', (input) => {
  expect(parseCvIssueId(input).ok).toBe(false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/cv-issue-id.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parseCvIssueId` in `src/lib/cvIssueId.ts`**

Strip whitespace, then any `?`/`#` tail. Find a `NNNN-NNNN` token anywhere in the string: `4000-` yields the id; `4050-` returns the volume message; any other four-digit prefix returns a message naming that resource. With no such token, accept a bare positive integer. Reject everything else with `'That does not look like a Comic Vine issue id or link.'`

A URL-shaped input is accepted only when its host is comicvine.gamespot.com, which is what rejects `https://example.com/4000-1`. A bare id or a bare `4000-1197227` token has no host and is unaffected.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/cv-issue-id.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cvIssueId.ts test/cv-issue-id.test.ts
git commit -m "feat: parse a Comic Vine issue id from a url or a bare number"
```

---

### Task 2: A Comic Vine error that carries its status

**Files:**
- Modify: `server/lib/comicvine.ts` (the `get()` throw sites, ~line 30-40)
- Test: `test/comicvine.test.ts`

**Interfaces:**
- Produces: `class CvApiError extends Error { httpStatus?: number; cvStatus?: number }`, exported from `server/lib/comicvine.ts`.

- [ ] **Step 1: Write the failing test**

```ts
test('a Comic Vine status_code surfaces on the error', async () => {
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ status_code: 101, error: 'Object Not Found' }) })) as never
  const cv = createComicVine({ apiKey: () => 'k' })
  await expect(cv.getIssue(1)).rejects.toMatchObject({ cvStatus: 101 })
})

test('an HTTP failure surfaces its status', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 500 })) as never
  const cv = createComicVine({ apiKey: () => 'k' })
  await expect(cv.getIssue(1)).rejects.toMatchObject({ httpStatus: 500 })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/comicvine.test.ts` → FAIL (plain `Error`, no fields).

- [ ] **Step 3: Replace both `throw new Error(...)` in `get()` with `CvApiError`**

Keep the existing message text so nothing reading messages breaks; add the fields. The "API key not configured" throw also becomes a `CvApiError` with neither field set.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/comicvine.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/comicvine.ts test/comicvine.test.ts
git commit -m "feat: carry Comic Vine's status code on the error it throws"
```

---

### Task 3: Replace tags one kind at a time

**Files:**
- Modify: `server/models/metadata.ts`
- Test: `test/metadata.test.ts`

**Interfaces:**
- Produces: `replaceBookTagsOfKind(db: Db, bookId: number, kind: string, tags: BookTag[]): void`
- `replaceBookTags` is left in place for callers that mean "all kinds".

- [ ] **Step 1: Write the failing test**

```ts
test('replacing one kind leaves the other kinds alone', () => {
  const db = openDb(':memory:')
  // seed a book with a character tag and a story_arc tag
  replaceBookTagsOfKind(db, bookId, 'character', [{ kind: 'character', value: 'Carnage' }])
  expect(getBookTags(db, bookId)).toEqual([
    { kind: 'story_arc', value: 'Death Spiral', extId: undefined },
    { kind: 'character', value: 'Carnage', extId: undefined },
  ])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/metadata.test.ts` → FAIL — not exported.

- [ ] **Step 3: Implement `replaceBookTagsOfKind`**

`DELETE FROM book_tag WHERE book_id = ? AND kind = ?`, then the same insert loop as `replaceBookTags`. Carries the same "must be called within a transaction" comment as its neighbours.

- [ ] **Step 4: Run to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add server/models/metadata.ts test/metadata.test.ts
git commit -m "feat: replace book tags of a single kind"
```

---

### Task 4: Comic Vine's empties stop overwriting your data

**Files:**
- Modify: `server/services/applyIssue.ts`
- Test: `test/apply-issue.test.ts`

**Interfaces:**
- Consumes: `replaceBookTagsOfKind` (Task 3).
- Produces: no signature change yet. `applyIssueToBook` omits keys rather than writing nulls.

This is the data-loss fix and the reason the full suite is the merge gate — every existing match test walks this code.

- [ ] **Step 1: Write the failing tests**

Add a `THIN` fixture beside `ISSUE`: `{ id: 1197227, issue_number: '1', name: null, cover_date: null, description: null, person_credits: [], character_credits: [], story_arc_credits: [], volume: { id: 177664, name: 'Amazing Spider-Man: Halloween Special' }, site_detail_url: 'https://cv/1197227', image: { original_url: 'https://cv/a/blank.png' } }`, and a `ctx()` variant that serves it.

```ts
test('a thin record leaves every existing field intact', async () => {
  // seed a book with title/date/summary/writer/penciller/coverUrl set
  await applyIssueToBook(c, book.id, 1197227)
  expect(getBook(c.db, book.id)).toMatchObject({
    title: 'Pre-existing title', date: '2026-01-02', summary: 'Pre-existing summary',
    writer: 'Someone', penciller: 'Someone Else', coverUrl: 'https://local/cover.jpg',
  })
})

test('a thin record still writes the link', async () => {
  await applyIssueToBook(c, book.id, 1197227)
  expect(getBook(c.db, book.id)).toMatchObject({ comicvineId: 1197227, cvSiteUrl: 'https://cv/1197227' })
})

test.each([['', 'empty'], ['   ', 'whitespace']])('%s issue_number is not written', async (number) => {
  // serve { ...THIN, issue_number: number } over a book whose number is '255'
  expect(getBook(c.db, book.id)!.number).toBe('255')
})

test('credits arrive without clearing character tags', async () => {
  // serve a record with person_credits but character_credits: []
  expect(getBookTags(c.db, book.id)).toContainEqual({ kind: 'character', value: 'Venom', extId: 1234 })
  expect(getBookCredits(c.db, book.id)).toEqual([{ name: 'Al Ewing', role: 'writer' }])
})

test('characters arrive without clearing credits', async () => { /* the reverse */ })

test('a populated record still overwrites', async () => {
  // the existing ISSUE fixture over a seeded book — guards against "never update"
  expect(getBook(c.db, book.id)).toMatchObject({ title: 'Death Spiral, Part 3 of 9' })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/apply-issue.test.ts`
Expected: FAIL — fields come back null, tags cleared.

- [ ] **Step 3: Build the patch by omission in `applyIssueToBook`**

Replace the `?? null` object literal with one assembled conditionally: a local `has(v)` implementing the Global Constraints emptiness rule, plus a cover-specific check for the `blank`/`missing` filename. `comicvineId` and `cvSiteUrl` are set unconditionally. Swap the single `replaceBookTags` call for four guarded calls — `replaceBookCredits` when `meta.credits.length`, and `replaceBookTagsOfKind` per kind for `character`, `team`, `story_arc` — each only when its list is non-empty.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/apply-issue.test.ts && npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/applyIssue.ts test/apply-issue.test.ts
git commit -m "fix: a thin Comic Vine record no longer erases a book's metadata"
```

---

### Task 5: Report what changed

**Files:**
- Modify: `server/services/applyIssue.ts`
- Test: `test/apply-issue.test.ts`

**Interfaces:**
- Produces: `AppliedIssue` gains `changed: string[]` and `metadataApplied: boolean`. Existing consumers (`server/routes/comicvine.ts`, `server/services/storeComic.ts`) are unaffected — both read only `book`.

- [ ] **Step 1: Write the failing test**

```ts
test('changed names only the fields that moved', async () => {
  const r = await applyIssueToBook(c, book.id, 1159231)  // populated ISSUE over an empty book
  expect(r.changed).toEqual(expect.arrayContaining(['title', 'number', 'date']))
  expect(r.changed).not.toContain('comicinfoSynced')
})

test('a thin record over a full book changes nothing but the link', async () => {
  const r = await applyIssueToBook(c, book.id, 1197227)
  expect(r.changed).toEqual(expect.arrayContaining(['comicvineId', 'cvSiteUrl']))
  expect(r.changed).not.toContain('title')
  expect(r.changed).not.toContain('summary')
})
```

- [ ] **Step 2: Run to verify it fails** → FAIL, `changed` undefined.

- [ ] **Step 3: Compute the diff**

The service already reads `book` before updating. Compare that snapshot against the returned row over `BOOK_FIELDS`' keys, excluding `comicinfoSynced` — `syncComicInfoFile` flips it on every call and would make every refresh look like a change. Append `'credits'` / `'characters'` / `'teams'` / `'storyArcs'` when that kind was replaced. Set `metadataApplied: true`.

- [ ] **Step 4: Run to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/applyIssue.ts test/apply-issue.test.ts
git commit -m "feat: applying an issue reports which fields changed"
```

---

### Task 6: The manual-entry table

**Files:**
- Modify: `server/db.ts` (add to `SCHEMA`)
- Create: `server/models/cvManualEntry.ts`
- Test: `test/cv-manual-entry.test.ts`

**Interfaces:**
- Produces:
  - `upsertManualEntry(db: Db, bookId: number, cvIssueId: number): void` — keeps the original `created_at` on re-entry
  - `recordManualCheck(db: Db, bookId: number, missing: string[]): void` — no-op when the book has no entry
  - `listManualEntries(db: Db): ManualEntry[]`
  - `deleteManualEntry(db: Db, bookId: number): void`
  - `interface ManualEntry { bookId; title: string | null; fileName: string; cvIssueId: number; bookCvId: number | null; cvSiteUrl: string | null; createdAt: string; checkedAt: string | null; missing: string[] }`

Schema exactly as spec §5.2.

- [ ] **Step 1: Write the failing test**

```ts
test('re-entering an id updates in place and keeps created_at', () => {
  upsertManualEntry(db, bookId, 1197227)
  const first = listManualEntries(db)[0]!.createdAt
  upsertManualEntry(db, bookId, 999)
  const rows = listManualEntries(db)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ cvIssueId: 999, createdAt: first })
})

test('an unchecked entry reports no missing fields and a null checkedAt', () => {
  upsertManualEntry(db, bookId, 1197227)
  expect(listManualEntries(db)[0]).toMatchObject({ checkedAt: null, missing: [] })
})

test('recordManualCheck stores the missing list and stamps checkedAt', () => {
  upsertManualEntry(db, bookId, 1197227)
  recordManualCheck(db, bookId, ['date', 'title'])
  const row = listManualEntries(db)[0]!
  expect(row.missing).toEqual(['date', 'title'])
  expect(row.checkedAt).not.toBeNull()
})

test('recordManualCheck on a book with no entry does nothing', () => {
  recordManualCheck(db, bookId, ['date'])
  expect(listManualEntries(db)).toEqual([])
})

test('an unparseable cv_missing reads as not yet checked', () => {
  upsertManualEntry(db, bookId, 1197227)
  db.prepare('UPDATE cv_manual_entry SET cv_missing = ? WHERE book_id = ?').run('{{{', bookId)
  expect(listManualEntries(db)[0]!.missing).toEqual([])
})

test('deleting a book removes its entry', () => { /* cascade */ })
test('deleteManualEntry leaves book.comicvine_id set', () => { /* the §5.4 guarantee */ })
```

- [ ] **Step 2: Run to verify they fail** → FAIL, module not found.

- [ ] **Step 3: Implement the schema and the model**

`listManualEntries` joins `book` for title, `file_path` (basename as `fileName`) and `comicvine_id`/`cv_site_url`, ordered by `created_at DESC`. `missing` parses `cv_missing` inside a try/catch returning `[]` — a corrupt or absent value must not break the page.

- [ ] **Step 4: Run to verify they pass** → PASS

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/models/cvManualEntry.ts test/cv-manual-entry.test.ts
git commit -m "feat: record comics linked to Comic Vine by hand"
```

---

### Task 7: Binding by hand, including when Comic Vine will not answer

**Files:**
- Modify: `server/services/applyIssue.ts`
- Test: `test/apply-issue.test.ts`

**Interfaces:**
- Consumes: `CvApiError` (Task 2), `upsertManualEntry` / `recordManualCheck` (Task 6).
- Produces: `applyIssueToBook(ctx, bookId, issueId, opts?: { manual?: boolean }): Promise<AppliedIssue>`

- [ ] **Step 1: Write the failing tests**

```ts
test('status_code 101 rejects and writes nothing', async () => {
  // fetch serves { status_code: 101, error: 'Object Not Found' }
  await expect(applyIssueToBook(c, book.id, 999999999, { manual: true })).rejects.toThrow()
  expect(getBook(c.db, book.id)!.comicvineId).toBeNull()
  expect(listManualEntries(c.db)).toEqual([])
})

test('an empty results array is treated as no such issue', async () => {
  // fetch serves { status_code: 1, results: [] }
  await expect(applyIssueToBook(c, book.id, 1, { manual: true })).rejects.toThrow()
  expect(getBook(c.db, book.id)!.comicvineId).toBeNull()
})

test.each([
  ['an http 500', async () => ({ ok: false, status: 500 })],
  ['no api key', null],
])('%s still binds the id and files the entry', async (_label, fetchImpl) => {
  const r = await applyIssueToBook(c, book.id, 1197227, { manual: true })
  expect(getBook(c.db, book.id)!.comicvineId).toBe(1197227)
  expect(r.metadataApplied).toBe(false)
  expect(listManualEntries(c.db)[0]).toMatchObject({ cvIssueId: 1197227, checkedAt: null })
})

test('a successful manual apply files the entry with what Comic Vine lacked', async () => {
  await applyIssueToBook(c, book.id, 1197227, { manual: true })   // THIN
  expect(listManualEntries(c.db)[0]!.missing).toEqual(
    expect.arrayContaining(['date', 'title', 'summary', 'credits', 'characters']))
})

test('a non-manual apply files no entry', async () => {
  await applyIssueToBook(c, book.id, 1159231)
  expect(listManualEntries(c.db)).toEqual([])
})

test('a refresh updates the check without re-stamping created_at', async () => {
  await applyIssueToBook(c, book.id, 1197227, { manual: true })
  const created = listManualEntries(c.db)[0]!.createdAt
  await applyIssueToBook(c, book.id, 1197227)          // no manual flag
  expect(listManualEntries(c.db)[0]).toMatchObject({ createdAt: created })
  expect(listManualEntries(c.db)[0]!.checkedAt).not.toBeNull()
})

test('a failing volume fetch still applies the issue and files the entry', async () => {
  // issue 200, volume 500
  await applyIssueToBook(c, book.id, 1159231, { manual: true })
  expect(getBook(c.db, book.id)).toMatchObject({ title: 'Death Spiral, Part 3 of 9' })
  expect(listManualEntries(c.db)).toHaveLength(1)
})
```

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

Wrap the `cv.getIssue` call. On a `CvApiError` with `cvStatus === 101`, or a success whose result has no `id`, rethrow — nothing is written. On any other failure, and only when `manual`, write `{ comicvineId }` via `updateBook`, `upsertManualEntry`, and return an `AppliedIssue` with `metadataApplied: false` and `changed: ['comicvineId']`. On success, `upsertManualEntry` first when `manual`, then `recordManualCheck` with the field names that failed the Task 4 emptiness test — the names from spec §5.3: `date`, `title`, `summary`, `credits`, `characters`, `cover`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/apply-issue.test.ts && npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/applyIssue.ts test/apply-issue.test.ts
git commit -m "feat: a hand-typed id binds even when Comic Vine cannot be read"
```

---

### Task 8: Routes and the API client

**Files:**
- Modify: `server/routes/comicvine.ts`, `src/api.ts`
- Test: `test/api-comicvine-manual.test.ts` (create)

**Interfaces:**
- Produces:
  - `POST /api/books/:id/comicvine` accepts `{ issueId, manual? }`
  - `GET /api/comicvine/manual-entries` → `{ entries: ManualEntry[] }`
  - `DELETE /api/comicvine/manual-entries/:bookId` → `{ removed: true }`
  - `api.applyIssue(id, issueId, manual?)`, `api.manualEntries()`, `api.removeManualEntry(bookId)`
  - `ApiManualEntry` in `src/api.ts`, mirroring `ManualEntry`; `BookResponse` gains `changed?: string[]`

- [ ] **Step 1: Write the failing test**

```ts
test('manual: true files an entry; a plain apply does not', async () => {
  await app.inject({ method: 'POST', url: `/api/books/${id}/comicvine`, payload: { issueId: 1197227, manual: true } })
  expect((await app.inject({ url: '/api/comicvine/manual-entries' })).json().entries).toHaveLength(1)
})

test('a 101 answers 404 rather than 500', async () => {
  const res = await app.inject({ method: 'POST', url: `/api/books/${id}/comicvine`, payload: { issueId: 9, manual: true } })
  expect(res.statusCode).toBe(404)
})

test('delete removes the row and leaves the book bound', async () => {
  await app.inject({ method: 'DELETE', url: `/api/comicvine/manual-entries/${id}` })
  expect(getBook(db, id)!.comicvineId).toBe(1197227)
})

test('a non-integer issueId is rejected', async () => {
  const res = await app.inject({ method: 'POST', url: `/api/books/${id}/comicvine`, payload: { issueId: 'abc' } })
  expect(res.statusCode).toBe(400)
})
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

The apply route passes `manual` through and maps a `CvApiError` with `cvStatus === 101` to 404 with `{ error: 'Comic Vine has no issue with that id.' }`. It validates `issueId` as a positive integer before calling the service. The two new routes wrap the Task 6 model directly.

- [ ] **Step 4: Run to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/comicvine.ts src/api.ts test/api-comicvine-manual.test.ts
git commit -m "feat: routes for manual Comic Vine entries"
```

---

### Task 9: The upload path files entries too

**Files:**
- Modify: `server/routes/upload.ts`, `server/services/storeComic.ts`
- Test: `test/upload.test.ts`

**Scope note:** the `src/pages/Upload.tsx` half of this change belongs to Task 10, which is
what creates the manual flag in the first place. This task builds and tests the server path
only; its tests post the multipart field directly.

**Interfaces:**
- Consumes: `applyIssueToBook`'s `opts` (Task 7).
- Produces: `storeComic` accepts `manual?: boolean` alongside `issueId` and forwards it.

`Upload.tsx` ships `issueId` as a multipart field to `/api/upload`, which reaches `applyIssueToBook` via `storeComic.ts:121` and never touches the apply route — so the flag needs plumbing the whole way.

- [ ] **Step 1: Write the failing test**

```ts
test('an id typed by hand during upload files a reminder', async () => {
  // multipart with issueId and manual: 'true'
  expect(listManualEntries(db)).toHaveLength(1)
})

test('an id chosen from search during upload files nothing', async () => {
  expect(listManualEntries(db)).toEqual([])
})
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

Read the `manual` form field in the upload route (`'true'` only), pass it into `storeComic`, and on to `applyIssueToBook`. The existing catch at `storeComic.ts:124` already binds `comicvineId` on a failed read; leave it as it is. `Upload.tsx` is not touched here — see the scope note.

- [ ] **Step 4: Run to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/upload.ts server/services/storeComic.ts src/pages/Upload.tsx test/
git commit -m "feat: a hand-typed id during upload files a reminder too"
```

---

### Task 10: The manual input in the match dialog

**Files:**
- Modify: `src/components/ComicVineMatchDialog.tsx`, `src/components/IssueEditPanel.tsx`, `src/pages/Upload.tsx`, `src/styles.css`
- Test: `test/ComicVineMatchDialog.test.tsx`

**Interfaces:**
- Consumes: `parseCvIssueId` (Task 1), `api.applyIssue(..., manual)` (Task 8).
- Produces: `onPick: (r: CvSearchResult, opts?: { manual?: boolean }) => void`

- [ ] **Step 1: Write the failing test**

```ts
test('a pasted issue url applies it as a manual pick', async () => {
  render(<ComicVineMatchDialog onPick={onPick} onClose={noop} />)
  await user.type(screen.getByLabelText(/comic vine id or link/i), 'https://comicvine.gamespot.com/x/4000-1197227/')
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ id: 1197227, name: 'Comic Vine #1197227' }), { manual: true })
})

test('a pasted volume url explains itself and applies nothing', async () => {
  await user.type(input, 'https://comicvine.gamespot.com/x/4050-177664/')
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onPick).not.toHaveBeenCalled()
  expect(screen.getByText(/that is a volume link/i)).toBeInTheDocument()
})

test('the manual input is usable when the search call threw', async () => {
  // api.cvSearch rejects
  expect(await screen.findByText('Search failed')).toBeInTheDocument()
  expect(screen.getByLabelText(/comic vine id or link/i)).toBeEnabled()
})
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

Add the labelled input, an **Apply** button and an error line below the search row. On submit, `parseCvIssueId`; on failure show `error`; on success call `onPick({ id, name: \`Comic Vine #${id}\` }, { manual: true })`. The synthesized `name` is what keeps `Upload.tsx`'s `matchLabel` from rendering a bare "✓". Thread the second argument through both call sites: `IssueEditPanel.tsx:113` → `apply.mutate({ issueId: r.id, manual })`, `Upload.tsx:259` → `choose(r, opts)` and `applyAfter.mutate({ issueId: r.id, manual })`.

**Carried from Task 9 (see its scope note):** `Upload.tsx` also holds the flag in component state beside `match`, and sets `form.set('manual', 'true')` beside the existing `form.set('issueId', …)` at line 123, so a hand-typed id on a *fresh* upload reaches the server path Task 9 built. Add a test that a manual pick before upload sends the field.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/ComicVineMatchDialog.test.tsx test/Upload.test.tsx && npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ComicVineMatchDialog.tsx src/components/IssueEditPanel.tsx src/pages/Upload.tsx src/styles.css test/
git commit -m "feat: type a Comic Vine id when search cannot find it"
```

---

### Task 11: Refresh from Comic Vine

**Files:**
- Modify: `src/components/IssueEditPanel.tsx`
- Test: `test/IssueEditPanel.test.tsx`

**Interfaces:**
- Consumes: `BookResponse.changed` (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
test('the button is absent on a book with no Comic Vine id', () => {
  expect(screen.queryByRole('button', { name: /refresh from comic vine/i })).toBeNull()
})

test('a refresh that changed nothing says so', async () => {
  // api.applyIssue resolves { changed: [] }
  expect(await screen.findByText(/comic vine had nothing new/i)).toBeInTheDocument()
})

test('a refresh names what changed', async () => {
  // resolves { changed: ['date', 'credits'] }
  expect(await screen.findByText(/date, credits/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

Render the button only when `book.comicvineId != null`; it calls `api.applyIssue(book.id, book.comicvineId)` with no `manual` flag, and reports from `changed`.

- [ ] **Step 4: Run to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/IssueEditPanel.tsx test/IssueEditPanel.test.tsx
git commit -m "feat: refresh a book from Comic Vine without searching"
```

---

### Task 12: The reminder list on Settings

**Files:**
- Modify: `src/pages/Settings.tsx`, `src/styles.css`
- Test: `test/Settings.test.tsx`

**Interfaces:**
- Consumes: `api.manualEntries()`, `api.removeManualEntry()` (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
test('the section is absent when nothing was entered by hand', async () => {
  expect(screen.queryByText(/entered by hand/i)).toBeNull()
})

test('a row names what Comic Vine still lacks', async () => {
  // entries: [{ ..., missing: ['date', 'title'], checkedAt: '2026-10-24T09:00:00Z' }]
  expect(await screen.findByText(/date, title/i)).toBeInTheDocument()
})

test('an unread entry says so rather than claiming completeness', async () => {
  // checkedAt: null, missing: []
  expect(await screen.findByText(/not yet read/i)).toBeInTheDocument()
})

test('a complete entry says so', async () => { /* checkedAt set, missing: [] */ })

test('a diverged id is flagged', async () => {
  // cvIssueId: 1197227, bookCvId: 999
  expect(await screen.findByText(/now linked to 999/i)).toBeInTheDocument()
})

test('refresh posts the book current id, not the typed one', async () => {
  await user.click(screen.getByRole('button', { name: /refresh/i }))
  expect(applyIssue).toHaveBeenCalledWith(expect.anything(), 999)
})

test('remove calls the delete route', async () => { /* … */ })
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

A subsection inside the existing Comic Vine `<section>`, below the key hint, rendering nothing when `entries.length === 0`. Each row: the comic linked to `/book/:id`, the id linked to `cvSiteUrl`, the missing summary per §6.1, both timestamps, Refresh and Remove. **Refresh posts `bookCvId`** (spec §5.5) — never `cvIssueId` — and both mutations invalidate the entries query.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/Settings.test.tsx && npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/Settings.tsx src/styles.css test/Settings.test.tsx
git commit -m "feat: list the comics linked to Comic Vine by hand"
```

---

### Task 13: Merge gate

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: all pass. Task 4 changed a service every existing match test walks — read the failures rather than assuming they are stale.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → clean.

- [ ] **Step 3: Rebuild the container**

Run: `docker compose up -d --build`

- [ ] **Step 4: Check it at http://localhost:8090**

Bind *Amazing Spider-Man: Halloween Special* #1 by pasting its url, confirm the Settings row names what Comic Vine still lacks, and confirm nothing on a comic that already had metadata was emptied.

- [ ] **Step 5: Stop.** The branch waits at :8090 for the user's verdict. A green suite is not permission to merge.
