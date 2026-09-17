# The Comic Vine Key as a Setting — Design Spec

**Date:** 2026-09-17
**Status:** Draft for review

## 1. Overview

The Comic Vine API key arrives through the environment. `loadConfig()` reads
`COMIC_VINE_API_KEY` at boot into `config.comicVineApiKey`, `docker-compose.yml`
passes it through, and fifteen reads across six files pull it back out. Changing the key
means editing a file on the host and recreating the container; standing up a new
container without one means the container comes up and every Comic Vine feature
answers 400 until you have found the README, written a `.env`, and rebuilt.

This moves the key into the `setting` table the download-concurrency work
introduced, and puts a field in front of it. A fresh container comes up, you open
Settings, paste the key, and it works — no restart, no file on the host.

### Goals

- Set and change the key from a page, with effect on the next request.
- Persist it in the database, so a rebuild does not lose it.
- Reject a key Comic Vine does not accept, at the moment it is entered rather
  than at the moment it is first used.
- Give the app one settings screen, rather than a second control hidden on a
  third page.

### Non-goals

- **Keeping the environment variable as a fallback.** The key is now DB-only; see
  §3. An env var that sometimes wins and sometimes does not is the worst of the
  options, and one that always wins makes the field a lie.
- **Hiding the key from the browser.** It is a free, read-only, per-account key
  whose entire capability is reading a public comics database. Masking it would
  cost a second endpoint and buy nothing; the field is prefilled with the real
  value so you can see what is stored.
- **Migrating an existing key out of the environment automatically.** A one-shot
  "seed the DB from env if empty" path is code that runs meaningfully once, on
  one machine, and then lives forever. The key is re-entered once, in the UI.
- **Settings beyond these two.** The page holds the key and the download
  concurrency. It is a page rather than a dialog so the next one has somewhere
  obvious to go, not because more are planned.
- **A configured/unconfigured banner elsewhere in the app.** The existing 400s
  already say the key is not configured. Where that message is surfaced is the
  same question it was before this change.

## 2. What is there now

`server/config.ts` carries the key on the config object:

```ts
comicVineApiKey: env.COMIC_VINE_API_KEY || '',
```

Two kinds of site consume it.

**Eight build a client.** `createComicVine({ apiKey: app.config.comicVineApiKey })`
appears in `routes/comicvine.ts:18`, `routes/arcs.ts:11`, `routes/releases.ts:29`,
`routes/editions.ts:87`, `:135` and `:158`, `services/storeComic.ts:92`, and
`services/applyIssue.ts:35`. The first three run at **route-registration time** —
once, at boot — and the resulting client is closed over by every handler in the
file.

**Seven guard on it.** `routes/comicvine.ts:21`, `:39`, `:68`, `:112`,
`routes/arcs.ts:18` and `routes/releases.ts:32` return
`400 { error: 'Comic Vine API key not configured' }`. `routes/editions.ts:121`
is different in kind: it degrades quietly, returning an empty issue list rather
than an error, so an unconfigured install still renders the edition page.

The client captures the key in its closure and checks it per request
(`lib/comicvine.ts:249`):

```ts
if (!apiKey) throw new Error('Comic Vine API key not configured')
```

The throttle that matters lives in the same closure (`lib/comicvine.ts:241`):
`lastCall` is per client, and `throttle()` holds each client to one request a
second.

Storage exists and is generic: `setting(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
with `getSetting`/`setSetting` in `models/settings.ts` and a `GET`/`PATCH
/api/settings` pair. One setting lives there today.

## 3. The rules

**The database is the only source.** `COMIC_VINE_API_KEY` and
`Config.comicVineApiKey` are deleted, along with the `docker-compose.yml`
environment line and the `.env.example` entry. There is no precedence question to
answer because there is nothing to have precedence over, and the field can never
disagree with what is in use.

**A change takes effect on the next Comic Vine request**, with no restart. This
is what forces §4.2: the three boot-time clients would otherwise hold the key
that existed at boot forever.

**A key is verified before it is stored.** `PATCH` makes one small Comic Vine
call with the candidate key. Accepted, it is written; rejected, nothing is
written and the response is a 400 carrying the reason. The alternative is
discovering a typo later, from an unrelated screen, as a generic failure.

**The empty string clears the key**, and skips verification — there is nothing to
verify, and refusing to clear would leave no way back to an unconfigured state.

**Absent fields in a `PATCH` are left alone; a `PATCH` carrying neither field is a
400.** The route already refuses an empty body
(`test/routes-settings.test.ts:81`); partial patching extends that promise rather
than replacing it, so a misspelled field name still fails loudly instead of
returning 200 having done nothing.

**Only a concurrency change wakes the download pool.** Saving a key has nothing
to do with the queue.

## 4. Components

### 4.1 `server/models/settings.ts` (changed)

```ts
const COMIC_VINE_KEY = 'comic_vine_api_key'

/** The empty string when unset — the same shape the old config field had. */
export function getComicVineKey(db: Db): string
export function setComicVineKey(db: Db, key: string): void
```

`setComicVineKey` trims before writing: a key pasted out of a web page arrives
with whitespace, and a trailing newline in a query string is a rejected key with
no visible cause. `getComicVineKey` returns `''` rather than `undefined` so every
existing `if (!key)` guard keeps working unchanged.

### 4.2 `server/lib/comicvine.ts` (changed)

`ComicVineOptions.apiKey` widens:

```ts
apiKey: string | (() => string)
```

resolved inside `get()`, at request time, rather than captured at construction:

```ts
const readKey = typeof apiKey === 'function' ? apiKey : () => apiKey
// in get():
const key = readKey()
if (!key) throw new Error('Comic Vine API key not configured')
```

A getter is what makes a boot-time client see a key entered an hour later. Still
accepting a plain string is deliberate: the existing client tests pass literal
keys, and rewriting them to pass thunks would be churn for no gain.

Rebuilding the client per request would have avoided the lib change and was
rejected: `lastCall` lives in the client's closure, so a client per request
resets the throttle and lets the app exceed one request per second against Comic
Vine — the exact thing that closure exists to prevent.

The client also gains:

```ts
/** Resolves when Comic Vine accepts the key; throws with its reason when not. */
verifyKey(): Promise<void>
```

implemented as `get('/issues/', { limit: '1', field_list: 'id' })`. Comic Vine
answers a bad key with HTTP 200 and `status_code` 100 in the body, which the
existing check at `lib/comicvine.ts:261` already converts into a throw carrying
the message — so `verifyKey` is a call, not a new error path.

### 4.3 Call sites (changed)

Every `createComicVine({ apiKey: app.config.comicVineApiKey })` becomes
`createComicVine({ apiKey: () => getComicVineKey(app.db) })`; in the two services
it is `ctx.db`, which both already destructure. The three boot-time constructions
stay where they are — with a getter, there is no longer a reason to move them.

Every `!app.config.comicVineApiKey` guard becomes `!getComicVineKey(app.db)`.
The 400 bodies are unchanged, and `routes/editions.ts:121` keeps degrading
quietly rather than becoming an error.

`Config.comicVineApiKey` is removed from the interface and from `loadConfig`,
which makes the compiler enumerate any site this spec has missed.

### 4.4 `GET` and `PATCH /api/settings` (changed)

```jsonc
// GET
{ "downloadConcurrency": 1, "comicVineApiKey": "" }

// PATCH { "comicVineApiKey": "abc123" }
//   -> 200 { "downloadConcurrency": 1, "comicVineApiKey": "abc123" }
// PATCH { "comicVineApiKey": "nope" }
//   -> 400 { "error": "Comic Vine did not accept that key: <reason>" }
// PATCH { "downloadConcurrency": 3 }   -> 200, pool woken
// PATCH { }                            -> 400
```

Order of operations within a patch carrying both fields: validate and apply the
concurrency first (cheap, local, and its failure mode is a bad number), then
verify and apply the key (a network call). A key rejected after a concurrency
change has already been written leaves the concurrency change standing — the two
settings are independent, and rolling one back because the other failed would be
surprising in its own way.

### 4.5 `src/pages/Settings.tsx` (new) and `src/App.tsx` (changed)

A `/settings` route and a header link beside Downloads and Search. Two sections:

- **Comic Vine.** A text input prefilled from `settings.comicVineApiKey` and a
  Save button. The mutation disables the button while it runs — this one is a
  network round trip through Comic Vine, not an instant write — and settles into
  "Saved" or the server's message verbatim. Beneath it, the link to
  `comicvine.gamespot.com/api`, which currently exists only in the README and is
  exactly what someone on a fresh container needs.
- **Downloads.** The concurrency select and its hint, moved intact from the
  Downloads page.

### 4.6 `src/pages/Downloads.tsx` (changed)

Loses the select, the hint, and the `downloads__queue-head` flex wrapper that
existed to sit the select beside the heading. The Queue heading is a plain
heading again.

### 4.7 `src/styles.css` (changed)

`.downloads__concurrency`, its `select` rule and `.downloads__hint` move and are
renamed to `settings__`; `.downloads__queue-head` is deleted. The comment at
`styles.css:316` recording that the control lives beside the section it governs
is no longer true and goes with it.

### 4.8 `src/api.ts` (changed)

```ts
export interface ApiSettings { downloadConcurrency: number; comicVineApiKey: string }
updateSettings: (body: Partial<ApiSettings>) => // PATCH
```

## 5. Data flow

```
PATCH /api/settings { comicVineApiKey: "abc123" }
  ├─ trim; empty? -> clear, skip verification
  ├─ createComicVine({ apiKey: () => "abc123" }).verifyKey()
  │    └─ throws -> 400, nothing written
  ├─ setComicVineKey(db, "abc123")
  └─ 200 { downloadConcurrency, comicVineApiKey }

any Comic Vine request, through a client built at boot
  └─ get() -> readKey() -> getComicVineKey(db) -> the key as it is now
```

## 6. Safety and failure

- **The key is read per request, so there is no stale copy anywhere.** Deleting
  `Config.comicVineApiKey` rather than keeping it in step is what guarantees it.
- **A verification failure writes nothing.** The stored key survives a failed
  attempt to replace it.
- **Comic Vine being down means a key cannot be saved.** Verification cannot
  distinguish "bad key" from "Comic Vine unreachable", and both surface as the
  error text from the attempt. This is the accepted cost of verify-on-save: the
  fallback, if it ever bites, is the separate Test button considered and set
  aside.
- **An unconfigured install behaves exactly as an unconfigured install does
  today** — the same 400s, from the same guards, with the same wording.
- **The key travels to the browser in plain text on every settings page load.**
  Accepted deliberately (§1, non-goals) for a free read-only key on a
  self-hosted app. It is the one decision here that would have to be revisited
  if the app ever grew a second user or a key worth stealing.

## 7. Schema

No change. The `setting` table gains a row, which is the point of having made it
generic.

## 8. Testing

**Model.** `getComicVineKey` returns `''` on a fresh database and round-trips a
value. Whitespace around a key is trimmed on write. The empty string clears.

**Client.** A client built with a getter picks up a changed key **between two
requests** — the defect this whole design exists to prevent, and the one test
that would fail under the rejected approaches. A getter returning `''` throws the
not-configured error. `verifyKey` resolves on a `status_code` 1 response and
throws on 100, with the message carried through.

**Route.** `GET` on a fresh database reports an empty key. `PATCH` verifies
before storing: a stubbed-rejecting key returns 400 and leaves the stored key
untouched; an accepted one is stored and echoed. An empty string clears without
calling Comic Vine at all. A key-only patch does **not** wake the download pool;
a concurrency-only patch still does. Both existing `toEqual` assertions on the
`GET` payload (`test/routes-settings.test.ts:24`, `:35`) grow the new field.

**The 15 suites that hand the key in through `app.decorate('config', ...)`** seed
it into their database instead. Mostly a one-line swap; the suites that decorate
a config without opening a database need one.

**Page.** Settings shows the stored key and issues the `PATCH` on Save; a
rejection renders the server's message. `Downloads.test.tsx` loses its
concurrency assertions to `Settings.test.tsx`.

## 9. Risks

- **Verify-on-save couples saving your key to Comic Vine being reachable.** The
  first thing you do on a fresh container now depends on a third party being up.
  It is also the only way to tell you the key is wrong at the moment you can do
  something about it.
- **Deleting the env var is a one-way break for the existing deployment.** The
  current key must be re-entered once, in the UI, after the rebuild that ships
  this. Nothing warns about it beyond the README change.
- **Fifteen test suites change for a reason unrelated to what they test.** A
  large mechanical diff is where a real behavioural change hides. The client
  test in §8 is **not** the guard it was thought to be: it only proves a
  client built with a getter re-reads the key between requests, not that any
  given route actually builds its client that way. Every one of the 15 suites
  seeds the key before registering routes, so a route quietly reverted to
  capturing the key by value at boot — the exact regression this design
  exists to prevent — passes the client test, typechecks, and leaves all of
  them green. What actually guards the migration is a route-level test that
  seeds the key *after* registering routes and asserts the second request
  succeeds where the first, keyless one failed.
- **The key being readable is a decision with an expiry date.** It is correct for
  a free key on a single-user LAN app and wrong the moment either of those stops
  being true.
