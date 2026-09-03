# Comic Vine Naming and Nested Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Comic Vine the source of truth for edition names, and store the library as `<series>/<volume>/` instead of one flat folder level.

**Architecture:** Comic Vine's volume name and start year are captured on the call that already runs during an issue match, stored on the edition, and offered on the edition page as a suggested rename the user clicks to accept. `edition.folder` widens from a single segment to a `series/volume` relative path; `book.file_path` is already relative to `comicsDir`, so consumers need no change. An explicit, dry-runnable migration moves the existing library into the new shape.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-comic-vine-naming-and-nested-storage-design.md`

## Global Constraints

- TypeScript throughout; ESM imports carry the `.js` extension (`../models/editions.js`).
- TDD: every task writes a failing test, watches it fail, then implements. No production code without a failing test first.
- Run a single test file with `npx vitest run test/<file>`; the whole suite with `npx vitest run`.
- Schema changes are additive `ALTER TABLE ... ADD COLUMN` guarded by `columnsOf(db, table).includes(...)`, following `server/db.ts:135-146`. Never edit the `SCHEMA` constant for an existing table.
- Never change `edition.name` through `updateEdition`; name changes go through `renameEdition` in `server/services/library.ts`, which moves files. The warning at `server/models/editions.ts:139-142` explains why.
- Comic Vine's exact name is what gets stored and displayed. Only sort keys strip leading articles.
- `docker compose up -d --build` after the work is complete — part of finishing, not an afterthought.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `server/lib/comicvine.ts` | Map `start_year` onto `CvVolume` | 1 |
| `server/db.ts` | Two additive edition columns | 2 |
| `server/types.ts` | `Edition.cvName`, `Edition.cvStartYear` | 2 |
| `server/models/editions.ts` | Column mapping; `upsertEdition` accepts a series name | 2, 7 |
| `server/routes/comicvine.ts` | Persist volume name/year/id on match | 3 |
| `server/routes/editions.ts` | Backfill endpoint | 4 |
| `server/lib/paths.ts` | `editionFolderPath` — the nesting rule, one place | 5 |
| `server/services/library.ts` | Moves honour the edition's folder; prune the series dir; reorganize | 6, 8, 10 |
| `server/services/indexer.ts` | Scan a nested tree | 7 |
| `server/models/series.ts` | Article-insensitive sort | 9 |
| `server/routes/library.ts` | **New** — `POST /api/library/reorganize` | 10 |
| `src/api.ts`, `src/pages/Edition.tsx` | Suggestion banner and its actions | 11 |

Tasks 1-4 (Comic Vine data) and 5-9 (storage) are independent of each other; 10 depends on 5, and 11 depends on 2 and 4.

---

### Task 1: Comic Vine volume start year

**Files:**
- Modify: `server/lib/comicvine.ts:141-145` (`CvVolume`), and the `getVolume` method
- Test: `test/comicvine.test.ts`

**Interfaces:**
- Produces: `CvVolume { name?: string; publisher?: string; summary?: string; startYear?: number }`

- [ ] **Step 1: Write the failing test**

Add to `test/comicvine.test.ts`:

```typescript
test('getVolume reads the start year the volume record carries', async () => {
  const impl = async () => ({
    ok: true,
    json: async () => ({ results: { name: 'The Amazing Spider-Man', start_year: '2025', publisher: { name: 'Marvel' } } }),
  })
  const cv = createComicVine({ apiKey: 'k', fetchImpl: impl as never, now: () => 0 })
  const volume = await cv.getVolume(163325)
  expect(volume).toMatchObject({ name: 'The Amazing Spider-Man', publisher: 'Marvel', startYear: 2025 })
})

test('a volume with no start year has no year rather than NaN', async () => {
  const impl = async () => ({ ok: true, json: async () => ({ results: { name: 'Untitled' } }) })
  const cv = createComicVine({ apiKey: 'k', fetchImpl: impl as never, now: () => 0 })
  expect((await cv.getVolume(1)).startYear).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/comicvine.test.ts`
Expected: FAIL — `startYear` is `undefined` in the first test.

- [ ] **Step 3: Write minimal implementation**

Widen the interface at `server/lib/comicvine.ts:141`:

```typescript
export interface CvVolume {
  name?: string
  publisher?: string
  summary?: string
  startYear?: number
}
```

And in `getVolume`:

```typescript
    async getVolume(id) {
      const data = await get(`/volume/${TYPE_PREFIX.volume}-${id}/`, {})
      const r = (data.results || {}) as CvResult
      const started = Number(r.start_year)
      return {
        name: r.name,
        publisher: r.publisher?.name,
        summary: stripHtml(r.description),
        startYear: Number.isInteger(started) ? started : undefined,
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/comicvine.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add server/lib/comicvine.ts test/comicvine.test.ts
git commit -m "feat: read the start year from a Comic Vine volume"
```

---

### Task 2: Edition columns for the Comic Vine volume

**Files:**
- Modify: `server/db.ts` (after the `series_name` migration at line 137-140)
- Modify: `server/types.ts:10-21` (`Edition`)
- Modify: `server/models/editions.ts` (`EditionRow`, `toEdition`, `EDITION_FIELDS`)
- Test: `test/models.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Edition.cvName: string | null`, `Edition.cvStartYear: number | null`; both writable through `updateEdition(db, id, { cvName, cvStartYear })`.

- [ ] **Step 1: Write the failing test**

Add to `test/models.test.ts`:

```typescript
test('an edition stores the Comic Vine volume name and start year', () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Vol 7', folder: 'Vol 7' })
  updateEdition(db, edition.id, { cvName: 'The Amazing Spider-Man', cvStartYear: 2025 })
  expect(getEdition(db, edition.id)).toMatchObject({
    cvName: 'The Amazing Spider-Man',
    cvStartYear: 2025,
  })
  db.close()
})

test('an edition with no Comic Vine volume reports nulls, not undefined', () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Unsorted', folder: 'Unsorted' })
  expect(getEdition(db, edition.id)).toMatchObject({ cvName: null, cvStartYear: null })
  db.close()
})
```

Ensure `updateEdition` is in the file's imports from `../server/models/editions.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/models.test.ts`
Expected: FAIL — no such column `cv_name`.

- [ ] **Step 3: Write minimal implementation**

In `server/db.ts`, directly after the `series_name` block:

```typescript
  // The Comic Vine volume an edition belongs to: its canonical name and the year the
  // run started. Together they are the name this edition should carry.
  const editionCols = columnsOf(db, 'edition')
  if (!editionCols.includes('cv_name')) db.exec('ALTER TABLE edition ADD COLUMN cv_name TEXT')
  if (!editionCols.includes('cv_start_year')) db.exec('ALTER TABLE edition ADD COLUMN cv_start_year INTEGER')
```

In `server/types.ts`, add to `Edition` after `seriesName`:

```typescript
  /** Comic Vine's own name for this volume, and the year its run started. */
  cvName: string | null
  cvStartYear: number | null
```

In `server/models/editions.ts`, add to `EditionRow`:

```typescript
  cv_name: string | null
  cv_start_year: number | null
```

to `toEdition`'s returned object:

```typescript
    cvName: row.cv_name ?? null, cvStartYear: row.cv_start_year ?? null,
```

and to `EDITION_FIELDS`:

```typescript
const EDITION_FIELDS: Record<string, string> = { publisher: 'publisher', summary: 'summary', comicvineId: 'comicvine_id', name: 'name', seriesName: 'series_name', cvName: 'cv_name', cvStartYear: 'cv_start_year' }

export type EditionUpdate = Partial<Pick<Edition, 'publisher' | 'summary' | 'comicvineId' | 'name' | 'seriesName' | 'cvName' | 'cvStartYear'>>
```

Adding them to `EDITION_FIELDS` also means `carryableMetadata` carries them across a rename automatically — which is the behaviour we want, and the reason that helper derives from the field list rather than a hand-written one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/models.test.ts test/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/types.ts server/models/editions.ts test/models.test.ts
git commit -m "feat: record the Comic Vine volume on an edition"
```

---

### Task 3: Persist the volume when a book is matched

**Files:**
- Modify: `server/routes/comicvine.ts:28-56` (the `POST /api/books/:id/comicvine` handler)
- Test: `test/routes-comicvine-volume.test.ts` (create)

**Interfaces:**
- Consumes: `CvVolume.startYear` (Task 1); `updateEdition(db, id, { cvName, cvStartYear, comicvineId })` (Task 2).
- Produces: after a match, the book's edition carries `cvName`, `cvStartYear`, and `comicvineId` set to the volume id when it was previously null.

- [ ] **Step 1: Write the failing test**

Create `test/routes-comicvine-volume.test.ts`:

```typescript
import { test, expect } from 'vitest'
import Fastify from 'fastify'
import comicvineRoutes from '../server/routes/comicvine.js'
import { openDb } from '../server/db.js'
import { upsertEdition, getEdition } from '../server/models/editions.js'
import { insertBook } from '../server/models/books.js'
import type { Config } from '../server/config.js'

const ISSUE = {
  name: 'Death to the Tyrant',
  issue_number: '1',
  cover_date: '2025-06-01',
  description: null,
  volume: { id: 163325, name: 'The Amazing Spider-Man' },
}
const VOLUME = { name: 'The Amazing Spider-Man', start_year: '2025', publisher: { name: 'Marvel' } }

function app(db: ReturnType<typeof openDb>) {
  const fetchImpl = async (url: string) => {
    if (url.includes('/volume/')) return { ok: true, json: async () => ({ results: VOLUME }) }
    return { ok: true, json: async () => ({ results: ISSUE }) }
  }
  const server = Fastify()
  server.decorate('db', db)
  server.decorate('config', { comicVineApiKey: 'k' } as Config)
  // The route builds its own client from app.config; inject the stub through global fetch.
  globalThis.fetch = fetchImpl as never
  return server
}

test('matching a book records the Comic Vine volume on its edition', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Vol 7', folder: 'Vol 7' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 20, fileSize: 100 })!
  const server = app(db)
  await server.register(comicvineRoutes)

  const res = await server.inject({ method: 'POST', url: `/api/books/${book.id}/comicvine`, payload: { issueId: 1102459 } })
  expect(res.statusCode).toBe(200)

  expect(getEdition(db, edition.id)).toMatchObject({
    cvName: 'The Amazing Spider-Man',
    cvStartYear: 2025,
    comicvineId: 163325,
  })
  await server.close()
  db.close()
})

test('an edition already linked to a volume keeps its own comicvineId', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Vol 7', folder: 'Vol 7' })
  const { updateEdition } = await import('../server/models/editions.js')
  updateEdition(db, edition.id, { comicvineId: 999 })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 20, fileSize: 100 })!
  const server = app(db)
  await server.register(comicvineRoutes)

  await server.inject({ method: 'POST', url: `/api/books/${book.id}/comicvine`, payload: { issueId: 1102459 } })

  expect(getEdition(db, edition.id)).toMatchObject({ comicvineId: 999, cvStartYear: 2025 })
  await server.close()
  db.close()
})
```

If `insertBook`'s required fields differ, copy the call shape used in `test/routes-arcs.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes-comicvine-volume.test.ts`
Expected: FAIL — `cvName` is null.

- [ ] **Step 3: Write minimal implementation**

In `server/routes/comicvine.ts`, the block that currently fetches the volume for its publisher keeps the whole volume instead of just the publisher name:

```typescript
    // Best-effort: fetch the volume BEFORE opening the transaction
    // (better-sqlite3 transactions must be synchronous; no async calls inside)
    let volume: CvVolume | undefined
    try {
      if (meta.volumeId) volume = await cv.getVolume(meta.volumeId)
    } catch { /* best-effort; don't fail the match */ }
    const publisher = volume?.publisher
```

and inside the transaction, where the edition is updated:

```typescript
      // Propagate the volume to the edition: publisher and Comic Vine identity if it
      // has none, and the volume's own name/year, which is what the edition should be
      // called. The name is offered as a suggestion, never applied here.
      if (book.editionId && (publisher || volume)) {
        const edition = getEdition(app.db, book.editionId)
        if (edition) {
          const patch: EditionUpdate = {}
          if (publisher && !edition.publisher) patch.publisher = publisher
          if (volume?.name) patch.cvName = volume.name
          if (volume?.startYear !== undefined) patch.cvStartYear = volume.startYear
          if (meta.volumeId && !edition.comicvineId) patch.comicvineId = Number(meta.volumeId)
          if (Object.keys(patch).length > 0) updateEdition(app.db, book.editionId, patch)
        }
      }
```

Import `CvVolume` from `../lib/comicvine.js` and `EditionUpdate`/`updateEdition` from `../models/editions.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes-comicvine-volume.test.ts test/comicvine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/comicvine.ts test/routes-comicvine-volume.test.ts
git commit -m "feat: record the volume name and year when a book is matched"
```

---

### Task 4: Backfill the volume for already-matched editions

**Files:**
- Modify: `server/routes/editions.ts` (add one route)
- Test: `test/routes-editions-volume.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `POST /api/editions/:id/comicvine-volume` → `{ edition }` on success, or `{ matched: false }` with status 200 when no book in the edition has a `comicvineId`.

- [ ] **Step 1: Write the failing test**

Create `test/routes-editions-volume.test.ts`:

```typescript
import { test, expect } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { openDb } from '../server/db.js'
import { upsertEdition, getEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import type { Config } from '../server/config.js'

const VOLUME = { name: 'The Amazing Spider-Man', start_year: '2025', publisher: { name: 'Marvel' } }
const ISSUE = { name: 'x', issue_number: '1', volume: { id: 163325, name: 'The Amazing Spider-Man' } }

function server(db: ReturnType<typeof openDb>, comicsDir: string) {
  globalThis.fetch = (async (url: string) =>
    url.includes('/volume/')
      ? { ok: true, json: async () => ({ results: VOLUME }) }
      : { ok: true, json: async () => ({ results: ISSUE }) }) as never
  const app = Fastify()
  app.decorate('db', db)
  app.decorate('config', { comicsDir, comicVineApiKey: 'k' } as Config)
  return app
}

test('an edition resolves its volume from a book that is already matched', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Vol 7', folder: 'Vol 7' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 1 })!
  updateBook(db, book.id, { comicvineId: 1102459 })
  const app = server(db, '/tmp/comics')
  await app.register(editionRoutes)

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/comicvine-volume` })

  expect(res.statusCode).toBe(200)
  expect(getEdition(db, edition.id)).toMatchObject({ cvName: 'The Amazing Spider-Man', cvStartYear: 2025 })
  await app.close()
  db.close()
})

test('an edition with nothing matched yet reports that, rather than failing', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Unsorted', folder: 'Unsorted' })
  insertBook(db, { editionId: edition.id, filePath: 'Unsorted/loose.cbz', pageCount: 1, fileSize: 1 })
  const app = server(db, '/tmp/comics')
  await app.register(editionRoutes)

  const res = await app.inject({ method: 'POST', url: `/api/editions/${edition.id}/comicvine-volume` })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ matched: false })
  expect(getEdition(db, edition.id)).toMatchObject({ cvName: null })
  await app.close()
  db.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes-editions-volume.test.ts`
Expected: FAIL — 404, route not registered.

- [ ] **Step 3: Write minimal implementation**

In `server/routes/editions.ts`, add after the PATCH handler:

```typescript
  // An edition whose books were matched before the volume was recorded has no
  // suggestion to show. Walk to the first matched book and resolve its volume once.
  app.post<{ Params: IdParams }>('/api/editions/:id/comicvine-volume', async (req, reply) => {
    const edition = getEdition(app.db, Number(req.params.id))
    if (!edition) return reply.code(404).send({ error: 'edition not found' })

    const matched = listBooksByEdition(app.db, edition.id).find((b) => b.comicvineId)
    if (!matched) return { matched: false }

    const cv = createComicVine({ apiKey: app.config.comicVineApiKey })
    const issue = await cv.getIssue(matched.comicvineId as number)
    if (!issue.volumeId) return { matched: false }
    const volume = await cv.getVolume(issue.volumeId)

    const patch: EditionUpdate = { cvName: volume.name ?? null, cvStartYear: volume.startYear ?? null }
    if (volume.publisher && !edition.publisher) patch.publisher = volume.publisher
    if (!edition.comicvineId) patch.comicvineId = Number(issue.volumeId)
    updateEdition(app.db, edition.id, patch)

    return { matched: true, edition: getEdition(app.db, edition.id) }
  })
```

Add the imports it needs: `createComicVine` from `../lib/comicvine.js`, `listBooksByEdition` from `../models/books.js`, `updateEdition` and `EditionUpdate` from `../models/editions.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes-editions-volume.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/editions.ts test/routes-editions-volume.test.ts
git commit -m "feat: resolve an edition's volume from a book already matched"
```

---

### Task 5: The nested folder rule

**Files:**
- Modify: `server/lib/paths.ts`
- Test: `test/paths.test.ts`

**Interfaces:**
- Produces: `editionFolderPath(seriesName: string | null | undefined, name: string): string` — the single place that knows the layout. `sanitizeEditionFolder` keeps its current signature and meaning: one safe segment.

- [ ] **Step 1: Write the failing test**

Add to `test/paths.test.ts`:

```typescript
test('an edition folder nests under its series', () => {
  expect(editionFolderPath('The Amazing Spider-Man', 'The Amazing Spider-Man (2025)'))
    .toBe('The Amazing Spider-Man/The Amazing Spider-Man (2025)')
})

test('an edition with no series stays at the top level', () => {
  expect(editionFolderPath(null, 'Unsorted')).toBe('Unsorted')
  expect(editionFolderPath('   ', 'Unsorted')).toBe('Unsorted')
})

// A series name may itself contain a slash - the library has "Amazing Spider-Man/Venom".
// It must stay one folder, not become a nesting level.
test('a slash inside a series name does not create a folder level', () => {
  expect(editionFolderPath('Amazing Spider-Man/Venom', 'Amazing Spider-Man/Venom (2025)'))
    .toBe('Amazing Spider-Man_Venom/Amazing Spider-Man_Venom (2025)')
})

test('a traversal attempt survives as a literal segment', () => {
  expect(editionFolderPath('..', '../etc')).toBe('_/_etc')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/paths.test.ts`
Expected: FAIL — `editionFolderPath is not defined`.

- [ ] **Step 3: Write minimal implementation**

Append to `server/lib/paths.ts`:

```typescript
/**
 * Where an edition's files live, relative to the comics dir: `<series>/<edition>`.
 *
 * Each segment goes through sanitizeEditionFolder separately, so a slash inside a
 * name collapses to `_` instead of silently becoming another folder level - the
 * library contains a series literally named "Amazing Spider-Man/Venom". An edition
 * with no series of its own stays at the top level, which is where Unsorted lives.
 */
export function editionFolderPath(seriesName: string | null | undefined, name: string): string {
  const leaf = sanitizeEditionFolder(name)
  const series = seriesName?.trim() ? sanitizeEditionFolder(seriesName) : ''
  return series ? `${series}/${leaf}` : leaf
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/paths.ts test/paths.test.ts
git commit -m "feat: give an edition folder a series level above it"
```

---

### Task 6: Moves honour the edition's own folder

**Files:**
- Modify: `server/services/library.ts` (`moveBookToEdition`, around lines 74-110)
- Test: `test/library.test.ts`

**Interfaces:**
- Consumes: `editionFolderPath` (Task 5), `deriveSeriesName` from `../lib/seriesName.js`.
- Produces: `moveBookToEdition` unchanged in signature; a **new** edition it creates gets a nested folder, and an **existing** edition's stored folder is used as-is.

This is the task most able to move files somewhere unintended. Note the existing latent bug it fixes: the destination is currently recomputed from the edition name (`sanitizeEditionFolder(editionName)`) even when the edition already exists with a different stored `folder`, so files could land outside the folder the row claims.

- [ ] **Step 1: Write the failing test**

Add to `test/library.test.ts`. That file already provides a module-level `ctx` via
`beforeEach` (temp `comicsDir` + in-memory db) and a `makeCbz` helper — use them; do
not build a new harness.

```typescript
test('a book moved to a new edition lands under its series', async () => {
  const srcDir = join(ctx.config.comicsDir, 'Unsorted')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'asm-001.cbz')
  const src = upsertEdition(ctx.db, { name: 'Unsorted', folder: 'Unsorted' })
  const book = insertBook(ctx.db, {
    editionId: src.id, filePath: 'Unsorted/asm-001.cbz', pageCount: 1, fileSize: 100,
  })!

  const result = await moveBookToEdition(ctx, book.id, 'The Amazing Spider-Man (2025)')

  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  expect(result.edition.folder).toBe(nested)
  expect(result.book.filePath).toBe(`${nested}/asm-001.cbz`)
  expect(existsSync(join(ctx.config.comicsDir, nested, 'asm-001.cbz'))).toBe(true)
})

// The edition row is the authority on where its files live. Recomputing the path from
// the name would send files somewhere the row does not point.
test('a book moved into an existing flat edition goes where that edition already is', async () => {
  const srcDir = join(ctx.config.comicsDir, 'Unsorted')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'asm-002.cbz')
  const src = upsertEdition(ctx.db, { name: 'Unsorted', folder: 'Unsorted' })
  upsertEdition(ctx.db, { name: 'Vol 7', folder: 'Vol 7' })
  const book = insertBook(ctx.db, {
    editionId: src.id, filePath: 'Unsorted/asm-002.cbz', pageCount: 1, fileSize: 100,
  })!

  const result = await moveBookToEdition(ctx, book.id, 'Vol 7')

  expect(result.book.filePath).toBe('Vol 7/asm-002.cbz')
  expect(existsSync(join(ctx.config.comicsDir, 'Vol 7', 'asm-002.cbz'))).toBe(true)
})
```

The folder above depends on `deriveSeriesName('The Amazing Spider-Man (2025)')` returning
`The Amazing Spider-Man`. That is load-bearing, so pin it in `test/series-name.test.ts`:

```typescript
test('a year suffix marks the edition, leaving the series behind it', () => {
  expect(deriveSeriesName('The Amazing Spider-Man (2025)')).toBe('The Amazing Spider-Man')
  expect(deriveSeriesName('Venom (2025)')).toBe('Venom')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/library.test.ts`
Expected: FAIL on the first test — folder is `The Amazing Spider-Man (2025)`, flat.

- [ ] **Step 3: Write minimal implementation**

In `moveBookToEdition`, replace the two lines that compute the target:

```typescript
  // A new edition is created nested under its series; an existing one keeps the folder
  // it already has, because the row - not a recomputation from the name - is the
  // authority on where its files live.
  const desiredFolder = editionFolderPath(deriveSeriesName(editionName), editionName)
  const targetEdition = upsertEdition(db, { name: editionName, folder: desiredFolder })
  const targetFolder = targetEdition.folder
```

Everything downstream already reads `targetFolder`. Add the imports for `editionFolderPath` and `deriveSeriesName`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/library.test.ts test/remove.test.ts test/models-library.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/library.ts test/library.test.ts
git commit -m "feat: create edition folders nested under their series"
```

---

### Task 7: Scan a nested tree

**Files:**
- Modify: `server/services/indexer.ts:73-80` (`ingestFile`)
- Modify: `server/models/editions.ts` (`upsertEdition` gains an optional series name)
- Test: `test/indexer.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `upsertEdition(db, { name, folder, seriesName? })` — when `seriesName` is omitted the series is derived from the name, exactly as today.

- [ ] **Step 1: Write the failing test**

Add to `test/indexer.test.ts`, which supplies a module-level `ctx` and `makeCbz`. Add
`ingestFile` and `getEdition` to that file's imports.

```typescript
test('a file two levels deep belongs to an edition under that series', async () => {
  const dir = join(ctx.config.comicsDir, 'The Amazing Spider-Man', 'The Amazing Spider-Man (2025)')
  mkdirSync(dir, { recursive: true })
  const cbz = await makeCbz(dir, ['p1.png'], '001.cbz')

  const book = await ingestFile(ctx, cbz)

  expect(getEdition(ctx.db, book!.editionId)).toMatchObject({
    name: 'The Amazing Spider-Man (2025)',
    seriesName: 'The Amazing Spider-Man',
    folder: 'The Amazing Spider-Man/The Amazing Spider-Man (2025)',
  })
})

test('a file directly in a top-level folder still makes a series-less edition', async () => {
  const dir = join(ctx.config.comicsDir, 'Unsorted')
  mkdirSync(dir, { recursive: true })
  const cbz = await makeCbz(dir, ['p1.png'], 'loose.cbz')

  const book = await ingestFile(ctx, cbz)

  expect(getEdition(ctx.db, book!.editionId)).toMatchObject({ name: 'Unsorted', folder: 'Unsorted' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/indexer.test.ts`
Expected: FAIL — folder is the raw edition name, series is derived from the leaf only.

- [ ] **Step 3: Write minimal implementation**

In `server/models/editions.ts`:

```typescript
export function upsertEdition(
  db: Db,
  { name, folder, seriesName }: { name: string; folder: string; seriesName?: string | null },
): Edition {
  const existing = db.prepare('SELECT * FROM edition WHERE name = ?').get(name) as EditionRow | undefined
  if (existing) return toEdition(existing) as Edition
  const info = db
    .prepare('INSERT INTO edition (name, folder, series_name, created_at) VALUES (?,?,?,?)')
    .run(name, folder, seriesName?.trim() || deriveSeriesName(name), new Date().toISOString())
  return toEdition(db.prepare('SELECT * FROM edition WHERE id = ?').get(info.lastInsertRowid) as EditionRow) as Edition
}
```

In `server/services/indexer.ts`, replace the two lines that name the edition:

```typescript
  // The folder an edition owns is where its files actually are, not a guess from its
  // name. A path of `<series>/<edition>/file.cbz` yields both; a single level yields an
  // edition with no series, which is how a loose `Unsorted/` keeps working.
  const segments = relPath.split('/').slice(0, -1)
  const leaf = segments[segments.length - 1]
  const parent = segments.length >= 2 ? segments[segments.length - 2] : null
  const name = editionName || info.series || leaf || 'Unsorted'
  const folder = segments.join('/') || 'Unsorted'
  const edition = upsertEdition(db, { name, folder, seriesName: parent })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/indexer.test.ts test/upload.test.ts test/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/indexer.ts server/models/editions.ts test/indexer.test.ts
git commit -m "feat: read the series level when scanning the comics folder"
```

---

### Task 8: Prune the series folder when it empties

**Files:**
- Modify: `server/services/library.ts:59-72` (`pruneEditionIfEmpty`)
- Test: `test/remove.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pruneEditionIfEmpty` unchanged in signature; it now also attempts the parent directory.

- [ ] **Step 1: Write the failing test**

`test/remove.test.ts` has a `seedEdition(name, files)` helper that assumes a flat
folder. Give it a sibling that seeds a nested one, then add the two tests:

```typescript
/** An edition folder nested under its series, holding one real .cbz. */
async function seedNested(series: string, name: string, file: string) {
  const folder = `${series}/${name}`
  mkdirSync(join(ctx.config.comicsDir, folder), { recursive: true })
  const edition = upsertEdition(ctx.db, { name, folder })
  await makeCbz(join(ctx.config.comicsDir, folder), ['p1.png'], file)
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: `${folder}/${file}`, pageCount: 1, fileSize: 100,
  })!
  return { edition, book }
}

test('emptying the last edition of a series removes the series folder too', async () => {
  const { book } = await seedNested('Venom', 'Venom (2025)', '001.cbz')

  await removeBook(ctx, book.id)

  expect(existsSync(join(ctx.config.comicsDir, 'Venom/Venom (2025)'))).toBe(false)
  expect(existsSync(join(ctx.config.comicsDir, 'Venom'))).toBe(false)
})

test('a series folder with another edition still in it is left alone', async () => {
  const { book } = await seedNested('Venom', 'Venom (2025)', '001.cbz')
  await seedNested('Venom', 'Venom (2022)', '001.cbz')

  await removeBook(ctx, book.id)

  expect(existsSync(join(ctx.config.comicsDir, 'Venom/Venom (2025)'))).toBe(false)
  expect(existsSync(join(ctx.config.comicsDir, 'Venom/Venom (2022)'))).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/remove.test.ts`
Expected: FAIL — `Venom/` still exists after the first test.

- [ ] **Step 3: Write minimal implementation**

In `pruneEditionIfEmpty`, replace the single `rmdir`:

```typescript
  if (folder) {
    await rmdir(join(config.comicsDir, folder)).catch(() => { /* ENOTEMPTY etc. */ })
    // The series level above it is now empty too, unless it holds other editions -
    // in which case rmdir fails with ENOTEMPTY and we leave it, same as above.
    const parent = dirname(folder)
    if (parent && parent !== '.' && parent !== folder) {
      await rmdir(join(config.comicsDir, parent)).catch(() => { /* holds other editions */ })
    }
  }
```

`dirname` is already imported in this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/remove.test.ts test/library.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/library.ts test/remove.test.ts
git commit -m "feat: clear the series folder once its last edition goes"
```

---

### Task 9: Sort series past a leading article

**Files:**
- Modify: `server/models/series.ts:54`
- Test: `test/models-series.test.ts`

**Interfaces:**
- Produces: `seriesSortKey(name: string): string`, exported for the test.

- [ ] **Step 1: Write the failing test**

Add to `test/models-series.test.ts`:

```typescript
test('a leading article does not decide where a series sorts', () => {
  expect(seriesSortKey('The Amazing Spider-Man')).toBe('Amazing Spider-Man')
  expect(seriesSortKey('A Distant Soil')).toBe('Distant Soil')
  expect(seriesSortKey('An Unkindness of Ravens')).toBe('Unkindness of Ravens')
})

test('a name that only looks like an article keeps it', () => {
  expect(seriesSortKey('Theseus')).toBe('Theseus')
  expect(seriesSortKey('Animal Man')).toBe('Animal Man')
})

test('The Amazing Spider-Man shelves before Batman, not after Thor', () => {
  const db = openDb(':memory:')
  for (const name of ['Thor', 'The Amazing Spider-Man', 'Batman']) {
    upsertEdition(db, { name: `${name} (2025)`, folder: `${name}/${name} (2025)`, seriesName: name })
  }
  expect(listSeries(db).map((s) => s.name))
    .toEqual(['The Amazing Spider-Man', 'Batman', 'Thor'])
  db.close()
})
```

Match the import names `test/models-series.test.ts` already uses for `listSeries`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/models-series.test.ts`
Expected: FAIL — `seriesSortKey is not defined`.

- [ ] **Step 3: Write minimal implementation**

In `server/models/series.ts`:

```typescript
// "The Amazing Spider-Man" belongs under A, where a reader looks for it - so the sort
// key drops a leading article. The stored name keeps it: Comic Vine's name is the name.
const LEADING_ARTICLE = /^(the|an|a)\s+/i

export function seriesSortKey(name: string): string {
  return name.replace(LEADING_ARTICLE, '')
}
```

and change the sort:

```typescript
  return [...series.values()].sort((a, b) => {
    const byKey = seriesSortKey(a.name).localeCompare(seriesSortKey(b.name), undefined, { sensitivity: 'base' })
    // Two names that differ only by their article still need a stable order.
    return byKey || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
```

The `\s+` in the pattern is what keeps "Theseus" and "Animal Man" intact — the article must be a whole word.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/models-series.test.ts test/routes-series.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/models/series.ts test/models-series.test.ts
git commit -m "feat: shelve a series past its leading article"
```

---

### Task 10: Reorganize the existing library

**Files:**
- Modify: `server/services/library.ts:172-191` (`reorganizeLibrary`)
- Modify: `server/models/editions.ts` (add `setEditionFolder`)
- Create: `server/routes/library.ts`
- Modify: `server/index.ts` (register the route beside the others)
- Test: `test/library.test.ts`

**Interfaces:**
- Consumes: `editionFolderPath` (Task 5); `moveBookToEdition` as modified by Task 6.
- Produces:
  - `setEditionFolder(db: Db, id: number, folder: string): void` — writes the `folder` column directly.
  - `planReorganize(db: Db): MovePlan[]` where `MovePlan = { bookId: number; from: string; to: string }`.
  - `reorganizeLibrary(ctx: Ctx): Promise<{ moved: number }>` — existing signature, new layout rule.
  - `POST /api/library/reorganize` body `{ dryRun?: boolean }` → `{ dryRun, planned }`, plus `moved` when executed.

**Read this before writing code.** A reorganizer already exists and is not a new
invention: `reorganizeLibrary` moves any book whose folder disagrees with
`sanitizeEditionFolder(edition.name)`, and `POST /api/scan` calls it on every scan
(`server/routes/scan.ts:8`). Two consequences:

1. Do not create a new service. Change the rule inside this one.
2. After Task 6, `moveBookToEdition` uses the **stored** `edition.folder`, so calling it
   alone would move nothing. The edition's folder column must be updated to the nested
   path *first*; the move then follows it. That ordering is the whole task.

Because scan calls it, the first scan after this ships migrates the library. The dry-run
route exists so the move can be previewed before that happens.

- [ ] **Step 1: Write the failing test**

`test/library.test.ts` already has a `reorganizeLibrary` test at line 155 and the
module-level `ctx` + `makeCbz` harness. Add:

```typescript
test('reorganize moves a flat edition under its series and repoints the row', async () => {
  const flat = join(ctx.config.comicsDir, 'Vol 7')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '001.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 100,
  })!

  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 1 })

  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  expect(getBook(ctx.db, book.id)!.filePath).toBe(`${nested}/001.cbz`)
  expect(getEdition(ctx.db, edition.id)!.folder).toBe(nested)
  expect(existsSync(join(ctx.config.comicsDir, nested, '001.cbz'))).toBe(true)
  expect(existsSync(flat)).toBe(false)
})

// An interrupted run is finished by running it again, so it must not trip over its
// own completed work.
test('a second reorganize finds nothing left to do', async () => {
  const flat = join(ctx.config.comicsDir, 'Vol 7')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '001.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  insertBook(ctx.db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 100 })

  await reorganizeLibrary(ctx)

  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 0 })
  expect(planReorganize(ctx.db)).toEqual([])
})

test('the plan names each move and touches nothing on disk', async () => {
  const flat = join(ctx.config.comicsDir, 'Vol 7')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '001.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 100,
  })!

  expect(planReorganize(ctx.db)).toEqual([{
    bookId: book.id,
    from: 'Vol 7/001.cbz',
    to: 'The Amazing Spider-Man/The Amazing Spider-Man (2025)/001.cbz',
  }])
  expect(existsSync(join(flat, '001.cbz'))).toBe(true)
})

test('an edition with no series of its own is left where it is', async () => {
  const dir = join(ctx.config.comicsDir, 'Unsorted')
  mkdirSync(dir, { recursive: true })
  await makeCbz(dir, ['p1.png'], 'loose.cbz')
  const edition = upsertEdition(ctx.db, { name: 'Unsorted', folder: 'Unsorted' })
  updateEdition(ctx.db, edition.id, { seriesName: null })
  insertBook(ctx.db, { editionId: edition.id, filePath: 'Unsorted/loose.cbz', pageCount: 1, fileSize: 100 })

  expect(planReorganize(ctx.db)).toEqual([])
  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 0 })
})
```

Add `planReorganize` and `getBook`/`getEdition` to the file's imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/library.test.ts`
Expected: FAIL — `planReorganize` is not exported; the first test moves nothing.

- [ ] **Step 3: Write minimal implementation**

In `server/models/editions.ts`, beside `updateEdition`:

```typescript
/**
 * Write the folder column directly. Legitimate only from the reorganizer, which moves
 * the files this column describes in the same breath - see the warning above
 * EDITION_FIELDS about keeping name, folder and the files on disk in agreement.
 */
export function setEditionFolder(db: Db, id: number, folder: string): void {
  db.prepare('UPDATE edition SET folder = ? WHERE id = ?').run(folder, id)
}
```

In `server/services/library.ts`, replace `reorganizeLibrary` and add the planner:

```typescript
export interface MovePlan {
  bookId: number
  from: string
  to: string
}

/**
 * Every book not yet living at `<series>/<edition>/<file>`, with the path it should
 * have. Reads only - the caller looks at this before anything moves.
 */
export function planReorganize(db: Db): MovePlan[] {
  const plans: MovePlan[] = []
  for (const edition of listEditions(db)) {
    const folder = editionFolderPath(edition.seriesName, edition.name)
    for (const book of listBooksByEdition(db, edition.id)) {
      const to = `${folder}/${basename(book.filePath)}`
      if (to !== book.filePath) plans.push({ bookId: book.id, from: book.filePath, to })
    }
  }
  return plans
}

/**
 * Bring the library into line with the layout: each edition under its series.
 *
 * The folder column is updated before the move, because moveBookToEdition follows the
 * edition's stored folder - update it after and every move would be a no-op. The move
 * itself then reuses the ordinary path, so collisions and pruning behave as they do
 * everywhere else. Re-running is safe: a book already at its target is not in the plan.
 */
export async function reorganizeLibrary(ctx: Ctx): Promise<{ moved: number }> {
  const { db } = ctx
  let moved = 0
  for (const edition of listEditions(db)) {
    const folder = editionFolderPath(edition.seriesName, edition.name)
    if (edition.folder !== folder) setEditionFolder(db, edition.id, folder)
    for (const book of listBooksByEdition(db, edition.id)) {
      if (dirname(book.filePath) === folder) continue
      await moveBookToEdition(ctx, book.id, edition.name)
      moved++
    }
  }
  return { moved }
}
```

Add imports for `editionFolderPath`, `listEditions`, `listBooksByEdition` and
`setEditionFolder`; `basename` and `dirname` are already imported here.

Create `server/routes/library.ts`:

```typescript
import { planReorganize, reorganizeLibrary } from '../services/library.js'
import type { App } from '../types.js'

interface ReorganizeBody { dryRun?: boolean }

export default async function libraryRoutes(app: App) {
  // Restructuring moves real files, so a dry run is the default posture: the caller
  // sees the whole plan before anything happens. Only dryRun:false executes.
  app.post<{ Body: ReorganizeBody }>('/api/library/reorganize', async (req) => {
    const planned = planReorganize(app.db)
    if (req.body?.dryRun !== false) return { dryRun: true, planned }
    const { moved } = await reorganizeLibrary({ db: app.db, config: app.config })
    return { dryRun: false, planned, moved }
  })
}
```

Register it in `server/index.ts` alongside the existing `app.register(...)` calls.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/library.test.ts test/remove.test.ts`
Expected: PASS. The pre-existing `reorganizeLibrary` test at line 155 must still pass —
it uses a flat edition whose series derives to the same name, so its expected path is
unchanged. If it now expects a nested path, update that expectation deliberately rather
than weakening the new rule.

- [ ] **Step 5: Commit**

```bash
git add server/services/library.ts server/models/editions.ts server/routes/library.ts server/index.ts test/library.test.ts
git commit -m "feat: reorganize the library into series folders"
```

---

### Task 11: The suggestion on the edition page

**Files:**
- Modify: `src/api.ts:231-236` (`renameEdition`), plus one new call
- Modify: `src/pages/Edition.tsx`
- Test: `test/Edition.test.tsx`

**Interfaces:**
- Consumes: `Edition.cvName` / `Edition.cvStartYear` (Task 2); `POST /api/editions/:id/comicvine-volume` (Task 4).
- Produces: `api.renameEdition(id, name, seriesName?)`; `api.checkComicVineVolume(id)`.

- [ ] **Step 1: Write the failing test**

`test/Edition.test.tsx` provides `mockFetch(edition, books)` and `renderPage(path)`,
with a default `EDITION` of id 9. Pass a full edition object to `mockFetch` before
rendering:

```typescript
const CV_EDITION = {
  id: 9,
  name: 'Vol 7',
  seriesName: 'Amazing Spider-Man',
  summary: null,
  cvName: 'The Amazing Spider-Man',
  cvStartYear: 2025,
}

test('an edition named differently from its Comic Vine volume offers the name', async () => {
  mockFetch(CV_EDITION)
  renderPage()

  expect(await screen.findByRole('button', { name: /rename to The Amazing Spider-Man \(2025\)/i }))
    .toBeInTheDocument()
})

test('an edition already carrying its Comic Vine name offers nothing', async () => {
  mockFetch({ ...CV_EDITION, name: 'The Amazing Spider-Man (2025)' })
  renderPage()

  await screen.findByText(/The Amazing Spider-Man \(2025\)/)
  expect(screen.queryByRole('button', { name: /rename to/i })).not.toBeInTheDocument()
})

test('an edition with no volume resolved yet offers to look it up', async () => {
  mockFetch({ ...CV_EDITION, cvName: null, cvStartYear: null })
  renderPage()

  expect(await screen.findByRole('button', { name: /check comic vine/i })).toBeInTheDocument()
})

// Accepting the suggestion must send the series too: renameEdition restores the old
// series name from carryableMetadata, so a name-only PATCH leaves the series behind.
test('accepting the name sends the series alongside it', async () => {
  mockFetch(CV_EDITION)
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: /rename to/i }))

  await waitFor(() => expect(patched).toHaveLength(1))
  expect(patched[0].body).toEqual({
    name: 'The Amazing Spider-Man (2025)',
    seriesName: 'The Amazing Spider-Man',
  })
})
```

The merge-wording case needs the page to know what other editions exist. If
`src/pages/Edition.tsx` has no such query, add one using the same endpoint
`EditionCombobox` already calls rather than inventing an endpoint, and cover it with a
fifth test asserting the button reads `/merge into/i` when that list contains an edition
named `The Amazing Spider-Man (2025)` with a different id. If wiring that query turns
out to pull unrelated state into the page, stop and say so rather than reshaping the
page around it — the suggestion is still correct without it, only the wording is less
precise.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/Edition.test.tsx`
Expected: FAIL — no suggestion text rendered.

- [ ] **Step 3: Write minimal implementation**

In `src/api.ts`, widen the rename call and add the lookup:

```typescript
  renameEdition: (id: string | number, name: string, seriesName?: string) =>
    json<EditionResponse>(`/api/editions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(seriesName === undefined ? { name } : { name, seriesName }),
    }),

  checkComicVineVolume: (id: string | number) =>
    json<{ matched: boolean; edition?: Edition }>(`/api/editions/${id}/comicvine-volume`, { method: 'POST' }),
```

In `src/pages/Edition.tsx`, derive the suggestion and render a banner above the issue list:

```tsx
  // Comic Vine's name for the volume, plus the year its run started, is what this
  // edition should be called. Offered, never applied on its own.
  const suggested = edition?.cvName && edition.cvStartYear
    ? `${edition.cvName} (${edition.cvStartYear})`
    : null
  const needsRename = suggested !== null && suggested !== edition?.name
  // Renaming onto an existing name merges into it; the button has to say so.
  const collides = needsRename && allEditions.some((e) => e.name === suggested && e.id !== edition?.id)

  const applyName = useMutation({
    mutationFn: () => api.renameEdition(id!, suggested!, edition!.cvName!),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['edition'] })
      qc.invalidateQueries({ queryKey: ['editions'] })
      qc.invalidateQueries({ queryKey: ['series'] })
      navigate(`/editions/${result.edition.id}`, { replace: true })
    },
  })

  const lookup = useMutation({
    mutationFn: () => api.checkComicVineVolume(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edition'] }),
  })
```

```tsx
      {needsRename && (
        <div className="edition__cv-suggestion">
          <span>Comic Vine calls this <strong>{suggested}</strong></span>
          <button type="button" className="btn" disabled={applyName.isPending} onClick={() => applyName.mutate()}>
            {collides ? `Merge into ${suggested}` : `Rename to ${suggested}`}
          </button>
        </div>
      )}
      {!suggested && (
        <button type="button" className="btn btn-ghost" disabled={lookup.isPending} onClick={() => lookup.mutate()}>
          {lookup.isPending ? 'Checking…' : 'Check Comic Vine'}
        </button>
      )}
```

Passing `edition.cvName` as the series name is the load-bearing half: `renameEdition` restores the old series name from `carryableMetadata`, so a rename alone would leave the series behind. The PATCH handler applies `seriesName` before renaming, so the new value is what gets carried.

Add a `.edition__cv-suggestion` rule beside the page's other styles.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/Edition.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/pages/Edition.tsx test/Edition.test.tsx
git commit -m "feat: offer an edition the name Comic Vine gives its volume"
```

---

### Task 12: Verify and migrate the real library

**Files:** none — this is the operational close-out.

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: every test passes. The suite was 537 tests before this plan.

- [ ] **Step 2: Typecheck both projects**

```bash
npx tsc --noEmit -p tsconfig.server.json && npx tsc --noEmit
```

- [ ] **Step 3: Rebuild the container**

```bash
docker compose up -d --build
```

- [ ] **Step 4: Back up the library before touching it**

```bash
cp -a data data.backup-$(date +%F)
```

Do not skip this. Everything after it moves real files.

- [ ] **Step 5: Resolve the volumes, then dry-run the move**

In the UI, open each edition and press **Check Comic Vine**, then accept the suggested name where it looks right. Then:

```bash
curl -s -X POST http://localhost:8090/api/library/reorganize \
  -H 'Content-Type: application/json' -d '{"dryRun":true}' | python3 -m json.tool
```

Read the `planned` list. Every `from`/`to` pair should be a move you expect.

- [ ] **Step 6: Execute**

```bash
curl -s -X POST http://localhost:8090/api/library/reorganize \
  -H 'Content-Type: application/json' -d '{"dryRun":false}' | python3 -m json.tool
```

Expected: `moved` equals the plan length, `skipped` is 0.

- [ ] **Step 7: Confirm the result**

```bash
find data/comics -maxdepth 2 -type d
curl -s http://localhost:8090/api/series | python3 -m json.tool | head -40
```

Expected: `<series>/<volume>` on disk, every series listed with its book count intact, and The Amazing Spider-Man sorted under A. Open a comic in the reader to confirm the paths resolve.

- [ ] **Step 8: Commit nothing / clean up**

No code change here. Once the library reads correctly, remove the backup at your leisure — not before.
