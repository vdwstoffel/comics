# Download Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the downloader's single slot with a durable queue you can enqueue into while one is running, reorder, cancel, retry and clear.

**Architecture:** A `download_queue` table in SQLite holds every download, alive or finished; the runner becomes a pool of workers that each loop on an atomic `takeNext`. Live byte counters stay in memory keyed by row id, because `received` changes on every chunk. Concurrency is one constant defaulting to 1.

**Tech Stack:** TypeScript throughout. Fastify + better-sqlite3 on the server, React + react-router + TanStack Query on the client, Vitest + Testing Library for tests.

**Spec:** `docs/superpowers/specs/2026-09-15-download-queue-design.md`

## Global Constraints

- **TypeScript only.** Server imports carry the `.js` extension (`../types.js`); `src/` imports carry none.
- **`src/` must never import from `server/`.** Duplicate a value with a comment saying why, as `src/pages/Edition.tsx` does for `YEAR_SLACK`.
- **No new dependencies.** Tests click with `fireEvent` from `@testing-library/react`; `@testing-library/user-event` was deliberately removed from this project.
- **Publisher/state strings are exact.** Queue states are `'queued' | 'running' | 'done' | 'failed'`.
- **BOTH typechecks must be clean:** `npx tsc --noEmit -p tsconfig.json` AND `npx tsc --noEmit -p tsconfig.server.json`. Run both every task — running only the server one let an error sit undetected for three tasks on the last feature.
- **Run tests with `npx vitest run <file>`.** The full suite is `npx vitest run` and currently passes **1055 tests across 81 files**.
- **Never test against the real library at `data/library.sqlite`.** Tests use `openDb(':memory:')` and temp dirs.
- **Commit after every task.** Do not squash tasks together.
- **`DOWNLOAD_CONCURRENCY` ships as 1.** The pool must support more; the default must be 1.

---

### Task 1: The queue table and its model

**Files:**
- Modify: `server/db.ts` (append to the `MIGRATION` template literal — note it is `MIGRATION`, not `SCHEMA`; the other caches live there)
- Create: `server/models/downloadQueue.ts`
- Test: `test/models-download-queue.test.ts`

**Interfaces:**
- Consumes: `Db` from `server/types.js`.
- Produces: everything below. Task 3 consumes all of it.

```ts
export type QueueState = 'queued' | 'running' | 'done' | 'failed'
export interface QueueEntry {
  id: number; position: number; state: QueueState; url: string
  edition?: string; cvIssueId?: number; label?: string; attempts: number
  fileName?: string; bookId?: number; error?: string
  queuedAt: string; startedAt?: string; finishedAt?: string
}
export interface EnqueueRequest { url: string; edition?: string; cvIssueId?: number; label?: string }
export const HISTORY_LIMIT: number
export function enqueue(db: Db, req: EnqueueRequest, now?: string):
  { queued: true; entry: QueueEntry } | { queued: false; duplicate: QueueEntry }
export function takeNext(db: Db, now?: string): QueueEntry | undefined
export function finish(db: Db, id: number, r: { bookId?: number; fileName?: string; error?: string }, now?: string): void
export function fail(db: Db, id: number, error: string, opts?: { retryAt: string }, now?: string): void
export function listQueue(db: Db): QueueEntry[]
export function listHistory(db: Db, limit?: number): QueueEntry[]
export function move(db: Db, id: number, toIndex: number): boolean
export function remove(db: Db, id: number): boolean
export function retry(db: Db, id: number): boolean
export function clearHistory(db: Db): void
export function recoverRunning(db: Db): number
export function pruneHistory(db: Db, keep?: number): void
export function findLiveByIssue(db: Db, cvIssueId: number): QueueEntry | undefined
```

- [ ] **Step 1: Write the failing test**

Create `test/models-download-queue.test.ts`:

```ts
import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  enqueue, takeNext, finish, fail, listQueue, listHistory, move, remove,
  retry, clearHistory, recoverRunning, pruneHistory, findLiveByIssue,
} from '../server/models/downloadQueue.js'

const db = () => openDb(':memory:')
const req = (n: number) => ({ url: `https://x.test/${n}`, label: `Item ${n}`, cvIssueId: 1000 + n })

test('enqueue assigns positions in the order things arrive', () => {
  const d = db()
  enqueue(d, req(1)); enqueue(d, req(2)); enqueue(d, req(3))
  expect(listQueue(d).map((e) => e.label)).toEqual(['Item 1', 'Item 2', 'Item 3'])
})

// The duplicate guard is the partial unique index, not a read-then-write: two presses in
// the same tick both reach the insert and the database rejects the second.
test('an issue already queued cannot be queued again', () => {
  const d = db()
  const first = enqueue(d, req(1))
  const second = enqueue(d, req(1))
  expect(first.queued).toBe(true)
  expect(second.queued).toBe(false)
  if (!second.queued) expect(second.duplicate.label).toBe('Item 1')
  expect(listQueue(d)).toHaveLength(1)
})

// The index covers live rows only, so finishing frees the issue to be fetched again.
test('a finished issue can be queued again', () => {
  const d = db()
  const first = enqueue(d, req(1))
  if (!first.queued) throw new Error('unreachable')
  finish(d, first.entry.id, { bookId: 7, fileName: 'x.cbz' })
  expect(enqueue(d, req(1)).queued).toBe(true)
})

// A pasted url carries no issue id, so the partial index does not apply to it.
test('two pasted urls with no issue id are both accepted', () => {
  const d = db()
  expect(enqueue(d, { url: 'https://x.test/a' }).queued).toBe(true)
  expect(enqueue(d, { url: 'https://x.test/a' }).queued).toBe(true)
})

test('takeNext marks the row running and hands it over once', () => {
  const d = db()
  enqueue(d, req(1)); enqueue(d, req(2))
  const first = takeNext(d)
  expect(first?.label).toBe('Item 1')
  expect(first?.state).toBe('running')
  expect(takeNext(d)?.label).toBe('Item 2')
  expect(takeNext(d)).toBeUndefined()
})

// not_before is what makes a retry a retry rather than a spin.
test('takeNext skips a row whose retry is still in the future', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d)
  fail(d, e.entry.id, 'boom', { retryAt: '2999-01-01T00:00:00.000Z' })
  expect(takeNext(d, '2026-09-15T00:00:00.000Z')).toBeUndefined()
  expect(takeNext(d, '2999-06-01T00:00:00.000Z')?.label).toBe('Item 1')
})

test('a failure with a retry goes back to the queue with attempts counted', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d)
  fail(d, e.entry.id, 'boom', { retryAt: '2026-01-01T00:00:00.000Z' })
  const [row] = listQueue(d)
  expect(row.state).toBe('queued')
  expect(row.attempts).toBe(1)
  expect(row.error).toBe('boom')
})

test('a failure with no retry is final and lands in history', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d)
  fail(d, e.entry.id, 'boom')
  expect(listQueue(d)).toEqual([])
  expect(listHistory(d)[0]).toMatchObject({ state: 'failed', error: 'boom' })
})

test('move reorders without leaving gaps or collisions', () => {
  const d = db()
  const ids = [1, 2, 3, 4].map((n) => { const e = enqueue(d, req(n)); if (!e.queued) throw new Error('x'); return e.entry.id })
  expect(move(d, ids[3], 0)).toBe(true)
  expect(listQueue(d).map((e) => e.label)).toEqual(['Item 4', 'Item 1', 'Item 2', 'Item 3'])
  expect(move(d, ids[0], 3)).toBe(true)
  expect(listQueue(d).map((e) => e.label)).toEqual(['Item 4', 'Item 2', 'Item 3', 'Item 1'])
  expect(new Set(listQueue(d).map((e) => e.position)).size).toBe(4)
})

test('a running row cannot be moved and an index off the end is refused', () => {
  const d = db()
  const e = enqueue(d, req(1)); enqueue(d, req(2))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d)
  expect(move(d, e.entry.id, 1)).toBe(false)
  expect(move(d, 999, 0)).toBe(false)
})

// A restart is not the download's fault, so it must not spend a retry.
test('recoverRunning puts a casualty back at the front without counting an attempt', () => {
  const d = db()
  enqueue(d, req(1)); enqueue(d, req(2))
  takeNext(d)
  expect(recoverRunning(d)).toBe(1)
  const q = listQueue(d)
  expect(q.map((e) => e.label)).toEqual(['Item 1', 'Item 2'])
  expect(q[0]).toMatchObject({ state: 'queued', attempts: 0, startedAt: undefined })
})

test('retry puts a failed row back at the end with its attempts reset', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  takeNext(d); fail(d, e.entry.id, 'boom')
  enqueue(d, req(2))
  expect(retry(d, e.entry.id)).toBe(true)
  expect(listQueue(d).map((x) => x.label)).toEqual(['Item 2', 'Item 1'])
  expect(listQueue(d)[1].attempts).toBe(0)
})

test('remove takes a row out and clearHistory empties the finished ones', () => {
  const d = db()
  const a = enqueue(d, req(1)); const b = enqueue(d, req(2))
  if (!a.queued || !b.queued) throw new Error('unreachable')
  expect(remove(d, a.entry.id)).toBe(true)
  expect(listQueue(d).map((e) => e.label)).toEqual(['Item 2'])
  takeNext(d); finish(d, b.entry.id, { bookId: 1 })
  expect(listHistory(d)).toHaveLength(1)
  clearHistory(d)
  expect(listHistory(d)).toEqual([])
})

test('history is pruned to the newest few', () => {
  const d = db()
  for (let n = 1; n <= 5; n++) {
    const e = enqueue(d, { url: `https://x.test/${n}`, label: `Item ${n}` })
    if (!e.queued) throw new Error('unreachable')
    takeNext(d)
    finish(d, e.entry.id, { bookId: n }, `2026-09-1${n}T00:00:00.000Z`)
  }
  pruneHistory(d, 2)
  expect(listHistory(d).map((e) => e.label)).toEqual(['Item 5', 'Item 4'])
})

test('findLiveByIssue sees a queued issue and not a finished one', () => {
  const d = db()
  const e = enqueue(d, req(1))
  if (!e.queued) throw new Error('unreachable')
  expect(findLiveByIssue(d, 1001)?.label).toBe('Item 1')
  takeNext(d); finish(d, e.entry.id, { bookId: 1 })
  expect(findLiveByIssue(d, 1001)).toBeUndefined()
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/models-download-queue.test.ts`
Expected: FAIL — cannot resolve `../server/models/downloadQueue.js`.

- [ ] **Step 3: Add the schema**

In `server/db.ts`, append inside the `MIGRATION` template literal, before its closing backtick:

```sql
-- Every download, alive or finished. `position` orders the live ones; the finished ones
-- are history until cleared. Live byte counts are deliberately NOT here - `received`
-- changes on every chunk and would be thousands of writes per download.
CREATE TABLE IF NOT EXISTS download_queue (
  id          INTEGER PRIMARY KEY,
  position    INTEGER NOT NULL,
  state       TEXT NOT NULL,
  url         TEXT NOT NULL,
  edition     TEXT,
  cv_issue_id INTEGER,
  label       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  -- Set only when a retry is deferred, so a lone failing item cannot be taken again the
  -- instant it fails.
  not_before  TEXT,
  file_name   TEXT,
  book_id     INTEGER,
  error       TEXT,
  queued_at   TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);

-- The duplicate guard. Partial, so it covers live rows only: a comic that finished or
-- failed can be queued again, and two simultaneous presses are separated by the database
-- rather than by a check that could interleave.
CREATE UNIQUE INDEX IF NOT EXISTS idx_download_queue_live_issue
  ON download_queue(cv_issue_id)
  WHERE cv_issue_id IS NOT NULL AND state IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_download_queue_state_position
  ON download_queue(state, position);
```

- [ ] **Step 4: Write the model**

Create `server/models/downloadQueue.ts`:

```ts
import type { Db } from '../types.js'

export type QueueState = 'queued' | 'running' | 'done' | 'failed'

/** How many finished rows are kept. A number, not a policy - see the spec's §9. */
export const HISTORY_LIMIT = 50

const LIVE = `('queued', 'running')`

export interface QueueEntry {
  id: number
  position: number
  state: QueueState
  url: string
  edition?: string
  cvIssueId?: number
  label?: string
  attempts: number
  fileName?: string
  bookId?: number
  error?: string
  queuedAt: string
  startedAt?: string
  finishedAt?: string
}

export interface EnqueueRequest {
  url: string
  edition?: string
  cvIssueId?: number
  label?: string
}

interface Row {
  id: number; position: number; state: QueueState; url: string
  edition: string | null; cv_issue_id: number | null; label: string | null
  attempts: number; file_name: string | null; book_id: number | null; error: string | null
  queued_at: string; started_at: string | null; finished_at: string | null
}

const COLS = `id, position, state, url, edition, cv_issue_id, label, attempts,
              file_name, book_id, error, queued_at, started_at, finished_at`

function toEntry(r: Row): QueueEntry {
  return {
    id: r.id, position: r.position, state: r.state, url: r.url, attempts: r.attempts,
    queuedAt: r.queued_at,
    ...(r.edition == null ? {} : { edition: r.edition }),
    ...(r.cv_issue_id == null ? {} : { cvIssueId: r.cv_issue_id }),
    ...(r.label == null ? {} : { label: r.label }),
    ...(r.file_name == null ? {} : { fileName: r.file_name }),
    ...(r.book_id == null ? {} : { bookId: r.book_id }),
    ...(r.error == null ? {} : { error: r.error }),
    ...(r.started_at == null ? {} : { startedAt: r.started_at }),
    ...(r.finished_at == null ? {} : { finishedAt: r.finished_at }),
  }
}

export function findLiveByIssue(db: Db, cvIssueId: number): QueueEntry | undefined {
  const row = db
    .prepare(`SELECT ${COLS} FROM download_queue WHERE cv_issue_id = ? AND state IN ${LIVE} LIMIT 1`)
    .get(cvIssueId) as Row | undefined
  return row ? toEntry(row) : undefined
}

/**
 * Add a download. A live duplicate is rejected by the partial unique index rather than by
 * a check here: two presses in the same tick both reach the insert, and only one can win.
 */
export function enqueue(
  db: Db,
  req: EnqueueRequest,
  now = new Date().toISOString(),
): { queued: true; entry: QueueEntry } | { queued: false; duplicate: QueueEntry } {
  const next = (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM download_queue WHERE state IN ${LIVE}`)
    .get() as { p: number }).p
  try {
    const info = db
      .prepare(`INSERT INTO download_queue (position, state, url, edition, cv_issue_id, label, queued_at)
                VALUES (?, 'queued', ?, ?, ?, ?, ?)`)
      .run(next, req.url, req.edition ?? null, req.cvIssueId ?? null, req.label ?? null, now)
    const row = db.prepare(`SELECT ${COLS} FROM download_queue WHERE id = ?`).get(info.lastInsertRowid) as Row
    return { queued: true, entry: toEntry(row) }
  } catch (err) {
    const existing = req.cvIssueId == null ? undefined : findLiveByIssue(db, req.cvIssueId)
    // Only a duplicate is expected here; anything else is a real fault and must not be
    // reported as "already queued".
    if (!existing) throw err
    return { queued: false, duplicate: existing }
  }
}

/**
 * The next eligible row, marked running in the same statement that selects it. That
 * atomicity is the whole mechanism that lets more than one worker share this queue.
 */
export function takeNext(db: Db, now = new Date().toISOString()): QueueEntry | undefined {
  const row = db
    .prepare(`UPDATE download_queue SET state = 'running', started_at = ?, not_before = NULL
              WHERE id = (
                SELECT id FROM download_queue
                WHERE state = 'queued' AND (not_before IS NULL OR not_before <= ?)
                ORDER BY position LIMIT 1
              )
              RETURNING ${COLS}`)
    .get(now, now) as Row | undefined
  return row ? toEntry(row) : undefined
}

export function finish(
  db: Db,
  id: number,
  r: { bookId?: number; fileName?: string; error?: string },
  now = new Date().toISOString(),
): void {
  db.prepare(`UPDATE download_queue
              SET state = 'done', book_id = ?, file_name = COALESCE(?, file_name),
                  error = ?, finished_at = ?
              WHERE id = ?`)
    .run(r.bookId ?? null, r.fileName ?? null, r.error ?? null, now, id)
  pruneHistory(db)
}

/**
 * With `retryAt`, back to the end of the queue and not eligible until then. Without it,
 * final. A cancel is a fail with no retryAt - stopping something is not a reason to
 * start it again.
 */
export function fail(
  db: Db,
  id: number,
  error: string,
  opts?: { retryAt: string },
  now = new Date().toISOString(),
): void {
  if (opts?.retryAt) {
    const next = (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM download_queue WHERE state IN ${LIVE}`)
      .get() as { p: number }).p
    db.prepare(`UPDATE download_queue
                SET state = 'queued', attempts = attempts + 1, error = ?,
                    not_before = ?, position = ?, started_at = NULL
                WHERE id = ?`)
      .run(error, opts.retryAt, next, id)
    return
  }
  db.prepare(`UPDATE download_queue
              SET state = 'failed', attempts = attempts + 1, error = ?, finished_at = ?
              WHERE id = ?`)
    .run(error, now, id)
  pruneHistory(db)
}

export function listQueue(db: Db): QueueEntry[] {
  return (db.prepare(`SELECT ${COLS} FROM download_queue WHERE state IN ${LIVE} ORDER BY position`)
    .all() as Row[]).map(toEntry)
}

export function listHistory(db: Db, limit = HISTORY_LIMIT): QueueEntry[] {
  return (db.prepare(`SELECT ${COLS} FROM download_queue
                      WHERE state IN ('done', 'failed')
                      ORDER BY finished_at DESC, id DESC LIMIT ?`)
    .all(limit) as Row[]).map(toEntry)
}

/** Move a queued row to a 0-based index in the live list, renumbering in one transaction. */
export function move(db: Db, id: number, toIndex: number): boolean {
  const live = listQueue(db)
  const from = live.findIndex((e) => e.id === id)
  // A running row is already downloading; there is nowhere useful to move it to.
  if (from === -1 || live[from].state === 'running') return false
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= live.length) return false

  const order = live.map((e) => e.id)
  order.splice(from, 1)
  order.splice(toIndex, 0, id)
  const set = db.prepare('UPDATE download_queue SET position = ? WHERE id = ?')
  db.transaction(() => { order.forEach((rowId, n) => set.run(n, rowId)) })()
  return true
}

export function remove(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM download_queue WHERE id = ?').run(id).changes > 0
}

/** A failed row back to the end of the queue, its attempts forgiven. */
export function retry(db: Db, id: number): boolean {
  const next = (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM download_queue WHERE state IN ${LIVE}`)
    .get() as { p: number }).p
  return db.prepare(`UPDATE download_queue
                     SET state = 'queued', attempts = 0, error = NULL, not_before = NULL,
                         position = ?, started_at = NULL, finished_at = NULL
                     WHERE id = ? AND state = 'failed'`)
    .run(next, id).changes > 0
}

export function clearHistory(db: Db): void {
  db.prepare(`DELETE FROM download_queue WHERE state IN ('done', 'failed')`).run()
}

/**
 * A row still marked running when the process starts is a casualty of the restart, not a
 * failure of the download: it goes back to the FRONT and spends no attempt. Its staging
 * file is already gone - index.ts sweeps tmpDir before the runner is built.
 */
export function recoverRunning(db: Db): number {
  const min = (db.prepare(`SELECT COALESCE(MIN(position), 0) AS p FROM download_queue WHERE state IN ${LIVE}`)
    .get() as { p: number }).p
  return db.prepare(`UPDATE download_queue SET state = 'queued', started_at = NULL, position = ?
                     WHERE state = 'running'`)
    .run(min - 1).changes
}

export function pruneHistory(db: Db, keep = HISTORY_LIMIT): void {
  db.prepare(`DELETE FROM download_queue WHERE id IN (
                SELECT id FROM download_queue WHERE state IN ('done', 'failed')
                ORDER BY finished_at DESC, id DESC LIMIT -1 OFFSET ?
              )`).run(keep)
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run test/models-download-queue.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Typecheck both projects**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add server/db.ts server/models/downloadQueue.ts test/models-download-queue.test.ts
git commit -m "feat: a durable download queue table and its model"
```

---

### Task 2: Make storing two comics at once safe

Independent of the queue and correct without it — the race is latent in today's code and only masked by there being one download at a time. Do it before the pool exists, so the pool never ships on top of it.

**Files:**
- Create: `server/lib/mutex.ts`
- Modify: `server/services/storeComic.ts`
- Test: `test/store-comic-concurrent.test.ts`

**Interfaces:**
- Produces: `createMutex(): <T>(fn: () => Promise<T>) => Promise<T>`

- [ ] **Step 1: Read the race before changing it**

Open `server/services/storeComic.ts` and find:

```ts
const destPath = dedupeDestPath(destDir, finalName)
await rename(cbzTmpPath, destPath)
```

`dedupeDestPath` is synchronous, so it cannot interleave with itself — but the `await` after it can. Two downloads can be handed the same free name because the first has not renamed yet. Both rename onto it: the second destroys the first's file and then fails the unique constraint on `book.file_path`. The comment above those lines names that exact failure.

- [ ] **Step 2: Write the failing test**

Create `test/store-comic-concurrent.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, copyFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { storeComic } from '../server/services/storeComic.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx, srcCbz: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'store-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'), tmpDir: join(dir, 'tmp'),
    maxUploadBytes: 5 * 1024 * 1024, comicVineApiKey: '',
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  ctx = { db: openDb(':memory:'), config }
  const src = mkdtempSync(join(tmpdir(), 'src-'))
  srcCbz = await makeCbz(src, ['p1.png', 'p2.png'], 'x.cbz')
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

function staged(n: number): string {
  const p = join(ctx.config.tmpDir, `staged-${n}.cbz`)
  copyFileSync(srcCbz, p)
  return p
}

// Both downloads resolve to the same final name. Serially this is fine - the second sees
// the first on disk and takes "(2)". Concurrently, without a lock, both are handed the
// same free name, the second rename destroys the first file, and one book row is lost.
//
// Removing the mutex from storeComic MUST make this test fail. A concurrency test that
// passes either way is testing nothing.
test('two comics storing at once under the same name both survive', async () => {
  const [a, b] = await Promise.all([
    storeComic(ctx, { tmpPath: staged(1), originalName: 'Venom 256.cbz', editionName: 'Venom' }),
    storeComic(ctx, { tmpPath: staged(2), originalName: 'Venom 256.cbz', editionName: 'Venom' }),
  ])

  expect(a.ok).toBe(true)
  expect(b.ok).toBe(true)
  const files = readdirSync(join(ctx.config.comicsDir, 'Venom', 'Venom'))
  expect(files).toHaveLength(2)
  expect(new Set(files).size).toBe(2)

  const books = ctx.db.prepare('SELECT file_path FROM book').all() as Array<{ file_path: string }>
  expect(books).toHaveLength(2)
  expect(new Set(books.map((r) => r.file_path)).size).toBe(2)
})
```

**Note:** the destination is `<comicsDir>/<series>/<edition>`. If the path in the assertion is wrong for this codebase's `editionFolderPath`, read that function and correct the path — do not weaken the assertion to `readdirSync` of a parent.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/store-comic-concurrent.test.ts`
Expected: FAIL — one file on disk, or a unique-constraint error from the second insert.

- [ ] **Step 4: Write the mutex**

Create `server/lib/mutex.ts`:

```ts
/**
 * Run functions one at a time, in call order.
 *
 * One process means a promise chain is a sufficient lock: there is no second event loop to
 * race with, and no file or advisory lock is needed. Keep critical sections small - every
 * caller waits for the one in front.
 */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    // Swallow here only so one caller's rejection cannot poison the queue behind it; the
    // rejection is still delivered to that caller through `run`.
    tail = run.catch(() => {})
    return run
  }
}
```

- [ ] **Step 5: Wrap the critical section**

In `server/services/storeComic.ts`, add at module scope:

```ts
import { createMutex } from '../lib/mutex.js'

/**
 * Picking a free filename and renaming onto it must be one step. dedupeDestPath is
 * synchronous, but the rename after it is not, so without this two concurrent stores are
 * handed the same free name and the second destroys the first file.
 *
 * Deliberately narrow: the Comic Vine naming lookup above stays OUTSIDE, or every
 * concurrent download would queue behind one slow API call.
 */
const renameLock = createMutex()
```

and replace the two lines from Step 1 with:

```ts
  const destPath = await renameLock(async () => {
    const claimed = dedupeDestPath(destDir, finalName)
    await rename(cbzTmpPath, claimed)
    return claimed
  })
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run test/store-comic-concurrent.test.ts`
Expected: PASS.

- [ ] **Step 7: Prove the test is a real guard**

Temporarily change the Step 5 block back to the unlocked two lines, re-run, and confirm the test FAILS. Then restore the lock and confirm it passes again. Record both outputs in your report. A concurrency test nobody has seen fail is not evidence.

- [ ] **Step 8: Check nothing else regressed, then commit**

Run: `npx vitest run test/upload.test.ts test/download-runner.test.ts test/store-comic-concurrent.test.ts` (if `test/upload.test.ts` does not exist, run `npx vitest run` and note the total)
Expected: PASS.

```bash
git add server/lib/mutex.ts server/services/storeComic.ts test/store-comic-concurrent.test.ts
git commit -m "fix: claim a destination filename and rename to it as one step"
```

---

### Task 3: The runner becomes a queue drain

`start` is replaced by `enqueue`, `status` returns the queue, and the nine existing tests in `test/download-runner.test.ts` are rewritten against the new contract. Still one worker, no retry, no cancel — those arrive in Task 4.

**Files:**
- Modify: `server/services/downloader.ts`
- Modify: `test/download-runner.test.ts`
- Modify: `server/index.ts` (call `recoverRunning` at startup)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:

```ts
export const DOWNLOAD_CONCURRENCY: number  // 1
export interface ActiveDownload {
  id: number; label?: string; fileName: string | null
  received: number; total: number; startedAt: string
}
export interface DownloadRunner {
  status: () => { active: ActiveDownload[]; queue: QueueEntry[]; history: QueueEntry[] }
  enqueue: (req: DownloadRequest) => { queued: true; entry: QueueEntry } | { queued: false; duplicate: QueueEntry }
  idle: () => Promise<void>
}
export interface DownloadRequest { url: string; edition?: string; issueId?: string | number; label?: string }
```

- [ ] **Step 1: Rewrite the existing tests against the new contract**

In `test/download-runner.test.ts`, replace every `runner.start(...)` / `await done` pair with `runner.enqueue(...)` / `await runner.idle()`, and read results from `status().history[0]` instead of `status()`. Replace the whole of the old `only one download runs at a time` test with the two below. The other eight keep their intent exactly; only the calls change.

```ts
test('a download lands in the library and reports the book it became', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })

  const res = runner.enqueue({ url: OPAQUE, edition: 'Amazing Spider-Man (2025)' })
  expect(res.queued).toBe(true)
  await runner.idle()

  const [entry] = runner.status().history
  expect(entry.state).toBe('done')
  expect(entry.error).toBeUndefined()
  expect(entry.bookId).toBeGreaterThan(0)
  expect(entry.fileName).toBe('Amazing Spider-Man 031 (2026) (Digital).cbz')
  expect(runner.status().queue).toEqual([])
})

// Replaces "only one download runs at a time": enqueueing while busy is now the point.
test('a second download is queued rather than refused', async () => {
  const order: string[] = []
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async (input) => { order.push(String(input)); return respond(cbzBytes, { url: REDIRECTED }) },
  })

  expect(runner.enqueue({ url: `${OPAQUE}/1`, edition: 'ASM', label: 'one' }).queued).toBe(true)
  expect(runner.enqueue({ url: `${OPAQUE}/2`, edition: 'ASM', label: 'two' }).queued).toBe(true)
  await runner.idle()

  expect(order).toEqual([`${OPAQUE}/1`, `${OPAQUE}/2`])
  expect(runner.status().history.map((e) => e.label)).toEqual(['two', 'one'])
})

// At the shipped concurrency of 1 they run strictly one after another. Asserted by what
// overlapped, not by timing.
test('at concurrency 1 the second waits for the first to finish', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return respond(cbzBytes, { url: REDIRECTED })
    },
  })
  runner.enqueue({ url: `${OPAQUE}/1`, edition: 'ASM' })
  runner.enqueue({ url: `${OPAQUE}/2`, edition: 'ASM' })
  await runner.idle()
  expect(maxInFlight).toBe(1)
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/download-runner.test.ts`
Expected: FAIL — `runner.enqueue is not a function`.

- [ ] **Step 3: Rewrite the runner**

In `server/services/downloader.ts`: keep `resolveDownload` and the download body unchanged. Replace the `DownloadStatus`/`DownloadRunner` types and the returned object.

```ts
import {
  enqueue as enqueueRow, takeNext, finish, fail, listQueue, listHistory, recoverRunning,
} from '../models/downloadQueue.js'
import type { QueueEntry } from '../models/downloadQueue.js'

/**
 * How many downloads run at once. One constant, and it ships as 1.
 *
 * The pool supports more because `takeNext` marks a row in the statement that selects it,
 * so two workers cannot take the same one. Whether more is FASTER depends on where the
 * bottleneck is - a saturated link gains nothing, a host that throttles per connection
 * gains nearly linearly - and that is measured on the real link, not guessed here.
 */
export const DOWNLOAD_CONCURRENCY = 1

/** Live progress for one in-flight download. In memory: `received` changes per chunk. */
export interface ActiveDownload {
  id: number
  label?: string
  fileName: string | null
  received: number
  total: number
  startedAt: string
}

export interface DownloadRequest {
  url: string
  edition?: string
  issueId?: string | number
  label?: string
}

export interface DownloadRunner {
  status: () => { active: ActiveDownload[]; queue: QueueEntry[]; history: QueueEntry[] }
  enqueue: (req: DownloadRequest) => ReturnType<typeof enqueueRow>
  /** Resolves when nothing is in flight and nothing is takeable. Tests await it. */
  idle: () => Promise<void>
}
```

and the factory's returned object:

```ts
export function createDownloadRunner(ctx: Ctx, deps: DownloadDeps = {}): DownloadRunner {
  const { fetchImpl = fetch, maxBytes = ctx.config.maxUploadBytes, timeoutMs = HOUR } = deps

  const active = new Map<number, ActiveDownload>()
  let workers = 0
  let idleWaiters: Array<() => void> = []

  function settleIdle() {
    if (workers > 0) return
    for (const resolve of idleWaiters) resolve()
    idleWaiters = []
  }

  /** The body of one download. Unchanged from the old `run` except for where it reports. */
  async function runOne(entry: QueueEntry): Promise<void> {
    let tmpPath: string | undefined
    const live: ActiveDownload = {
      id: entry.id, label: entry.label, fileName: null, received: 0, total: 0,
      startedAt: entry.startedAt ?? new Date().toISOString(),
    }
    active.set(entry.id, live)
    try {
      // Checked before anything is fetched: a scheme we do not speak is a mistake, and
      // file:// in particular would hand the local disk to whoever typed the box.
      let parsed: URL
      try { parsed = new URL(entry.url) } catch { throw new Error('not a valid url') }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('only http and https urls can be downloaded')
      }

      const res = await fetchImpl(entry.url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())

      // The name lives on the url the request LANDED on, not the one that was pasted:
      // a download link is often an opaque token that redirects to the real file.
      const landedOn = res.url || entry.url
      const named = downloadFileName(landedOn, res.headers.get('content-disposition'))
      const fileName = named ?? `download-${randomUUID()}.cbz`
      const claimed = Number(res.headers.get('content-length'))
      live.fileName = fileName
      live.total = Number.isFinite(claimed) && claimed > 0 ? claimed : 0

      tmpPath = join(ctx.config.tmpDir, `${randomUUID()}${extname(fileName) || '.cbz'}`)
      if (!res.body) throw new Error('the response had no body')

      // Counted as it streams. Content-Length is the server's claim; the cap has to hold
      // against a lie, so it is the bytes actually seen that stop this.
      async function* counting(source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          live.received += chunk.length
          if (live.received > maxBytes) throw new Error('file too large')
          yield chunk
        }
      }
      await pipeline(counting(Readable.fromWeb(res.body as never)), createWriteStream(tmpPath))

      const result = await storeComic(ctx, {
        tmpPath, originalName: fileName, editionName: entry.edition, issueId: entry.cvIssueId,
      })
      // storeComic consumes the tmp file either way, so there is nothing left to clean.
      tmpPath = undefined
      if (!result.ok) throw new Error(result.error)

      finish(ctx.db, entry.id, { bookId: result.book?.id, fileName })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (tmpPath) await unlink(tmpPath).catch(() => {})
      fail(ctx.db, entry.id, message)
    } finally {
      active.delete(entry.id)
    }
  }

  function wake(): void {
    while (workers < DOWNLOAD_CONCURRENCY) {
      const entry = takeNext(ctx.db)
      if (!entry) break
      workers++
      void runOne(entry).finally(() => { workers--; wake(); settleIdle() })
    }
    settleIdle()
  }

  return {
    status: () => ({
      active: [...active.values()],
      queue: listQueue(ctx.db),
      history: listHistory(ctx.db),
    }),
    enqueue(req) {
      const res = enqueueRow(ctx.db, {
        url: req.url, edition: req.edition, label: req.label,
        cvIssueId: req.issueId == null ? undefined : Number(req.issueId),
      })
      if (res.queued) wake()
      return res
    },
    idle: () => new Promise<void>((resolve) => {
      if (workers === 0 && !listQueue(ctx.db).some((e) => e.state === 'queued')) return resolve()
      idleWaiters.push(resolve)
    }),
  }
}
```

**Note on `idle()`:** it must not resolve while queued rows remain takeable. If the implementation above proves racy in practice, have `settleIdle` also check `listQueue` for takeable rows before resolving — the tests in Step 1 are the arbiter.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run test/download-runner.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Recover restart casualties at startup**

In `server/index.ts`, immediately before `app.decorate('downloader', ...)`:

```ts
  // A row still marked running belongs to a process that is gone. Its staging file went
  // with the tmp sweep above; the row goes back to the front of the queue.
  const requeued = recoverRunning(db)
  if (requeued) console.log(`requeued ${requeued} interrupted download${requeued === 1 ? '' : 's'}`)
```

with `import { recoverRunning } from './models/downloadQueue.js'` at the top.

- [ ] **Step 6: Typecheck both, then commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json`

The client will NOT typecheck yet if `src/` still reads the old `DownloadStatus` shape — that is Task 6. If the only errors are in `src/lib/useDownload.ts`, `src/components/DownloadBar.tsx` or `src/api.ts`, note them in your report and continue; any error in `server/` or `test/` must be fixed now.

```bash
git add server/services/downloader.ts server/index.ts test/download-runner.test.ts
git commit -m "feat: drain a queue instead of holding one download"
```

---

### Task 4: Retry, cancel, and the worker pool

**Files:**
- Modify: `server/services/downloader.ts`
- Test: `test/download-runner.test.ts`

**Interfaces:**
- Produces, on `DownloadRunner`: `cancel(id: number): boolean` and `wake(): void`. Plus
  `RETRY_BACKOFF_MS`. `wake` is public because a route that puts a row back in the queue
  without going through `enqueue` — the retry route — still has to start the pool.

- [ ] **Step 1: Write the failing tests**

Append to `test/download-runner.test.ts`:

```ts
test('a failure is retried once and then given up on', async () => {
  let calls = 0
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => { calls++; throw new Error('network down') },
    retryBackoffMs: 0,
  })
  runner.enqueue({ url: OPAQUE, edition: 'ASM', label: 'doomed' })
  await runner.idle()

  expect(calls).toBe(2)
  const [entry] = runner.status().history
  expect(entry).toMatchObject({ state: 'failed', attempts: 2, label: 'doomed' })
})

// A retry must not be taken the instant it fails, or one bad link becomes a hot loop.
test('a retry is not eligible until its backoff has passed', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => { throw new Error('network down') },
    retryBackoffMs: 50_000,
  })
  runner.enqueue({ url: OPAQUE, edition: 'ASM' })
  await runner.idle()

  const [queued] = runner.status().queue
  expect(queued).toMatchObject({ state: 'queued', attempts: 1 })
})

test('cancelling a queued download removes it and leaves the rest alone', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })
  const a = runner.enqueue({ url: `${OPAQUE}/1`, edition: 'ASM', label: 'one' })
  const b = runner.enqueue({ url: `${OPAQUE}/2`, edition: 'ASM', label: 'two' })
  if (!a.queued || !b.queued) throw new Error('unreachable')

  expect(runner.cancel(b.entry.id)).toBe(true)
  await runner.idle()
  expect(runner.status().history.map((e) => e.label)).toEqual(['one'])
})

// Stopping something is not a reason to start it again.
test('cancelling a running download aborts it and does not retry it', async () => {
  let calls = 0
  const runner = createDownloadRunner(ctx, {
    retryBackoffMs: 0,
    fetchImpl: async (_input, init) => {
      calls++
      await new Promise((resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
        setTimeout(resolve, 1000)
      })
      return respond(cbzBytes, { url: REDIRECTED })
    },
  })
  const a = runner.enqueue({ url: OPAQUE, edition: 'ASM', label: 'stopped' })
  if (!a.queued) throw new Error('unreachable')

  await new Promise((r) => setTimeout(r, 10))
  expect(runner.cancel(a.entry.id)).toBe(true)
  await runner.idle()

  expect(calls).toBe(1)
  expect(runner.status().history[0]).toMatchObject({ state: 'failed', label: 'stopped' })
})

// The pool is the point of DOWNLOAD_CONCURRENCY existing at all.
test('at concurrency 2 two downloads are in flight and no row is taken twice', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const runner = createDownloadRunner(ctx, {
    concurrency: 2,
    fetchImpl: async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight--
      return respond(cbzBytes, { url: REDIRECTED })
    },
  })
  for (const n of [1, 2, 3]) runner.enqueue({ url: `${OPAQUE}/${n}`, edition: 'ASM', label: `i${n}` })
  await runner.idle()

  const done = runner.status().history
  expect(done).toHaveLength(3)
  expect(new Set(done.map((e) => e.id)).size).toBe(3)
  expect(maxInFlight).toBe(2)
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/download-runner.test.ts`
Expected: FAIL — `runner.cancel is not a function`, and the retry tests see `attempts: 1`.

- [ ] **Step 3: Implement retry, cancel and the configurable pool**

In `server/services/downloader.ts`:

```ts
/** How long a failed download waits before it is eligible again. */
export const RETRY_BACKOFF_MS = 30_000
/** At most this many attempts per download: the first, and one retry. */
const MAX_ATTEMPTS = 2
```

Extend `DownloadDeps` with `concurrency?: number` and `retryBackoffMs?: number`, defaulting to `DOWNLOAD_CONCURRENCY` and `RETRY_BACKOFF_MS`.

Add to the factory:

```ts
  const controllers = new Map<number, AbortController>()
  const cancelled = new Set<number>()
  let retryTimer: ReturnType<typeof setTimeout> | undefined
```

In `runOne`, create an `AbortController` per row, store it in `controllers`, pass `controller.signal` to `fetchImpl` — combining it with the existing timeout via `AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])` — and delete it in the `finally`.

Replace the catch with:

```ts
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (tmpPath) await unlink(tmpPath).catch(() => {})
      // A cancel and a failure both land here, and only one of them deserves a retry.
      if (cancelled.has(entry.id)) {
        cancelled.delete(entry.id)
        fail(ctx.db, entry.id, 'cancelled')
      } else if (entry.attempts + 1 < MAX_ATTEMPTS) {
        fail(ctx.db, entry.id, message, { retryAt: new Date(Date.now() + retryBackoffMs).toISOString() })
      } else {
        fail(ctx.db, entry.id, message)
      }
    }
```

Add `cancel` to the returned object:

```ts
    wake,
    cancel(id) {
      const controller = controllers.get(id)
      if (controller) {
        // Marked before aborting, so the catch can tell this from a genuine failure.
        cancelled.add(id)
        controller.abort()
        return true
      }
      return removeRow(ctx.db, id)
    },
```

(`removeRow` is `remove` from the model, imported under an alias to avoid shadowing.)

In `wake`, when nothing is takeable but a queued row has a future `not_before`, set `retryTimer` for the earliest and have it call `wake` again. `idle()` must resolve once nothing is in flight and nothing is takeable — a row waiting on its backoff counts as takeable for this purpose, so tests with a long backoff see it in `queue` rather than hanging.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run test/download-runner.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Typecheck the server, then commit**

Run: `npx tsc --noEmit -p tsconfig.server.json`

```bash
git add server/services/downloader.ts test/download-runner.test.ts
git commit -m "feat: retry a failed download once, cancel a running one, pool the workers"
```

---

### Task 5: The routes

**Files:**
- Modify: `server/routes/downloads.ts`
- Modify: `server/services/issueDownload.ts`
- Test: `test/routes-downloads.test.ts` (new), plus the existing `test/routes-editions-download-issue.test.ts` and `test/routes-releases-download.test.ts` must keep passing

**Interfaces:**
- Consumes: the runner from Tasks 3–4, the model from Task 1.
- Produces: the eight routes in the spec's §4.4.

- [ ] **Step 1: Establish the baseline**

Run: `npx vitest run test/routes-editions-download-issue.test.ts test/routes-releases-download.test.ts`
Expected: PASS. Note both counts; they must be identical at the end of this task.

- [ ] **Step 2: Swap `busy` for `duplicate` in the shared service**

In `server/services/issueDownload.ts`:

```ts
export type IssueDownloadResult =
  | { ok: true; entry: QueueEntry }
  | { ok: false; code: 404 | 409 | 502; reason: 'no-match' | 'duplicate' | 'unreadable' | 'no-link'; error: string; entry?: QueueEntry }
```

and replace the tail:

```ts
  const res = app.downloader.enqueue({ url, edition: editionName, issueId: issue.id, label })
  if (!res.queued) {
    return {
      ok: false, code: 409, reason: 'duplicate',
      error: 'that issue is already queued', entry: res.duplicate,
    }
  }
  return { ok: true, entry: res.entry }
```

Add `label` to the function's parameter object — the two callers pass `Wolverine #27`-style text (spec §3, *Labels*).

- [ ] **Step 3: Update the two issue-download routes**

In `server/routes/editions.ts` and `server/routes/releases.ts`, the handlers currently special-case `result.reason === 'busy'` and send `{ started: false, status }`. Replace both with:

```ts
      if (!result.ok) return reply.code(result.code).send({ error: result.error, entry: result.entry })
      return reply.code(202).send({ queued: true, entry: result.entry })
```

and pass a label when calling `startIssueDownload`:

- editions: `label: [edition.cvName, issue.number && `#${issue.number}`].filter(Boolean).join(' ')`
- releases: `label: [issue.volumeName, issue.number && `#${issue.number}`].filter(Boolean).join(' ')`

Their existing tests assert 202 and the downloader being called; adjust ONLY assertions that named the old `{ started, status }` body, and say in your report exactly which ones you changed and why.

- [ ] **Step 4: Write the failing route tests**

Create `test/routes-downloads.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import downloadRoutes from '../server/routes/downloads.js'
import { openDb } from '../server/db.js'
import { enqueue, takeNext, fail, listQueue } from '../server/models/downloadQueue.js'
import type { Config } from '../server/config.js'

async function setup() {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  const cancel = vi.fn(() => true)
  app.decorate('downloader', {
    status: () => ({ active: [], queue: listQueue(db), history: [] }),
    enqueue: (req: { url: string }) => enqueue(db, { url: req.url }),
    cancel,
    idle: async () => {},
  } as never)
  await app.register(downloadRoutes)
  return { app, db, cancel, cleanup: async () => { await app.close() } }
}

test('the status endpoint reports active, queue and history', async () => {
  const t = await setup()
  try {
    const body = (await t.app.inject({ url: '/api/downloads' })).json()
    expect(body).toHaveProperty('active')
    expect(body).toHaveProperty('queue')
    expect(body).toHaveProperty('history')
  } finally { await t.cleanup() }
})

test('a pasted url is queued', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'POST', url: '/api/downloads', payload: { url: 'https://x.test/a' },
    })
    expect(res.statusCode).toBe(202)
    expect(res.json().entry.url).toBe('https://x.test/a')
  } finally { await t.cleanup() }
})

test('a post with no url is refused', async () => {
  const t = await setup()
  try {
    expect((await t.app.inject({ method: 'POST', url: '/api/downloads', payload: {} })).statusCode).toBe(400)
  } finally { await t.cleanup() }
})

test('cancelling asks the runner, which owns the abort', async () => {
  const t = await setup()
  const e = enqueue(t.db, { url: 'https://x.test/a' })
  if (!e.queued) throw new Error('unreachable')
  try {
    const res = await t.app.inject({ method: 'DELETE', url: `/api/downloads/queue/${e.entry.id}` })
    expect(res.statusCode).toBe(200)
    expect(t.cancel).toHaveBeenCalledWith(e.entry.id)
  } finally { await t.cleanup() }
})

test('a failed download can be retried', async () => {
  const t = await setup()
  const e = enqueue(t.db, { url: 'https://x.test/a' })
  if (!e.queued) throw new Error('unreachable')
  takeNext(t.db); fail(t.db, e.entry.id, 'boom')
  try {
    const res = await t.app.inject({ method: 'POST', url: `/api/downloads/queue/${e.entry.id}/retry` })
    expect(res.statusCode).toBe(200)
    expect(listQueue(t.db)).toHaveLength(1)
  } finally { await t.cleanup() }
})

test('moving a row reorders the queue', async () => {
  const t = await setup()
  const a = enqueue(t.db, { url: 'https://x.test/a', label: 'a' })
  enqueue(t.db, { url: 'https://x.test/b', label: 'b' })
  if (!a.queued) throw new Error('unreachable')
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: `/api/downloads/queue/${a.entry.id}`, payload: { index: 1 },
    })
    expect(res.statusCode).toBe(200)
    expect(listQueue(t.db).map((e) => e.label)).toEqual(['b', 'a'])
  } finally { await t.cleanup() }
})

// An index off the end must be refused rather than silently corrupting the order.
test('moving to an index outside the queue is refused', async () => {
  const t = await setup()
  const a = enqueue(t.db, { url: 'https://x.test/a' })
  if (!a.queued) throw new Error('unreachable')
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: `/api/downloads/queue/${a.entry.id}`, payload: { index: 9 },
    })
    expect(res.statusCode).toBe(400)
  } finally { await t.cleanup() }
})

test('clearing history empties the finished rows', async () => {
  const t = await setup()
  const e = enqueue(t.db, { url: 'https://x.test/a' })
  if (!e.queued) throw new Error('unreachable')
  takeNext(t.db); fail(t.db, e.entry.id, 'boom')
  try {
    expect((await t.app.inject({ method: 'DELETE', url: '/api/downloads/history' })).statusCode).toBe(200)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM download_queue').get()).toEqual({ n: 0 })
  } finally { await t.cleanup() }
})
```

- [ ] **Step 5: Run them and watch them fail**

Run: `npx vitest run test/routes-downloads.test.ts`
Expected: FAIL — 404 on the routes that do not exist yet.

- [ ] **Step 6: Write the routes**

Rewrite `server/routes/downloads.ts`:

```ts
import { resolveDownload } from '../services/downloader.js'
import { move, retry, clearHistory } from '../models/downloadQueue.js'
import type { App } from '../types.js'

interface ResolveBody { url?: string }
interface StartBody { url?: string; edition?: string; issueId?: number | string; label?: string }
interface IdParams { id: string }

export default async function downloadRoutes(app: App) {
  app.post<{ Body: ResolveBody }>('/api/downloads/resolve', async (req, reply) => {
    const url = req.body?.url?.trim()
    if (!url) return reply.code(400).send({ error: 'missing url' })
    try {
      return await resolveDownload(url)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'could not resolve url' })
    }
  })

  app.get('/api/downloads', async () => app.downloader.status())

  app.post<{ Body: StartBody }>('/api/downloads', async (req, reply) => {
    const url = req.body?.url?.trim()
    if (!url) return reply.code(400).send({ error: 'missing url' })
    const res = app.downloader.enqueue({
      url,
      edition: req.body?.edition?.trim() || undefined,
      issueId: req.body?.issueId,
      // A pasted link has no issue to name it after; the url stands in until the
      // response says what the file is called.
      label: req.body?.label?.trim() || url,
    })
    if (!res.queued) {
      return reply.code(409).send({ error: 'that is already queued', entry: res.duplicate })
    }
    return reply.code(202).send({ queued: true, entry: res.entry })
  })

  // Cancel goes through the runner, not the model: a running row needs its fetch aborted,
  // and only the runner holds that controller.
  app.delete<{ Params: IdParams }>('/api/downloads/queue/:id', async (req, reply) => {
    if (!app.downloader.cancel(Number(req.params.id))) {
      return reply.code(404).send({ error: 'not in the queue' })
    }
    return { cancelled: true }
  })

  // The row goes back through the model, so the pool has to be told by hand - nothing
  // was enqueued and nothing would otherwise wake it.
  app.post<{ Params: IdParams }>('/api/downloads/queue/:id/retry', async (req, reply) => {
    if (!retry(app.db, Number(req.params.id))) {
      return reply.code(404).send({ error: 'no failed download with that id' })
    }
    app.downloader.wake()
    return { retried: true }
  })

  app.patch<{ Params: IdParams; Body: { index?: number } }>('/api/downloads/queue/:id', async (req, reply) => {
    const index = req.body?.index
    if (typeof index !== 'number') return reply.code(400).send({ error: 'missing index' })
    if (!move(app.db, Number(req.params.id), index)) {
      return reply.code(400).send({ error: 'cannot move that download there' })
    }
    return { moved: true }
  })

  app.delete('/api/downloads/history', async () => { clearHistory(app.db); return { cleared: true } })
}
```

- [ ] **Step 7: Run everything touched and watch it pass**

Run: `npx vitest run test/routes-downloads.test.ts test/routes-editions-download-issue.test.ts test/routes-releases-download.test.ts`
Expected: PASS, with the two existing files at their Step 1 counts.

- [ ] **Step 8: Typecheck the server, then commit**

```bash
git add server/routes/downloads.ts server/routes/editions.ts server/routes/releases.ts \
        server/services/issueDownload.ts test/routes-downloads.test.ts
git commit -m "feat: routes for queueing, cancelling, retrying and reordering"
```

---

### Task 6: The client learns the new shape

**Files:**
- Modify: `src/api.ts`, `src/lib/useDownload.ts`, `src/components/DownloadBar.tsx`
- Test: `test/DownloadBar.test.tsx` (existing — rewrite against the new shape)

**Interfaces:**
- Produces:

```ts
export interface QueueEntry {
  id: number; position: number; state: 'queued' | 'running' | 'done' | 'failed'
  url: string; edition?: string; cvIssueId?: number; label?: string; attempts: number
  fileName?: string; bookId?: number; error?: string
  queuedAt: string; startedAt?: string; finishedAt?: string
}
export interface ActiveDownload {
  id: number; label?: string; fileName: string | null
  received: number; total: number; startedAt: string
}
export interface DownloadsView { active: ActiveDownload[]; queue: QueueEntry[]; history: QueueEntry[] }
```

- [ ] **Step 1: Replace the API types and calls**

In `src/api.ts`, delete `DownloadStatus` and add the three types above. Replace the download calls:

```ts
  getDownloads: () => json<DownloadsView>('/api/downloads'),
  queueDownload: (body: { url: string; edition?: string; issueId?: number }) =>
    json<{ queued: boolean }>('/api/downloads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  cancelDownload: (id: number) => json<{ cancelled: boolean }>(`/api/downloads/queue/${id}`, { method: 'DELETE' }),
  retryDownload: (id: number) => json<{ retried: boolean }>(`/api/downloads/queue/${id}/retry`, { method: 'POST' }),
  moveDownload: (id: number, index: number) =>
    json<{ moved: boolean }>(`/api/downloads/queue/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }),
    }),
  clearDownloadHistory: () => json<{ cleared: boolean }>('/api/downloads/history', { method: 'DELETE' }),
```

Keep `startDownload` as an alias of `queueDownload` ONLY if `src/pages/Upload.tsx` still calls it; otherwise update that call site and delete the alias.

- [ ] **Step 2: Rewrite the hook**

Replace `src/lib/useDownload.ts`:

```ts
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { DownloadsView, QueueEntry } from '../api'

const POLL_MS = 500

/** What a newly stored comic could show up in. */
const LIBRARY_KEYS = [['editions'], ['series'], ['edition'], ['edition-issues']]

export interface DownloadView {
  data: DownloadsView | undefined
  active: DownloadsView['active']
  queue: QueueEntry[]
  history: QueueEntry[]
  /** Live entries by Comic Vine issue id, so a tile can say Queued instead of Get. */
  liveByIssue: Map<number, QueueEntry>
}

/**
 * The one view of the server's downloads, shared by every page.
 *
 * Polling is driven by the server's own state, not by whether this page started anything:
 * a download outlives the page that asked for it. The single-`finishedAt` dismissal this
 * hook used to carry is gone - with a queue, several runs finish in a row, and the history
 * list is what represents that.
 */
export function useDownload(): DownloadView {
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['download'],
    queryFn: api.getDownloads,
    refetchInterval: (q) => {
      const d = q.state.data
      return d && (d.active.length > 0 || d.queue.length > 0) ? POLL_MS : false
    },
  })

  const active = data?.active ?? []
  const queue = data?.queue ?? []
  const history = data?.history ?? []

  // Refresh the library once per completed run, wherever the reader is standing. Keyed on
  // the newest finished id so a remount does not redo one already dealt with.
  const newestDone = history[0]?.id ?? null
  useEffect(() => {
    if (newestDone == null || qc.getQueryData(['download-handled']) === newestDone) return
    qc.setQueryData(['download-handled'], newestDone)
    for (const key of LIBRARY_KEYS) qc.invalidateQueries({ queryKey: key })
  }, [newestDone, qc])

  const liveByIssue = new Map<number, QueueEntry>()
  for (const entry of queue) if (entry.cvIssueId != null) liveByIssue.set(entry.cvIssueId, entry)

  return { data, active, queue, history, liveByIssue }
}
```

- [ ] **Step 3: Write the failing bar tests**

Rewrite `test/DownloadBar.test.tsx` around the new shape. Keep any existing test whose intent still holds; these are the ones that must exist:

```tsx
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import DownloadBar from '../src/components/DownloadBar'

const view = (over: Partial<{ active: unknown[]; queue: unknown[]; history: unknown[] }> = {}) => ({
  active: [], queue: [], history: [], ...over,
})

function stub(body: unknown) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch
}
afterEach(() => cleanup())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DownloadBar /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const ACTIVE = { id: 1, label: 'Wolverine #27', fileName: 'w27.cbz', received: 500_000, total: 1_000_000, startedAt: '2026-09-15T00:00:00Z' }

test('an idle server with nothing queued shows no bar', async () => {
  stub(view())
  draw()
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
})

test('a running download is reported with its progress', async () => {
  stub(view({ active: [ACTIVE] }))
  draw()
  expect(await screen.findByRole('status')).toHaveTextContent(/Wolverine #27/)
  expect(screen.getByRole('status')).toHaveTextContent(/50%/)
})

test('what is waiting is counted', async () => {
  stub(view({ active: [ACTIVE], queue: [{ id: 2, state: 'queued', label: 'a' }, { id: 3, state: 'queued', label: 'b' }] }))
  draw()
  expect(await screen.findByRole('status')).toHaveTextContent(/2 queued/)
})

test('the bar links to the queue page', async () => {
  stub(view({ active: [ACTIVE] }))
  draw()
  expect(await screen.findByRole('link', { name: /queue/i })).toHaveAttribute('href', '/downloads')
})
```

- [ ] **Step 4: Run and watch them fail, then rewrite the bar**

Run: `npx vitest run test/DownloadBar.test.tsx` — expect FAIL.

Replace `src/components/DownloadBar.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { useDownload } from '../lib/useDownload'

/** Bytes as megabytes, for a progress line a person can read. */
function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * What the server is downloading, on every page that has a header.
 *
 * It summarises rather than lists: with a queue there can be more than one thing waiting,
 * and the bar is a glance, not a screen. /downloads is where the detail lives.
 */
export default function DownloadBar() {
  const { active, queue } = useDownload()
  const waiting = queue.filter((e) => e.state === 'queued').length
  const [current] = active

  if (!current && waiting === 0) return null

  // Content-Length is a claim the server may not make; without it there is no percentage
  // to show, only how much has arrived.
  const progress = !current ? null
    : current.total > 0
      ? `${Math.round((current.received / current.total) * 100)}% — ${mb(current.received)} of ${mb(current.total)}`
      : mb(current.received)

  return (
    <div className="download-bar" role="status">
      <span className="download-bar__label">{current ? 'Downloading…' : 'Queued'}</span>
      {current && (
        <span className="download-bar__name">{current.label || current.fileName}</span>
      )}
      {progress && <span className="download-bar__progress">{progress}</span>}
      {waiting > 0 && <span className="download-bar__progress">{waiting} queued</span>}
      <Link to="/downloads" className="download-bar__link">Queue</Link>
    </div>
  )
}
```

- [ ] **Step 5: Run and watch them pass**

Run: `npx vitest run test/DownloadBar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Both typechecks clean, then commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json`
Expected: no output from either. Fix any remaining call site (`src/pages/Upload.tsx` is the likely one).

```bash
git add src/api.ts src/lib/useDownload.ts src/components/DownloadBar.tsx src/pages/Upload.tsx test/DownloadBar.test.tsx
git commit -m "feat: the client reads a queue instead of one download"
```

---

### Task 7: The drag arithmetic

**Files:**
- Create: `src/lib/dragOrder.ts`
- Test: `test/drag-order.test.ts`

**Interfaces:**
- Produces: `dropIndex(pointerY: number, itemTops: number[], itemHeight: number): number`

- [ ] **Step 1: Write the failing test**

Create `test/drag-order.test.ts`:

```ts
import { test, expect } from 'vitest'
import { dropIndex } from '../src/lib/dragOrder'

// Four rows, 40px each, starting at y=100.
const TOPS = [100, 140, 180, 220]
const H = 40

test('a pointer inside a row lands on that row', () => {
  expect(dropIndex(110, TOPS, H)).toBe(0)
  expect(dropIndex(150, TOPS, H)).toBe(1)
  expect(dropIndex(230, TOPS, H)).toBe(3)
})

test('above the first row lands on the first, below the last on the last', () => {
  expect(dropIndex(0, TOPS, H)).toBe(0)
  expect(dropIndex(-500, TOPS, H)).toBe(0)
  expect(dropIndex(9999, TOPS, H)).toBe(3)
})

// A boundary belongs to the row below it, so a slow drag moves exactly one place.
test('exactly on a boundary lands on the lower row', () => {
  expect(dropIndex(140, TOPS, H)).toBe(1)
  expect(dropIndex(180, TOPS, H)).toBe(2)
})

test('a single-item list has only one answer', () => {
  expect(dropIndex(-10, [100], H)).toBe(0)
  expect(dropIndex(10_000, [100], H)).toBe(0)
})

test('an empty list yields zero rather than a negative index', () => {
  expect(dropIndex(50, [], H)).toBe(0)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/drag-order.test.ts`
Expected: FAIL — cannot resolve `../src/lib/dragOrder`.

- [ ] **Step 3: Write it**

Create `src/lib/dragOrder.ts`:

```ts
/**
 * Which row a drag has landed on.
 *
 * Extracted from the component deliberately: simulating pointer drags in jsdom tests the
 * simulation rather than the behaviour. This is the behaviour, and it is testable with
 * numbers.
 *
 * `itemTops` are viewport-relative tops in the list's current order; `itemHeight` is the
 * row height. A pointer exactly on a boundary belongs to the row below it, so a slow drag
 * moves exactly one place rather than flickering between two.
 */
export function dropIndex(pointerY: number, itemTops: number[], itemHeight: number): number {
  if (itemTops.length === 0) return 0
  const first = itemTops[0]
  const raw = Math.floor((pointerY - first) / itemHeight)
  return Math.min(Math.max(raw, 0), itemTops.length - 1)
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/drag-order.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dragOrder.ts test/drag-order.test.ts
git commit -m "feat: work out which row a drag landed on"
```

---

### Task 8: The queue list

**Files:**
- Create: `src/components/QueueList.tsx`
- Test: `test/QueueList.test.tsx`

**Interfaces:**
- Consumes: `dropIndex` (Task 7), `QueueEntry` (Task 6).
- Produces: `QueueList({ entries, onMove, onCancel })`.

- [ ] **Step 1: Write the failing test**

Create `test/QueueList.test.tsx`:

```tsx
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import QueueList from '../src/components/QueueList'
import type { QueueEntry } from '../src/api'

afterEach(() => cleanup())

const entry = (id: number, label: string, state: QueueEntry['state'] = 'queued'): QueueEntry => ({
  id, position: id, state, url: `https://x.test/${id}`, label, attempts: 0,
  queuedAt: '2026-09-15T00:00:00Z',
})

const THREE = [entry(1, 'one'), entry(2, 'two'), entry(3, 'three')]

function draw(over: Partial<{ entries: QueueEntry[]; onMove: () => void; onCancel: () => void }> = {}) {
  const props = { entries: THREE, onMove: vi.fn(), onCancel: vi.fn(), ...over }
  render(<QueueList {...props} />)
  return props
}

test('every waiting download is listed in order', () => {
  draw()
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    expect.stringContaining('one'),
    expect.stringContaining('two'),
    expect.stringContaining('three'),
  ])
})

test('moving a row down asks for the index below it', () => {
  const { onMove } = draw()
  const row = screen.getAllByRole('listitem')[0]
  fireEvent.click(within(row).getByRole('button', { name: /move down/i }))
  expect(onMove).toHaveBeenCalledWith(1, 1)
})

test('moving a row up asks for the index above it', () => {
  const { onMove } = draw()
  const row = screen.getAllByRole('listitem')[2]
  fireEvent.click(within(row).getByRole('button', { name: /move up/i }))
  expect(onMove).toHaveBeenCalledWith(3, 1)
})

// The ends have nowhere to go; the buttons say so rather than sending a doomed request.
test('the first cannot move up and the last cannot move down', () => {
  draw()
  const rows = screen.getAllByRole('listitem')
  expect(within(rows[0]).getByRole('button', { name: /move up/i })).toBeDisabled()
  expect(within(rows[2]).getByRole('button', { name: /move down/i })).toBeDisabled()
})

test('cancelling a row names it', () => {
  const { onCancel } = draw()
  fireEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: /cancel/i }))
  expect(onCancel).toHaveBeenCalledWith(2)
})

// A download already in flight is not reorderable - it is already going.
test('the running row cannot be reordered but can be cancelled', () => {
  draw({ entries: [entry(1, 'one', 'running'), entry(2, 'two')] })
  const row = screen.getAllByRole('listitem')[0]
  expect(within(row).getByRole('button', { name: /move down/i })).toBeDisabled()
  expect(within(row).getByRole('button', { name: /cancel/i })).toBeEnabled()
})

test('an empty queue says so rather than rendering an empty list', () => {
  draw({ entries: [] })
  expect(screen.queryByRole('listitem')).toBeNull()
  expect(screen.getByText(/nothing waiting/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/QueueList.test.tsx`
Expected: FAIL — cannot resolve `../src/components/QueueList`.

- [ ] **Step 3: Write the component**

Create `src/components/QueueList.tsx`:

```tsx
import { useRef, useState } from 'react'
import { dropIndex } from '../lib/dragOrder'
import type { QueueEntry } from '../api'

interface QueueListProps {
  entries: QueueEntry[]
  onMove: (id: number, index: number) => void
  onCancel: (id: number) => void
}

/**
 * What is waiting, and the two ways to reorder it.
 *
 * Drag is wired with Pointer Events rather than HTML5 drag-and-drop, which does not fire
 * on a tablet at all. The up and down buttons are not a lesser fallback: they are the
 * keyboard-reachable path, and they keep working if a device's pointer behaviour is odd.
 */
export default function QueueList({ entries, onMove, onCancel }: QueueListProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const tops = useRef<number[]>([])
  const rowHeight = useRef(0)

  if (entries.length === 0) return <p className="queue-list__empty">Nothing waiting.</p>

  function measure() {
    const rows = [...(listRef.current?.querySelectorAll('li') ?? [])]
    tops.current = rows.map((row) => row.getBoundingClientRect().top)
    rowHeight.current = rows[0]?.getBoundingClientRect().height ?? 1
  }

  return (
    <ul className="queue-list" ref={listRef}>
      {entries.map((entry, index) => {
        const running = entry.state === 'running'
        return (
          <li
            key={entry.id}
            className={`queue-list__row${dragging === entry.id ? ' queue-list__row--dragging' : ''}${dropAt === index && dragging != null ? ' queue-list__row--drop' : ''}`}
          >
            <button
              type="button"
              className="queue-list__handle"
              aria-label={`Drag ${entry.label ?? entry.url}`}
              disabled={running}
              onPointerDown={(e) => {
                if (running) return
                e.currentTarget.setPointerCapture(e.pointerId)
                measure()
                setDragging(entry.id)
                setDropAt(index)
              }}
              onPointerMove={(e) => {
                if (dragging !== entry.id) return
                setDropAt(dropIndex(e.clientY, tops.current, rowHeight.current))
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId)
                if (dragging === entry.id && dropAt !== null && dropAt !== index) onMove(entry.id, dropAt)
                setDragging(null)
                setDropAt(null)
              }}
            >
              ⠿
            </button>

            <span className="queue-list__label">{entry.label ?? entry.url}</span>
            {running && <span className="queue-list__state">downloading</span>}

            <button
              type="button" className="btn btn-ghost" aria-label={`Move up ${entry.label ?? entry.url}`}
              disabled={running || index === 0}
              onClick={() => onMove(entry.id, index - 1)}
            >↑</button>
            <button
              type="button" className="btn btn-ghost" aria-label={`Move down ${entry.label ?? entry.url}`}
              disabled={running || index === entries.length - 1}
              onClick={() => onMove(entry.id, index + 1)}
            >↓</button>
            <button
              type="button" className="btn btn-ghost" aria-label={`Cancel ${entry.label ?? entry.url}`}
              onClick={() => onCancel(entry.id)}
            >Cancel</button>
          </li>
        )
      })}
    </ul>
  )
}
```

The drag is deliberately not unit-tested here — see Task 7, which tests the arithmetic. Do not add a test that fakes pointer events.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/QueueList.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck the client, then commit**

```bash
git add src/components/QueueList.tsx test/QueueList.test.tsx
git commit -m "feat: a reorderable queue list"
```

---

### Task 9: The downloads page, and tiles that know they are queued

**Files:**
- Create: `src/pages/Downloads.tsx`
- Modify: `src/App.tsx`, `src/components/MissingIssueTile.tsx`, `src/pages/Releases.tsx`, `src/pages/Edition.tsx`
- Test: `test/Downloads.test.tsx`, plus `test/MissingIssueTile.test.tsx`

**Interfaces:**
- Consumes: `QueueList` (Task 8), `useDownload` (Task 6), the api calls (Task 6).

- [ ] **Step 1: Write the failing page test**

Create `test/Downloads.test.tsx`:

```tsx
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Downloads from '../src/pages/Downloads'

const VIEW = {
  active: [{ id: 1, label: 'Wolverine #27', fileName: 'w27.cbz', received: 500_000, total: 1_000_000, startedAt: '2026-09-15T00:00:00Z' }],
  queue: [
    { id: 1, position: 0, state: 'running', url: 'u1', label: 'Wolverine #27', attempts: 0, queuedAt: 'q' },
    { id: 2, position: 1, state: 'queued', url: 'u2', label: 'Iron Man #9', attempts: 0, queuedAt: 'q' },
  ],
  history: [
    { id: 9, position: 0, state: 'failed', url: 'u9', label: 'Black Cat #14', attempts: 2, error: 'no link', queuedAt: 'q', finishedAt: 'f' },
  ],
}

let posted: string[]
beforeEach(() => {
  posted = []
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method) posted.push(`${init.method} ${url}`)
    return { ok: true, json: async () => (init?.method ? {} : VIEW) }
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Downloads /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('what is downloading now is shown with its progress', async () => {
  draw()
  expect(await screen.findByText(/Wolverine #27/)).toBeInTheDocument()
  expect(screen.getByText(/50%/)).toBeInTheDocument()
})

test('what is waiting is listed', async () => {
  draw()
  expect(await screen.findByText(/Iron Man #9/)).toBeInTheDocument()
})

test('a failed download is listed with its error and offers a retry', async () => {
  draw()
  expect(await screen.findByText(/Black Cat #14/)).toBeInTheDocument()
  expect(screen.getByText(/no link/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /retry/i }))
  expect(posted).toContain('POST /api/downloads/queue/9/retry')
})

test('clearing the history asks the server to', async () => {
  draw()
  fireEvent.click(await screen.findByRole('button', { name: /clear/i }))
  expect(posted).toContain('DELETE /api/downloads/history')
})

test('cancelling a queued download asks the server to', async () => {
  draw()
  await screen.findByText(/Iron Man #9/)
  const row = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('Iron Man'))!
  fireEvent.click(within(row).getByRole('button', { name: /cancel/i }))
  expect(posted).toContain('DELETE /api/downloads/queue/2')
})
```

- [ ] **Step 2: Run it and watch it fail, then write the page**

Run: `npx vitest run test/Downloads.test.tsx` — expect FAIL.

Create `src/pages/Downloads.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useDownload } from '../lib/useDownload'
import QueueList from '../components/QueueList'

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export default function Downloads() {
  const qc = useQueryClient()
  const { active, queue, history } = useDownload()
  // Every mutation ends by re-reading the one query the whole app shares.
  const refresh = { onSuccess: () => qc.invalidateQueries({ queryKey: ['download'] }) }

  const move = useMutation({ mutationFn: (v: { id: number; index: number }) => api.moveDownload(v.id, v.index), ...refresh })
  const cancel = useMutation({ mutationFn: (id: number) => api.cancelDownload(id), ...refresh })
  const retry = useMutation({ mutationFn: (id: number) => api.retryDownload(id), ...refresh })
  const clear = useMutation({ mutationFn: () => api.clearDownloadHistory(), ...refresh })

  return (
    <>
      <h1 className="page-title">Downloads</h1>

      <section>
        <h2 className="page-title">Now downloading</h2>
        {active.length === 0 ? <p>Nothing downloading.</p> : active.map((d) => (
          <p key={d.id} className="download-bar__name">
            {d.label || d.fileName}{' — '}
            {d.total > 0 ? `${Math.round((d.received / d.total) * 100)}%` : mb(d.received)}
          </p>
        ))}
      </section>

      <section>
        <h2 className="page-title">Queue</h2>
        <QueueList
          entries={queue}
          onMove={(id, index) => move.mutate({ id, index })}
          onCancel={(id) => cancel.mutate(id)}
        />
      </section>

      <section>
        <h2 className="page-title">Recent</h2>
        {history.length === 0 ? <p>Nothing yet.</p> : (
          <>
            <ul className="queue-list">
              {history.map((entry) => (
                <li key={entry.id} className="queue-list__row">
                  <span className="queue-list__label">{entry.label ?? entry.url}</span>
                  {entry.error && <span className="queue-list__error">{entry.error}</span>}
                  {entry.bookId && <Link to={`/book/${entry.bookId}`}>View comic</Link>}
                  {entry.state === 'failed' && (
                    <button
                      type="button" className="btn btn-ghost"
                      aria-label={`Retry ${entry.label ?? entry.url}`}
                      onClick={() => retry.mutate(entry.id)}
                    >Retry</button>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-ghost" onClick={() => clear.mutate()}>Clear</button>
          </>
        )}
      </section>
    </>
  )
}
```

- [ ] **Step 3: Add the route**

In `src/App.tsx`: `import Downloads from './pages/Downloads'` and

```tsx
      <Route path="/downloads" element={<Layout><Downloads /></Layout>} />
```

Do NOT add a header tab — the bar links here, and the header is two peer tabs by deliberate design.

- [ ] **Step 4: Teach the tile about being queued**

Add a `queued?: boolean` prop to `src/components/MissingIssueTile.tsx`. When true, render a disabled control reading **Queued** in place of both the Get button and the Find link. Add to `test/MissingIssueTile.test.tsx`:

```tsx
// Pressing Get twice on the same issue is refused by the server; saying so up front is
// better than letting someone press a button that will 409.
test('an issue already queued says so instead of offering Get', () => {
  draw({ hasMatch: true, queued: true })
  expect(screen.getByText(/queued/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Get/ })).toBeNull()
  expect(screen.queryByRole('link', { name: /Find/ })).toBeNull()
})
```

Then in `src/pages/Releases.tsx` and `src/pages/Edition.tsx`, read `liveByIssue` from `useDownload()` and pass `queued={liveByIssue.has(issue.id)}`.

- [ ] **Step 5: Run the client suite and watch it pass**

Run: `npx vitest run test/Downloads.test.tsx test/MissingIssueTile.test.tsx test/Releases.test.tsx test/Edition.test.tsx test/App.test.tsx`
Expected: PASS.

- [ ] **Step 6: Both typechecks, then commit**

```bash
git add src/pages/Downloads.tsx src/App.tsx src/components/MissingIssueTile.tsx \
        src/pages/Releases.tsx src/pages/Edition.tsx test/Downloads.test.tsx test/MissingIssueTile.test.tsx
git commit -m "feat: a downloads page, and tiles that know what is queued"
```

---

### Task 10: Full verification and a real run

- [ ] **Step 1: Run the entire suite**

Run: `npx vitest run`
Expected: PASS. The baseline before this work was 1055 tests across 81 files; this plan adds roughly 55 across 7 new files.

- [ ] **Step 2: Typecheck both projects**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json`
Expected: no output from either.

- [ ] **Step 3: Rebuild the container**

Run: `docker compose up -d --build`
Expected: `Container comic-app Started`.

- [ ] **Step 4: Queue two downloads and watch them drain**

```bash
PORT=$(docker compose port comic-app 3000 | cut -d: -f2)
curl -s -X POST "http://localhost:$PORT/api/downloads" -H 'content-type: application/json' \
  -d '{"url":"https://example.invalid/one.cbz"}' | python3 -m json.tool
curl -s -X POST "http://localhost:$PORT/api/downloads" -H 'content-type: application/json' \
  -d '{"url":"https://example.invalid/two.cbz"}' | python3 -m json.tool
curl -s "http://localhost:$PORT/api/downloads" | python3 -m json.tool
```

Expected: both return 202 with an entry — **the second is queued, not refused**, which is the whole feature. Both then fail (the host is deliberately invalid), each after one retry, and end in `history` with `attempts: 2`.

- [ ] **Step 5: Prove the queue survives a restart**

Queue one, then `docker compose restart comic-app`, wait, and `GET /api/downloads` again. The row must still be there. Check the container log for the `requeued N interrupted download` line if one was mid-flight.

- [ ] **Step 6: Reorder and cancel against the running server**

Queue three, `PATCH` the last to index 0, confirm the order changed, `DELETE` one, confirm it is gone.

- [ ] **Step 7: Commit anything Steps 1–6 forced**

If every step passed, there is nothing to commit and the feature is done.

---

## Notes for the executor

- **The spec is the argument, this plan is the order.** When they disagree, the spec wins — say so rather than guessing.
- **Task 2 is the one that must be seen to fail.** A concurrency test that has never failed is not evidence. Step 7 of that task exists for exactly that reason.
- **Tasks 3 and 5 rewrite existing tests.** That is expected there and nowhere else: those tasks change a contract the tests assert. If you find yourself editing a test in any OTHER task, stop and report it.
- **`DOWNLOAD_CONCURRENCY` ships as 1.** The pool is tested at 2; the default must not change.
- **Do not test against the real library.** Every test uses `openDb(':memory:')` and a temp dir.
