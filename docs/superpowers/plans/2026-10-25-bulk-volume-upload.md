# Bulk volume upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Bulk add screen that takes a folder of comics, matches them against one or more Comic Vine volumes by series and issue number, shows every pairing for review, and uploads the batch with real metadata.

**Architecture:** Matching happens in the browser, from the `File` list and a volume's issue list served by a new read-only route. The server learns of a pairing only as `issueId` on the existing `POST /api/upload`, which already does the whole intake. Two server-side economies (caller-supplied name parts, a cached volume record) cut Comic Vine traffic from four requests per comic to roughly one.

**Tech Stack:** TypeScript, React 19 + react-router, @tanstack/react-query, Fastify 5, better-sqlite3, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-25-bulk-volume-upload-design.md`

## Global Constraints

- **Never write into `./data`.** Tests use `:memory:` databases and `zz-test/` path prefixes, as every existing suite here does.
- **While iterating:** run only the touched tests plus `npm run typecheck`. Full `npm test` once, at the end.
- Nothing under `src/` imports from `server/`. A shared rule is copied, with a comment pointing at its twin (`src/lib/annuals.ts:9-12` is the precedent).
- Comic Vine numbers are strings. Both sides of any number comparison go through the same normaliser.
- A Comic Vine failure costs metadata, never the comic.
- Issue identity is `comicvine_id`, never issue number.
- Commit per task. Squash-merge only, and only after the user has tested at `http://localhost:8090`.

## Review Focus

Five things the spec implies that no task's happy path exercises. Each has a test added to the task that owns the code.

1. **A file with no issue number at all** (`Avengers Omnibus.cbz`) must land unplaced, not throw and not match issue `null`. — Task 2
2. **A Comic Vine issue whose `number` is null** must never match anything, rather than matching a file whose number failed to parse. — Task 2
3. **A volume whose issue list comes back empty or unavailable** must render the group with every file unplaced, not a blank screen. — Task 6, Task 8
4. **Two picked files with the identical name** (same issue from two folders) must both go unplaced per §4.4, and the table must still key its rows uniquely. — Task 2
5. **An uppercase extension** (`.CBR`, `.CBZ`) must be accepted as a comic, not swept into "ignored". — Task 2

---

### Task 1: The shared file-name parser

**Files:**
- Create: `src/lib/comicFileParse.ts`
- Modify: `src/lib/cvQuery.ts` (rebuild on the parser; public API unchanged)
- Test: `test/comic-file-parse.test.ts`

**Interfaces:**
- Produces:
  - `parseComicFileName(fileName: string): { series: string; number: string | null }`
  - `normalizeIssueNumber(raw: string | null | undefined): string | null` — trims, drops leading zeros, keeps a dotted suffix, lowercases it. `null` for blank.
  - `seriesKey(title: string): string` — the `matchKey` rule, copied.
  - `baseIssueNumber(n: string): string | null` — the part before the dot, or `null` when there is no dotted suffix.

- [ ] **Step 1: Write the failing tests**

```ts
test('the real folder: tags stripped, padding dropped', () => {
  expect(parseComicFileName('Avengers 020 (2013) (Digital) (Zone-Empire).cbr'))
    .toEqual({ series: 'Avengers', number: '20' })
})
test('a dotted suffix survives the parse', () => {
  expect(parseComicFileName('Avengers 024.NOW (2014) (Digital) (Zone-Empire).cbr'))
    .toEqual({ series: 'Avengers', number: '24.now' })
})
test('no number at all', () => {
  expect(parseComicFileName('Avengers Omnibus.cbz'))
    .toEqual({ series: 'Avengers Omnibus', number: null })
})
test('bracketed tags come off too', () => {
  expect(parseComicFileName('Avengers 020 [Digital].cbz').number).toBe('20')
})
test('seriesKey folds punctuation and a leading "the"', () => {
  expect(seriesKey('The Uncanny X-Men')).toBe(seriesKey('Uncanny X-Men'))
  expect(seriesKey('Avengers: Armageddon')).toBe(seriesKey('Avengers – Armageddon'))
})
test('seriesKey keeps a hyphen inside a word', () => {
  expect(seriesKey('Spider-Man')).not.toBe(seriesKey('Spider Man'))
})
test('baseIssueNumber', () => {
  expect(baseIssueNumber('24.now')).toBe('24')
  expect(baseIssueNumber('24')).toBe(null)
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/comic-file-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/comicFileParse.ts`**

Move `RELEASE_TAG_RE`, `TRAILING_NUMBER_RE`, `PADDED_NUMBER_RE`, `fileStem` and `normalizeNumber` out of `src/lib/cvQuery.ts` and build the four exports on them. `seriesKey` is `matchKey` from `server/lib/issueMatch.ts:52` copied verbatim, with a comment naming its twin and why it is a copy.

`normalizeIssueNumber` lowercases — `24.NOW` and `24.now` are one number — which `cvQuery`'s `normalizeNumber` did not. Keep `cvQuery`'s own casing behaviour unchanged by having it use `parseComicFileName` for the stem and number *shape* only, and its existing display casing for the query string.

- [ ] **Step 4: Rebuild `cvQuery.ts` on it, and prove nothing moved**

Run: `npx vitest run test/comic-file-parse.test.ts test/cvQuery.test.ts && npm run typecheck`
Expected: PASS, with every pre-existing `cvQuery` assertion untouched.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comicFileParse.ts src/lib/cvQuery.ts test/comic-file-parse.test.ts
git commit -m "refactor: one parser for the number in a comic's file name"
```

---

### Task 2: The matcher

**Files:**
- Create: `src/lib/bulkMatch.ts`
- Test: `test/bulk-match.test.ts`

**Interfaces:**
- Consumes: Task 1's four exports.
- Produces:

```ts
export type BulkRowState = 'matched' | 'owned-here' | 'owned-elsewhere' | 'unplaced' | 'ignored'

export interface BulkIssue {
  id: number; number: string | null; name?: string | null; coverDate?: string | null
  owned?: boolean; bookId?: number
  ownedIn?: { editionId: number; editionName: string }
}
export interface BulkVolume {
  volumeId: number; name: string; startYear: number | null
  editionId: number | null; editionName: string | null
  issues: BulkIssue[]
}
export interface BulkRow {
  key: string          // unique per picked file, even when two share a name
  fileName: string
  state: BulkRowState
  volumeId: number | null
  issue: BulkIssue | null
  replace: boolean     // ticked by default only for 'owned-elsewhere'
}

/** Is this file a comic at all? Case-insensitive. */
export function isComicFile(fileName: string): boolean

/**
 * Claim unplaced rows for `volume`. Rows already carrying a volumeId are returned
 * untouched — a later search can never steal an earlier match.
 */
export function claimForVolume(rows: BulkRow[], volume: BulkVolume): BulkRow[]
```

- [ ] **Step 1: Write the failing tests**

```ts
test('series must agree: Avengers (2013) does not claim Avengers World 001', () => {
  // the regression this rule exists for — that volume really does have a #1
})
test('The Uncanny X-Men claims a file called Uncanny X-Men 001')
test('exact number wins: 16.1 matches 16.1 and does not collapse to 16')
test('024.NOW falls back to the base number and matches #24')
test('the base-number fallback refuses when another file matched #24 exactly')
test('two files resolving to one issue leave both unplaced')
test('a file with no number is unplaced, not matched to a null-numbered issue')
test('an issue whose number is null matches nothing')
test('an owned issue in this volume\'s edition is owned-here, replace off')
test('an owned issue in another edition is owned-elsewhere, replace ON')
test('a second claimForVolume cannot steal a row the first matched')
test('isComicFile accepts .CBR and .CBZ in any case, rejects .txt')
test('two picked files with the identical name get distinct keys')
```

Assert on `state`, `issue?.id` and `replace`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/bulk-match.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/bulkMatch.ts`**

`claimForVolume` runs in one pass over the unplaced rows:

1. Drop rows whose `seriesKey(parsed.series)` ≠ `seriesKey(volume.name)`.
2. Build `byNumber: Map<string, BulkIssue[]>` from the volume's issues, keyed by `normalizeIssueNumber(issue.number)`, skipping null numbers.
3. **Exact pass** over the surviving rows; a number matching exactly one issue claims it.
4. **Fallback pass** over rows still unplaced whose number has a `baseIssueNumber`: claim only when that base maps to exactly one issue *and* no row claimed that issue in pass 3.
5. **Conflict sweep:** any issue claimed by more than one row releases all of them back to `unplaced`.
6. State per claimed row from `issue.owned` / `issue.ownedIn` vs `volume.editionId`.

`key` is assigned when the rows are built from the picked files, not here: index plus name, so two identical names stay distinct.

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run test/bulk-match.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkMatch.ts test/bulk-match.test.ts
git commit -m "feat: match a folder of comics against a Comic Vine volume"
```

---

### Task 3: Cache the volume record

**Files:**
- Modify: `server/db.ts` (new `cv_volume` table in `MIGRATION`)
- Create: `server/models/volumeRecord.ts`
- Test: `test/models-volume-record.test.ts`

**Interfaces:**
- Produces:
  - `cacheVolumeRecord(db: Db, volumeId: number, volume: CvVolume, now?: string): void`
  - `getCachedVolumeRecord(db: Db, volumeId: number, maxAgeMs?: number, now?: Date): CvVolume | undefined`
  - `getVolumeCached(db: Db, cv: ComicVine, volumeId: number): Promise<CvVolume | undefined>` — cache, else fetch and cache; `undefined` when Comic Vine will not answer and nothing is held.
  - `VOLUME_RECORD_CACHE_MAX_AGE_MS` — one day, matching `volumeIssues.ts`.

Table, beside `volume_cache` and for the same reason it is separate:

```sql
CREATE TABLE IF NOT EXISTS cv_volume (
  volume_id   INTEGER PRIMARY KEY,
  name        TEXT,
  publisher   TEXT,
  summary     TEXT,
  start_year  INTEGER,
  site_url    TEXT,
  fetched_at  TEXT NOT NULL
);
```

- [ ] **Step 1: Write the failing tests**

```ts
test('a cached record comes back whole')
test('a record past its max age does not')
test('Infinity reads at any age')
test('getVolumeCached makes one fetch for two calls with the same id')
test('getVolumeCached returns a stale record when Comic Vine throws')
test('getVolumeCached returns undefined when Comic Vine throws and nothing is held')
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run test/models-volume-record.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the table and write the model**

`getCachedVolumeRecord` mirrors `getCachedVolumeIssues` (`server/models/volumeIssues.ts:70`) — same age check, same `undefined` for never-asked. Omit null columns from the returned object the way that file does, so an absent `startYear` stays absent rather than becoming `null`.

- [ ] **Step 4: Run and watch pass**

Run: `npx vitest run test/models-volume-record.test.ts test/db.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/models/volumeRecord.ts test/models-volume-record.test.ts
git commit -m "feat: cache the Comic Vine volume record for a day"
```

---

### Task 4: Stop paying four Comic Vine calls per comic

**Files:**
- Modify: `server/services/storeComic.ts`, `server/services/applyIssue.ts`, `server/routes/upload.ts`, `src/lib/uploadComic.ts`
- Test: `test/store-comic-name-parts.test.ts`

**Interfaces:**
- Consumes: Task 3's `getVolumeCached`.
- Produces:
  - `StoreComicInput` gains `volumeName?: string` and `issueNumber?: string`.
  - `StoreComicResult`'s success arm gains `wantedName?: string` — the name `comicFileName` asked for, before `dedupeDestPath` may have changed it. Task 5 needs this.
  - `UploadComicInput` gains `volumeName?: string`, `issueNumber?: string`.

- [ ] **Step 1: Write the failing tests**

```ts
test('with volumeName and issueNumber, storing makes no Comic Vine call for the name')
test('the file name produced is identical to the one the lookup would have produced')
test('without them, the lookup still runs — the existing path is unchanged')
test('a client-supplied volume name cannot escape the edition folder')
  // volumeName: '../../etc', assert the stored path stays inside the edition dir
test('wantedName reports the pre-dedupe name when the destination was taken')
```

Stub `globalThis.fetch` and count calls, as `test/api-comicvine-manual.test.ts:27` does.

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run test/store-comic-name-parts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `storeComic`, when both `volumeName` and `issueNumber` are present, build `finalName` from them directly and skip the `getIssue`/`getVolume` block entirely. `comicFileName` already runs its series through `slug()` (`server/lib/comicFileName.ts:33,56`) — that is the guard against a hostile `volumeName`, and nothing may bypass it. Return `wantedName` alongside the book.

In `applyIssue.ts`, replace the bare `cv.getVolume(meta.volumeId)` at line 154 with `getVolumeCached(db, cv, meta.volumeId)`. Its surrounding best-effort `try/catch` and the "fetch before the transaction" rule both stand.

Thread the two fields through `uploadComic` and the multipart loop in `routes/upload.ts` beside `edition` and `issueId`.

- [ ] **Step 4: Run and watch pass**

Run: `npx vitest run test/store-comic-name-parts.test.ts test/upload.test.ts test/uploadComic.test.ts test/apply-issue.test.ts test/store-comic-concurrent.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/storeComic.ts server/services/applyIssue.ts server/routes/upload.ts src/lib/uploadComic.ts test/store-comic-name-parts.test.ts
git commit -m "perf: one Comic Vine call per uploaded comic, not four"
```

---

### Task 5: Replace deletes the comic it replaces

**Files:**
- Modify: `server/routes/upload.ts`, `src/lib/uploadComic.ts`
- Test: `test/upload-replace.test.ts`

**Interfaces:**
- Consumes: Task 4's `wantedName`.
- Produces: `POST /api/upload` accepts `replaceBookId`; the response gains `replaced?: { bookId: number; editionRemoved: boolean }`. `UploadComicInput` gains `replaceBookId?: number`.

- [ ] **Step 1: Write the failing tests**

```ts
test('the old file, thumbnail and row are gone and the new comic is in its place')
test('the new file lands under a deduped name BEFORE the old one is deleted')
test('storeComic failing leaves the old book and its file untouched')   // the important one
test('a rename that fails after the delete still leaves the new comic reachable')
test('replaceBookId naming a book that does not exist still stores the upload')
test('replacing the last issue of an edition prunes that edition')
test('replaceBookId that is not a positive integer is a 400')
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run test/upload-replace.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the §7 sequence in the route**

Only after `storeComic` returns `ok: true`:

1. `removeBook({db, config}, replaceBookId)` — the existing service, unchanged.
2. If the stored file's basename ≠ `wantedName`, rename it to `wantedName` in the same directory and `updateBook` the path. Wrapped in `renameLock`, and best-effort: a failure is logged and the comic keeps its deduped name.

Validate `replaceBookId` with the digits-only rule at `server/routes/comicvine.ts:60`. A `replaceBookId` for a book that does not exist is ignored, not an error — two tabs are enough to produce that race, which is how `dismissFollowup` already reasons.

- [ ] **Step 4: Run and watch pass**

Run: `npx vitest run test/upload-replace.test.ts test/upload.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/upload.ts src/lib/uploadComic.ts test/upload-replace.test.ts
git commit -m "feat: replacing a comic on upload deletes the one it replaces"
```

---

### Task 6: A volume's issue list, keyed by volume

**Files:**
- Modify: `server/routes/comicvine.ts`, `src/api.ts`
- Test: `test/routes-comicvine-volume-issues.test.ts`

**Interfaces:**
- Consumes: Task 3's `getVolumeCached`.
- Produces: `GET /api/comicvine/volumes/:volumeId/issues` →

```ts
{ volumeId: number
  volume: { name: string | null; startYear: number | null } | null
  edition: { id: number; name: string } | null
  editionName: string            // what a batch of this volume should file into
  issues: Array<{ id: number; number: string | null; name?: string; coverDate?: string
                  siteUrl?: string; owned: boolean; bookId?: number
                  ownedIn?: { editionId: number; editionName: string } }>
  fetchedAt: string | null; stale?: true; unavailable?: true }
```

- [ ] **Step 1: Write the failing tests**

```ts
test('a fresh list is served from Comic Vine and cached')
test('a cached list is served without a Comic Vine call')
test('a stale list is served with stale:true when Comic Vine throws')
test('unavailable:true when Comic Vine throws and nothing is held')
test('owned is resolved across the whole library, not one edition')
test('ownedIn names the edition the copy actually lives in')
test('editionName reuses an existing edition for this volume, under its own name')
test('editionName composes "name (year)" when no edition exists')
test('editionName is the bare name when startYear is 0')   // the Halloween Special shape
test('an empty issue list is a 200 with issues: [], not an error')
test('no Comic Vine key is a 400')
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run test/routes-comicvine-volume-issues.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

Model the cache handling on `GET /api/editions/:id/issues` (`server/routes/editions.ts:296-378`) — same `getCachedVolumeIssues` / `cacheVolumeIssues` / stale-beats-nothing shape. It does **not** compute `match`.

`owned` comes from one query over every book with a `comicvine_id`, joined to its edition for `ownedIn`. `editionName` follows §7: `getEditionByComicvineId(db, volumeId)?.name`, else `` `${name} (${startYear})` ``, else the bare `name` when `startYear` is absent, zero or not an integer.

Add `api.getVolumeIssues(volumeId)` to `src/api.ts` beside the existing volume calls.

- [ ] **Step 4: Run and watch pass**

Run: `npx vitest run test/routes-comicvine-volume-issues.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/comicvine.ts src/api.ts test/routes-comicvine-volume-issues.test.ts
git commit -m "feat: serve a Comic Vine volume's issue list by volume id"
```

---

### Task 7: A comic with no Comic Vine id is a follow-up

**Files:**
- Modify: `server/models/metadataFollowups.ts`, `src/pages/MetadataFollowups.tsx`
- Test: `test/metadata-followups.test.ts` (extend), `test/MetadataFollowups.test.tsx` (extend)

**Interfaces:**
- Produces: `missingMetadata` takes one more field, `comicvineId: number | null`, and reports `'comic vine id'` first when it is null.

- [ ] **Step 1: Write the failing tests**

```ts
test('a book with no Comic Vine id is on the list even with date, summary and credits')
  // the §5.5 regression: a scene release ships a full ComicInfo.xml
test('"comic vine id" is reported first among the reasons')
test('a book with an id and full metadata is still off the list')
test('the page renders the new reason')
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run test/metadata-followups.test.ts test/MetadataFollowups.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the arm to `missingMetadata` and pass `r.comicvine_id` at the call site in `listMetadataFollowups` — the column is already selected (`server/models/metadataFollowups.ts:106`). Extend that function's doc comment to say why an absent id counts, and why the blast radius is zero today: 0 of 219 books in the live library lack one.

- [ ] **Step 4: Run and watch pass**

Run: `npx vitest run test/metadata-followups.test.ts test/MetadataFollowups.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/models/metadataFollowups.ts src/pages/MetadataFollowups.tsx test/metadata-followups.test.ts test/MetadataFollowups.test.tsx
git commit -m "feat: a comic with no Comic Vine id belongs on the follow-up list"
```

---

### Task 8: The Bulk add screen

**Files:**
- Create: `src/pages/BulkUpload.tsx`, `src/components/BulkVolumeGroup.tsx`, `src/components/BulkIssuePicker.tsx`
- Modify: `src/App.tsx` (route `/upload/bulk`), `src/pages/Upload.tsx` (a link across), `src/styles.css`
- Test: `test/BulkUpload.test.tsx`, `test/BulkVolumeGroup.test.tsx`

**Interfaces:**
- Consumes: Task 2's `claimForVolume` / `isComicFile` / `BulkRow`; Task 6's `api.getVolumeIssues`; `api.cvVolumes(series)` (existing); Task 4 and 5's `uploadComic` fields.

- [ ] **Step 1: Write the failing tests**

```ts
test('picking files lists them, and a .txt is ignored rather than shown as a problem')
test('searching a volume and choosing it groups the files it claims under it')
test('a second volume search is offered only the unplaced files')
test('the group header names the edition the batch will file into')
test('an unplaced row offers only that volume\'s unclaimed issues')
test('owned-here defaults to skip; owned-elsewhere defaults to replace')
test('the button counts: "Upload 41 comics · 3 will replace and delete · 1 skipped"')
test('the button is disabled with nothing to upload')
test('a batch over 150 files warns about the Comic Vine budget but does not block')
test('an unavailable issue list renders the group with every file unplaced')
test('uploading sends edition, issueId, volumeName, issueNumber per row')
test('a row that replaces sends replaceBookId')
test('a failed row marks itself and the batch carries on')
test('a row answering metadataApplied:false reads as landed-without-metadata, not success')
test('the summary names what landed, skipped, replaced, failed and arrived bare')
```

Mock `api` and `uploadComic` as the existing page suites do (`test/Upload.test.tsx`).

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run test/BulkUpload.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the page**

`<input type="file" multiple webkitdirectory>` plus a plain `multiple` input, so a folder or a selection both work. Rows are built once from the picked files (`key` = index + name) and held in state; each volume search calls `claimForVolume` and replaces the row list.

Uploads run **sequentially** in table order. `beforeunload` is armed while a batch is running, and the page says the tab has to stay open. Invalidate `['editions']`, `['series']`, `['edition']`, `['edition-issues']` at the end of the batch — the set `IssueUploadAction` already invalidates — rather than per file.

- [ ] **Step 4: Run and watch pass**

Run: `npx vitest run test/BulkUpload.test.tsx test/BulkVolumeGroup.test.tsx test/Upload.test.tsx test/App.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/BulkUpload.tsx src/components/BulkVolumeGroup.tsx src/components/BulkIssuePicker.tsx src/App.tsx src/pages/Upload.tsx src/styles.css test/BulkUpload.test.tsx test/BulkVolumeGroup.test.tsx
git commit -m "feat: add a whole volume of comics in one pass"
```

---

### Task 9: Prove the branch and hand it over

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS, every test. Read the output; a partial run is not a result.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Rebuild the container**

Run: `docker compose up -d --build`
Expected: the app answers at `http://localhost:8090`.

- [ ] **Step 4: Hand over, do not merge**

The branch waits at `:8090` for the user's verdict. A green suite is not permission to merge.
