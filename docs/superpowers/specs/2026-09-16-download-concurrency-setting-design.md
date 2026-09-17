# Download Concurrency Setting — Design Spec

**Date:** 2026-09-16
**Status:** Draft for review

## 1. Overview

The download queue drains through a worker pool whose size is `DOWNLOAD_CONCURRENCY`,
a constant in `server/services/downloader.ts` set to 1. Trying 2 or 3 means
editing that line and rebuilding the container.

Whether parallel downloads help is not answerable in the abstract — a saturated
home link gains nothing, a host that throttles per connection gains nearly
linearly — so the previous spec made choosing the number a non-goal and left the
dial unbuilt. This builds the dial: a control on the Downloads page, persisted,
read by the pool without a restart.

### Goals

- Change the pool size from the Downloads page, with effect on the next download.
- Persist it, so a container rebuild does not reset it.
- Refuse a value outside 1–5 on the server, not only in the dropdown.

### Non-goals

- **Telling you what the number should be.** This ships a dial and a range. Which
  value is faster is a measurement on the real link.
- **Stopping downloads already in flight when the number is lowered.** The pool
  stops taking new work until the count is back under the limit. Killing a
  download to honour a settings change is worse than waiting for it.
- **A settings page.** One control, on the page it governs. A general settings
  screen is a problem for the day there is a second setting worth showing.
- **Per-host limits.** Inherited from the queue spec: the pool size is global,
  and downloads all come from one scraped index today.
- **Changing the Comic Vine throttle.** Each `storeComic` builds its own client
  with its own 1-per-second limit, so N parallel downloads make N times the
  requests. At two calls per download against a 200-per-hour budget this does
  not bite at 5, and it is the reason the cap is 5 rather than higher.

## 2. What is there now

`createDownloadRunner(ctx, deps)` destructures the pool size once, at
construction (`server/services/downloader.ts:114-117`):

```ts
concurrency = DOWNLOAD_CONCURRENCY, retryBackoffMs = RETRY_BACKOFF_MS,
```

and reads it in two places: the take loop (`while (workers < concurrency)`) and
the retry-timer guard (`if (workers < concurrency)`). `server/index.ts` builds
the runner with no `deps` at all, so production always gets the constant; only
tests pass a number.

There is **no settings storage of any kind** in this app. `config.ts` reads
environment variables at boot, which is the wrong shape for something changed
from a page at runtime.

## 3. The rules

**Where it lives.** A generic `setting` table — `key TEXT PRIMARY KEY`,
`value TEXT` — not a column bolted onto an existing table. One row today,
`download_concurrency`. A key/value table costs no more than a purpose-built one
and means the next setting needs no migration.

**When a change takes effect.** The pool reads the setting on each `wake()`, so a
change applies to the next download rather than needing a restart. There is no
second source of truth to keep in step: the table is the only place the number
lives.

**Raising it** starts more downloads immediately: the route wakes the pool after
writing (§4.3). Waiting for the next natural wake would mean a raise did nothing
visible until the download in progress ended, which is exactly when it is least
useful.

**Lowering it** lets what is running finish. `wake()`'s loop condition simply
stops being true, so no new work is taken until `workers` falls back under the
new limit. Nothing is aborted.

**The range is 1 to 5, enforced in the model.** The dropdown offering 1–5 is
convenience; a `PATCH` of `0`, `99` or `"three"` is a 400. A value already in the
table outside the range — hand-edited, or written by a future version — is
clamped on read rather than crashing the pool.

**The default is 1**, matching the constant that ships today, so an install that
never touches the control behaves exactly as it does now.

## 4. Components

### 4.1 `server/models/settings.ts` (new)

```ts
export const CONCURRENCY_MIN = 1
export const CONCURRENCY_MAX = 5
export const CONCURRENCY_DEFAULT = 1

export function getSetting(db: Db, key: string): string | undefined
export function setSetting(db: Db, key: string, value: string): void

/** Clamped to 1-5, falling back to the default when unset or unparseable. */
export function getDownloadConcurrency(db: Db): number
/** Returns false when `n` is outside 1-5 or not an integer; writes nothing. */
export function setDownloadConcurrency(db: Db, n: number): boolean
```

The generic pair is the storage; the typed pair is the only thing anything else
calls. Nothing outside this file parses the stored string.

### 4.2 `server/services/downloader.ts` (changed)

`deps.concurrency` becomes `number | (() => number)`, normalised once:

```ts
const readConcurrency = typeof concurrency === 'function' ? concurrency : () => concurrency
```

with the default `() => getDownloadConcurrency(ctx.db)`. Both existing read sites
call `readConcurrency()` instead of closing over a captured number.

Accepting a plain number as well as a getter is deliberate: every existing pool
test passes `concurrency: 2`, and rewriting them to pass a thunk would be churn
for no gain.

`DOWNLOAD_CONCURRENCY` is **removed** from this file. §4.1's `CONCURRENCY_DEFAULT`
is the one owner of that number, and the runner imports it — two constants for
one value is how they drift apart. Any remaining reference, in tests or
elsewhere, moves to the model's export.

### 4.3 `GET /api/settings` and `PATCH /api/settings` (new)

```jsonc
// GET
{ "downloadConcurrency": 1 }

// PATCH { "downloadConcurrency": 3 }  ->  200 { "downloadConcurrency": 3 }
//       { "downloadConcurrency": 9 }  ->  400 { "error": "..." }
```

One endpoint rather than a per-setting route: the table is generic and the
response shape can grow a field without a new URL.

A successful `PATCH` **calls `app.downloader.wake()`**. Without it, raising the
limit while one download is running and three are queued would start nothing
until that download finished — the pool only re-reads on a wake, and a busy pool
is not woken by anything else. That is the opposite of what someone who just
raised the number expects. `wake()` is already public on the runner; when the
pool is idle or already at its limit it is a no-op.

### 4.4 `src/pages/Downloads.tsx` (changed)

A labelled `<select>` of 1–5 beside the Queue heading, showing the current value
and issuing a `PATCH` on change, then invalidating the settings query. A select
rather than a number input: it enforces the range in the UI, and it is a better
touch target on a tablet, which is the device this page was built for.

The control carries a one-line note that more is not automatically faster —
without it the obvious reading of a dial is that higher is better.

### 4.5 `src/api.ts` (changed)

```ts
getSettings: () => json<{ downloadConcurrency: number }>('/api/settings')
updateSettings: (body: { downloadConcurrency: number }) => // PATCH
```

## 5. Data flow

```
PATCH /api/settings { downloadConcurrency: 3 }
  ├─ setDownloadConcurrency(db, 3)      -> false if outside 1-5 -> 400
  ├─ app.downloader.wake()              -> so a raise takes effect now, not when
  │                                        the running download happens to end
  └─ 200 { downloadConcurrency: 3 }

wake() — from the PATCH above, an enqueue, a finished download, or a retry
  └─ while (workers < readConcurrency())   -> reads the table, takes more work
```

## 6. Safety and failure

- **The range is enforced where the value is written and again where it is
  read.** A row put there by hand cannot make the pool take unbounded work.
- **A missing row is not an error.** `getDownloadConcurrency` returns the default,
  so an install that has never opened the control runs exactly as it does today.
- **A lowered limit never aborts anything.** It is a ceiling on new work, not a
  kill signal.
- **The read is on the wake path, which is already a database path.** `takeNext`
  runs a statement per wake regardless; one more small read costs nothing
  measurable, and it is what removes the second source of truth.

## 7. Schema

```sql
-- Settings changed from the app rather than from the environment. One row per
-- setting; `config.ts` still owns everything read at boot.
CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## 8. Testing

**Model.** Round-trips a value. Returns the default when the row is absent.
Clamps a stored value above the max and below the min on read. `setDownloadConcurrency`
refuses `0`, `6`, `2.5` and `NaN`, and writes nothing when it refuses.

**Runner — the one that matters.** Raise the setting between two wakes and prove
the pool takes more work on the second: enqueue three with the setting at 1,
assert one is in flight, set it to 2, wake, assert two are. A setting the pool
reads but never acts on would pass every other test in this spec. Also: lowering
it mid-flight does not abort what is running.

**Route.** `GET` returns the default on a fresh database. `PATCH` persists and
echoes, and wakes the runner — asserted against a stub, because a raise that does
not wake is the defect this route exists to avoid. `PATCH` of `0`, `99` and a
non-number each return 400, leave the stored value alone, and do not wake.

**Page.** The select shows the stored value, and changing it issues the `PATCH`.

## 9. Risks

- **The dial invites the assumption that higher is better.** The note beside the
  control is the only thing pushing back on that, and a note is weak. If it turns
  out to matter, the honest fix is showing measured throughput rather than
  wording the label harder.
- **Nothing here measures whether parallel helped.** The user changes a number
  and forms an impression. Real evidence would need per-download throughput
  recorded and compared, which is a larger feature and deliberately not this one.
- **Five is a guess, calibrated to the Comic Vine budget rather than to the file
  host.** The host's tolerance for parallel connections is unknown; if it starts
  refusing, the cap is the wrong lever and a per-host rule is the right one.
