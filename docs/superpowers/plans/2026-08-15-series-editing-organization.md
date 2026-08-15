# Series Editing + On-Disk Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add series-rename/merge and book-reassignment features that keep comic files physically organized in per-series folders on disk.

**Architecture:** New `server/lib/paths.ts` exports `sanitizeSeriesFolder` (extracted from `upload.ts`). New `server/services/library.ts` provides `moveBookToSeries`, `renameSeries`, and `reorganizeLibrary` using `fs.rename` only (never overwrite). Two new model helpers (`setBookSeries`, `getSeriesByName`, `deleteSeries`) power the service layer. Routes add `PATCH /api/series/:id` and `PUT /api/books/:id/series`; scan route gains `reorganizeLibrary` call. Frontend adds inline rename on the Series page and a "Move to series" control on BookDetail.

**Tech Stack:** TypeScript (strict), Fastify 5, better-sqlite3, React 19 + React Query, Vitest

**Spec:** (inline in this conversation)

## Global Constraints

- TypeScript strict mode — no `any`, no implicit undefined
- Use `fs.rename` ONLY — NEVER copy, never delete a comic file, NEVER overwrite on collision (de-dupe with numeric suffix)
- `rmdir` (non-recursive) only; ignore ENOTEMPTY and all errors on directory cleanup
- `npm install --legacy-peer-deps` if adding packages
- All existing 35 tests must still pass
- Acceptance gate: `npm run typecheck` clean, `npx vitest run` all green, `npm run build` succeeds

---

### Task 1: `server/lib/paths.ts` — sanitizeSeriesFolder + refactor upload.ts

**Files:**
- Create: `server/lib/paths.ts`
- Modify: `server/routes/upload.ts` (lines 41-43)

**Interfaces:**
- Produces: `sanitizeSeriesFolder(name: string): string` — replace `/`, `\`, and `..` runs with `_`, trim; return `"Unsorted"` if empty

- [ ] **Step 1: Write the failing test in `test/paths.test.ts`**

```typescript
import { test, expect } from 'vitest'
import { sanitizeSeriesFolder } from '../server/lib/paths.js'

test('sanitizeSeriesFolder trims and replaces bad chars', () => {
  expect(sanitizeSeriesFolder('Spider-Man')).toBe('Spider-Man')
  expect(sanitizeSeriesFolder('  Batman  ')).toBe('Batman')
  expect(sanitizeSeriesFolder('../../evil')).toBe('__evil')
  expect(sanitizeSeriesFolder('a/b\\c')).toBe('a_b_c')
  expect(sanitizeSeriesFolder('')).toBe('Unsorted')
  expect(sanitizeSeriesFolder('   ')).toBe('Unsorted')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/paths.test.ts
```
Expected: FAIL (module not found)

- [ ] **Step 3: Create `server/lib/paths.ts`**

```typescript
/**
 * Sanitize a series name into a safe folder name.
 * Replaces `/`, `\`, and `..` runs with `_`, trims whitespace.
 * Returns "Unsorted" if the result would be empty.
 */
export function sanitizeSeriesFolder(name: string): string {
  const sanitized = name
    .replace(/[/\\]+/g, '_')
    .replace(/\.\.+/g, '_')
    .trim()
  return sanitized || 'Unsorted'
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/paths.test.ts
```
Expected: PASS

- [ ] **Step 5: Refactor `server/routes/upload.ts` to use the new function**

Replace line 41-43 in `upload.ts`:
```typescript
// OLD (remove this):
const finalSeries =
  (seriesName || 'Unsorted').replace(/[\\/]+/g, '_').replace(/\.\.+/g, '_').trim() || 'Unsorted'
```
```typescript
// NEW (add import at top, replace the assignment):
import { sanitizeSeriesFolder } from '../lib/paths.js'
// ...
const finalSeries = sanitizeSeriesFolder(seriesName || 'Unsorted')
```

- [ ] **Step 6: Verify existing upload tests still pass**

```bash
npx vitest run test/upload.test.ts
```
Expected: all 3 tests PASS

- [ ] **Step 7: Commit**

```bash
git add server/lib/paths.ts server/routes/upload.ts test/paths.test.ts
git commit -m "refactor: extract sanitizeSeriesFolder into server/lib/paths.ts"
```

---

### Task 2: Model helpers — `setBookSeries`, `getSeriesByName`, `deleteSeries`

**Files:**
- Modify: `server/models/books.ts` (add `setBookSeries` at end)
- Modify: `server/models/series.ts` (add `getSeriesByName` and `deleteSeries` at end)

**Interfaces:**
- Produces:
  - `setBookSeries(db: Db, bookId: number, seriesId: number, filePath: string): Book` (from books.ts)
  - `getSeriesByName(db: Db, name: string): Series | undefined` (from series.ts)
  - `deleteSeries(db: Db, id: number): void` (from series.ts)

- [ ] **Step 1: Write failing tests in `test/models-library.test.ts`**

```typescript
import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertSeries } from '../server/models/series.js'
import { getSeriesByName, deleteSeries } from '../server/models/series.js'
import { insertBook, setBookSeries } from '../server/models/books.js'

function freshDb() { return openDb(':memory:') }

test('getSeriesByName finds existing series', () => {
  const db = freshDb()
  upsertSeries(db, { name: 'Batman', folder: 'Batman' })
  const found = getSeriesByName(db, 'Batman')
  expect(found).toBeDefined()
  expect(found!.name).toBe('Batman')
})

test('getSeriesByName returns undefined for unknown name', () => {
  const db = freshDb()
  expect(getSeriesByName(db, 'Nonexistent')).toBeUndefined()
})

test('deleteSeries removes the row', () => {
  const db = freshDb()
  const s = upsertSeries(db, { name: 'Batman', folder: 'Batman' })
  deleteSeries(db, s.id)
  expect(getSeriesByName(db, 'Batman')).toBeUndefined()
})

test('setBookSeries updates seriesId and filePath', () => {
  const db = freshDb()
  const s1 = upsertSeries(db, { name: 'A', folder: 'A' })
  const s2 = upsertSeries(db, { name: 'B', folder: 'B' })
  const book = insertBook(db, { seriesId: s1.id, filePath: 'A/001.cbz', pageCount: 5, fileSize: 100 })!
  const updated = setBookSeries(db, book.id, s2.id, 'B/001.cbz')
  expect(updated.seriesId).toBe(s2.id)
  expect(updated.filePath).toBe('B/001.cbz')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/models-library.test.ts
```
Expected: FAIL (functions not exported)

- [ ] **Step 3: Add helpers to `server/models/series.ts`**

Append at the end of `server/models/series.ts`:
```typescript
export function getSeriesByName(db: Db, name: string): Series | undefined {
  return toSeries(db.prepare('SELECT * FROM series WHERE name = ?').get(name) as SeriesRow | undefined)
}

export function deleteSeries(db: Db, id: number): void {
  db.prepare('DELETE FROM series WHERE id = ?').run(id)
}
```

- [ ] **Step 4: Add `setBookSeries` to `server/models/books.ts`**

Append at the end of `server/models/books.ts`:
```typescript
export function setBookSeries(db: Db, bookId: number, seriesId: number, filePath: string): Book {
  db.prepare('UPDATE book SET series_id = ?, file_path = ? WHERE id = ?').run(seriesId, filePath, bookId)
  return getBook(db, bookId) as Book
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/models-library.test.ts
```
Expected: all 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/models/series.ts server/models/books.ts test/models-library.test.ts
git commit -m "feat: add setBookSeries, getSeriesByName, deleteSeries model helpers"
```

---

### Task 3: `server/services/library.ts` — moveBookToSeries, renameSeries, reorganizeLibrary

**Files:**
- Create: `server/services/library.ts`

**Interfaces:**
- Consumes:
  - `sanitizeSeriesFolder(name: string): string` from `../lib/paths.js`
  - `upsertSeries(db, { name, folder })` from `../models/series.js`
  - `getSeries(db, id)` from `../models/series.js`
  - `getSeriesByName(db, name)` from `../models/series.js`
  - `deleteSeries(db, id)` from `../models/series.js`
  - `listBooksBySeries(db, seriesId)` from `../models/books.js`
  - `getBook(db, id)` from `../models/books.js`
  - `setBookSeries(db, bookId, seriesId, filePath)` from `../models/books.js`
  - `Ctx` type from `../types.js`
  - `Series`, `Book` types from `../types.js`
- Produces:
  - `moveBookToSeries(ctx: Ctx, bookId: number, seriesName: string): Promise<{ book: Book; series: Series }>`
  - `renameSeries(ctx: Ctx, seriesId: number, newName: string): Promise<{ series: Series }>`
  - `reorganizeLibrary(ctx: Ctx): Promise<{ moved: number }>`

- [ ] **Step 1: Write failing tests in `test/library.test.ts`**

```typescript
import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { upsertSeries } from '../server/models/series.js'
import { getSeriesByName } from '../server/models/series.js'
import { insertBook, getBook } from '../server/models/books.js'
import { moveBookToSeries, renameSeries, reorganizeLibrary } from '../server/services/library.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lib-'))
  ctx = {
    db: openDb(':memory:'),
    config: { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config,
  }
  mkdirSync(ctx.config.comicsDir, { recursive: true })
  mkdirSync(ctx.config.thumbsDir, { recursive: true })
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

test('moveBookToSeries physically moves file, updates DB, prunes empty source', async () => {
  // Set up source series with one book
  const srcDir = join(ctx.config.comicsDir, 'OldSeries')
  mkdirSync(srcDir, { recursive: true })
  const cbzPath = await makeCbz(srcDir, ['p1.png'], 'issue1.cbz')
  const srcSeries = upsertSeries(ctx.db, { name: 'OldSeries', folder: 'OldSeries' })
  const book = insertBook(ctx.db, {
    seriesId: srcSeries.id,
    filePath: 'OldSeries/issue1.cbz',
    pageCount: 1,
    fileSize: 100,
  })!

  const result = await moveBookToSeries(ctx, book.id, 'NewSeries')

  // File moved
  expect(existsSync(cbzPath)).toBe(false)
  expect(existsSync(join(ctx.config.comicsDir, 'NewSeries', 'issue1.cbz'))).toBe(true)
  // DB updated
  expect(result.book.filePath).toBe('NewSeries/issue1.cbz')
  expect(result.series.name).toBe('NewSeries')
  // Old series pruned (was empty)
  expect(getSeriesByName(ctx.db, 'OldSeries')).toBeUndefined()
  // Old folder removed (was empty)
  expect(existsSync(srcDir)).toBe(false)
})

test('collision de-dupe: two files with same basename get numeric suffix', async () => {
  // First book in target series
  const targetDir = join(ctx.config.comicsDir, 'Target')
  mkdirSync(targetDir, { recursive: true })
  const cbz1 = await makeCbz(targetDir, ['p1.png'], 'issue.cbz')
  const targetSeries = upsertSeries(ctx.db, { name: 'Target', folder: 'Target' })
  insertBook(ctx.db, { seriesId: targetSeries.id, filePath: 'Target/issue.cbz', pageCount: 1, fileSize: 100 })

  // Second book with same name in a different source series
  const srcDir = join(ctx.config.comicsDir, 'Source')
  mkdirSync(srcDir, { recursive: true })
  const cbz2 = await makeCbz(srcDir, ['p2.png'], 'issue.cbz')
  const srcSeries = upsertSeries(ctx.db, { name: 'Source', folder: 'Source' })
  const book2 = insertBook(ctx.db, { seriesId: srcSeries.id, filePath: 'Source/issue.cbz', pageCount: 1, fileSize: 100 })!

  const result = await moveBookToSeries(ctx, book2.id, 'Target')

  // Both files exist, no overwrite
  expect(existsSync(join(ctx.config.comicsDir, 'Target', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'Target', 'issue (2).cbz'))).toBe(true)
  expect(result.book.filePath).toBe('Target/issue (2).cbz')
})

test('renameSeries MERGE: rename B to existing A name moves all books under A, deletes B', async () => {
  // Series A with one book
  const aDir = join(ctx.config.comicsDir, 'SeriesA')
  mkdirSync(aDir, { recursive: true })
  await makeCbz(aDir, ['p1.png'], 'a1.cbz')
  const seriesA = upsertSeries(ctx.db, { name: 'SeriesA', folder: 'SeriesA' })
  insertBook(ctx.db, { seriesId: seriesA.id, filePath: 'SeriesA/a1.cbz', pageCount: 1, fileSize: 100 })

  // Series B with one book
  const bDir = join(ctx.config.comicsDir, 'SeriesB')
  mkdirSync(bDir, { recursive: true })
  await makeCbz(bDir, ['p2.png'], 'b1.cbz')
  const seriesB = upsertSeries(ctx.db, { name: 'SeriesB', folder: 'SeriesB' })
  insertBook(ctx.db, { seriesId: seriesB.id, filePath: 'SeriesB/b1.cbz', pageCount: 1, fileSize: 100 })

  // Rename B → SeriesA (merge)
  const result = await renameSeries(ctx, seriesB.id, 'SeriesA')

  expect(result.series.name).toBe('SeriesA')
  expect(result.series.id).toBe(seriesA.id)
  // B's book physically moved to A's folder
  expect(existsSync(join(ctx.config.comicsDir, 'SeriesA', 'b1.cbz'))).toBe(true)
  // B's folder and DB row gone
  expect(existsSync(bDir)).toBe(false)
  expect(getSeriesByName(ctx.db, 'SeriesB')).toBeUndefined()
})

test('renameSeries pure rename: moves folder + files, old series/folder gone', async () => {
  const oldDir = join(ctx.config.comicsDir, 'OldName')
  mkdirSync(oldDir, { recursive: true })
  await makeCbz(oldDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(ctx.db, { name: 'OldName', folder: 'OldName' })
  insertBook(ctx.db, { seriesId: series.id, filePath: 'OldName/issue.cbz', pageCount: 1, fileSize: 100 })

  const result = await renameSeries(ctx, series.id, 'NewName')

  expect(result.series.name).toBe('NewName')
  // File physically at new location
  expect(existsSync(join(ctx.config.comicsDir, 'NewName', 'issue.cbz'))).toBe(true)
  // Old location gone
  expect(existsSync(join(ctx.config.comicsDir, 'OldName', 'issue.cbz'))).toBe(false)
  expect(existsSync(oldDir)).toBe(false)
  expect(getSeriesByName(ctx.db, 'OldName')).toBeUndefined()
})

test('reorganizeLibrary moves a book whose folder does not match its series folder', async () => {
  // Place file in wrong folder
  const wrongDir = join(ctx.config.comicsDir, 'wrong-folder')
  mkdirSync(wrongDir, { recursive: true })
  await makeCbz(wrongDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(ctx.db, { name: 'CorrectName', folder: 'CorrectName' })
  // DB says it's in 'wrong-folder/issue.cbz' but series folder should be 'CorrectName'
  insertBook(ctx.db, { seriesId: series.id, filePath: 'wrong-folder/issue.cbz', pageCount: 1, fileSize: 100 })

  const result = await reorganizeLibrary(ctx)

  expect(result.moved).toBe(1)
  expect(existsSync(join(ctx.config.comicsDir, 'CorrectName', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'wrong-folder', 'issue.cbz'))).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/library.test.ts
```
Expected: FAIL (module not found)

- [ ] **Step 3: Create `server/services/library.ts`**

```typescript
import { mkdir, rename, rmdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'
import { sanitizeSeriesFolder } from '../lib/paths.js'
import { upsertSeries, getSeries, getSeriesByName, deleteSeries } from '../models/series.js'
import { getBook, listBooksBySeries, setBookSeries } from '../models/books.js'
import type { Ctx } from '../types.js'
import type { Series, Book } from '../types.js'

/** Returns a dest path that does not yet exist, de-duping with (2), (3), … suffixes. */
function dedupeDestPath(destDir: string, filename: string): string {
  const ext = extname(filename)
  const base = filename.slice(0, filename.length - ext.length)
  let candidate = join(destDir, filename)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(destDir, `${base} (${n})${ext}`)
    n++
  }
  return candidate
}

export async function moveBookToSeries(
  ctx: Ctx,
  bookId: number,
  seriesName: string,
): Promise<{ book: Book; series: Series }> {
  const { db, config } = ctx
  const book = getBook(db, bookId)
  if (!book) throw new Error(`Book ${bookId} not found`)

  const targetFolder = sanitizeSeriesFolder(seriesName)
  const targetSeries = upsertSeries(db, { name: seriesName, folder: targetFolder })

  const currentAbsPath = join(config.comicsDir, book.filePath)
  const destDir = join(config.comicsDir, targetFolder)
  const destAbsPath = dedupeDestPath(destDir, basename(book.filePath))
  const destRelPath = `${targetFolder}/${basename(destAbsPath)}`

  if (destAbsPath !== currentAbsPath) {
    await mkdir(destDir, { recursive: true })
    await rename(currentAbsPath, destAbsPath)
  }

  const updatedBook = setBookSeries(db, bookId, targetSeries.id, destRelPath)

  // Prune the old series if it is now empty
  const oldSeriesId = book.seriesId
  if (oldSeriesId !== targetSeries.id) {
    const remaining = listBooksBySeries(db, oldSeriesId)
    if (remaining.length === 0) {
      deleteSeries(db, oldSeriesId)
      const oldSeries = db.prepare('SELECT folder FROM series WHERE id = ?').get(oldSeriesId) as { folder: string } | undefined
      // oldSeries already deleted; reconstruct folder from original path
      const oldFolder = dirname(book.filePath) // e.g. "OldSeries"
      const oldDir = join(config.comicsDir, oldFolder)
      await rmdir(oldDir).catch(() => { /* ignore ENOTEMPTY or other errors */ })
    }
  }

  const series = getSeries(db, targetSeries.id) as Series
  return { book: updatedBook, series }
}

export async function renameSeries(
  ctx: Ctx,
  seriesId: number,
  newName: string,
): Promise<{ series: Series }> {
  const { db } = ctx

  const targetExisting = getSeriesByName(db, newName)

  if (targetExisting && targetExisting.id !== seriesId) {
    // MERGE: move all books of seriesId into targetExisting
    const books = listBooksBySeries(db, seriesId)
    for (const book of books) {
      await moveBookToSeries(ctx, book.id, newName)
    }
    // seriesId should be deleted by moveBookToSeries (emptied)
    return { series: getSeries(db, targetExisting.id) as Series }
  }

  // Pure rename: move all books to new name (this upserts the new series)
  const books = listBooksBySeries(db, seriesId)
  for (const book of books) {
    await moveBookToSeries(ctx, book.id, newName)
  }
  // seriesId emptied and deleted by moveBookToSeries
  const renamed = getSeriesByName(db, newName) as Series
  return { series: renamed }
}

export async function reorganizeLibrary(ctx: Ctx): Promise<{ moved: number }> {
  const { db } = ctx
  const allBooks = db.prepare('SELECT * FROM book').all() as Array<{ id: number; series_id: number; file_path: string }>
  let moved = 0
  for (const row of allBooks) {
    const series = getSeries(db, row.series_id)
    if (!series) continue
    const expectedFolder = sanitizeSeriesFolder(series.name)
    const currentFolder = dirname(row.file_path) // e.g. "OldSeries"
    if (currentFolder !== expectedFolder) {
      await moveBookToSeries(ctx, row.id, series.name)
      moved++
    }
  }
  return { moved }
}
```

**Note:** There is a subtle bug in the pruning logic above — after `deleteSeries` the row is gone, so the SELECT after delete won't find it. The old folder name comes from `dirname(book.filePath)`. Let me provide the corrected version:

```typescript
import { mkdir, rename, rmdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'
import { sanitizeSeriesFolder } from '../lib/paths.js'
import { upsertSeries, getSeries, getSeriesByName, deleteSeries } from '../models/series.js'
import { getBook, listBooksBySeries, setBookSeries } from '../models/books.js'
import type { Ctx } from '../types.js'
import type { Series, Book } from '../types.js'

function dedupeDestPath(destDir: string, filename: string): string {
  const ext = extname(filename)
  const base = filename.slice(0, filename.length - ext.length)
  let candidate = join(destDir, filename)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(destDir, `${base} (${n})${ext}`)
    n++
  }
  return candidate
}

export async function moveBookToSeries(
  ctx: Ctx,
  bookId: number,
  seriesName: string,
): Promise<{ book: Book; series: Series }> {
  const { db, config } = ctx
  const book = getBook(db, bookId)
  if (!book) throw new Error(`Book ${bookId} not found`)

  const targetFolder = sanitizeSeriesFolder(seriesName)
  const targetSeries = upsertSeries(db, { name: seriesName, folder: targetFolder })

  const currentAbsPath = join(config.comicsDir, book.filePath)
  const destDir = join(config.comicsDir, targetFolder)
  const destAbsPath = dedupeDestPath(destDir, basename(book.filePath))
  const destRelPath = `${targetFolder}/${basename(destAbsPath)}`

  // Only move if path actually changes
  if (destAbsPath !== currentAbsPath) {
    await mkdir(destDir, { recursive: true })
    await rename(currentAbsPath, destAbsPath)
  }

  const updatedBook = setBookSeries(db, bookId, targetSeries.id, destRelPath)

  // Prune old series if now empty
  const oldSeriesId = book.seriesId
  if (oldSeriesId !== targetSeries.id) {
    const remaining = listBooksBySeries(db, oldSeriesId)
    if (remaining.length === 0) {
      // Compute old folder path BEFORE deleting the DB row
      const oldSeries = getSeries(db, oldSeriesId)
      const oldFolderName = oldSeries?.folder ?? dirname(book.filePath)
      deleteSeries(db, oldSeriesId)
      const oldDir = join(config.comicsDir, oldFolderName)
      await rmdir(oldDir).catch(() => { /* ignore ENOTEMPTY or other errors */ })
    }
  }

  const series = getSeries(db, targetSeries.id) as Series
  return { book: updatedBook, series }
}

export async function renameSeries(
  ctx: Ctx,
  seriesId: number,
  newName: string,
): Promise<{ series: Series }> {
  const { db } = ctx
  const targetExisting = getSeriesByName(db, newName)

  if (targetExisting && targetExisting.id !== seriesId) {
    // MERGE path
    const books = listBooksBySeries(db, seriesId)
    for (const book of books) {
      await moveBookToSeries(ctx, book.id, newName)
    }
    return { series: getSeries(db, targetExisting.id) as Series }
  }

  // Pure rename path
  const books = listBooksBySeries(db, seriesId)
  for (const book of books) {
    await moveBookToSeries(ctx, book.id, newName)
  }
  const renamed = getSeriesByName(db, newName) as Series
  return { series: renamed }
}

export async function reorganizeLibrary(ctx: Ctx): Promise<{ moved: number }> {
  const { db } = ctx
  const allBooks = db.prepare('SELECT id, series_id, file_path FROM book').all() as Array<{
    id: number
    series_id: number
    file_path: string
  }>
  let moved = 0
  for (const row of allBooks) {
    const series = getSeries(db, row.series_id)
    if (!series) continue
    const expectedFolder = sanitizeSeriesFolder(series.name)
    const currentFolder = dirname(row.file_path)
    if (currentFolder !== expectedFolder) {
      await moveBookToSeries(ctx, row.id, series.name)
      moved++
    }
  }
  return { moved }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/library.test.ts
```
Expected: all 5 tests PASS

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
npx vitest run
```
Expected: all prior tests still pass

- [ ] **Step 6: Commit**

```bash
git add server/services/library.ts test/library.test.ts
git commit -m "feat: add library service (moveBookToSeries, renameSeries, reorganizeLibrary)"
```

---

### Task 4: Backend routes — PATCH /api/series/:id, PUT /api/books/:id/series, updated scan

**Files:**
- Modify: `server/routes/series.ts` (add PATCH route)
- Modify: `server/routes/books.ts` (add PUT route)
- Modify: `server/routes/scan.ts` (call reorganizeLibrary, return reorganized)

**Interfaces:**
- Consumes:
  - `moveBookToSeries(ctx, bookId, seriesName)` from `../services/library.js`
  - `renameSeries(ctx, seriesId, newName)` from `../services/library.js`
  - `reorganizeLibrary(ctx)` from `../services/library.js`
- Produces:
  - `PATCH /api/series/:id` body `{ name: string }` → `{ series: Series }` (400 if name blank; 404 if not found)
  - `PUT /api/books/:id/series` body `{ name: string }` → `{ book: Book; series: Series }` (400 if name blank; 404 if book not found)
  - `POST /api/scan` → `{ added: number; total: number; reorganized: number }`

- [ ] **Step 1: Write failing route tests in `test/routes-library.test.ts`**

```typescript
import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import seriesRoutes from '../server/routes/series.js'
import booksRoutes from '../server/routes/books.js'
import { upsertSeries } from '../server/models/series.js'
import { insertBook } from '../server/models/books.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rt-'))
  const config = {
    comicsDir: join(dir, 'comics'),
    thumbsDir: join(dir, 'thumbs'),
  } as Config
  mkdirSync(config.comicsDir, { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(seriesRoutes)
  await app.register(booksRoutes)
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('PATCH /api/series/:id renames series', async () => {
  // Set up series with a book on disk
  const srcDir = join(app.config.comicsDir, 'OldName')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(app.db, { name: 'OldName', folder: 'OldName' })
  insertBook(app.db, { seriesId: series.id, filePath: 'OldName/issue.cbz', pageCount: 1, fileSize: 100 })

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/series/${series.id}`,
    payload: { name: 'NewName' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().series.name).toBe('NewName')
})

test('PATCH /api/series/:id 400 on blank name', async () => {
  const series = upsertSeries(app.db, { name: 'Test', folder: 'Test' })
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/series/${series.id}`,
    payload: { name: '   ' },
  })
  expect(res.statusCode).toBe(400)
})

test('PATCH /api/series/:id 404 on missing series', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/series/99999',
    payload: { name: 'Something' },
  })
  expect(res.statusCode).toBe(404)
})

test('PUT /api/books/:id/series moves book to named series', async () => {
  const srcDir = join(app.config.comicsDir, 'Source')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(app.db, { name: 'Source', folder: 'Source' })
  const book = insertBook(app.db, { seriesId: series.id, filePath: 'Source/issue.cbz', pageCount: 1, fileSize: 100 })!

  const res = await app.inject({
    method: 'PUT',
    url: `/api/books/${book.id}/series`,
    payload: { name: 'Target' },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.book.filePath).toBe('Target/issue.cbz')
  expect(body.series.name).toBe('Target')
})

test('PUT /api/books/:id/series 400 on blank name', async () => {
  const series = upsertSeries(app.db, { name: 'S', folder: 'S' })
  const book = insertBook(app.db, { seriesId: series.id, filePath: 'S/a.cbz', pageCount: 1, fileSize: 100 })!
  const res = await app.inject({
    method: 'PUT',
    url: `/api/books/${book.id}/series`,
    payload: { name: '' },
  })
  expect(res.statusCode).toBe(400)
})

test('PUT /api/books/:id/series 404 on missing book', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/books/99999/series',
    payload: { name: 'Target' },
  })
  expect(res.statusCode).toBe(404)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/routes-library.test.ts
```
Expected: FAIL (routes not implemented)

- [ ] **Step 3: Add PATCH route to `server/routes/series.ts`**

Update the imports at top to add library service:
```typescript
import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { listSeries, getSeries } from '../models/series.js'
import { listBooksBySeries } from '../models/books.js'
import { renameSeries } from '../services/library.js'
import type { App } from '../types.js'

interface IdParams { id: string }
interface RenameBody { name?: string }
```

Inside `seriesRoutes` function, add after the existing routes:
```typescript
  app.patch<{ Params: IdParams; Body: RenameBody }>('/api/series/:id', async (req, reply) => {
    const name = (req.body?.name ?? '').trim()
    if (!name) return reply.code(400).send({ error: 'name is required' })
    const existing = getSeries(app.db, Number(req.params.id))
    if (!existing) return reply.code(404).send({ error: 'series not found' })
    const result = await renameSeries({ db: app.db, config: app.config }, existing.id, name)
    return { series: result.series }
  })
```

- [ ] **Step 4: Add PUT route to `server/routes/books.ts`**

Update imports at top of `books.ts` to add library service:
```typescript
import { moveBookToSeries } from '../services/library.js'
```

Add new interface and route inside `booksRoutes` function:
```typescript
  interface MoveSeriesBody { name?: string }

  app.put<{ Params: IdParams; Body: MoveSeriesBody }>('/api/books/:id/series', async (req, reply) => {
    const name = (req.body?.name ?? '').trim()
    if (!name) return reply.code(400).send({ error: 'name is required' })
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const result = await moveBookToSeries({ db: app.db, config: app.config }, book.id, name)
    return { book: result.book, series: result.series }
  })
```

- [ ] **Step 5: Update `server/routes/scan.ts` to call reorganizeLibrary**

```typescript
import { scanLibrary } from '../services/indexer.js'
import { reorganizeLibrary } from '../services/library.js'
import type { App } from '../types.js'

export default async function scanRoutes(app: App) {
  app.post('/api/scan', async () => {
    const { added, total } = await scanLibrary({ db: app.db, config: app.config })
    const { moved: reorganized } = await reorganizeLibrary({ db: app.db, config: app.config })
    return { added, total, reorganized }
  })
}
```

- [ ] **Step 6: Run route tests**

```bash
npx vitest run test/routes-library.test.ts
```
Expected: all 6 tests PASS

- [ ] **Step 7: Run full test suite**

```bash
npx vitest run
```
Expected: all tests PASS

- [ ] **Step 8: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add server/routes/series.ts server/routes/books.ts server/routes/scan.ts test/routes-library.test.ts
git commit -m "feat: add PATCH /api/series/:id, PUT /api/books/:id/series, reorganize on scan"
```

---

### Task 5: Frontend — `src/api.ts` additions

**Files:**
- Modify: `src/api.ts` (add `renameSeries` and `moveBookSeries`)

**Interfaces:**
- Consumes: existing `json<T>` helper, existing typed response interfaces
- Produces:
  - `api.renameSeries(id: number | string, name: string): Promise<{ series: ApiSeries }>`
  - `api.moveBookSeries(id: number | string, name: string): Promise<{ book: ApiBook; series: ApiSeries }>`

- [ ] **Step 1: Add new response interfaces and API methods to `src/api.ts`**

After the existing `CvSearchResponse` interface (line ~49), add:
```typescript
export interface RenameSeriesResponse { series: ApiSeries }
export interface MoveBookSeriesResponse { book: ApiBook; series: ApiSeries }
```

Inside the `api` object, add after the `embed` method:
```typescript
  renameSeries: (id: string | number, name: string) =>
    json<RenameSeriesResponse>(`/api/series/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    }),
  moveBookSeries: (id: string | number, name: string) =>
    json<MoveBookSeriesResponse>(`/api/books/${id}/series`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    }),
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/api.ts
git commit -m "feat: add renameSeries and moveBookSeries to API client"
```

---

### Task 6: Frontend — Series page inline rename

**Files:**
- Modify: `src/pages/Series.tsx`

**Interfaces:**
- Consumes:
  - `api.renameSeries(id, name): Promise<{ series: ApiSeries }>` (from Task 5)
  - `useNavigate` from `react-router-dom`
  - `useMutation`, `useQueryClient` from `@tanstack/react-query`
- Produces: Inline edit affordance next to the series title — pencil button toggles text input + Save/Cancel; Save calls renameSeries, on success navigate to `/series/<returned id>`

- [ ] **Step 1: Update `src/pages/Series.tsx`**

Replace the entire file content with:
```typescript
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import CoverTile from '../components/CoverTile'

export default function Series() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['series', id],
    queryFn: () => api.getSeriesDetail(id!),
  })

  const rename = useMutation({
    mutationFn: (name: string) => api.renameSeries(id!, name),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['series'] })
      setEditing(false)
      navigate(`/series/${result.series.id}`)
    },
  })

  const handleEditClick = () => {
    setNameInput(data?.series.name ?? '')
    setEditing(true)
  }

  const handleSave = () => {
    const trimmed = nameInput.trim()
    if (trimmed) rename.mutate(trimmed)
  }

  if (isLoading) return <p>Loading…</p>
  if (!data) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {editing ? (
          <>
            <input
              className="field-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              autoFocus
            />
            <button className="btn" onClick={handleSave} disabled={rename.isPending}>Save</button>
            <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <h1 className="page-title">{data.series.name}</h1>
            <button className="btn-ghost" onClick={handleEditClick} title="Edit series name">✏️</button>
          </>
        )}
      </div>
      {rename.isError && <p style={{ color: 'red' }}>Rename failed: {rename.error?.message}</p>}
      {data.series.summary && <p className="page-subtitle">{data.series.summary}</p>}
      <div className="tile-grid">
        {data.books.map((b) => (
          <CoverTile
            key={b.id}
            to={`/book/${b.id}`}
            img={`/api/books/${b.id}/thumbnail`}
            title={b.title || `#${b.number ?? '?'}`}
            subtitle={b.number ? `#${b.number}` : ''}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/Series.tsx
git commit -m "feat: add inline series rename on Series page"
```

---

### Task 7: Frontend — BookDetail "Move to series" control

**Files:**
- Modify: `src/pages/BookDetail.tsx`

**Interfaces:**
- Consumes:
  - `api.moveBookSeries(id, name): Promise<{ book: ApiBook; series: ApiSeries }>` (from Task 5)
  - `api.getSeries(): Promise<{ series: ApiSeries[] }>` (existing)
- Produces: Series name display + text input with datalist (existing series names) + "Move" button; on success invalidate `['book', id]` and series queries

- [ ] **Step 1: Update `src/pages/BookDetail.tsx`**

Replace the entire file with:
```typescript
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import MetadataEditor from '../components/MetadataEditor'
import ComicVineMatchDialog from '../components/ComicVineMatchDialog'

export default function BookDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['book', id], queryFn: () => api.getBook(id!) })
  const { data: seriesData } = useQuery({ queryKey: ['series'], queryFn: () => api.getSeries() })

  const save = useMutation({
    mutationFn: (form: Record<string, unknown>) => api.patchMetadata(id!, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['book', id] }),
  })
  const apply = useMutation({
    mutationFn: (issueId: number) => api.applyIssue(id!, issueId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['book', id] }); setDialog(false) },
  })
  const embed = useMutation({
    mutationFn: () => api.embed(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['book', id] }),
  })
  const moveSeries = useMutation({
    mutationFn: (name: string) => api.moveBookSeries(id!, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['book', id] })
      qc.invalidateQueries({ queryKey: ['series'] })
      setMoveTarget(null)
    },
  })

  if (isLoading) return <p>Loading…</p>
  if (!data) return null
  const { book } = data

  const currentSeriesName = seriesData?.series.find((s) => s.id === book.seriesId)?.name ?? `Series #${book.seriesId}`
  const moveValue = moveTarget ?? currentSeriesName
  const metadataKey = [book.title, book.number, book.writer, book.penciller, book.date, book.summary].join('|')

  return (
    <div className="book-detail">
      <img src={`/api/books/${id}/thumbnail`} alt="" className="book-detail__cover" />
      <div className="book-detail__info">
        <h1 className="book-detail__title">{book.title || '(untitled)'}</h1>
        <p className="book-detail__meta">
          {book.pageCount} pages{book.comicinfoSynced ? ' · metadata embedded' : ''}
        </p>
        <div className="btn-row">
          <Link to={`/read/${id}`}><button className="btn">Read</button></Link>
          <button className="btn-ghost" onClick={() => setDialog(true)}>Fetch metadata</button>
          <button className="btn-ghost" onClick={() => embed.mutate()} disabled={embed.isPending}>Embed into file</button>
        </div>
        {embed.isError && <p className="book-detail__error">Embed failed: {embed.error?.message ?? 'Unknown error'}</p>}

        <div className="field">
          <label>Series</label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              list="series-list"
              value={moveValue}
              onChange={(e) => setMoveTarget(e.target.value)}
            />
            <datalist id="series-list">
              {seriesData?.series.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            <button
              className="btn-ghost"
              disabled={moveSeries.isPending || moveValue.trim() === currentSeriesName}
              onClick={() => { const t = moveValue.trim(); if (t) moveSeries.mutate(t) }}
            >
              Move
            </button>
          </div>
          {moveSeries.isError && <p style={{ color: 'red' }}>Move failed: {moveSeries.error?.message}</p>}
        </div>

        <div className="metadata-section">
          <MetadataEditor key={metadataKey} book={book} onSave={(form) => save.mutate(form)} />
        </div>
      </div>
      {dialog && (
        <ComicVineMatchDialog
          defaultQuery={book.title}
          onPick={(r) => apply.mutate(r.id)}
          onClose={() => setDialog(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```
Expected: all tests PASS (including all new ones)

- [ ] **Step 4: Run build**

```bash
npm run build
```
Expected: succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add src/pages/BookDetail.tsx
git commit -m "feat: add Move to series control on BookDetail page"
```

---

### Task 8: Final acceptance gate + single feature commit

**Files:** (no new files — just verification and squash commit)

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```
Expected: clean (0 errors)

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```
Expected: all tests pass (≥ 41 total: 35 prior + 6 new in library.test.ts + routes-library.test.ts + models-library.test.ts + paths.test.ts)

- [ ] **Step 3: Run build**

```bash
npm run build
```
Expected: TypeScript backend compiles + Vite frontend build succeeds

- [ ] **Step 4: Create single feature commit**

```bash
git log --oneline -10
```
Review commits from this feature. Then squash all feature commits into one:
```bash
git rebase -i HEAD~N  # where N = number of commits from this feature
```
Or, if you want to keep separate commits, simply create the final commit:
```bash
git commit --allow-empty -m "feat: series editing (rename/merge + move) with on-disk organization"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| `server/lib/paths.ts` with `sanitizeSeriesFolder` | Task 1 |
| Refactor `upload.ts` to import from paths.ts | Task 1 |
| `moveBookToSeries` with de-dupe collision | Task 3 |
| `renameSeries` MERGE path | Task 3 |
| `renameSeries` pure rename path | Task 3 |
| `reorganizeLibrary` | Task 3 |
| `setBookSeries` model helper | Task 2 |
| `getSeriesByName` model helper | Task 2 |
| `deleteSeries` model helper | Task 2 |
| `PATCH /api/series/:id` | Task 4 |
| `PUT /api/books/:id/series` | Task 4 |
| scan route calls reorganizeLibrary, returns reorganized | Task 4 |
| `api.renameSeries`, `api.moveBookSeries` in `src/api.ts` | Task 5 |
| Series page inline rename | Task 6 |
| BookDetail "Move to series" with datalist | Task 7 |
| Test: moveBookToSeries moves file, updates DB, prunes series | Task 3 |
| Test: collision de-dupe | Task 3 |
| Test: renameSeries MERGE | Task 3 |
| Test: renameSeries pure rename | Task 3 |
| Test: reorganizeLibrary | Task 3 |
| Test: route PUT /api/books/:id/series happy + 400 | Task 4 |
| Test: route PATCH /api/series/:id happy + 400 | Task 4 |
| Only `fs.rename`, never overwrite | Task 3 (dedupeDestPath) |
| `rmdir` non-recursive, ignore errors | Task 3 |

**Placeholder scan:** All steps have explicit code. No TBDs found.

**Type consistency check:**
- `sanitizeSeriesFolder` defined in Task 1, consumed in Task 3 ✓
- `setBookSeries(db, bookId, seriesId, filePath): Book` defined in Task 2, consumed in Task 3 ✓
- `getSeriesByName(db, name): Series | undefined` defined in Task 2, consumed in Task 3 ✓
- `deleteSeries(db, id): void` defined in Task 2, consumed in Task 3 ✓
- `moveBookToSeries(ctx, bookId, seriesName)` defined in Task 3, consumed in Task 4 ✓
- `renameSeries(ctx, seriesId, newName)` defined in Task 3, consumed in Task 4 ✓
- `reorganizeLibrary(ctx)` defined in Task 3, consumed in Task 4 ✓
- `api.renameSeries(id, name)` defined in Task 5, consumed in Task 6 ✓
- `api.moveBookSeries(id, name)` defined in Task 5, consumed in Task 7 ✓
