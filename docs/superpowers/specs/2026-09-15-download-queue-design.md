# Download Queue — Design Spec

**Date:** 2026-09-15
**Status:** Draft for review

## 1. Overview

The downloader holds one job. Press Get while something is downloading and the
request is refused with a 409 — you are told to come back later, and it is on
you to remember what you wanted. On a Wednesday with twenty new issues that is
the normal case, not the edge.

This work replaces the single slot with a durable queue: enqueue while one is
running, watch it drain, and manage what is waiting — reorder it, cancel it,
retry what failed, clear what finished.

### Goals

- Enqueue a download while one is running, rather than being refused.
- Survive a restart. A queue that a `docker compose up --build` discards is not
  a queue.
- Manage what is waiting: reorder by drag on a tablet, cancel, retry a failure,
  clear history.
- Retry a failure once automatically before giving up on it.
- Refuse a duplicate rather than downloading the same comic twice.
- Make concurrency a number, not an assumption: the drain is a worker pool whose
  size is one constant, defaulting to 1.

### Non-goals

- **Deciding how many downloads should run at once.** The pool supports more
  than one and ships set to 1. Whether 2 or 3 is faster depends on where the
  bottleneck is — a saturated home link gains nothing, a host that throttles per
  connection gains nearly linearly — and that is measured on the real link, not
  guessed here.
- **Per-host concurrency limits.** The pool size is global. Downloads all come
  from the same scraped index today; a rule per host is a problem for the day
  there are several.
- **Scheduling.** No "download at 3am", no rate windows. `not_before` exists for
  the retry backoff (§3) and is not a scheduling feature.
- **Queueing a whole Wednesday in one press.** Inherited from the missing-issue
  spec: a wrong match once is a nuisance, the same wrong match twenty times is a
  mess. Per-issue stays per-issue.
- **Cross-device queue ownership.** One server, one queue. Two tablets both
  pressing Get is two enqueues, and the duplicate guard is what keeps that sane.
- **Resuming a partial file.** A download interrupted by a restart starts over.
  Range requests against a host that may not honour them is a separate problem.

## 2. What is there now

### 2.1 The contract being replaced

`server/services/downloader.ts` exposes:

```ts
status: () => DownloadStatus
start: (req: DownloadRequest) => { started: boolean; status: DownloadStatus; done: Promise<void> }
```

`state` is one in-memory `DownloadStatus`. `start` returns `started: false`
when `state.running`, and that refusal is what this work removes.

### 2.2 Three callers, one of them shared

- `POST /api/downloads` — a URL pasted on the upload page.
- `POST /api/editions/:id/issues/:cvIssueId/download` — a gap in a run.
- `POST /api/releases/issues/:cvIssueId/download` — a new release.

The last two go through `startIssueDownload` in
`server/services/issueDownload.ts`, whose result is a discriminated union with a
`reason` of `'no-match' | 'busy' | 'unreadable' | 'no-link'`. Both routes already
switch on `reason`, so `'busy'` can be swapped for `'duplicate'` without either
route changing shape.

### 2.3 The client polls one job

`src/lib/useDownload.ts` polls `GET /api/downloads` every 500ms while
`running`, and treats a run as finished when it is "stopped and stamped". Its
dismissal is keyed on a single `finishedAt`, which has no meaning once several
runs finish in a row. `DownloadBar` renders that one job on every page with a
header.

`src/pages/Upload.tsx`'s `pct` is the file **upload** progress from an
XMLHttpRequest and is unrelated to this work.

### 2.4 The tmp directory is already swept at startup

`server/index.ts:47` runs `clearTmpDir(config.tmpDir)` before the downloader is
constructed, with the comment: *"A run that died mid-upload or mid-download left
its staging file behind. Nothing has been accepted yet, so anything in tmp
belongs to a run that is already over."*

This is why the schema below carries **no** `tmp_path` column. Recovery does not
need to track individual staging files; they are gone before the runner exists.

### 2.5 Storing two comics at once has exactly one race

`server/services/storeComic.ts` picks a free filename and then renames onto it:

```ts
const destPath = dedupeDestPath(destDir, finalName)   // synchronous; finds a free name
await rename(cbzTmpPath, destPath)                     // yields
```

`dedupeDestPath` is synchronous, so it cannot interleave with itself — but the
`await` after it can. Two downloads can both be handed the same free name,
because the first has not renamed yet when the second looks. Both then rename
onto it: the second destroys the first's file, and the second `book.file_path`
insert fails its unique constraint. The comment above that line names this exact
failure, which is today prevented by there only ever being one download.

The window is wide, not theoretical: the `issueId` branch a few lines earlier
makes two Comic Vine requests.

What was checked and is **not** a race:

- `upsertEdition` runs its SELECT and INSERT with no `await` between them, and
  better-sqlite3 is synchronous, so two downloads creating the same new edition
  cannot interleave.
- SQLite statements cannot interleave for the same reason, so no DB write needs
  a lock of its own.

## 3. The rules

**Order.** `position`, a plain integer. Reordering renumbers the live rows in one
transaction. The queue is short; fractional positions would be cleverness with
nobody to pay for it.

**Concurrency.** `DOWNLOAD_CONCURRENCY`, one constant, default 1. The drain is a
pool of that many workers, each looping independently over `takeNext`. At 1 it
behaves exactly as a single loop; above 1 the only thing that changes is how many
workers are asking. `takeNext` marking the row in the statement that selects it
is what makes that safe — it is not an optimisation, it is the whole mechanism.

**Duplicates.** An issue already `queued` or `running` cannot be queued again.
Enforced by a partial unique index, not by a read-then-write, so two near-
simultaneous presses cannot both pass a check. A finished row does not block —
the index covers live states only, so a comic that failed can be queued again.

**Retry.** A failure requeues once at the back with `attempts` incremented and
`not_before` set a short way ahead; the second failure is final. `not_before` is
what makes this a retry rather than a spin: without it, a lone failing item is
taken again immediately and hammers the host.

**Restart.** A row still marked `running` when the process starts is a casualty
of the restart, not a failure of the download. It goes back to the **front** of
the queue with `started_at` cleared and `attempts` unchanged.

**History.** `done` and `failed` rows are kept until cleared, capped at the most
recent 50 and pruned past that, so a queue nobody tidies cannot grow without
bound. A finished row keeps whatever `position` it had; only live rows are
ordered, and `move` renumbers live rows only.

**Labels.** What the list calls a row. An issue download passes Comic Vine's
volume name and number — `Wolverine #27` — which both issue routes already hold.
A pasted URL has no such name, so it passes the resolved file name if
`resolveDownload` produced one, and the URL itself otherwise. `label` is display
only; nothing matches on it.

## 4. Components

### 4.1 `server/models/downloadQueue.ts` (new)

Owns the table. Nothing else writes it.

```ts
export type QueueState = 'queued' | 'running' | 'done' | 'failed'

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

enqueue(db, req): { queued: true; entry: QueueEntry } | { queued: false; duplicate: QueueEntry }
takeNext(db, now): QueueEntry | undefined      // marks it running, atomically
finish(db, id, { bookId, fileName }): void
/** With `retryAt`, requeues at the back and sets not_before. Without it, final. */
fail(db, id, error, opts?: { retryAt: string }): void
listQueue(db): QueueEntry[]                     // queued + running, by position
listHistory(db, limit): QueueEntry[]            // done + failed, newest first
move(db, id, toIndex): void                     // 0-based into the live queue; renumbers in one transaction
remove(db, id): void
retry(db, id): void                             // failed -> queued, attempts reset
clearHistory(db): void
recoverRunning(db): number                      // restart casualties back to the front
pruneHistory(db, keep): void
```

`takeNext` must mark the row `running` in the same statement that selects it, so
that a second drain loop — which should not exist, but the schema should not
depend on that — cannot take the same row.

### 4.2 `server/services/downloader.ts` (changed)

`start` is replaced by `enqueue`. `status` returns the queue rather than one job.

```ts
export interface DownloadRunner {
  status: () => { active: ActiveDownload[]; queue: QueueEntry[]; history: QueueEntry[] }
  enqueue: (req: DownloadRequest) => { queued: true; entry: QueueEntry } | { queued: false; duplicate: QueueEntry }
  cancel: (id: number) => boolean
  /** Resolves when the queue is empty. Tests await it; nothing in production does. */
  idle: () => Promise<void>
}

export interface ActiveDownload {
  id: number
  label?: string
  fileName: string | null
  received: number
  total: number
  startedAt: string
}
```

**Live progress stays in memory.** `received` updates on every chunk; writing it
to SQLite would be thousands of writes per download. The in-memory `ActiveDownload`
is the only mutable state the runner keeps, and it is discarded when the row
finishes.

**The worker pool.** `enqueue` inserts and wakes the pool. Each of the
`DOWNLOAD_CONCURRENCY` workers loops on `takeNext` until it comes back empty;
when nothing is takeable but queued rows exist with a future `not_before`, the
last worker to stop sets a timer for the earliest. The download body itself —
the fetch, the byte cap, the `storeComic` call — is unchanged from today's `run`.

**Progress is a map, not a field.** `ActiveDownload` is keyed by row id, because
at concurrency above 1 there is more than one. At 1 the map holds one entry and
the bar renders it exactly as before.

**Cancelling.** The runner holds an `AbortController` per in-flight row, keyed
by id — which is what lets a cancel name which download it means once there can
be more than one. Cancel on a queued row removes it. Cancel on the running row aborts the fetch, which
lands in the existing catch — so the catch must be able to tell an abort from a
failure, or the retry rule would put back the very thing that was just stopped.
The runner tracks which id it cancelled and routes that one to `fail(id,
'cancelled')` with no `retryAt`: final, not auto-retried. A manual retry from
the history list is still offered, because changing your mind twice is allowed.

### 4.2.1 `server/services/storeComic.ts` (changed)

The dedupe-then-rename of §2.5 is wrapped in an in-process async mutex, so the
name a download is handed is still free when it renames onto it. One process
means a plain promise chain is a sufficient lock; no file locking, no advisory
lock in SQLite.

The critical section is those two statements and nothing more — the Comic Vine
naming round-trip above it stays outside, or every parallel download would queue
behind one slow lookup and the pool would be a pool in name only.

This fix is required by the pool and correct without it. It goes in whether or
not concurrency is ever raised above 1.

### 4.3 `server/services/issueDownload.ts` (changed)

`reason: 'busy'` becomes `reason: 'duplicate'`, carrying the existing entry's id
so the caller can say what it collided with. Both download routes switch on
`reason` already and need only rename the arm.

### 4.4 Routes

| Route | Behaviour |
| ----- | --------- |
| `GET /api/downloads` | `{ active, queue, history }` |
| `POST /api/downloads` | enqueue a pasted url — 202, or 409 `{ reason: 'duplicate', entry }` |
| `POST /api/editions/:id/issues/:cvIssueId/download` | unchanged URL, now enqueues |
| `POST /api/releases/issues/:cvIssueId/download` | unchanged URL, now enqueues |
| `DELETE /api/downloads/queue/:id` | cancel — queued or running |
| `POST /api/downloads/queue/:id/retry` | a failed row back to the queue |
| `PATCH /api/downloads/queue/:id` | `{ index }` — move to a 0-based index in the live queue |
| `DELETE /api/downloads/history` | clear finished |

### 4.5 `src/lib/dragOrder.ts` (new)

The drag arithmetic, as a pure function:

```ts
export function dropIndex(pointerY: number, itemTops: number[], itemHeight: number): number
```

Extracted deliberately. Simulating pointer drags in jsdom tests the simulation
rather than the behaviour; this function is the behaviour, and it is testable
with numbers.

### 4.6 `src/components/QueueList.tsx` (new)

The list, with both affordances:

- **Drag**, via Pointer Events — `setPointerCapture` on a handle, track Y,
  compute the target with `dropIndex`, commit on `pointerup`. Pointer Events
  cover touch and mouse from one code path; HTML5 drag events do not fire on a
  tablet at all, which is why they are not used.
- **Up and down buttons** beside each row — the keyboard-reachable path, and the
  fallback if drag misbehaves on a given device.

Both call the same `PATCH`, with the 0-based index the row should end up at.

### 4.7 `src/pages/Downloads.tsx` (new), `src/components/DownloadBar.tsx` (changed)

The page has three sections: *Now downloading*, *Queue*, *Recent*. *Now
downloading* renders every active row, which is one of them at the shipped
concurrency and is why it is a list rather than a block. The bar gains the queued
count and a link to the page; with more than one in flight it summarises rather
than growing — the page is where the detail lives.

`useDownload` polls while anything is `active` **or** the queue is non-empty, and its
single-`finishedAt` dismissal is replaced by the history list — several runs
finishing in a row each land there, which the old keying could not represent.

### 4.8 Tiles read the queue they already have

Every page renders `DownloadBar`, so `useDownload` has the queue everywhere.
`MissingIssueTile` gains a `queued` state showing **Queued** instead of offering
Get, resolved by looking up the issue id in that response. No extra request.

## 5. Data flow

```
POST .../download
  ├─ derive the match, index row, post page, link   (unchanged, issueDownload)
  ├─ enqueue(url, edition, cvIssueId, label)
  │    └─ partial unique index rejects a live duplicate → 409 { reason: 'duplicate' }
  └─ 202 { entry }                         → kicks the drain loop if idle

each of N workers
  ├─ entry := takeNext(now)                → marks it running in one statement,
  │                                          so two workers cannot take one row
  │    └─ nothing takeable, but a future not_before exists → set a timer, stop
  ├─ progress := in-memory { received, total, fileName }
  ├─ download → storeComic                 (rename now behind a mutex, §4.2.1)
  ├─ ok      → finish(id, { bookId, fileName })
  ├─ aborted → fail(id, 'cancelled')       -- no retryAt: final, never auto-retried
  └─ failed  → fail(id, error, { retryAt: attempts === 0 ? now + BACKOFF : undefined })
  └─ loop

startup
  └─ recoverRunning()  → running rows to the front, started_at cleared
     (tmp files already gone: index.ts sweeps tmpDir before the runner exists)
```

## 6. Safety and failure

- **A duplicate is refused by the database, not by a check.** Two presses in the
  same tick both reach the insert; one violates the partial unique index and is
  reported as the duplicate it is.
- **A cancelled download is not retried.** It is recorded finished-with-error.
  Retrying something the user just stopped would be the opposite of what they
  asked for.
- **A restart casualty is not counted as an attempt.** Otherwise a crash loop
  would exhaust the retry budget of every queued item without any of them having
  been tried.
- **The byte cap still holds.** `maxBytes` is enforced against bytes actually
  received, not against `Content-Length`, exactly as today.
- **A failing host is not hammered.** `not_before` spaces a retry out; the loop
  moves to other work in the meantime rather than blocking on a sleep.
- **History cannot grow without bound.** Pruned to 50 on write.
- **Two workers cannot take one row**, because `takeNext` marks it in the
  statement that selects it rather than in a second statement afterwards.
- **Two workers cannot claim one filename**, because the dedupe and the rename
  are one critical section (§4.2.1).
- **Raising concurrency multiplies the Comic Vine request rate.** `storeComic`
  builds its own client per call, so each in-flight download carries its own
  1-per-second throttle. At the default of 1 this is today's behaviour; at 3 it
  is three times the rate, against a 200-per-hour budget. Two calls per download
  makes that a non-issue at any pool size this app would use, but it is the
  reason the constant is not a user-facing setting.

## 7. Schema

```sql
-- One row per download, alive or finished. Position orders the live ones; the
-- finished ones are history until cleared.
CREATE TABLE IF NOT EXISTS download_queue (
  id          INTEGER PRIMARY KEY,
  position    INTEGER NOT NULL,
  state       TEXT NOT NULL,
  url         TEXT NOT NULL,
  edition     TEXT,
  cv_issue_id INTEGER,
  label       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  -- Set only when a retry is deferred, so a lone failing item cannot be taken
  -- again the instant it fails.
  not_before  TEXT,
  file_name   TEXT,
  book_id     INTEGER,
  error       TEXT,
  queued_at   TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);

-- The duplicate guard. Partial, so it covers only live rows: a comic that
-- finished or failed can be queued again, and a second simultaneous press is
-- rejected by the database rather than by a check that could interleave.
CREATE UNIQUE INDEX IF NOT EXISTS idx_download_queue_live_issue
  ON download_queue(cv_issue_id)
  WHERE cv_issue_id IS NOT NULL AND state IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_download_queue_state_position
  ON download_queue(state, position);
```

## 8. Testing

**Model.** Enqueue assigns the next position. A live duplicate is rejected; the
same issue is accepted once the first row is `done`. `takeNext` marks the row
running and returns nothing when the only queued row has a future `not_before`.
`move` renumbers without gaps or collisions, moving both up and down. `recoverRunning`
puts a running row at the front and leaves `attempts` alone. `pruneHistory` keeps
the newest 50.

**Runner.** At concurrency 1, three enqueued items download in order, one at a
time — asserted by recording the order the stub fetch is called in, not by
timing. At concurrency 2, two are in flight at once and no row is taken twice —
asserted by holding both stub fetches open and checking what `takeNext` handed
out, again not by timing. A failure is
retried once then marked failed, and `attempts` reflects it. A cancel on the
running row aborts it and it is **not** retried. A cancel on a queued row removes
it without touching the running one. Two enqueues in the same tick produce one
row and one duplicate result.

**Routes.** Each of the eight in §4.4, including the 409 duplicate carrying the
existing entry, and a `PATCH` to an index outside the live queue being rejected
with 400 rather than corrupting the order.

**The rename race (§2.5).** Two `storeComic` calls resolving to the same final
filename, started together: both comics end up on disk under different names,
neither file is destroyed, and both `book` rows insert. Run against the mutex
removed, this test must fail — a concurrency test that passes either way is
testing nothing.

**`dropIndex`.** A table: above the first item, below the last, exactly on a
boundary, and a single-item list. Numbers in, index out — no DOM.

**Components.** `QueueList` reorders via the up/down buttons and calls PATCH with
the right position; a cancel calls DELETE. `DownloadBar` shows the count and
links to the page. `MissingIssueTile` renders **Queued** for an issue in the live
queue and **Get** otherwise.

## 9. Risks

- **The drag is hand-rolled.** Pointer Events are well supported, but drag
  interactions are where device quirks live, and the tests deliberately cover
  the arithmetic rather than the gesture. The up/down buttons are the mitigation:
  if the drag misbehaves on the actual tablet, reordering still works and the
  fix is contained to one component.
- **`takeNext` assumes one drain loop.** It marks the row in the statement that
  selects it, which is enough for one process. Two server processes against the
  same SQLite file would need more than this — but that is not how this app is
  deployed.
- **Cancel races the end of a download.** Cancelling in the instant between the
  last byte and `storeComic` returning will abort nothing and the comic will
  land. The row records what happened; the alternative — deleting a stored
  comic because a cancel arrived late — is worse.
- **The history cap is a number, not a policy.** Fifty is a guess. It is a
  constant in one place.
- **Concurrency above 1 is shipped untested against the real host.** The pool is
  covered by tests, but whether the file host tolerates — or rewards — parallel
  connections is only answerable on the real link. The default of 1 is why that
  is a measurement rather than a risk.
