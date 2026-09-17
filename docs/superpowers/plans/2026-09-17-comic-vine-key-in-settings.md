# Comic Vine Key in Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Comic Vine API key out of the environment and into the `setting` table, set from a new Settings page, read per request so a change needs no restart.

**Architecture:** `createComicVine` stops capturing the key at construction and takes a getter resolved inside each request, which is what lets the three clients built at route-registration time see a key entered an hour later — and what preserves the per-client 1-request-per-second throttle that rebuilding a client per request would reset. `Config.comicVineApiKey` and `COMIC_VINE_API_KEY` are deleted outright, so the database is the only source and the compiler enumerates every site that has to change. A `PATCH /api/settings` verifies a candidate key against Comic Vine before storing it.

**Tech Stack:** TypeScript (strict), Fastify, better-sqlite3, React + Vite, React Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-17-comic-vine-key-in-settings-design.md`

## Global Constraints

- **TypeScript strict throughout.** Server is NodeNext: every relative import ends in `.js` (`../models/settings.js`), even though the source is `.ts`. Frontend uses bundler resolution and no extension.
- **`npm install` always needs `--legacy-peer-deps`** (vite@8 / @vitejs/plugin-react@4 peer conflict). Do not run a bare `npm install`.
- **Test:** `npm test` (vitest run). A single file: `npx vitest run test/<file>`. **Typecheck:** `npm run typecheck`. Both must pass before every commit.
- **Existing 400 wording is unchanged and must stay verbatim:** `Comic Vine API key not configured`.
- **New rejection wording, verbatim:** `` `Comic Vine did not accept that key: ${message}` ``.
- **Empty-body PATCH stays a 400.** `test/routes-settings.test.ts:81` already pins it.
- **`getComicVineKey` returns `''`, never `undefined`** — every existing `if (!key)` guard keeps working untouched.
- **Only a concurrency change wakes the download pool.** A key save must not call `app.downloader.wake()`.
- **Commits:** conventional prefix, lowercase subject, body explaining *why*, and the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **After the last task, rebuild the container:** `docker compose up -d --build`.

---

### Task 1: Store the key in the setting table

**Files:**
- Modify: `server/models/settings.ts`
- Test: `test/models-settings.test.ts`

**Interfaces:**
- Consumes: `getSetting(db, key)` / `setSetting(db, key, value)`, already in this file.
- Produces: `getComicVineKey(db: Db): string` — the stored key, `''` when unset. `setComicVineKey(db: Db, key: string): void` — writes the trimmed key.

- [ ] **Step 1: Write the failing tests**

Append to `test/models-settings.test.ts`. Match the file's existing import style; add `getComicVineKey, setComicVineKey` to the existing import from `../server/models/settings.js`.

```ts
test('a fresh install has no Comic Vine key, reported as the empty string', () => {
  const db = openDb(':memory:')
  expect(getComicVineKey(db)).toBe('')
})

test('a Comic Vine key round-trips', () => {
  const db = openDb(':memory:')
  setComicVineKey(db, 'abc123')
  expect(getComicVineKey(db)).toBe('abc123')
})

// A key pasted out of a web page arrives with whitespace, and a trailing newline in a
// query string is a rejected key with no visible cause.
test('whitespace around a pasted key is trimmed away', () => {
  const db = openDb(':memory:')
  setComicVineKey(db, '  abc123\n')
  expect(getComicVineKey(db)).toBe('abc123')
})

test('the empty string clears the key rather than storing a blank one', () => {
  const db = openDb(':memory:')
  setComicVineKey(db, 'abc123')
  setComicVineKey(db, '')
  expect(getComicVineKey(db)).toBe('')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/models-settings.test.ts`
Expected: FAIL — `getComicVineKey is not a function` (or a TS resolution error on the import).

- [ ] **Step 3: Implement**

Add to `server/models/settings.ts`, below the concurrency pair:

```ts
const COMIC_VINE_KEY = 'comic_vine_api_key'

/**
 * The Comic Vine key as it stands right now.
 *
 * The empty string when unset rather than `undefined`: every guard in the app asks
 * `if (!key)`, and the two shapes would read identically at those sites while differing
 * everywhere else.
 */
export function getComicVineKey(db: Db): string {
  return getSetting(db, COMIC_VINE_KEY) ?? ''
}

/** Trimmed on the way in - a pasted key carries whitespace, and a trailing newline in a
 *  query string is a rejected key with no visible cause. The empty string clears it. */
export function setComicVineKey(db: Db, key: string): void {
  setSetting(db, COMIC_VINE_KEY, key.trim())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/models-settings.test.ts` → PASS
Run: `npm run typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add server/models/settings.ts test/models-settings.test.ts
git commit -m "feat: store the Comic Vine key in the setting table

The key has somewhere to live that is not the environment. Nothing reads
it yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Read the key at request time, not at construction

**Files:**
- Modify: `server/lib/comicvine.ts:222-226` (options), `:240` (factory signature), `:248-251` (the `get` preamble)
- Test: `test/comicvine.test.ts`

**Interfaces:**
- Produces: `ComicVineOptions.apiKey: string | (() => string)`. A plain string still works exactly as before; a getter is resolved on every request.

**Why this and not a client per request:** `lastCall` lives in the client's closure (`server/lib/comicvine.ts:241`) and is what holds the app to one Comic Vine request per second. A fresh client per request resets it. `server/routes/releases.ts:26-28` already carries a comment saying precisely this.

- [ ] **Step 1: Write the failing tests**

Add to `test/comicvine.test.ts`, near the other client tests. `mockFetch` is already defined at the top of that file.

```ts
// The load-bearing test of this change. A client that captures its key at construction -
// which is what all three route plugins do, once, at boot - passes every other test in
// this file and fails only this one.
test('a key getter is re-read on every request, so a key set later is used', async () => {
  let key = ''
  const cv = createComicVine({
    apiKey: () => key,
    now: () => 0,
    fetchImpl: mockFetch([['/issue/', { results: { name: 'Year One', issue_number: '1' } }]]),
  })

  await expect(cv.getIssue(42)).rejects.toThrow(/not configured/)

  key = 'set-later'
  await expect(cv.getIssue(42)).resolves.toMatchObject({ title: 'Year One' })
})

test('the key the getter returns is the key that is sent', async () => {
  let key = 'first'
  const urls: string[] = []
  const cv = createComicVine({
    apiKey: () => key,
    now: () => 0,
    fetchImpl: async (url: string) => {
      urls.push(String(url))
      return { ok: true, json: async () => ({ results: {} }) }
    },
  })

  await cv.getIssue(1)
  key = 'second'
  await cv.getIssue(1)

  expect(urls[0]).toContain('api_key=first')
  expect(urls[1]).toContain('api_key=second')
})

// Every existing caller and test passes a literal. Widening the option must not cost them.
test('a plain string key still works', async () => {
  const cv = createComicVine({
    apiKey: 'k',
    now: () => 0,
    fetchImpl: mockFetch([['/issue/', { results: { name: 'Year One' } }]]),
  })
  await expect(cv.getIssue(42)).resolves.toMatchObject({ title: 'Year One' })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/comicvine.test.ts`
Expected: FAIL — the first two fail to typecheck/run because `apiKey` only accepts `string`; at runtime a function stringifies into the query and the `!apiKey` guard never fires.

- [ ] **Step 3: Implement**

In `server/lib/comicvine.ts`, change the option type:

```ts
export interface ComicVineOptions {
  /**
   * A getter rather than a string when the key can change while the process runs. Three
   * route plugins build their client once, at registration, and would otherwise hold the
   * key that existed at boot forever. Resolved per request, inside `get`.
   */
  apiKey: string | (() => string)
  fetchImpl?: typeof fetch | ((url: string, init?: unknown) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>)
  now?: () => number
}
```

Inside `createComicVine`, immediately after the destructure:

```ts
export function createComicVine({ apiKey, fetchImpl = fetch, now = () => Date.now() }: ComicVineOptions): ComicVineClient {
  // Normalised once so `get` has a single shape to call. A literal is still accepted: every
  // client test and the settings route's verification pass one, and a thunk there would be
  // churn for no gain.
  const readKey = typeof apiKey === 'function' ? apiKey : () => apiKey

  let lastCall = 0
```

And in `get`, replace the first two lines of the body:

```ts
  async function get(path: string, params: Record<string, string>): Promise<CvResponse> {
    const key = readKey()
    if (!key) throw new Error('Comic Vine API key not configured')
    await throttle()
    const qs = new URLSearchParams({ api_key: key, format: 'json', ...params })
```

Leave the rest of `get` — the `res.ok` check, the `status_code` check and its comment — untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/comicvine.test.ts` → PASS
Run: `npm run typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add server/lib/comicvine.ts test/comicvine.test.ts
git commit -m "feat: let the Comic Vine client read its key per request

The key is about to become a setting that changes while the process runs.
Three route plugins build their client once at registration, so a key
captured in the closure would be the one that existed at boot forever.

A getter rather than a client per request: the 1-per-second throttle lives
in the client's closure, and a fresh client per call resets it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Ask Comic Vine whether a key is good

**Files:**
- Modify: `server/lib/comicvine.ts:228-238` (client interface), factory return object
- Test: `test/comicvine.test.ts`

**Interfaces:**
- Consumes: Task 2's `readKey`, and the existing private `get`.
- Produces: `ComicVineClient.verifyKey(): Promise<void>` — resolves when Comic Vine accepts the key, throws carrying Comic Vine's own reason when it does not.

**Why it needs no new error handling:** Comic Vine answers a bad key with HTTP 200 and `status_code` 100 in the body. The check at `server/lib/comicvine.ts:261` already turns that into a throw carrying the message, so `verifyKey` is a request, not an error path.

- [ ] **Step 1: Write the failing tests**

Add to `test/comicvine.test.ts`:

```ts
test('verifyKey resolves when Comic Vine accepts the key', async () => {
  const cv = createComicVine({
    apiKey: 'good-key',
    now: () => 0,
    fetchImpl: mockFetch([['/issues/', { status_code: 1, results: [{ id: 1 }] }]]),
  })
  await expect(cv.verifyKey()).resolves.toBeUndefined()
})

// Comic Vine reports a bad key as HTTP 200 with status_code 100 in the body, so the only
// thing that distinguishes it from a good key is the check `get` already makes.
test('verifyKey throws with Comic Vine reason when the key is rejected', async () => {
  const cv = createComicVine({
    apiKey: 'bad-key',
    now: () => 0,
    fetchImpl: mockFetch([['/issues/', { status_code: 100, error: 'Invalid API Key' }]]),
  })
  await expect(cv.verifyKey()).rejects.toThrow(/Invalid API Key/)
})

// One row, one field. Verification must not cost a page of issues.
test('verifyKey asks for as little as Comic Vine will return', async () => {
  const urls: string[] = []
  const cv = createComicVine({
    apiKey: 'k',
    now: () => 0,
    fetchImpl: async (url: string) => {
      urls.push(String(url))
      return { ok: true, json: async () => ({ status_code: 1, results: [] }) }
    },
  })
  await cv.verifyKey()
  expect(urls[0]).toContain('limit=1')
  expect(urls[0]).toContain('field_list=id')
})

test('verifyKey refuses an empty key without calling Comic Vine', async () => {
  let calls = 0
  const cv = createComicVine({
    apiKey: '',
    now: () => 0,
    fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({}) } },
  })
  await expect(cv.verifyKey()).rejects.toThrow(/not configured/)
  expect(calls).toBe(0)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/comicvine.test.ts`
Expected: FAIL — `cv.verifyKey is not a function`.

- [ ] **Step 3: Implement**

Add to the `ComicVineClient` interface in `server/lib/comicvine.ts`:

```ts
export interface ComicVineClient {
  search(query: string, type?: string): Promise<CvSearchResult[]>
  searchVolumes(query: string): Promise<CvVolumeMatch[]>
  getIssue(id: number | string): Promise<CvIssue>
  getVolume(id: number | string): Promise<CvVolume>
  listVolumeIssues(volumeId: number | string): Promise<CvVolumeIssue[]>
  getCharacter(id: number | string): Promise<CvCharacter>
  getStoryArc(id: number | string): Promise<CvStoryArc>
  listIssuesOnSale(day: string): Promise<CvReleaseIssue[]>
  getVolumePublishers(ids: number[]): Promise<Map<number, string | undefined>>
  /** Resolves when Comic Vine accepts the key; throws carrying its reason when it does not. */
  verifyKey(): Promise<void>
}
```

Add the implementation inside `createComicVine`, alongside the other methods:

```ts
  /**
   * The smallest request Comic Vine will answer: one row, one field. Its only purpose is
   * the answer `get` already extracts - a rejected key comes back as HTTP 200 with
   * status_code 100, which `get` turns into a throw carrying Comic Vine's own wording.
   */
  async function verifyKey(): Promise<void> {
    await get('/issues/', { limit: '1', field_list: 'id' })
  }
```

and add `verifyKey` to the returned object literal, keeping it in the same order as the interface.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/comicvine.test.ts` → PASS
Run: `npm run typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add server/lib/comicvine.ts test/comicvine.test.ts
git commit -m "feat: ask Comic Vine whether a key is good

A key typed into a field should be refused when it is typed, not
discovered to be wrong later from an unrelated screen. Comic Vine reports
a bad key as HTTP 200 with status_code 100, which the client's existing
body check already turns into a throw - so this is one small request, not
a new error path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Set the key through /api/settings

**Files:**
- Modify: `server/routes/settings.ts` (whole file)
- Test: `test/routes-settings.test.ts`

**Interfaces:**
- Consumes: `getComicVineKey` / `setComicVineKey` (Task 1), `createComicVine(...).verifyKey()` (Tasks 2-3), the existing `getDownloadConcurrency` / `setDownloadConcurrency`.
- Produces: `GET /api/settings` → `{ downloadConcurrency: number, comicVineApiKey: string }`. `PATCH /api/settings` accepts either field or both.

**Rules this task encodes:** an absent field is left alone; a body with neither field is a 400; a key is verified before it is stored and a rejection writes nothing; the empty string clears without verifying; only a concurrency change wakes the pool.

- [ ] **Step 1: Write the failing tests**

In `test/routes-settings.test.ts`, first update the two existing assertions that pin the whole GET payload:

```ts
// line ~24, in 'a fresh install reports the default'
expect(res.json()).toEqual({ downloadConcurrency: 1, comicVineApiKey: '' })

// line ~35, in 'a change is persisted and echoed back'
expect(res.json()).toEqual({ downloadConcurrency: 3, comicVineApiKey: '' })
```

Then extend `setup()` so a test can control what Comic Vine says, and append the new cases. Replace the existing `setup` with:

```ts
async function setup(cvOk = true) {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  const wake = vi.fn()
  app.decorate('downloader', { wake } as never)

  // The route builds its own client from the candidate key; the stub goes in through
  // global fetch, the way every other route suite here does it.
  const origFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url))
    return cvOk
      ? { ok: true, json: async () => ({ status_code: 1, results: [] }) }
      : { ok: true, json: async () => ({ status_code: 100, error: 'Invalid API Key' }) }
  }) as unknown as typeof fetch

  return {
    app, db, wake, calls,
    cleanup: async () => { globalThis.fetch = origFetch; await app.close() },
  }
}
```

Add `import { getComicVineKey } from '../server/models/settings.js'` to the existing model import, then append:

```ts
test('a verified key is stored and echoed back', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'abc123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().comicVineApiKey).toBe('abc123')
    expect(getComicVineKey(t.db)).toBe('abc123')
  } finally { await t.cleanup() }
})

// The whole point of verifying on save: a typo is refused while you are still looking at
// the field, and what was already working is left alone.
test('a key Comic Vine rejects is refused and changes nothing', async () => {
  const t = await setup(false)
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'bad' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/did not accept that key/i)
    expect(res.json().error).toMatch(/Invalid API Key/)
    expect(getComicVineKey(t.db)).toBe('')
  } finally { await t.cleanup() }
})

test('a stored key survives a failed attempt to replace it', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'good' } })
    expect(getComicVineKey(t.db)).toBe('good')

    // Comic Vine now rejects everything.
    globalThis.fetch = (async () => ({
      ok: true, json: async () => ({ status_code: 100, error: 'Invalid API Key' }),
    })) as unknown as typeof fetch

    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'bad' },
    })
    expect(res.statusCode).toBe(400)
    expect(getComicVineKey(t.db)).toBe('good')
  } finally { await t.cleanup() }
})

// There is nothing to verify, and refusing to clear would leave no way back to an
// unconfigured install.
test('clearing the key stores nothing and never calls Comic Vine', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'abc123' } })
    const before = t.calls.length

    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: '' },
    })
    expect(res.statusCode).toBe(200)
    expect(getComicVineKey(t.db)).toBe('')
    expect(t.calls.length).toBe(before)
  } finally { await t.cleanup() }
})

test('a patch that names only one setting leaves the other alone', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { downloadConcurrency: 4 } })
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'abc123' } })

    const res = await t.app.inject({ url: '/api/settings' })
    expect(res.json()).toEqual({ downloadConcurrency: 4, comicVineApiKey: 'abc123' })
  } finally { await t.cleanup() }
})

// Saving a key has nothing to do with the download queue.
test('saving a key does not wake the download pool', async () => {
  const t = await setup()
  try {
    await t.app.inject({ method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 'abc123' } })
    expect(t.wake).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

test('a key that is not a string is refused', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'PATCH', url: '/api/settings', payload: { comicVineApiKey: 42 },
    })
    expect(res.statusCode).toBe(400)
  } finally { await t.cleanup() }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/routes-settings.test.ts`
Expected: FAIL — the GET payload lacks `comicVineApiKey`, and every key PATCH returns 400 from the existing `downloadConcurrency must be a number` branch.

- [ ] **Step 3: Implement**

Replace `server/routes/settings.ts` entirely:

```ts
import { createComicVine } from '../lib/comicvine.js'
import {
  getDownloadConcurrency, setDownloadConcurrency,
  getComicVineKey, setComicVineKey,
} from '../models/settings.js'
import type { App } from '../types.js'

interface PatchBody {
  downloadConcurrency?: unknown
  comicVineApiKey?: unknown
}

export default async function settingsRoutes(app: App) {
  const view = () => ({
    downloadConcurrency: getDownloadConcurrency(app.db),
    comicVineApiKey: getComicVineKey(app.db),
  })

  app.get('/api/settings', async () => view())

  app.patch<{ Body: PatchBody }>('/api/settings', async (req, reply) => {
    const body = req.body ?? {}
    const hasConcurrency = 'downloadConcurrency' in body
    const hasKey = 'comicVineApiKey' in body

    // An absent field is left alone, so one control can save without knowing about the
    // others. A body naming neither is still refused: a misspelled field would otherwise
    // return 200 having done nothing.
    if (!hasConcurrency && !hasKey) {
      return reply.code(400).send({ error: 'nothing to update' })
    }

    // The cheap local write first. The key check is a network round trip, and a valid
    // number should not go unapplied because a third party was unreachable; the two
    // settings have nothing to do with each other.
    if (hasConcurrency) {
      const value = body.downloadConcurrency
      if (typeof value !== 'number') {
        return reply.code(400).send({ error: 'downloadConcurrency must be a number' })
      }
      // The model owns the range. The route does not repeat it, or the two would drift.
      if (!setDownloadConcurrency(app.db, value)) {
        return reply.code(400).send({ error: 'downloadConcurrency must be a whole number from 1 to 5' })
      }
      // A busy pool is woken by nothing else, so without this a raise would do nothing
      // visible until the download in progress happened to end. Only a concurrency change
      // wakes it - saving a key has nothing to do with the queue.
      app.downloader.wake()
    }

    if (hasKey) {
      const value = body.comicVineApiKey
      if (typeof value !== 'string') {
        return reply.code(400).send({ error: 'comicVineApiKey must be a string' })
      }
      const key = value.trim()
      // Clearing is not a key to check, and refusing to clear would leave no way back to
      // an unconfigured install.
      if (key) {
        try {
          await createComicVine({ apiKey: key }).verifyKey()
        } catch (err) {
          // Comic Vine's own wording, carried through: a rejected key and an unreachable
          // Comic Vine look the same from here, and this message is the only thing that
          // tells them apart.
          return reply.code(400).send({
            error: `Comic Vine did not accept that key: ${(err as Error).message}`,
          })
        }
      }
      setComicVineKey(app.db, key)
    }

    return view()
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/routes-settings.test.ts` → PASS (including all five pre-existing tests)
Run: `npm run typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add server/routes/settings.ts test/routes-settings.test.ts
git commit -m "feat: set the Comic Vine key through /api/settings

A key is verified against Comic Vine before it is stored, so a typo is
refused while you are still looking at the field rather than surfacing
later as an unrelated failure. A rejection writes nothing, leaving a
working key in place.

The patch is now partial - an absent field is left alone - so one control
can save without knowing about the others. A body naming neither field is
still a 400, or a misspelled field name would return 200 having done
nothing. Only a concurrency change wakes the pool.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Every consumer reads the key from the database

**Files:**
- Modify: `server/routes/comicvine.ts:18,21,39,68,112`
- Modify: `server/routes/arcs.ts:11,18`
- Modify: `server/routes/releases.ts:29,32`
- Modify: `server/routes/editions.ts:87,121,135,158`
- Modify: `server/services/storeComic.ts:92`
- Modify: `server/services/applyIssue.ts:35`
- Test: the eleven suites listed in Step 3

**Interfaces:**
- Consumes: `getComicVineKey(db)` (Task 1) and the getter-shaped `apiKey` option (Task 2).
- Produces: nothing new. `Config.comicVineApiKey` still exists after this task and is simply no longer read — Task 6 deletes it.

**Why routes and services are one task:** the eleven test suites below span both. `test/comicvine.test.ts` alone exercises `routes/comicvine.ts` *and* `services/applyIssue.ts`, so a split would leave a suite red at a task boundary.

- [ ] **Step 1: Switch the four route files**

In each file add the import — `import { getComicVineKey } from '../models/settings.js'` — then apply both substitutions throughout:

- `createComicVine({ apiKey: app.config.comicVineApiKey })` → `createComicVine({ apiKey: () => getComicVineKey(app.db) })`
- `!app.config.comicVineApiKey` → `!getComicVineKey(app.db)`

The three registration-time constructions (`routes/comicvine.ts:18`, `routes/arcs.ts:11`, `routes/releases.ts:29`) **stay exactly where they are** — with a getter there is no longer any reason to move them, and `routes/releases.ts:26-28` documents why one client per plugin matters.

Two sites need care:

`server/routes/editions.ts:121` degrades quietly rather than erroring, and must keep doing so:

```ts
    if (!edition.comicvineId || !getComicVineKey(app.db)) {
      return {
        volumeId: edition.comicvineId ?? null, issues: [], extras: books.map(extraOf),
        owned: 0, total: 0, siteUrl: edition.cvSiteUrl ?? null,
      }
    }
```

`server/routes/releases.ts:29` keeps its comment, which is still true and now also explains the getter:

```ts
  // One client for the plugin's lifetime, not one per resolve() call: the client carries
  // the 1-request-per-second throttle state, and a fresh client per call would reset it,
  // letting the fallback's first request fire with no wait. The key is read per request
  // rather than captured, so a key entered in Settings applies without a restart.
  const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })
```

The 400 bodies are untouched — `Comic Vine API key not configured`, word for word.

- [ ] **Step 2: Switch the two services**

Both already destructure `{ db, config }` from their context, so `db` is in scope. Add `import { getComicVineKey } from '../models/settings.js'` to each.

`server/services/storeComic.ts:92`:

```ts
      const cv = createComicVine({ apiKey: () => getComicVineKey(db) })
```

`server/services/applyIssue.ts:35`:

```ts
  const cv = createComicVine({ apiKey: () => getComicVineKey(db) })
```

- [ ] **Step 3: Run the suite to see exactly which tests fail**

Run: `npm test`
Expected: FAIL across eleven suites — the code now reads an empty key from a fresh test database while the tests are still handing one in through `config`. Failures look like 400s where a 200 was expected, or `Comic Vine API key not configured` thrown.

- [ ] **Step 4: Move each suite's key into its database**

Every one of these already opens a `db`. In each, add `import { setComicVineKey } from '../server/models/settings.js'`, drop `comicVineApiKey` from the `as Config` literal, and seed the database instead.

The shape, using `test/routes-character.test.ts:39-43` as the worked example:

```ts
// before
async function setup(routes: Array<[string, unknown]>, apiKey = 'test-key') {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { comicVineApiKey: apiKey } as Config)

// after
async function setup(routes: Array<[string, unknown]>, apiKey = 'test-key') {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  // The key is a setting now, not configuration. A suite that passes '' is testing the
  // unconfigured path and seeds nothing.
  if (apiKey) setComicVineKey(db, apiKey)
```

Apply to all eleven, keeping each suite's own local naming:

1. `test/comicvine.test.ts` — four `as Config` literals carry `'test-key'` (~:182, :236, :432, :662); seed each suite's `db`. The one at `:153` carries `''` and is the "400s when no API key configured" test: drop the field and seed nothing.
2. `test/routes-arcs.test.ts:51` — `setup(routes, apiKey = 'test-key')`, exactly the worked example.
3. `test/routes-character.test.ts:43` — the worked example.
4. `test/routes-comicvine-volumes.test.ts:29` — `app(db, { apiKey })`; `apiKey` defaults to a real key and some tests pass `''`, so keep the `if (apiKey)` guard.
5. `test/routes-comicvine-volume.test.ts:25` — `app(db)`, literal `'k'`.
6. `test/routes-editions-download-issue.test.ts:24` — `server(db, ...)`, literal `'k'`.
7. `test/routes-editions-issues.test.ts:45` — `app(db)`, literal `'k'`.
8. `test/routes-editions-volume.test.ts:19` — `server(db, comicsDir)`, literal `'k'`.
9. `test/routes-releases.test.ts:110` — `app.decorate('config', { comicVineApiKey: apiKey } as Config)` with a `db` on the line above.
10. `test/routes-releases-download.test.ts:32` — literal `'test-key'`, `db` on the line above.
11. `test/apply-issue.test.ts:28,35` — builds a `Ctx` rather than a Fastify app:

```ts
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  const db = openDb(':memory:')
  setComicVineKey(db, 'k')
  return { db, config, dir } as Ctx & { dir: string }
```

`test/upload.test.ts` is the odd one: it mutates config mid-test at `:166`, `:177`, `:196`, `:257`, `:277` and `:289`. Each `app.config.comicVineApiKey = 'k'` becomes:

```ts
  setComicVineKey(app.db, 'k')
```

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test` → PASS
Run: `npm run typecheck` → clean

If anything still fails, the likely cause is a suite whose `db` is created after the `config` decoration — seed it after the `openDb` call, not before.

- [ ] **Step 6: Commit**

```bash
git add server/routes/comicvine.ts server/routes/arcs.ts server/routes/releases.ts \
        server/routes/editions.ts server/services/storeComic.ts server/services/applyIssue.ts \
        test/comicvine.test.ts test/routes-arcs.test.ts test/routes-character.test.ts \
        test/routes-comicvine-volumes.test.ts test/routes-comicvine-volume.test.ts \
        test/routes-editions-download-issue.test.ts test/routes-editions-issues.test.ts \
        test/routes-editions-volume.test.ts test/routes-releases.test.ts \
        test/routes-releases-download.test.ts test/apply-issue.test.ts test/upload.test.ts
git commit -m "feat: read the Comic Vine key from the database, not from config

Fifteen reads across six files pointed at a value captured at boot. They
now ask the setting table per request, so a key entered in the app applies
without a restart. The three clients built at route registration stay
where they are - the getter is what makes that safe.

The edition issues route keeps degrading quietly rather than erroring when
no key is set, and every 400 keeps its existing wording.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Delete the environment variable

**Files:**
- Modify: `server/config.ts:8,21`
- Modify: `docker-compose.yml:9`
- Modify: `.env.example:1`
- Modify: `README.md:36,42`
- Test: `test/routes-downloads.test.ts:31,95`, `test/store-comic-concurrent.test.ts:19`, `test/download-runner.test.ts:18`

**Interfaces:**
- Produces: `Config` without `comicVineApiKey`. Deleting it is what makes the compiler prove Task 5 missed nothing.

- [ ] **Step 1: Delete the field from Config**

In `server/config.ts`, remove `comicVineApiKey: string` from the `Config` interface and `comicVineApiKey: env.COMIC_VINE_API_KEY || '',` from `loadConfig`.

- [ ] **Step 2: Run typecheck to find every straggler**

Run: `npm run typecheck`
Expected: errors only in the four test files listed above, each carrying `comicVineApiKey: ''` in a `Config` literal. If a *source* file appears, Task 5 missed it — fix it the same way Task 5 did.

- [ ] **Step 3: Drop the dead field from those four suites**

All four pass the empty string, so they were testing the unconfigured path and need no seeding — just delete the property:

```ts
// test/routes-downloads.test.ts:31 and :95, test/store-comic-concurrent.test.ts:19,
// test/download-runner.test.ts:18 — remove `comicVineApiKey: '',` from each literal.
    maxUploadBytes: 5 * 1024 * 1024,
```

- [ ] **Step 4: Remove the environment plumbing**

`docker-compose.yml` — delete the line:

```yaml
      - COMIC_VINE_API_KEY=${COMIC_VINE_API_KEY:-}
```

`.env.example` — delete `COMIC_VINE_API_KEY=`, leaving:

```
DATA_DIR=./data
PORT=3000
MAX_UPLOAD_BYTES=5368709120
```

- [ ] **Step 5: Update the README**

Replace the Docker run line (`README.md:36`):

```markdown
## Run (Docker)

- `docker compose up -d --build`
- Open `http://<server-ip>:3000`
- Open **Settings** and paste your Comic Vine API key — a free key comes from
  https://comicvine.gamespot.com/api/. Without one, search, matching and Latest
  releases are unavailable; everything else works.
- Comics + DB persist in `./data`.
```

and drop the `COMIC_VINE_API_KEY` bullet from the Config (env) list, leaving:

```markdown
## Config (env)

- `DATA_DIR` (default `/data` in Docker), `PORT` (3000), `MAX_UPLOAD_BYTES`

The Comic Vine API key is not an environment variable — it is a setting, entered
in the app under Settings and stored in the database.
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` → PASS
Run: `npm run typecheck` → clean

- [ ] **Step 7: Commit**

```bash
git add server/config.ts docker-compose.yml .env.example README.md \
        test/routes-downloads.test.ts test/store-comic-concurrent.test.ts test/download-runner.test.ts
git commit -m "refactor: drop COMIC_VINE_API_KEY from the environment

The database is the only source now, so there is no precedence question to
answer and the settings field can never disagree with what is in use.
Deleting the config field is also what proves nothing still reads it - the
compiler enumerates the stragglers.

An existing install must re-enter its key once, under Settings, after the
rebuild that ships this.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Let the browser see why a save was refused

**Files:**
- Modify: `src/api.ts:107-109` (`ApiSettings`), `:363-367` (`json`), `:434-437` (`updateSettings`)
- Test: `test/api-settings.test.ts` (create)

**Interfaces:**
- Produces: `ApiSettings { downloadConcurrency: number; comicVineApiKey: string }`; `api.updateSettings(body: Partial<ApiSettings>): Promise<ApiSettings>`. `json` now throws `Error(body.error)` when the failing response carries one, and `Error(String(status))` otherwise.

**Why `json` has to change:** it currently discards the response body (`throw new Error(\`${res.status}\`)`), so "Comic Vine did not accept that key: Invalid API Key" would reach the page as the string `400`. Nothing asserts on the old message — the only test matching on a status code is `test/comic-index-source.test.ts:93`, which covers a server-side lib, not this helper.

- [ ] **Step 1: Write the failing tests**

Create `test/api-settings.test.ts`:

```ts
import { test, expect, afterEach } from 'vitest'
import { api } from '../src/api'

const origFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = origFetch })

// The server explains its own refusals, and for a key save that explanation is the entire
// value of the round trip. Reaching the page as "400" would waste it.
test('a refusal carries the server message rather than the status', async () => {
  globalThis.fetch = (async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'Comic Vine did not accept that key: Invalid API Key' }),
  })) as unknown as typeof fetch

  await expect(api.updateSettings({ comicVineApiKey: 'nope' }))
    .rejects.toThrow(/did not accept that key: Invalid API Key/)
})

test('a refusal with no json body still reports the status', async () => {
  globalThis.fetch = (async () => ({
    ok: false,
    status: 502,
    json: async () => { throw new Error('not json') },
  })) as unknown as typeof fetch

  await expect(api.updateSettings({ comicVineApiKey: 'nope' })).rejects.toThrow('502')
})

test('a refusal whose body has no error field still reports the status', async () => {
  globalThis.fetch = (async () => ({
    ok: false, status: 500, json: async () => ({ something: 'else' }),
  })) as unknown as typeof fetch

  await expect(api.updateSettings({ comicVineApiKey: 'nope' })).rejects.toThrow('500')
})

test('one setting can be patched without naming the other', async () => {
  let sent = ''
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent = init.body
    return { ok: true, json: async () => ({ downloadConcurrency: 1, comicVineApiKey: 'abc' }) }
  }) as unknown as typeof fetch

  await api.updateSettings({ comicVineApiKey: 'abc' })
  expect(JSON.parse(sent)).toEqual({ comicVineApiKey: 'abc' })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/api-settings.test.ts`
Expected: FAIL — the first test gets `400`; the last fails to typecheck because `updateSettings` demands `downloadConcurrency`.

- [ ] **Step 3: Implement**

In `src/api.ts`, widen the settings type:

```ts
export interface ApiSettings {
  downloadConcurrency: number
  comicVineApiKey: string
}
```

Carry the server's message out of `json`:

```ts
async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts)
  if (!res.ok) {
    // The server explains its own refusals - "Comic Vine did not accept that key" is the
    // whole point of the settings save, and a bare status throws that explanation away.
    // A body that is not json, or carries no `error`, falls back to the status, which is
    // what every caller received before.
    let message = `${res.status}`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body?.error === 'string' && body.error) message = body.error
    } catch { /* not json; the status stands */ }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}
```

And make the patch partial:

```ts
  updateSettings: (body: Partial<ApiSettings>) =>
    json<ApiSettings>('/api/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/api-settings.test.ts` → PASS
Run: `npm test` → PASS (nothing else asserted on the old message)
Run: `npm run typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add src/api.ts test/api-settings.test.ts
git commit -m "feat: carry the server's refusal message to the browser

A failed request threw the status and discarded the body, so \"Comic Vine
did not accept that key: Invalid API Key\" would have reached the settings
page as \"400\". A body that is not json, or carries no error field, still
falls back to the status.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The Settings page

**Files:**
- Create: `src/pages/Settings.tsx`
- Create: `test/Settings.test.tsx`
- Modify: `src/App.tsx:1-14` (import), `:52-60` (header nav), `:91-106` (routes)
- Modify: `src/pages/Downloads.tsx:1-34,50-66`
- Modify: `src/styles.css:315-347`
- Modify: `test/Downloads.test.tsx:23-25,77-140`
- Modify: `test/App.test.tsx`

**Interfaces:**
- Consumes: `api.getSettings()` → `ApiSettings`, `api.updateSettings(Partial<ApiSettings>)` → `ApiSettings` (Task 7).
- Produces: the `/settings` route and a `Settings` header link.

- [ ] **Step 1: Write the failing page tests**

Create `test/Settings.test.tsx`. The four concurrency tests are moved from `test/Downloads.test.tsx:77-140` unchanged in intent — including the last one, which is load-bearing and explained in its own comment.

```tsx
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Settings from '../src/pages/Settings'

const SETTINGS = { downloadConcurrency: 1, comicVineApiKey: 'stored-key' }

let posted: string[]
let bodies: string[]
beforeEach(() => {
  posted = []
  bodies = []
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method) { posted.push(`${init.method} ${url}`); bodies.push(String(init.body)) }
    if (init?.method === 'PATCH') {
      return { ok: true, json: async () => ({ ...SETTINGS, ...JSON.parse(String(init.body)) }) }
    }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Settings /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('the key field shows what is stored', async () => {
  draw()
  expect(await screen.findByLabelText(/api key/i)).toHaveValue('stored-key')
})

test('saving sends the typed key and nothing else', async () => {
  draw()
  const field = await screen.findByLabelText(/api key/i)
  fireEvent.change(field, { target: { value: 'new-key' } })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))

  await waitFor(() => expect(posted).toContain('PATCH /api/settings'))
  expect(JSON.parse(bodies[0])).toEqual({ comicVineApiKey: 'new-key' })
})

// A rejected key and an unreachable Comic Vine look the same from here; the server's
// message is the only thing that tells them apart, so it is shown rather than a generic
// failure.
test('a refused key shows what the server said', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'PATCH') {
      return {
        ok: false, status: 400,
        json: async () => ({ error: 'Comic Vine did not accept that key: Invalid API Key' }),
      }
    }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch

  draw()
  fireEvent.change(await screen.findByLabelText(/api key/i), { target: { value: 'bad' } })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))

  expect(await screen.findByText(/Invalid API Key/)).toBeInTheDocument()
})

// What you typed is what you have to correct. Reverting it to the stored value on failure
// would make you retype the whole key to fix one character.
test('a refused key is left in the field to correct', async () => {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'PATCH') {
      return { ok: false, status: 400, json: async () => ({ error: 'nope' }) }
    }
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch

  draw()
  const field = await screen.findByLabelText(/api key/i)
  fireEvent.change(field, { target: { value: 'typo-key' } })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))

  await screen.findByText(/nope/)
  expect(field).toHaveValue('typo-key')
})

test('where to get a key is on the page', async () => {
  draw()
  const link = await screen.findByRole('link', { name: /comicvine\.gamespot\.com/i })
  expect(link).toHaveAttribute('href', 'https://comicvine.gamespot.com/api/')
})

test('the concurrency control shows what is stored', async () => {
  draw()
  expect(await screen.findByLabelText(/at once/i)).toHaveValue('1')
})

test('the control offers one through five and nothing else', async () => {
  draw()
  const select = await screen.findByLabelText(/at once/i) as HTMLSelectElement
  expect([...select.options].map((o) => o.value)).toEqual(['1', '2', '3', '4', '5'])
})

test('changing it patches the server', async () => {
  draw()
  fireEvent.change(await screen.findByLabelText(/at once/i), { target: { value: '3' } })
  await waitFor(() => expect(posted).toContain('PATCH /api/settings'))
  expect(JSON.parse(bodies[0])).toEqual({ downloadConcurrency: 3 })
})

// A dial with no caveat reads as "higher is better", which is not true.
test('the control says that more is not automatically faster', async () => {
  draw()
  expect(await screen.findByText(/not always faster|may not be faster/i)).toBeInTheDocument()
})

// The PATCH response already carries the stored value - that is what the echo is for.
// Relying only on `invalidateQueries` left the select showing the old number until that
// second round trip landed. This proves the select updates without it: the refetch
// invalidate triggers is deliberately held open and never resolves, so if the new value
// only ever arrived through that refetch, the assertion below would time out.
test('the select shows the patched value without waiting for the invalidated refetch', async () => {
  let settingsGets = 0
  let releaseSecondGet: () => void = () => {}
  const secondGetGate = new Promise<void>((resolve) => { releaseSecondGet = resolve })

  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'PATCH') {
      return { ok: true, json: async () => ({ ...SETTINGS, downloadConcurrency: 3 }) }
    }
    settingsGets += 1
    if (settingsGets > 1) await secondGetGate
    return { ok: true, json: async () => SETTINGS }
  }) as unknown as typeof fetch

  draw()
  const select = await screen.findByLabelText(/at once/i) as HTMLSelectElement
  expect(select).toHaveValue('1')

  fireEvent.change(select, { target: { value: '3' } })
  await waitFor(() => expect(select).toHaveValue('3'))

  releaseSecondGet()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/Settings.test.tsx`
Expected: FAIL — `Cannot find module '../src/pages/Settings'`.

- [ ] **Step 3: Write the page**

Create `src/pages/Settings.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiSettings } from '../api'

export default function Settings() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })

  // The field is a draft, seeded once from the server and owned by the keyboard after
  // that. Binding it straight to the query would fight your typing on every refetch, and
  // would wipe a rejected key you are halfway through correcting.
  const [draftKey, setDraftKey] = useState<string | null>(null)
  useEffect(() => {
    if (settings && draftKey === null) setDraftKey(settings.comicVineApiKey)
  }, [settings, draftKey])

  // Both mutations take the echoed response as the new truth, then reconcile. The echo is
  // what stops a control showing its old value until the refetch lands.
  const applied = {
    onSuccess: (next: ApiSettings) => {
      qc.setQueryData(['settings'], next)
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  }

  const saveKey = useMutation({
    mutationFn: (comicVineApiKey: string) => api.updateSettings({ comicVineApiKey }),
    ...applied,
  })

  const setConcurrency = useMutation({
    mutationFn: (downloadConcurrency: number) => api.updateSettings({ downloadConcurrency }),
    ...applied,
  })

  return (
    <>
      <h1 className="page-title">Settings</h1>

      <section>
        <h2 className="page-title">Comic Vine</h2>
        <form
          className="settings__row"
          onSubmit={(e) => { e.preventDefault(); saveKey.mutate(draftKey ?? '') }}
        >
          <label className="settings__field">
            API key
            <input
              type="text"
              value={draftKey ?? ''}
              // Editing clears the last verdict: "Saved." beside a key you have since
              // changed is a lie about what is stored.
              onChange={(e) => { setDraftKey(e.target.value); saveKey.reset() }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" disabled={saveKey.isPending}>
            {saveKey.isPending ? 'Checking…' : 'Save'}
          </button>
        </form>

        {/* Saving is a round trip through Comic Vine, so it reports what Comic Vine said.
            A rejected key and an unreachable Comic Vine look identical from here, and this
            message is the only thing that tells them apart. */}
        {saveKey.isError && <p className="error-text">{(saveKey.error as Error).message}</p>}
        {saveKey.isSuccess && <p className="settings__hint">Saved.</p>}

        <p className="settings__hint">
          A free key comes from{' '}
          <a href="https://comicvine.gamespot.com/api/" target="_blank" rel="noreferrer">
            comicvine.gamespot.com/api
          </a>
          . Without one, search, matching and Latest releases are unavailable — the rest of
          the library works as normal.
        </p>
      </section>

      <section>
        <h2 className="page-title">Downloads</h2>
        <label className="settings__concurrency">
          Download at once
          <select
            value={String(settings?.downloadConcurrency ?? 1)}
            onChange={(e) => setConcurrency.mutate(Number(e.target.value))}
            disabled={setConcurrency.isPending}
          >
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {/* A dial invites the reading that higher is better. It depends on where the
            bottleneck is: a saturated link gains nothing from more connections. */}
        <p className="settings__hint">More at once is not always faster — it depends on your connection.</p>
      </section>
    </>
  )
}
```

- [ ] **Step 4: Run the page tests**

Run: `npx vitest run test/Settings.test.tsx` → PASS

- [ ] **Step 5: Route and link it**

In `src/App.tsx`, add the import beside the other pages:

```tsx
import Settings from './pages/Settings'
```

Add the link to the header nav, after Downloads — it is a utility beside Search, not a third tab, so it must not take `aria-current`:

```tsx
          <Link to="/downloads" className="app-header__link">Downloads</Link>
          <Link to="/settings" className="app-header__link">Settings</Link>
          <Link to="/search" className="app-header__link">Search</Link>
```

And the route, beside the other `Layout` pages:

```tsx
      <Route path="/settings" element={<Layout><Settings /></Layout>} />
```

- [ ] **Step 6: Add the header test**

In `test/App.test.tsx`, beside the existing Downloads-link tests (`:106-117`):

```tsx
test('the header links to settings', async () => {
  renderApp('/')
  const link = await screen.findByRole('link', { name: 'Settings' })
  expect(link).toHaveAttribute('href', '/settings')
})
```

Use whatever render helper that file already defines — match the call in the test at `:106`.

- [ ] **Step 7: Strip the concurrency control out of Downloads**

In `src/pages/Downloads.tsx`: delete the `settings` query (`:22`), the `setConcurrency` mutation (`:24-34`), and the whole `downloads__queue-head` block plus the hint (`:51-66`), leaving the Queue heading plain:

```tsx
      <section>
        <h2 className="page-title">Queue</h2>
        <QueueList
          entries={queue}
          onMove={(id, index) => move.mutate({ id, index })}
          onCancel={(id) => cancel.mutate(id)}
        />
      </section>
```

Then drop `useQuery` from the react-query import — `useMutation` and `useQueryClient` are still used — and remove the now-unused `api` import only if nothing else in the file uses it (the queue mutations do, so it stays).

In `test/Downloads.test.tsx`: delete the four concurrency tests (`:77-140`) and the `/api/settings` branch of the fetch mock (`:23-25`), which now has no caller.

- [ ] **Step 8: Move the styles**

In `src/styles.css`, delete `.downloads__queue-head` (`:315-323`) including its comment — the control no longer sits beside the section it governs, so the comment is false. Rename the remaining three rules and move them into a new Settings block:

```css
/* ============================================================
   Settings
   ============================================================ */
.settings__row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin: 12px 0 4px;
}

.settings__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.875rem;
  color: var(--muted);
}

/* 44px so it is a real target on the tablet this app was built for. */
.settings__field input {
  min-height: 44px;
  min-width: 22rem;
  max-width: 100%;
  padding: 0 10px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.settings__concurrency {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--muted);
}

/* 44px so it is a real target on the tablet this page was built for. */
.settings__concurrency select {
  min-height: 44px;
  padding: 0 10px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.settings__hint {
  margin: 4px 0 12px;
  font-size: 0.8125rem;
  color: var(--muted);
}
```

The Save button needs no rule of its own — it inherits the app's button styling.

- [ ] **Step 9: Run everything**

Run: `npm test` → PASS
Run: `npm run typecheck` → clean
Run: `npm run build` → succeeds

- [ ] **Step 10: Commit**

```bash
git add src/pages/Settings.tsx src/pages/Downloads.tsx src/App.tsx src/styles.css \
        test/Settings.test.tsx test/Downloads.test.tsx test/App.test.tsx
git commit -m "feat: enter the Comic Vine key under Settings

A new container now comes up, you open Settings, paste the key, and it
works - no file on the host, no rebuild. Saving reports what Comic Vine
said, because a rejected key and an unreachable Comic Vine are
indistinguishable from the browser and the message is what separates them.

The field is a draft owned by the keyboard rather than bound to the query,
so a refused key stays on screen to be corrected instead of reverting.

Download concurrency moves here from the Downloads page. One place to look
is what you expect the moment there is more than one setting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Rebuild the container and set the key**

```bash
docker compose up -d --build
```

Then open the app, go to **Settings**, and paste the Comic Vine key — the one that used to live in `.env`. It has to be re-entered once; that is the accepted cost of dropping the environment variable. Confirm by running a search, which is the shortest path through a real Comic Vine call.

---

## Self-Review

**Spec coverage.** §4.1 model → Task 1. §4.2 getter → Task 2; §4.2 `verifyKey` → Task 3. §4.3 call sites → Task 5; `Config` deletion → Task 6. §4.4 route → Task 4. §4.5 page and header → Task 8. §4.6 Downloads → Task 8 Step 7. §4.7 styles → Task 8 Step 8. §4.8 api.ts → Task 7. §3's rules each have a test in Task 4. §8's test list is distributed across the tasks that create the behaviour. Docs, docker-compose and `.env.example` → Task 6.

**Ordering.** The settings route (Task 4) lands before the environment variable is deleted (Task 6), so there is never a commit where the app has no way to receive a key.

**Type consistency.** `getComicVineKey`/`setComicVineKey` are spelled identically in Tasks 1, 4, 5 and 6. `verifyKey` matches between Task 3's interface and Task 4's call. `ApiSettings` in Task 7 matches the route's response shape in Task 4 and the page's reads in Task 8.

**One judgement recorded.** Task 4 applies the concurrency change before verifying the key, so a patch carrying both a good number and a bad key keeps the number. The spec (§4.4) states this and why.
