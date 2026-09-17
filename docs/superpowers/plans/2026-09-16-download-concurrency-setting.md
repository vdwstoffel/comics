# Download Concurrency Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the download pool size from a hardcoded constant into a control on the Downloads page, persisted and read without a restart.

**Architecture:** A generic `setting` key/value table in SQLite holds one row, `download_concurrency`. The runner's `concurrency` dep becomes a getter that `wake()` calls, defaulting to reading that row, so a change applies on the next wake. The `PATCH` route wakes the pool so a raise takes effect immediately rather than when the running download happens to end.

**Tech Stack:** TypeScript throughout. Fastify + better-sqlite3 on the server, React + TanStack Query on the client, Vitest + Testing Library for tests.

**Spec:** `docs/superpowers/specs/2026-09-16-download-concurrency-setting-design.md`

## Global Constraints

- **TypeScript only.** Server imports carry the `.js` extension (`../types.js`); `src/` imports carry none.
- **`src/` must never import from `server/`.**
- **No new dependencies.** Tests click with `fireEvent` from `@testing-library/react`; `@testing-library/user-event` was deliberately removed from this project.
- **The range is 1 to 5 inclusive**, enforced in the model, not only in the dropdown. The default is **1**.
- **BOTH typechecks must be clean:** `npx tsc --noEmit -p tsconfig.json` AND `npx tsc --noEmit -p tsconfig.server.json`. Run both every task.
- **Run tests with `npx vitest run <file>`.** The full suite is `npx vitest run` and currently passes **1126 tests across 88 files**.
- **Never test against the real library at `data/library.sqlite`.** Tests use `openDb(':memory:')`.
- **Commit after every task.**

---

### Task 1: The setting table and its model

**Files:**
- Modify: `server/db.ts` (append to the `MIGRATION` template literal — it is `MIGRATION`, not `SCHEMA`; every other table this app added lives there)
- Create: `server/models/settings.ts`
- Test: `test/models-settings.test.ts`

**Interfaces:**
- Consumes: `Db` from `server/types.js`.
- Produces:

```ts
export const CONCURRENCY_MIN = 1
export const CONCURRENCY_MAX = 5
export const CONCURRENCY_DEFAULT = 1
export function getSetting(db: Db, key: string): string | undefined
export function setSetting(db: Db, key: string, value: string): void
export function getDownloadConcurrency(db: Db): number
export function setDownloadConcurrency(db: Db, n: number): boolean
```

- [ ] **Step 1: Write the failing test**

Create `test/models-settings.test.ts`:

```ts
import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  getSetting, setSetting, getDownloadConcurrency, setDownloadConcurrency,
  CONCURRENCY_DEFAULT, CONCURRENCY_MIN, CONCURRENCY_MAX,
} from '../server/models/settings.js'

const db = () => openDb(':memory:')

test('a setting round-trips', () => {
  const d = db()
  setSetting(d, 'colour', 'green')
  expect(getSetting(d, 'colour')).toBe('green')
})

test('setting the same key again replaces it rather than failing', () => {
  const d = db()
  setSetting(d, 'colour', 'green')
  setSetting(d, 'colour', 'blue')
  expect(getSetting(d, 'colour')).toBe('blue')
})

test('a key that was never set reads as undefined', () => {
  expect(getSetting(db(), 'nothing')).toBeUndefined()
})

// An install that never opens the control must behave exactly as it does today.
test('concurrency defaults to one when the row is absent', () => {
  expect(getDownloadConcurrency(db())).toBe(CONCURRENCY_DEFAULT)
  expect(CONCURRENCY_DEFAULT).toBe(1)
})

test('concurrency round-trips through the typed pair', () => {
  const d = db()
  expect(setDownloadConcurrency(d, 3)).toBe(true)
  expect(getDownloadConcurrency(d)).toBe(3)
})

test('both ends of the range are accepted', () => {
  const d = db()
  expect(setDownloadConcurrency(d, CONCURRENCY_MIN)).toBe(true)
  expect(getDownloadConcurrency(d)).toBe(1)
  expect(setDownloadConcurrency(d, CONCURRENCY_MAX)).toBe(true)
  expect(getDownloadConcurrency(d)).toBe(5)
})

// The dropdown is convenience. This is the guard.
test('a value outside the range is refused and writes nothing', () => {
  const d = db()
  setDownloadConcurrency(d, 3)
  for (const bad of [0, -1, 6, 99, 2.5, NaN, Infinity]) {
    expect(setDownloadConcurrency(d, bad)).toBe(false)
  }
  expect(getDownloadConcurrency(d)).toBe(3)
})

// A row put there by hand, or by a future version with a different range, must not
// make the pool take unbounded work.
test('a stored value outside the range is clamped on read', () => {
  const d = db()
  setSetting(d, 'download_concurrency', '99')
  expect(getDownloadConcurrency(d)).toBe(CONCURRENCY_MAX)
  setSetting(d, 'download_concurrency', '0')
  expect(getDownloadConcurrency(d)).toBe(CONCURRENCY_MIN)
})

test('a stored value that is not a number falls back to the default', () => {
  const d = db()
  setSetting(d, 'download_concurrency', 'three')
  expect(getDownloadConcurrency(d)).toBe(CONCURRENCY_DEFAULT)
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/models-settings.test.ts`
Expected: FAIL — cannot resolve `../server/models/settings.js`.

- [ ] **Step 3: Add the table**

In `server/db.ts`, append inside the `MIGRATION` template literal, before its closing backtick:

```sql
-- Settings changed from the app rather than from the environment. One row per
-- setting; config.ts still owns everything read at boot. Generic on purpose: a
-- key/value table costs no more than a purpose-built one, and the next setting
-- then needs no migration.
CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 4: Write the model**

Create `server/models/settings.ts`:

```ts
import type { Db } from '../types.js'

/**
 * How many downloads may run at once.
 *
 * The ceiling is calibrated to the Comic Vine budget rather than to the file host:
 * each download builds its own throttled client, so N downloads make N times the
 * requests. Five is comfortable against 200 an hour; it is also low enough that a
 * mistyped number cannot open twenty connections to a scraped file host.
 */
export const CONCURRENCY_MIN = 1
export const CONCURRENCY_MAX = 5
export const CONCURRENCY_DEFAULT = 1

const CONCURRENCY_KEY = 'download_concurrency'

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

/**
 * The pool size. Clamped on read as well as on write: a row put there by hand, or
 * written by a future version with a wider range, must not make the pool take
 * unbounded work. Anything unparseable reads as the default rather than NaN.
 */
export function getDownloadConcurrency(db: Db): number {
  const raw = getSetting(db, CONCURRENCY_KEY)
  const n = Number(raw)
  if (raw == null || !Number.isFinite(n)) return CONCURRENCY_DEFAULT
  return Math.min(Math.max(Math.trunc(n), CONCURRENCY_MIN), CONCURRENCY_MAX)
}

/** False, and nothing written, when `n` is not a whole number inside the range. */
export function setDownloadConcurrency(db: Db, n: number): boolean {
  if (!Number.isInteger(n) || n < CONCURRENCY_MIN || n > CONCURRENCY_MAX) return false
  setSetting(db, CONCURRENCY_KEY, String(n))
  return true
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run test/models-settings.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck both, then commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json`

```bash
git add server/db.ts server/models/settings.ts test/models-settings.test.ts
git commit -m "feat: a setting table, and the download concurrency that lives in it"
```

---

### Task 2: The pool reads the setting instead of a constant

**Files:**
- Modify: `server/services/downloader.ts`
- Test: `test/download-runner.test.ts`

**Interfaces:**
- Consumes: `getDownloadConcurrency`, `CONCURRENCY_DEFAULT` from Task 1.
- Produces: `DownloadDeps.concurrency?: number | (() => number)`. `DOWNLOAD_CONCURRENCY` is **removed** from this file.

- [ ] **Step 1: Write the failing test**

Append to `test/download-runner.test.ts`. You will need `setDownloadConcurrency` from `../server/models/settings.js` in that file's imports.

```ts
// The whole point of the setting: the pool must notice a change without being
// rebuilt. A pool that reads the value once at construction passes every other
// test in this file and fails only this one.
test('raising the setting lets the next wake take more work', async () => {
  let inFlight = 0
  let maxInFlight = 0
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })

  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await held
      inFlight--
      return respond(cbzBytes, { url: REDIRECTED })
    },
  })

  for (const n of [1, 2, 3]) runner.enqueue({ url: `${OPAQUE}/${n}`, edition: 'ASM', label: `i${n}` })
  // Default of 1: exactly one is in flight, and the others are waiting.
  await new Promise((r) => setTimeout(r, 20))
  expect(maxInFlight).toBe(1)

  setDownloadConcurrency(ctx.db, 3)
  runner.wake()
  await new Promise((r) => setTimeout(r, 20))
  expect(maxInFlight).toBe(3)

  release()
  await runner.idle()
})

// Lowering is a ceiling on NEW work, not a kill signal.
test('lowering the setting does not abort what is already running', async () => {
  let started = 0
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })

  // The setting, not a fixed dep: passing `concurrency: 2` here would make the runner
  // ignore the table entirely and this test would pass without proving anything.
  setDownloadConcurrency(ctx.db, 2)
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => { started++; await held; return respond(cbzBytes, { url: REDIRECTED }) },
  })
  runner.enqueue({ url: `${OPAQUE}/1`, edition: 'ASM', label: 'a' })
  runner.enqueue({ url: `${OPAQUE}/2`, edition: 'ASM', label: 'b' })
  await new Promise((r) => setTimeout(r, 20))
  expect(started).toBe(2)

  setDownloadConcurrency(ctx.db, 1)
  runner.wake()
  release()
  await runner.idle()

  // Both finished. Nothing was cancelled, and neither carries an error.
  expect(runner.status().history.map((e) => e.state)).toEqual(['done', 'done'])
})
```

- [ ] **Step 2: Run it and watch the first one fail**

Run: `npx vitest run test/download-runner.test.ts`
Expected: FAIL on `raising the setting lets the next wake take more work` — `expected 1 to be 3`, because the pool captured its size at construction.

- [ ] **Step 3: Make the pool read a getter**

In `server/services/downloader.ts`:

Delete the `DOWNLOAD_CONCURRENCY` constant and its doc comment, and add the import:

```ts
import { getDownloadConcurrency } from '../models/settings.js'
```

Change the dep's type on `DownloadDeps`:

```ts
  /**
   * How many downloads run at once. A number is treated as fixed; a getter is read
   * on every wake, which is how the setting takes effect without a restart.
   * Defaults to reading the `setting` table.
   */
  concurrency?: number | (() => number)
```

and in the factory, replace the destructured `concurrency` with a normalised reader:

```ts
  const {
    fetchImpl = fetch, maxBytes = ctx.config.maxUploadBytes, timeoutMs = HOUR,
    concurrency, retryBackoffMs = RETRY_BACKOFF_MS,
  } = deps

  // Normalised once. A plain number stays accepted because every existing pool test
  // passes one, and rewriting them to pass a thunk would be churn for no gain.
  const readConcurrency: () => number =
    typeof concurrency === 'function' ? concurrency
      : concurrency != null ? () => concurrency
        : () => getDownloadConcurrency(ctx.db)
```

Then change both read sites to call it — the take loop and the retry-timer guard:

```ts
    while (workers < readConcurrency()) {
```

```ts
    if (workers < readConcurrency()) {
```

- [ ] **Step 4: Run the runner tests and watch them pass**

Run: `npx vitest run test/download-runner.test.ts`
Expected: PASS. Every pre-existing test in this file must still pass — they pass `concurrency` as a number and that path is unchanged.

- [ ] **Step 5: Check nothing else referenced the removed constant**

Run: `grep -rn "DOWNLOAD_CONCURRENCY" server/ src/ test/`
Expected: only the comment in `test/download-runner.test.ts` around line 289, which is prose. If any code still imports it, point it at `CONCURRENCY_DEFAULT` from `server/models/settings.js` instead.

- [ ] **Step 6: Both typechecks and the full suite, then commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json && npx vitest run`

```bash
git add server/services/downloader.ts test/download-runner.test.ts
git commit -m "feat: the pool reads its size on every wake"
```

---

### Task 3: The settings routes

**Files:**
- Create: `server/routes/settings.ts`
- Modify: `server/index.ts` (register it)
- Test: `test/routes-settings.test.ts`

**Interfaces:**
- Consumes: `getDownloadConcurrency`, `setDownloadConcurrency` (Task 1); `app.downloader.wake()` (already public).
- Produces: `GET /api/settings` → `{ downloadConcurrency }`; `PATCH /api/settings` with the same shape.

- [ ] **Step 1: Write the failing test**

Create `test/routes-settings.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import settingsRoutes from '../server/routes/settings.js'
import { openDb } from '../server/db.js'
import { getDownloadConcurrency } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

async function setup() {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  const wake = vi.fn()
  app.decorate('downloader', { wake } as never)
  await app.register(settingsRoutes)
  return { app, db, wake, cleanup: async () => { await app.close() } }
}

test('a fresh install reports the default', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ url: '/api/settings' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ downloadConcurrency: 1 })
  } finally { await t.cleanup() }
})

test('a change is persisted and echoed back', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 3 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ downloadConcurrency: 3 })
    expect(getDownloadConcurrency(t.db)).toBe(3)
    expect((await t.app.inject({ url: '/api/settings' })).json().downloadConcurrency).toBe(3)
  } finally { await t.cleanup() }
})

// Without this, raising the limit while one download runs and three wait would start
// nothing until that download happened to end - the pool only re-reads on a wake.
test('raising the limit wakes the pool', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 4 } })
    expect(t.wake).toHaveBeenCalled()
  } finally { await t.cleanup() }
})

test('a value outside the range is refused, changes nothing, and wakes nothing', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 2 } })
    t.wake.mockClear()
    for (const bad of [0, 6, 99, -1]) {
      const res = await t.app.inject({
        method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: bad },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(getDownloadConcurrency(t.db)).toBe(2)
    expect(t.wake).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

test('a non-number is refused', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 'three' },
    })
    expect(res.statusCode).toBe(400)
  } finally { await t.cleanup() }
})

test('a patch with nothing in it is refused rather than silently doing nothing', async () => {
  const t = await setup()
  try {
    expect((await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: {} })).statusCode).toBe(400)
  } finally { await t.cleanup() }
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/routes-settings.test.ts`
Expected: FAIL — cannot resolve `../server/routes/settings.js`.

- [ ] **Step 3: Write the routes**

Create `server/routes/settings.ts`:

```ts
import { getDownloadConcurrency, setDownloadConcurrency } from '../models/settings.js'
import type { App } from '../types.js'

interface PatchBody { downloadConcurrency?: unknown }

export default async function settingsRoutes(app: App) {
  app.get('/api/settings', async () => ({
    downloadConcurrency: getDownloadConcurrency(app.db),
  }))

  app.patch<{ Body: PatchBody }>('/api/settings', async (req, reply) => {
    const value = req.body?.downloadConcurrency
    if (typeof value !== 'number') {
      return reply.code(400).send({ error: 'downloadConcurrency must be a number' })
    }
    // The model owns the range. The route does not repeat it, or the two would drift.
    if (!setDownloadConcurrency(app.db, value)) {
      return reply.code(400).send({ error: 'downloadConcurrency must be a whole number from 1 to 5' })
    }
    // A busy pool is woken by nothing else, so without this a raise would do nothing
    // visible until the download in progress happened to end.
    app.downloader.wake()
    return { downloadConcurrency: getDownloadConcurrency(app.db) }
  })
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/routes-settings.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Register the route**

In `server/index.ts`, beside the other registrations, add `await app.register(settingsRoutes)` with `import settingsRoutes from './routes/settings.js'` at the top.

- [ ] **Step 6: Both typechecks and the full suite, then commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json && npx vitest run`

```bash
git add server/routes/settings.ts server/index.ts test/routes-settings.test.ts
git commit -m "feat: read and change the download concurrency over http"
```

---

### Task 4: The control on the Downloads page

**Files:**
- Modify: `src/api.ts`, `src/pages/Downloads.tsx`, `src/styles.css`
- Test: `test/Downloads.test.tsx`

**Interfaces:**
- Consumes: `GET`/`PATCH /api/settings` (Task 3).
- Produces: `api.getSettings()`, `api.updateSettings({ downloadConcurrency })`.

- [ ] **Step 1: Add the API calls**

In `src/api.ts`, beside the other download calls:

```ts
export interface ApiSettings {
  downloadConcurrency: number
}
```

```ts
  getSettings: () => json<ApiSettings>('/api/settings'),

  updateSettings: (body: { downloadConcurrency: number }) =>
    json<ApiSettings>('/api/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
```

- [ ] **Step 2: Write the failing tests**

Add to `test/Downloads.test.tsx`. Its `beforeEach` answers every GET with the downloads
view; it needs a `/api/settings` branch. Add the branch and change nothing else — no
existing assertion in that file is yours to touch:

```ts
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method) posted.push(`${init.method} ${url}`)
    if (String(url).includes('/api/settings')) {
      return { ok: true, json: async () => ({ downloadConcurrency: 1 }) }
    }
    return { ok: true, json: async () => (init?.method ? {} : VIEW) }
  }) as unknown as typeof fetch
```

Match the surrounding code's existing shape — the names above (`posted`, `VIEW`) are
what that file already uses; if they differ, keep the file's.

```tsx
test('the concurrency control shows what is stored', async () => {
  draw()
  const select = await screen.findByLabelText(/at once/i)
  expect(select).toHaveValue('1')
})

test('the control offers one through five and nothing else', async () => {
  draw()
  const select = await screen.findByLabelText(/at once/i) as HTMLSelectElement
  expect([...select.options].map((o) => o.value)).toEqual(['1', '2', '3', '4', '5'])
})

test('changing it patches the server', async () => {
  draw()
  const select = await screen.findByLabelText(/at once/i)
  fireEvent.change(select, { target: { value: '3' } })
  await waitFor(() => expect(posted).toContain('PATCH /api/settings'))
})

// A dial with no caveat reads as "higher is better", which is not true.
test('the control says that more is not automatically faster', async () => {
  draw()
  expect(await screen.findByText(/not always faster|may not be faster/i)).toBeInTheDocument()
})
```

You will need `waitFor` in that file's imports from `@testing-library/react` if it is not already there.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run test/Downloads.test.tsx`
Expected: FAIL — no element with that label.

- [ ] **Step 4: Add the control**

In `src/pages/Downloads.tsx`, add the query and the mutation beside the existing ones:

```tsx
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })

  const setConcurrency = useMutation({
    mutationFn: (downloadConcurrency: number) => api.updateSettings({ downloadConcurrency }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
```

and render it beside the Queue heading:

```tsx
      <section>
        <div className="downloads__queue-head">
          <h2 className="page-title">Queue</h2>
          <label className="downloads__concurrency">
            Download at once
            <select
              value={String(settings?.downloadConcurrency ?? 1)}
              onChange={(e) => setConcurrency.mutate(Number(e.target.value))}
              disabled={setConcurrency.isPending}
            >
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        {/* A dial invites the reading that higher is better. It depends on where the
            bottleneck is: a saturated link gains nothing from more connections. */}
        <p className="downloads__hint">More at once is not always faster — it depends on your connection.</p>
        <QueueList
          entries={queue}
          onMove={(id, index) => move.mutate({ id, index })}
          onCancel={(id) => cancel.mutate(id)}
        />
      </section>
```

Those `QueueList` props are exactly what the file already passes — copy them from the
current code rather than from here if they differ, and change nothing about them.

- [ ] **Step 5: Add the styles**

In `src/styles.css`, beside the `.queue-list` rules:

```css
/* The heading and its control share a row; the control sits to the right of the
   section it governs rather than in a settings screen of its own. */
.downloads__queue-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.downloads__concurrency {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--muted);
}

/* 44px so it is a real target on the tablet this page was built for. */
.downloads__concurrency select {
  min-height: 44px;
  padding: 0 10px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.downloads__hint {
  margin: 4px 0 12px;
  font-size: 0.8125rem;
  color: var(--muted);
}
```

Check those variable names against neighbouring rules before using them; match whatever the file actually defines.

- [ ] **Step 6: Run the page tests and watch them pass**

Run: `npx vitest run test/Downloads.test.tsx`
Expected: PASS, with every pre-existing test in that file still green.

- [ ] **Step 7: Both typechecks and the full suite, then commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json && npx vitest run`

```bash
git add src/api.ts src/pages/Downloads.tsx src/styles.css test/Downloads.test.tsx
git commit -m "feat: choose how many downloads run at once"
```

---

### Task 5: Verification against the running app

- [ ] **Step 1: Full suite and both typechecks**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json`
Expected: green, and about 21 tests more than the 1126 baseline (9 + 2 + 6 + 4).

- [ ] **Step 2: Rebuild the container**

Run: `docker compose up -d --build`

- [ ] **Step 3: Read and change the setting over HTTP**

```bash
PORT=$(docker compose port comic-app 3000 | cut -d: -f2)
curl -s "http://localhost:$PORT/api/settings"
curl -s -X PATCH "http://localhost:$PORT/api/settings" -H 'content-type: application/json' -d '{"downloadConcurrency":3}'
curl -s -X PATCH "http://localhost:$PORT/api/settings" -H 'content-type: application/json' -d '{"downloadConcurrency":9}' -w ' [%{http_code}]\n'
curl -s "http://localhost:$PORT/api/settings"
```

Expected: `{"downloadConcurrency":1}`, then `3`, then a **400** for 9, then `3` again — the refusal left it alone.

- [ ] **Step 4: Prove it survives a restart**

```bash
docker compose restart comic-app && sleep 10
curl -s "http://localhost:$PORT/api/settings"
```

Expected: still `3`.

- [ ] **Step 5: Prove the pool honours it**

Queue three downloads against an unreachable host and check how many are in flight at once:

```bash
for n in a b c; do
  curl -s -X POST "http://localhost:$PORT/api/downloads" -H 'content-type: application/json' \
    -d "{\"url\":\"https://example.invalid/$n.cbz\",\"label\":\"$n\"}" > /dev/null
done
curl -s "http://localhost:$PORT/api/downloads" | python3 -c "
import json,sys; d=json.load(sys.stdin); print('active:', len(d['active']), 'queue:', len(d['queue']))"
```

`example.invalid` fails DNS almost instantly, so catching three in flight is timing-dependent — if `active` reads 0, that is the downloads having already failed, not the setting being ignored. The deterministic proof is the runner test from Task 2; this step is a smoke test that the wiring reaches production.

- [ ] **Step 6: Put the setting back and clean up**

```bash
curl -s -X PATCH "http://localhost:$PORT/api/settings" -H 'content-type: application/json' -d '{"downloadConcurrency":1}'
curl -s -X DELETE "http://localhost:$PORT/api/downloads/history"
sqlite3 -readonly data/library.sqlite "SELECT COUNT(*) FROM download_queue;"
```

Expected: `0` rows left. Leave the setting at whatever you want to run with.

---

## Notes for the executor

- **The spec is the argument, this plan is the order.** When they disagree, the spec wins — say so rather than guessing.
- **Task 2's first test is the one that matters.** A pool that reads its size once at construction passes every other test in the runner file and fails only that one. If it passes before you change the runner, the test is wrong.
- **Only Task 2 and Task 4 touch existing test files**, and in both cases additively. If you find yourself editing an existing assertion, stop and report which and why.
- **The range lives in the model.** The route does not re-check it and the dropdown is not the guard — if you find yourself writing `1` and `5` in a third place, that is the drift the spec warned about.
