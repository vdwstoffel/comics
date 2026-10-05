# Following Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Following shelf where a followed volume or story arc pulls exactly the next issue when you finish one, and retries after every scrape when that issue cannot be found yet.

**Architecture:** One `follow` table holds the subscription; everything else is derived. `nextWantedIssue` reads your reading position against the cached issue list and returns one of four outcomes; `attemptFollow` hands a wanted issue to the existing `startIssueDownload`. Two callers invoke it: completing a book, and a scrape finishing.

**Tech Stack:** TypeScript (strict, NodeNext on the server), Fastify, better-sqlite3, React + Vite, React Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-04-following-design.md`

## Global Constraints

- TypeScript strict throughout; server imports carry the `.js` extension (NodeNext).
- `npm run typecheck` and `npm test` must both pass before any commit.
- No new timer, scheduler, or background process (spec §1, §4.3).
- No new npm dependency.
- Tests never touch the network or the real library: every fetch is injected, every database is `openDb(':memory:')`.
- A follow attempt must never fail a user action. Every call site wraps it.
- Downloads go through `startIssueDownload`; nothing re-implements matching, link parsing, or queueing (spec §3.2).
- Comic Vine reads are capped: 20 refreshes per sweep (spec §3.4), and skipped entirely when no key is set.
- Follow outcome names are fixed by spec §3.1 and used verbatim end to end: `wanted`, `supplied`, `dormant`, `caught-up`. The plan adds one more, `unresolved`, for a follow whose target no longer exists — spec §2.3 requires pruning those, and this is the signal that drives it.

## Review Focus

Five things the spec implies that no task's happy-path tests would otherwise reach. Each has a test assigned to the task owning the code.

1. **Deleting an edition must not take an unrelated arc follow with it.** `(kind, ref_id)` is polymorphic, so arc 42 and edition 42 are different rows that a careless `WHERE ref_id = ?` would merge. → Task 1.
2. **An issue with no number must not crash the walk or queue a wrong comic.** Comic Vine lists unnumbered issues, and `volume_issue` stores `number` as nullable. → Task 2.
3. **Re-finishing an already-finished comic must not re-attempt.** The reader sends `completed: true` on every page turn at the end of a book. → Task 7.
4. **Two scrapes finishing at once must not run two sweeps.** The guard is the only thing preventing doubled outbound traffic. → Task 8.
5. **A missing Comic Vine key must leave index matching fully working.** Refresh is the only part needing a key; a fresh install with no key must still queue what the index can already match. → Task 8.

---

### Task 1: The `follow` table and its model

**Files:**
- Modify: `server/db.ts` (the `MIGRATION` template string)
- Create: `server/models/follows.ts`
- Test: `test/models-follows.test.ts`

**Interfaces:**
- Consumes: `Db` from `../types.js`.
- Produces: `FollowKind = 'volume' | 'arc'`; `Follow = { kind: FollowKind; refId: number; name: string; createdAt: string }`; `addFollow(db, kind, refId, name, now?): Follow`; `getFollow(db, kind, refId): Follow | undefined`; `listFollows(db): Follow[]`; `removeFollow(db, kind, refId): boolean`; `removeFollowsForEdition(db, editionId): void`.

- [ ] **Step 1: Write the failing test**

Create `test/models-follows.test.ts`:

```ts
import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  addFollow, getFollow, listFollows, removeFollow, removeFollowsForEdition,
} from '../server/models/follows.js'

test('a follow can be added and read back', () => {
  const db = openDb(':memory:')
  const added = addFollow(db, 'volume', 7, 'Iron Man', '2026-10-04T10:00:00.000Z')
  expect(added).toEqual({ kind: 'volume', refId: 7, name: 'Iron Man', createdAt: '2026-10-04T10:00:00.000Z' })
  expect(getFollow(db, 'volume', 7)).toEqual(added)
})

test('following the same thing twice is idempotent and refreshes the name', () => {
  const db = openDb(':memory:')
  addFollow(db, 'volume', 7, 'Iron Man', '2026-10-04T10:00:00.000Z')
  addFollow(db, 'volume', 7, 'Iron Man (2020)', '2026-10-05T10:00:00.000Z')
  expect(listFollows(db)).toHaveLength(1)
  expect(getFollow(db, 'volume', 7)?.name).toBe('Iron Man (2020)')
  // The day you first followed it is the day it says, not the day you pressed again.
  expect(getFollow(db, 'volume', 7)?.createdAt).toBe('2026-10-04T10:00:00.000Z')
})

test('a volume and an arc with the same id are different follows', () => {
  const db = openDb(':memory:')
  addFollow(db, 'volume', 42, 'Daredevil')
  addFollow(db, 'arc', 42, 'Shadowland')
  expect(listFollows(db)).toHaveLength(2)
})

test('removing a follow reports whether there was one', () => {
  const db = openDb(':memory:')
  addFollow(db, 'arc', 56676, 'Death Spiral')
  expect(removeFollow(db, 'arc', 56676)).toBe(true)
  expect(removeFollow(db, 'arc', 56676)).toBe(false)
  expect(listFollows(db)).toEqual([])
})

// Review Focus 1: the polymorphic key means ref_id alone is not an identity.
test('dropping an edition leaves an arc that happens to share its id alone', () => {
  const db = openDb(':memory:')
  addFollow(db, 'volume', 42, 'Daredevil')
  addFollow(db, 'arc', 42, 'Shadowland')
  removeFollowsForEdition(db, 42)
  expect(listFollows(db)).toEqual([
    expect.objectContaining({ kind: 'arc', refId: 42, name: 'Shadowland' }),
  ])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/models-follows.test.ts`
Expected: FAIL — cannot resolve `../server/models/follows.js`.

- [ ] **Step 3: Add the table**

In `server/db.ts`, append to the `MIGRATION` template string, just before its closing backtick:

```sql
-- The runs and arcs you are keeping up with. `ref_id` is edition.id for a volume and
-- Comic Vine's own arc id for an arc: a download has to land in an edition's folder, so
-- the edition is the thing a volume follow must name, and an arc has no local row at all
-- to name instead. Polymorphic, so it carries no foreign key - the edition delete route
-- drops a volume follow with its edition, and the follow list prunes anything else that
-- stops resolving.
CREATE TABLE IF NOT EXISTS follow (
  kind       TEXT NOT NULL,
  ref_id     INTEGER NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, ref_id)
);
```

- [ ] **Step 4: Write the model**

Create `server/models/follows.ts`:

```ts
import type { Db } from '../types.js'

export type FollowKind = 'volume' | 'arc'

export interface Follow {
  kind: FollowKind
  /** edition.id for a volume; Comic Vine's arc id for an arc. See db.ts. */
  refId: number
  name: string
  createdAt: string
}

interface Row { kind: string; ref_id: number; name: string; created_at: string }

const toFollow = (r: Row): Follow => ({
  kind: r.kind as FollowKind, refId: r.ref_id, name: r.name, createdAt: r.created_at,
})

/**
 * Follow something, or restate the name of something already followed.
 *
 * `created_at` is deliberately left alone on conflict: pressing Follow on a run you
 * already follow is a no-op you cannot tell apart from a double-click, and it has no
 * business resetting the day you started.
 */
export function addFollow(
  db: Db, kind: FollowKind, refId: number, name: string, now = new Date().toISOString(),
): Follow {
  db.prepare(
    `INSERT INTO follow (kind, ref_id, name, created_at) VALUES (?,?,?,?)
     ON CONFLICT(kind, ref_id) DO UPDATE SET name = excluded.name`,
  ).run(kind, refId, name, now)
  return getFollow(db, kind, refId)!
}

export function getFollow(db: Db, kind: FollowKind, refId: number): Follow | undefined {
  const row = db
    .prepare('SELECT * FROM follow WHERE kind = ? AND ref_id = ?')
    .get(kind, refId) as Row | undefined
  return row ? toFollow(row) : undefined
}

/** Alphabetical, because the shelf is a list you scan by name rather than by age. */
export function listFollows(db: Db): Follow[] {
  return (db.prepare('SELECT * FROM follow ORDER BY name COLLATE NOCASE').all() as Row[]).map(toFollow)
}

export function removeFollow(db: Db, kind: FollowKind, refId: number): boolean {
  return db.prepare('DELETE FROM follow WHERE kind = ? AND ref_id = ?').run(kind, refId).changes > 0
}

/**
 * Drop the follow that pointed at a deleted edition. The `kind` is not optional
 * decoration: arc 42 and edition 42 are different rows, and matching on `ref_id` alone
 * would unfollow a story arc because a volume happened to share its number.
 */
export function removeFollowsForEdition(db: Db, editionId: number): void {
  db.prepare("DELETE FROM follow WHERE kind = 'volume' AND ref_id = ?").run(editionId)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/models-follows.test.ts && npm run typecheck`
Expected: 5 passed, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/db.ts server/models/follows.ts test/models-follows.test.ts
git commit -m "feat: remember the runs and arcs you follow"
```

---

### Task 2: `nextWantedIssue` for a followed volume

**Files:**
- Create: `server/services/following.ts`
- Test: `test/following-next-wanted.test.ts`

**Interfaces:**
- Consumes: `Follow`, `FollowKind` (Task 1); `getEdition` from `../models/editions.js`; `listBooksByEdition` from `../models/books.js`; `getCachedVolumeIssues` from `../models/volumeIssues.js`; `getProgress` from `../models/progress.js`; `CvVolumeIssue` from `../lib/comicvine.js`.
- Produces: `FollowOutcome` (the discriminated union below) and `nextWantedIssue(db, follow): FollowOutcome`.

- [ ] **Step 1: Write the failing test**

Create `test/following-next-wanted.test.ts`:

```ts
import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { addFollow } from '../server/models/follows.js'
import { nextWantedIssue } from '../server/services/following.js'

const ISSUES = [
  { id: 101, number: '1', coverDate: '2020-01-01' },
  { id: 102, number: '2', coverDate: '2020-02-01' },
  { id: 103, number: '3', coverDate: '2020-03-01' },
]

/** An edition matched to Comic Vine volume 500, with the issue list already cached. */
function seed(issues = ISSUES) {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Iron Man', folder: 'Iron Man' })
  updateEdition(db, edition.id, { comicvineId: 500, cvName: 'Iron Man' })
  cacheVolumeIssues(db, 500, issues)
  const follow = addFollow(db, 'volume', edition.id, 'Iron Man')
  const own = (cvId: number, finished: boolean) => {
    const b = insertBook(db, { editionId: edition.id, filePath: `Iron Man/${cvId}.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvId })
    if (finished) setProgress(db, b.id, { lastPage: 9, completed: true })
    return b
  }
  return { db, edition, follow, own }
}

test('the issue after the last one you finished is what it wants', () => {
  const t = seed()
  t.own(101, true)
  expect(nextWantedIssue(t.db, t.follow)).toEqual({
    state: 'wanted',
    issue: expect.objectContaining({ id: 102, number: '2' }),
    volumeName: 'Iron Man',
    editionName: 'Iron Man',
  })
})

test('a run with nothing finished is dormant', () => {
  const t = seed()
  t.own(101, false)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('dormant')
})

test('a run whose next issue you already own is supplied', () => {
  const t = seed()
  t.own(101, true)
  t.own(102, false)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('supplied')
})

test('a run whose last issue you have finished is caught up', () => {
  const t = seed()
  t.own(101, true); t.own(102, true); t.own(103, true)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('caught-up')
})

// The anchor is the LAST finished issue, not the first gap (spec §3.1).
test('a gap behind you is left behind', () => {
  const t = seed()
  t.own(101, true)
  t.own(103, true)
  // #2 is missing, but #3 is finished, so the run has moved past it.
  expect(nextWantedIssue(t.db, t.follow).state).toBe('caught-up')
})

test('an issue abandoned halfway reads as supplied, since it is itself the unread one', () => {
  const t = seed()
  t.own(101, true)
  const b = t.own(102, false)
  setProgress(t.db, b.id, { lastPage: 4, completed: false })
  expect(nextWantedIssue(t.db, t.follow).state).toBe('supplied')
})

test('a follow whose edition is gone is unresolved', () => {
  const t = seed()
  const follow = addFollow(t.db, 'volume', 9999, 'Ghost')
  expect(nextWantedIssue(t.db, follow).state).toBe('unresolved')
})

test('an edition never matched to Comic Vine is unresolved', () => {
  const t = seed()
  const bare = upsertEdition(t.db, { name: 'Unsorted', folder: 'Unsorted' })
  const follow = addFollow(t.db, 'volume', bare.id, 'Unsorted')
  expect(nextWantedIssue(t.db, follow).state).toBe('unresolved')
})

test('a volume with no cached issue list is caught up until a refresh fills it', () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Thor', folder: 'Thor' })
  updateEdition(db, edition.id, { comicvineId: 600, cvName: 'Thor' })
  const follow = addFollow(db, 'volume', edition.id, 'Thor')
  expect(nextWantedIssue(db, follow).state).toBe('caught-up')
})

// Review Focus 2: Comic Vine lists unnumbered issues, and the match rule cannot use one.
test('an unnumbered next issue is still wanted, and carries no number to match on', () => {
  const t = seed([
    { id: 101, number: '1', coverDate: '2020-01-01' },
    { id: 102, coverDate: '2020-02-01' },
  ])
  t.own(101, true)
  const outcome = nextWantedIssue(t.db, t.follow)
  expect(outcome.state).toBe('wanted')
  if (outcome.state === 'wanted') expect(outcome.issue.number).toBeUndefined()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/following-next-wanted.test.ts`
Expected: FAIL — cannot resolve `../server/services/following.js`.

- [ ] **Step 3: Write the volume half of the service**

Create `server/services/following.ts`:

```ts
import { getEdition } from '../models/editions.js'
import { listBooksByEdition } from '../models/books.js'
import { getCachedVolumeIssues } from '../models/volumeIssues.js'
import { getProgress } from '../models/progress.js'
import type { Follow } from '../models/follows.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'
import type { Db } from '../types.js'

/**
 * What a follow is waiting for, named by spec §3.1 and carried unchanged all the way to
 * the tile. `unresolved` is the fifth: a follow whose edition has been deleted or whose
 * arc Comic Vine no longer knows. It is what the list route prunes on.
 */
export type FollowOutcome =
  | {
      state: 'wanted'
      issue: CvVolumeIssue
      /** Comic Vine's name for the volume: what the match keys on. */
      volumeName: string | null
      /** The edition's own name: where the file lands. */
      editionName: string
    }
  | { state: 'supplied' }
  | { state: 'dormant' }
  | { state: 'caught-up' }
  | { state: 'unresolved' }

/**
 * The one issue this follow should fetch, or why there is none.
 *
 * Entirely local: the cached issue list, what you own, and what you have finished. A
 * Comic Vine read only ever happens in the sweep, and only for a `caught-up` follow,
 * because that is the only state a fresher list could change.
 */
export function nextWantedIssue(db: Db, follow: Follow): FollowOutcome {
  return follow.kind === 'volume' ? volumeOutcome(db, follow) : arcOutcome(db, follow)
}

function volumeOutcome(db: Db, follow: Follow): FollowOutcome {
  const edition = getEdition(db, follow.refId)
  // No edition, or one never matched to a volume: there is no issue list to walk and no
  // name to match on. The list route drops the follow rather than showing a dead tile.
  if (!edition || edition.comicvineId == null) return { state: 'unresolved' }

  // Read at any age. Freshness is the sweep's job; a day-old list still answers "what
  // comes after the one I finished" correctly for every issue it does hold.
  const cached = getCachedVolumeIssues(db, edition.comicvineId, Infinity)
  if (!cached) return { state: 'caught-up' }

  const ownedIds = new Set<number>()
  const finishedIds = new Set<number>()
  for (const book of listBooksByEdition(db, edition.id)) {
    if (book.comicvineId == null) continue
    ownedIds.add(book.comicvineId)
    if (getProgress(db, book.id).completed) finishedIds.add(book.comicvineId)
  }

  const at = lastFinishedIndex(cached.issues, finishedIds)
  if (at === -1) return { state: 'dormant' }

  const next = cached.issues[at + 1]
  if (!next) return { state: 'caught-up' }
  if (ownedIds.has(next.id)) return { state: 'supplied' }

  return { state: 'wanted', issue: next, volumeName: edition.cvName, editionName: edition.name }
}

/**
 * How far down the run you have read: the LAST issue you finished, not the first gap.
 * A gap behind you is one you chose to skip, and a follow that reopened it would fight
 * you about a comic you have already read past.
 */
function lastFinishedIndex(issues: Array<{ id: number }>, finishedIds: Set<number>): number {
  let at = -1
  for (const [i, issue] of issues.entries()) if (finishedIds.has(issue.id)) at = i
  return at
}

function arcOutcome(_db: Db, _follow: Follow): FollowOutcome {
  return { state: 'unresolved' }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/following-next-wanted.test.ts && npm run typecheck`
Expected: 10 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/services/following.ts test/following-next-wanted.test.ts
git commit -m "feat: work out which issue a followed run is waiting for"
```

---

### Task 3: `nextWantedIssue` for a followed arc

**Files:**
- Modify: `server/services/following.ts` (replace the `arcOutcome` stub)
- Test: `test/following-next-wanted-arc.test.ts`

**Interfaces:**
- Consumes: `getCachedArc` from `../models/arcCache.js`; `getArcOrder` from `../models/arcOrder.js`; `applySavedOrder` from `../lib/arcOrder.js`; `ownedIssueIds` from `../models/arcs.js`; `getEditionByComicvineId` from `../models/editions.js`; `CvArcIssue` from `../lib/comicvine.js`.
- Produces: no new exports — `nextWantedIssue` now answers for both kinds.

- [ ] **Step 1: Write the failing test**

Create `test/following-next-wanted-arc.test.ts`:

```ts
import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { cacheArc } from '../server/models/arcCache.js'
import { saveArcOrder } from '../server/models/arcOrder.js'
import { addFollow } from '../server/models/follows.js'
import { nextWantedIssue } from '../server/services/following.js'

const ARC_ID = 56676

const ARC = {
  id: ARC_ID,
  name: 'Death Spiral',
  issues: [
    { id: 201, number: '1', volumeName: 'Daredevil', volumeId: 700, coverDate: '2015-03-01' },
    { id: 202, number: '2', volumeName: 'Daredevil', volumeId: 700, coverDate: '2015-04-01' },
    { id: 203, number: '9', volumeName: 'Elektra', volumeId: 800, coverDate: '2015-05-01' },
  ],
}

function seed() {
  const db = openDb(':memory:')
  cacheArc(db, ARC_ID, ARC)
  const dd = upsertEdition(db, { name: 'Daredevil (2014)', folder: 'Daredevil (2014)' })
  updateEdition(db, dd.id, { comicvineId: 700, cvName: 'Daredevil' })
  const follow = addFollow(db, 'arc', ARC_ID, 'Death Spiral')
  const own = (cvId: number, finished: boolean, editionId = dd.id) => {
    const b = insertBook(db, { editionId, filePath: `arc/${cvId}.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvId })
    if (finished) setProgress(db, b.id, { lastPage: 9, completed: true })
    return b
  }
  return { db, dd, follow, own }
}

test('the next part of the arc is what it wants', () => {
  const t = seed()
  t.own(201, true)
  const outcome = nextWantedIssue(t.db, t.follow)
  expect(outcome).toEqual({
    state: 'wanted',
    issue: expect.objectContaining({ id: 202 }),
    volumeName: 'Daredevil',
    editionName: 'Daredevil (2014)',
  })
})

// An arc crosses volumes: ownership is library-wide, not scoped to one edition.
test('a part you own in another edition still counts as owned', () => {
  const t = seed()
  const other = upsertEdition(t.db, { name: 'Elektra', folder: 'Elektra' })
  t.own(201, true)
  t.own(202, true)
  t.own(203, false, other.id)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('supplied')
})

// The tie-in's own volume decides where it lands, not the arc's spine.
test('a tie-in with no edition of its own falls back to its volume name', () => {
  const t = seed()
  t.own(201, true)
  t.own(202, true)
  const outcome = nextWantedIssue(t.db, t.follow)
  expect(outcome).toEqual({
    state: 'wanted',
    issue: expect.objectContaining({ id: 203 }),
    volumeName: 'Elektra',
    editionName: 'Elektra',
  })
})

test('an arc follows the order you arranged, not the one dates computed', () => {
  const t = seed()
  saveArcOrder(t.db, ARC_ID, [203, 201, 202])
  t.own(203, true)
  const outcome = nextWantedIssue(t.db, t.follow)
  expect(outcome.state).toBe('wanted')
  if (outcome.state === 'wanted') expect(outcome.issue.id).toBe(201)
})

test('an arc with nothing finished is dormant', () => {
  const t = seed()
  t.own(201, false)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('dormant')
})

test('an arc whose last part you finished is caught up', () => {
  const t = seed()
  t.own(201, true); t.own(202, true); t.own(203, true)
  expect(nextWantedIssue(t.db, t.follow).state).toBe('caught-up')
})

test('an arc Comic Vine has never been asked about is caught up', () => {
  const t = seed()
  const follow = addFollow(t.db, 'arc', 99999, 'Unknown Arc')
  expect(nextWantedIssue(t.db, follow).state).toBe('caught-up')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/following-next-wanted-arc.test.ts`
Expected: FAIL — every case returns `unresolved` from the stub.

- [ ] **Step 3: Replace the stub**

In `server/services/following.ts`, add these imports:

```ts
import { getCachedArc } from '../models/arcCache.js'
import { getArcOrder } from '../models/arcOrder.js'
import { applySavedOrder } from '../lib/arcOrder.js'
import { ownedIssueIds } from '../models/arcs.js'
import { getEditionByComicvineId } from '../models/editions.js'
import type { CvArcIssue } from '../lib/comicvine.js'
```

and replace `arcOutcome` with:

```ts
function arcOutcome(db: Db, follow: Follow): FollowOutcome {
  const cached = getCachedArc(db, follow.refId, Infinity)
  if (!cached) return { state: 'caught-up' }

  // The order YOU put the arc in outranks the one dates computed - applied here for the
  // same reason the arc route applies it in one place: the shelf and the arc page must
  // never disagree about which issue comes next.
  const issues = applySavedOrder(cached.arc.issues, getArcOrder(db, follow.refId))

  // Library-wide, not per-edition: an arc crosses volumes by definition, and most of what
  // it is missing are tie-ins belonging to other runs entirely.
  const owned = ownedIssueIds(db)

  const finishedIds = new Set<number>()
  for (const [cvId, bookId] of owned) if (getProgress(db, bookId).completed) finishedIds.add(cvId)

  const at = lastFinishedIndex(issues, finishedIds)
  if (at === -1) return { state: 'dormant' }

  const next = issues[at + 1]
  if (!next) return { state: 'caught-up' }
  if (owned.has(next.id)) return { state: 'supplied' }

  return {
    state: 'wanted',
    issue: asVolumeIssue(next),
    // The tie-in's OWN volume, never the arc's name: the match keys on the volume the
    // issue belongs to, and most of an arc is not the title it is named after.
    volumeName: next.volumeName ?? null,
    editionName: editionNameFor(db, next) ?? follow.name,
  }
}

/** Where a part of an arc lands: its volume's edition if we hold one, else its own name. */
function editionNameFor(db: Db, issue: CvArcIssue): string | undefined {
  const edition = issue.volumeId == null ? undefined : getEditionByComicvineId(db, issue.volumeId)
  return edition?.name ?? issue.volumeName
}

/**
 * An arc issue as the download path wants it. A structural cast would compile - the
 * fields line up today - but the two types are owned by different parts of Comic Vine's
 * api and the extra ones (`storeDate`, `volumeId`) have no meaning downstream.
 */
function asVolumeIssue(issue: CvArcIssue): CvVolumeIssue {
  return {
    id: issue.id,
    ...(issue.number == null ? {} : { number: issue.number }),
    ...(issue.name == null ? {} : { name: issue.name }),
    ...(issue.coverDate == null ? {} : { coverDate: issue.coverDate }),
    ...(issue.siteUrl == null ? {} : { siteUrl: issue.siteUrl }),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/following-next-wanted-arc.test.ts test/following-next-wanted.test.ts && npm run typecheck`
Expected: 17 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/services/following.ts test/following-next-wanted-arc.test.ts
git commit -m "feat: work out which part a followed arc is waiting for"
```

---

### Task 4: `attemptFollow` — hand a wanted issue to the downloader

**Files:**
- Modify: `server/services/following.ts`
- Test: `test/following-attempt.test.ts`

**Interfaces:**
- Consumes: `startIssueDownload`, `issueLabel` from `./issueDownload.js`; `fetchSourcePage` from `../lib/comicIndexSource.js`; `App` from `../types.js`.
- Produces: `attemptFollow(app, follow, fetchPage?): Promise<'queued' | 'skipped'>`.

- [ ] **Step 1: Write the failing test**

Create `test/following-attempt.test.ts`:

```ts
import { test, expect } from 'vitest'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { upsertComicIndex } from '../server/models/comicIndex.js'
import { addFollow } from '../server/models/follows.js'
import { enqueue as enqueueRow, listQueue } from '../server/models/downloadQueue.js'
import { attemptFollow } from '../server/services/following.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

// The shape parseDownloadLink actually reads — see test/comic-post-page.test.ts.
const POST = '<div class="aio-button-center">'
  + '<a href="https://dl.example/ironman2.cbz">DOWNLOAD NOW</a></div>'

function seed({ indexed = true }: { indexed?: boolean } = {}) {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  // The real queue model behind a stub runner: nothing downloads, but the duplicate
  // guard is the genuine partial unique index rather than a reimplementation of it.
  // Note the rename — the runner takes `issueId`, the model stores `cvIssueId`.
  app.decorate('downloader', {
    enqueue: (req: { url: string; edition?: string; issueId?: number; label?: string }) =>
      enqueueRow(db, { url: req.url, edition: req.edition, cvIssueId: req.issueId, label: req.label }),
  } as unknown as App['downloader'])

  const edition = upsertEdition(db, { name: 'Iron Man', folder: 'Iron Man' })
  updateEdition(db, edition.id, { comicvineId: 500, cvName: 'Iron Man' })
  cacheVolumeIssues(db, 500, [
    { id: 101, number: '1', coverDate: '2020-01-01' },
    { id: 102, number: '2', coverDate: '2020-02-01' },
  ])
  if (indexed) {
    // `number` and `year` are NOT passed: upsertComicIndex derives both from the title.
    upsertComicIndex(db, [{
      title: 'Iron Man #2 (2020)', url: 'https://src.example/iron-man-2', category: 'Marvel',
    }])
  }
  const follow = addFollow(db, 'volume', edition.id, 'Iron Man')
  const b = insertBook(db, { editionId: edition.id, filePath: 'Iron Man/1.cbz', pageCount: 10, fileSize: 1 })!
  updateBook(db, b.id, { comicvineId: 101 })
  setProgress(db, b.id, { lastPage: 9, completed: true })
  return { app, db, edition, follow }
}

test('a wanted issue is queued, labelled by volume and number', async () => {
  const t = seed()
  const result = await attemptFollow(t.app, t.follow, async () => POST)
  expect(result).toBe('queued')
  const queue = listQueue(t.db)
  expect(queue).toHaveLength(1)
  expect(queue[0]).toMatchObject({
    url: 'https://dl.example/ironman2.cbz', edition: 'Iron Man', cvIssueId: 102, label: 'Iron Man #2',
  })
})

test('an issue the index cannot match queues nothing and throws nothing', async () => {
  const t = seed({ indexed: false })
  expect(await attemptFollow(t.app, t.follow, async () => POST)).toBe('skipped')
  expect(listQueue(t.db)).toHaveLength(0)
})

test('an issue already queued is not queued twice', async () => {
  const t = seed()
  await attemptFollow(t.app, t.follow, async () => POST)
  expect(await attemptFollow(t.app, t.follow, async () => POST)).toBe('skipped')
  expect(listQueue(t.db)).toHaveLength(1)
})

test('a follow with nothing to want fetches no page at all', async () => {
  const t = seed()
  // Finish #2 as well, leaving the run caught up.
  const b = insertBook(t.db, { editionId: t.edition.id, filePath: 'Iron Man/2.cbz', pageCount: 10, fileSize: 1 })!
  updateBook(t.db, b.id, { comicvineId: 102 })
  setProgress(t.db, b.id, { lastPage: 9, completed: true })
  let fetched = 0
  expect(await attemptFollow(t.app, t.follow, async () => { fetched++; return POST })).toBe('skipped')
  expect(fetched).toBe(0)
})

test('a post that cannot be read is skipped rather than thrown', async () => {
  const t = seed()
  const result = await attemptFollow(t.app, t.follow, async () => { throw new Error('offline') })
  expect(result).toBe('skipped')
  expect(listQueue(t.db)).toHaveLength(0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/following-attempt.test.ts`
Expected: FAIL — `attemptFollow` is not exported.

- [ ] **Step 3: Write `attemptFollow`**

Add to `server/services/following.ts`:

```ts
import { startIssueDownload, issueLabel } from './issueDownload.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { App } from '../types.js'
```

```ts
/**
 * Fetch what this follow is waiting for, if anything.
 *
 * Everything past "which issue" is the path a single Get press already takes, so the
 * match is re-derived at the moment of queueing and a double-queue is refused by the
 * partial unique index rather than by a check that could interleave.
 *
 * Every refusal is a non-event: the want is still wanted, and the next sweep works it
 * out again from scratch. That is the whole of the error handling, and it is this short
 * because nothing about the attempt is stored.
 */
export async function attemptFollow(
  app: App,
  follow: Follow,
  /** Injected so tests never touch the network. */
  fetchPage: (url: string) => Promise<string> = fetchSourcePage,
): Promise<'queued' | 'skipped'> {
  const outcome = nextWantedIssue(app.db, follow)
  if (outcome.state !== 'wanted') return 'skipped'

  const result = await startIssueDownload(app, {
    volumeName: outcome.volumeName,
    editionName: outcome.editionName,
    issue: outcome.issue,
    label: issueLabel(outcome.volumeName, outcome.issue.number),
    fetchPage,
  })
  return result.ok ? 'queued' : 'skipped'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/following-attempt.test.ts && npm run typecheck`
Expected: 5 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/services/following.ts test/following-attempt.test.ts
git commit -m "feat: fetch the issue a follow is waiting for"
```

---

### Task 5: Share `resolveArcId` between the arc and follow routes

**Files:**
- Create: `server/services/arcIdentity.ts`
- Modify: `server/routes/arcs.ts` (remove the local `resolveArcId`, import it, expose `arcId` on the response)
- Test: `test/arc-identity.test.ts`

**Interfaces:**
- Consumes: `booksInArc` from `../models/arcs.js`; `setTagIds` from `../models/metadata.js`; `ComicVineClient` from `../lib/comicvine.js`.
- Produces: `resolveArcId(db, cv, name): Promise<{ id: number } | { code: number; error: string }>`.

Spec §5.1 requires the follow route to resolve an arc name the same way every other arc route does, and the arc page needs the resolved id back so it can unfollow. Both are this one move.

- [ ] **Step 1: Write the failing test**

Create `test/arc-identity.test.ts`:

```ts
import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags, getBookTags } from '../server/models/metadata.js'
import { resolveArcId } from '../server/services/arcIdentity.js'
import type { ComicVineClient } from '../server/lib/comicvine.js'

function seed() {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Daredevil', folder: 'Daredevil' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Daredevil/1.cbz', pageCount: 1, fileSize: 1 })!
  updateBook(db, book.id, { comicvineId: 201 })
  return { db, book }
}

const cvReturning = (storyArcs: Array<{ id: number; name: string }>) =>
  ({ getIssue: async () => ({ storyArcs }) } as unknown as ComicVineClient)

test('a stored tag id is used without asking Comic Vine', async () => {
  const t = seed()
  replaceBookTags(t.db, t.book.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  const cv = { getIssue: async () => { throw new Error('should not be asked') } } as unknown as ComicVineClient
  expect(await resolveArcId(t.db, cv, 'Death Spiral')).toEqual({ id: 56676 })
})

test('a tag with no id is backfilled from the issue that carries it', async () => {
  const t = seed()
  replaceBookTags(t.db, t.book.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  expect(await resolveArcId(t.db, cvReturning([{ id: 56676, name: 'Death Spiral' }]), 'Death Spiral'))
    .toEqual({ id: 56676 })
  // Backfilled, so the next resolve costs nothing.
  expect(getBookTags(t.db, t.book.id)[0].extId).toBe(56676)
})

test('an arc the library does not hold is a 404', async () => {
  const t = seed()
  expect(await resolveArcId(t.db, cvReturning([]), 'Nothing')).toEqual({
    code: 404, error: 'arc not in this library',
  })
})

test('an arc Comic Vine cannot name is a 404', async () => {
  const t = seed()
  replaceBookTags(t.db, t.book.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  expect(await resolveArcId(t.db, cvReturning([{ id: 1, name: 'Something Else' }]), 'Death Spiral'))
    .toEqual({ code: 404, error: 'arc not found on Comic Vine' })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/arc-identity.test.ts`
Expected: FAIL — cannot resolve `../server/services/arcIdentity.js`.

- [ ] **Step 3: Move the function out of the route**

Create `server/services/arcIdentity.ts` with the body currently at `server/routes/arcs.ts:98-120`, parameterised by `db` and `cv`:

```ts
import { booksInArc } from '../models/arcs.js'
import { setTagIds } from '../models/metadata.js'
import type { ComicVineClient } from '../lib/comicvine.js'
import type { Db } from '../types.js'

/**
 * The Comic Vine id for an arc the library knows by name, or the refusal to send back.
 *
 * Shared rather than private to the arc routes: reordering an arc, following one, and
 * drawing one all have to find the same id, or an arrangement gets filed under nothing
 * and a follow points at an arc nobody can open.
 */
export async function resolveArcId(
  db: Db, cv: ComicVineClient, name: string,
): Promise<{ id: number } | { code: number; error: string }> {
  const rows = booksInArc(db, name)
  if (rows.length === 0) return { code: 404, error: 'arc not in this library' }

  const stored = rows.find((r) => r.extId != null)?.extId ?? null
  if (stored != null) return { id: stored }

  // No id stored: re-read an issue that carries the tag, the same way a character is
  // backfilled. Two requests the first time this arc is opened, none after that.
  const source = rows.find((r) => r.comicvineId != null)
  if (source) {
    const issue = await cv.getIssue(source.comicvineId!)
    setTagIds(db, source.bookId, 'story_arc', issue.storyArcs)
    const found = issue.storyArcs.find((a) => a.name === name)?.id ?? null
    if (found != null) return { id: found }
  }
  return { code: 404, error: 'arc not found on Comic Vine' }
}
```

- [ ] **Step 4: Point the arc routes at it and expose the id**

In `server/routes/arcs.ts`: delete the local `resolveArcId` function and its `booksInArc` / `setTagIds` imports if nothing else uses them, add `import { resolveArcId } from '../services/arcIdentity.js'`, and replace every `resolveArcId(name)` call with `resolveArcId(app.db, cv, name)`.

In the `GET /api/arcs/:name` handler, add the resolved id to the response so the page can unfollow (spec §5.1) — the handler already computes `extId` and currently discards it:

```ts
    return {
      // The arc's own Comic Vine id, which the page needs to unfollow it. Computed here
      // already; it was simply never sent.
      arcId: extId,
      stale: loaded.stale,
      fetchedAt: loaded.fetchedAt,
```

- [ ] **Step 5: Run the tests to verify nothing regressed**

Run: `npx vitest run test/arc-identity.test.ts test/routes-arcs.test.ts && npm run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/services/arcIdentity.ts server/routes/arcs.ts test/arc-identity.test.ts
git commit -m "refactor: share the arc id lookup, and send it to the page"
```

---

### Task 6: The `/api/follows` routes

**Files:**
- Create: `server/routes/follows.ts`
- Modify: `server/index.ts` (register), `server/routes/editions.ts` (drop a follow with its edition)
- Test: `test/routes-follows.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5; `findLiveByIssue` from `../models/downloadQueue.js`; `getEdition` from `../models/editions.js`; `getComicVineKey` from `../models/settings.js`.
- Produces: `GET /api/follows`, `POST /api/follows`, `DELETE /api/follows/:kind/:refId`, and the response type `{ follows: FollowView[] }` where `FollowView = { kind, refId, name, state, want?: { id, number, name }, queued?: boolean }`.

**Deviation from spec §5.1:** the spec says a wanted issue carries "the store date when Comic Vine has one". `CvVolumeIssue` has no store date — only `coverDate`, which is two months ahead of the shelf date and would read as a lie. The want carries `queued` instead, which is the more useful fact and is always knowable. Noted again at the end of the plan.

- [ ] **Step 1: Write the failing test**

Create `test/routes-follows.test.ts`:

```ts
import { test, expect } from 'vitest'
import Fastify from 'fastify'
import followRoutes from '../server/routes/follows.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition, deleteEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags } from '../server/models/metadata.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { addFollow, listFollows } from '../server/models/follows.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

async function setup() {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  app.decorate('downloader', { enqueue: () => ({ queued: false }) } as unknown as App['downloader'])
  setComicVineKey(db, 'test-key')
  // No page is ever fetched in these tests: POST attempts, and an attempt with no match
  // stops before the fetch.
  await app.register(followRoutes, { fetchPage: async () => { throw new Error('no network') } })

  const edition = upsertEdition(db, { name: 'Iron Man', folder: 'Iron Man' })
  updateEdition(db, edition.id, { comicvineId: 500, cvName: 'Iron Man' })
  cacheVolumeIssues(db, 500, [
    { id: 101, number: '1', coverDate: '2020-01-01' },
    { id: 102, number: '2', coverDate: '2020-02-01' },
  ])
  const own = (cvId: number, finished: boolean) => {
    const b = insertBook(db, { editionId: edition.id, filePath: `Iron Man/${cvId}.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvId })
    if (finished) setProgress(db, b.id, { lastPage: 9, completed: true })
    return b
  }
  return { app, db, edition, own, cleanup: () => app.close() }
}

test('following a volume stores it and answers with it', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({
      method: 'POST', url: '/api/follows',
      payload: { kind: 'volume', editionId: t.edition.id },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().follow).toMatchObject({ kind: 'volume', refId: t.edition.id, name: 'Iron Man' })
    expect(listFollows(t.db)).toHaveLength(1)
  } finally { await t.cleanup() }
})

test('a volume never matched to Comic Vine is refused with a reason', async () => {
  const t = await setup()
  try {
    const bare = upsertEdition(t.db, { name: 'Unsorted', folder: 'Unsorted' })
    const res = await t.app.inject({
      method: 'POST', url: '/api/follows', payload: { kind: 'volume', editionId: bare.id },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/match/i)
    expect(listFollows(t.db)).toHaveLength(0)
  } finally { await t.cleanup() }
})

test('the list carries what each follow is waiting for', async () => {
  const t = await setup()
  try {
    t.own(101, true)
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    const follows = (await t.app.inject({ url: '/api/follows' })).json().follows
    expect(follows).toHaveLength(1)
    expect(follows[0]).toMatchObject({
      kind: 'volume', refId: t.edition.id, name: 'Iron Man',
      state: 'wanted', want: { id: 102, number: '2' }, queued: false,
    })
  } finally { await t.cleanup() }
})

test('a dormant follow says so and carries no want', async () => {
  const t = await setup()
  try {
    t.own(101, false)
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    const follows = (await t.app.inject({ url: '/api/follows' })).json().follows
    expect(follows[0].state).toBe('dormant')
    expect(follows[0].want).toBeUndefined()
  } finally { await t.cleanup() }
})

test('a follow whose edition has been deleted is pruned on read', async () => {
  const t = await setup()
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    deleteEdition(t.db, t.edition.id)
    expect((await t.app.inject({ url: '/api/follows' })).json().follows).toEqual([])
    expect(listFollows(t.db)).toEqual([])
  } finally { await t.cleanup() }
})

test('an arc is followed by name and stored under its Comic Vine id', async () => {
  const t = await setup()
  try {
    const b = t.own(101, false)
    replaceBookTags(t.db, b.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
    const res = await t.app.inject({
      method: 'POST', url: '/api/follows', payload: { kind: 'arc', name: 'Death Spiral' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().follow).toMatchObject({ kind: 'arc', refId: 56676, name: 'Death Spiral' })
  } finally { await t.cleanup() }
})

test('unfollowing removes it, and unfollowing nothing is a 404', async () => {
  const t = await setup()
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    expect((await t.app.inject({ method: 'DELETE', url: `/api/follows/volume/${t.edition.id}` })).statusCode).toBe(200)
    expect((await t.app.inject({ method: 'DELETE', url: `/api/follows/volume/${t.edition.id}` })).statusCode).toBe(404)
  } finally { await t.cleanup() }
})

test('a kind that is not a kind is refused', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/follows', payload: { kind: 'character', name: 'Venom' } })
    expect(res.statusCode).toBe(400)
  } finally { await t.cleanup() }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/routes-follows.test.ts`
Expected: FAIL — cannot resolve `../server/routes/follows.js`.

- [ ] **Step 3: Write the routes**

Create `server/routes/follows.ts`:

```ts
import { createComicVine } from '../lib/comicvine.js'
import { addFollow, getFollow, listFollows, removeFollow } from '../models/follows.js'
import type { Follow, FollowKind } from '../models/follows.js'
import { getEdition } from '../models/editions.js'
import { getComicVineKey } from '../models/settings.js'
import { findLiveByIssue } from '../models/downloadQueue.js'
import { resolveArcId } from '../services/arcIdentity.js'
import { nextWantedIssue, attemptFollow } from '../services/following.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { App } from '../types.js'

interface FollowBody { kind?: string; editionId?: number; name?: string }
interface FollowParams { kind: string; refId: string }

export interface FollowRouteOpts {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
}

const KINDS: FollowKind[] = ['volume', 'arc']
const isKind = (v: unknown): v is FollowKind => KINDS.includes(v as FollowKind)

export default async function followRoutes(app: App, opts: FollowRouteOpts = {}) {
  const { fetchPage = fetchSourcePage } = opts
  const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })

  /**
   * What each follow is waiting for. A follow whose target has gone - a deleted edition,
   * an arc no issue carries any more - is dropped here rather than drawn as a tile that
   * can never do anything.
   */
  app.get('/api/follows', async () => {
    const views = []
    for (const follow of listFollows(app.db)) {
      const outcome = nextWantedIssue(app.db, follow)
      if (outcome.state === 'unresolved') {
        removeFollow(app.db, follow.kind, follow.refId)
        continue
      }
      views.push({
        kind: follow.kind,
        refId: follow.refId,
        name: follow.name,
        state: outcome.state,
        ...(outcome.state === 'wanted'
          ? {
              want: {
                id: outcome.issue.id,
                number: outcome.issue.number ?? null,
                name: outcome.issue.name ?? null,
              },
              // Whether the thing it wants is already on its way, which is a different
              // sentence from "waiting" and the one a reader actually wants to read.
              queued: findLiveByIssue(app.db, outcome.issue.id) !== undefined,
            }
          : {}),
      })
    }
    return { follows: views }
  })

  /**
   * Follow a run or an arc, each addressed the way it is addressed everywhere else: a
   * volume by its edition id, an arc by the name its page is reached under.
   *
   * Attempts once on the way out. Following a run you are already part-way through
   * should do the obvious thing immediately rather than making you re-read an issue to
   * trigger it.
   */
  app.post<{ Body: FollowBody }>('/api/follows', async (req, reply) => {
    const body = req.body || {}
    if (!isKind(body.kind)) return reply.code(400).send({ error: 'follow a volume or an arc' })

    let follow: Follow
    if (body.kind === 'volume') {
      const edition = getEdition(app.db, Number(body.editionId))
      if (!edition) return reply.code(404).send({ error: 'edition not found' })
      // The whole mechanism rests on an issue list and a match rule, and both need the
      // volume. Accepting this follow would leave it permanently inert, which looks
      // exactly like a bug.
      if (edition.comicvineId == null) {
        return reply.code(409).send({ error: 'match this volume to Comic Vine before following it' })
      }
      follow = addFollow(app.db, 'volume', edition.id, edition.cvName || edition.name)
    } else {
      const name = (body.name ?? '').trim()
      if (!name) return reply.code(400).send({ error: 'which arc?' })
      const resolved = await resolveArcId(app.db, cv, name)
      if ('code' in resolved) return reply.code(resolved.code).send({ error: resolved.error })
      follow = addFollow(app.db, 'arc', resolved.id, name)
    }

    // Never lets a failed fetch fail the follow: the row is already saved, and the next
    // sweep tries again.
    try { await attemptFollow(app, follow, fetchPage) } catch { /* spec §3.5 */ }
    return { follow }
  })

  app.delete<{ Params: FollowParams }>('/api/follows/:kind/:refId', async (req, reply) => {
    const { kind, refId } = req.params
    if (!isKind(kind)) return reply.code(400).send({ error: 'follow a volume or an arc' })
    if (!removeFollow(app.db, kind, Number(refId))) {
      return reply.code(404).send({ error: 'not following that' })
    }
    return { unfollowed: true }
  })
}
```

- [ ] **Step 4: Register it, and drop a follow with its edition**

In `server/index.ts`, beside the other route imports and registrations:

```ts
import followRoutes from './routes/follows.js'
```
```ts
  await app.register(followRoutes)
```

In `server/routes/editions.ts`, add the import and one line to the `DELETE /api/editions/:id` handler, before `deleteEdition`:

```ts
import { removeFollowsForEdition } from '../models/follows.js'
```
```ts
    // The follow pointed at this edition; nothing else can clean it up, because a
    // polymorphic key cannot carry a foreign key.
    removeFollowsForEdition(app.db, edition.id)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/routes-follows.test.ts test/routes-editions-volume.test.ts && npm run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/routes/follows.ts server/index.ts server/routes/editions.ts test/routes-follows.test.ts
git commit -m "feat: follow and unfollow a run or an arc"
```

---

### Task 7: Pull the next issue when you finish one

**Files:**
- Modify: `server/services/following.ts` (add `attemptFollowsForBook`), `server/routes/books.ts`
- Test: `test/follow-on-finish.test.ts`

**Interfaces:**
- Consumes: `getBookTags` from `../models/metadata.js`; `getProgress` from `../models/progress.js`; `Book` from `../types.js`.
- Produces: `attemptFollowsForBook(app, book, fetchPage?): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `test/follow-on-finish.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import booksRoutes from '../server/routes/books.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags } from '../server/models/metadata.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { cacheArc } from '../server/models/arcCache.js'
import { addFollow } from '../server/models/follows.js'
import * as following from '../server/services/following.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

async function setup() {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { thumbsDir: '/tmp/none' } as Config)
  app.decorate('downloader', { enqueue: () => ({ queued: false }) } as unknown as App['downloader'])
  await app.register(booksRoutes)

  const edition = upsertEdition(db, { name: 'Iron Man', folder: 'Iron Man' })
  updateEdition(db, edition.id, { comicvineId: 500, cvName: 'Iron Man' })
  cacheVolumeIssues(db, 500, [
    { id: 101, number: '1', coverDate: '2020-01-01' },
    { id: 102, number: '2', coverDate: '2020-02-01' },
  ])
  const book = insertBook(db, { editionId: edition.id, filePath: 'Iron Man/1.cbz', pageCount: 10, fileSize: 1 })!
  updateBook(db, book.id, { comicvineId: 101 })
  return { app, db, edition, book, cleanup: () => app.close() }
}

test('finishing a comic attempts the follow on its run', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('queued')
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    const res = await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 9, completed: true },
    })
    expect(res.statusCode).toBe(200)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][1]).toMatchObject({ kind: 'volume', refId: t.edition.id })
  } finally { spy.mockRestore(); await t.cleanup() }
})

test('finishing a comic attempts the follows on its arcs', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('queued')
  try {
    cacheArc(t.db, 56676, { id: 56676, name: 'Death Spiral', issues: [] })
    replaceBookTags(t.db, t.book.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
    addFollow(t.db, 'arc', 56676, 'Death Spiral')
    await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 9, completed: true },
    })
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][1]).toMatchObject({ kind: 'arc', refId: 56676 })
  } finally { spy.mockRestore(); await t.cleanup() }
})

test('saving your place partway through attempts nothing', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('queued')
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 4, completed: false },
    })
    expect(spy).not.toHaveBeenCalled()
  } finally { spy.mockRestore(); await t.cleanup() }
})

// Review Focus 3: the reader re-sends completed:true on every page turn at the end.
test('re-finishing a comic you had already finished attempts nothing', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('queued')
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    setProgress(t.db, t.book.id, { lastPage: 9, completed: true })
    await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 9, completed: true },
    })
    expect(spy).not.toHaveBeenCalled()
  } finally { spy.mockRestore(); await t.cleanup() }
})

test('an attempt that throws still saves your place', async () => {
  const t = await setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockRejectedValue(new Error('the site is down'))
  try {
    addFollow(t.db, 'volume', t.edition.id, 'Iron Man')
    const res = await t.app.inject({
      method: 'PUT', url: `/api/books/${t.book.id}/progress`, payload: { lastPage: 9, completed: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().progress.completed).toBe(true)
  } finally { spy.mockRestore(); await t.cleanup() }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/follow-on-finish.test.ts`
Expected: FAIL — `attemptFollow` is never called.

- [ ] **Step 3: Add `attemptFollowsForBook`**

In `server/services/following.ts`, add the imports and the function. Note the self-import: the spies in the test replace the module's export, and a direct call would bypass them — but the real reason to route through it is that it keeps one definition of "attempt a follow".

```ts
import { getBookTags } from '../models/metadata.js'
import { getFollow, listFollows } from '../models/follows.js'
import type { Book } from '../types.js'
```

```ts
/**
 * Attempt every follow this comic belongs to: the run it sits in, and any arc it carries
 * a tag for. Arcs are matched on the tag's Comic Vine id rather than its name - an arc
 * follow is stored under that id, and names get restated by re-matching.
 *
 * Each attempt is wrapped. One follow failing must never stop the next.
 */
export async function attemptFollowsForBook(
  app: App,
  book: Book,
  fetchPage: (url: string) => Promise<string> = fetchSourcePage,
): Promise<void> {
  const due: Follow[] = []

  const volume = getFollow(app.db, 'volume', book.editionId)
  if (volume) due.push(volume)

  const arcIds = new Set(
    getBookTags(app.db, book.id)
      .filter((t) => t.kind === 'story_arc' && t.extId != null)
      .map((t) => t.extId as number),
  )
  if (arcIds.size > 0) {
    for (const follow of listFollows(app.db)) {
      if (follow.kind === 'arc' && arcIds.has(follow.refId)) due.push(follow)
    }
  }

  for (const follow of due) {
    try {
      await followingModule.attemptFollow(app, follow, fetchPage)
    } catch { /* spec §3.5: every refusal is a non-event */ }
  }
}
```

At the top of the file, add the self-reference that keeps the call indirect:

```ts
import * as followingModule from './following.js'
```

- [ ] **Step 4: Call it when a comic is finished**

In `server/routes/books.ts`, add the import and change the progress handler:

```ts
import { attemptFollowsForBook } from '../services/following.js'
```

```ts
  app.put<{ Params: IdParams; Body: ProgressBody }>('/api/books/:id/progress', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const { lastPage = 0, completed = false } = req.body || {}
    // Read BEFORE the write, so "you just finished this" can be told apart from "you are
    // still on the last page". The reader re-sends completed on every page turn at the
    // end of a comic, and each one would otherwise be a fresh attempt.
    const wasCompleted = getProgress(app.db, book.id).completed
    const progress = setProgress(app.db, book.id, { lastPage, completed })

    // Fire and forget: saving your place must never wait on, or fail because of,
    // someone else's web server.
    if (completed && !wasCompleted) {
      void attemptFollowsForBook(app, book).catch(() => { /* spec §3.5 */ })
    }
    return { progress }
  })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/follow-on-finish.test.ts test/routes-read.test.ts && npm run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/services/following.ts server/routes/books.ts test/follow-on-finish.test.ts
git commit -m "feat: pull the next issue when you finish one"
```

---

### Task 8: Retry every follow when a scrape finishes

**Files:**
- Modify: `server/services/following.ts` (the sweep), `server/routes/comicIndex.ts`
- Test: `test/follow-sweep.test.ts`

**Interfaces:**
- Consumes: `cacheVolumeIssues`, `getCachedVolumeIssues`, `VOLUME_CACHE_MAX_AGE_MS` from `../models/volumeIssues.js`; `cacheArc`, `getCachedArc` from `../models/arcCache.js`; `createComicVine` from `../lib/comicvine.js`; `getComicVineKey` from `../models/settings.js`.
- Produces: `sweepFollows(app, opts?): { swept: number } | { already: true }` and `followSweepIdle(): Promise<void>`. Options: `{ fetchPage?, delayMs?, refreshLimit? }`.

- [ ] **Step 1: Write the failing test**

Create `test/follow-sweep.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { cacheVolumeIssues, getCachedVolumeIssues } from '../server/models/volumeIssues.js'
import { addFollow } from '../server/models/follows.js'
import { setComicVineKey } from '../server/models/settings.js'
import { sweepFollows, followSweepIdle } from '../server/services/following.js'
import * as following from '../server/services/following.js'
import type { App } from '../server/types.js'
import type { Config } from '../server/config.js'

const DAY_OLD = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()

function setup({ key = 'test-key' } = {}) {
  const app = Fastify() as unknown as App
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  app.decorate('downloader', { enqueue: () => ({ queued: false }) } as unknown as App['downloader'])
  if (key) setComicVineKey(db, key)

  const follow = (name: string, cvVolumeId: number, caughtUp: boolean, fetchedAt?: string) => {
    const edition = upsertEdition(db, { name, folder: name })
    updateEdition(db, edition.id, { comicvineId: cvVolumeId, cvName: name })
    cacheVolumeIssues(db, cvVolumeId, [{ id: cvVolumeId + 1, number: '1', coverDate: '2020-01-01' }], fetchedAt)
    const b = insertBook(db, { editionId: edition.id, filePath: `${name}/1.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvVolumeId + 1 })
    if (caughtUp) setProgress(db, b.id, { lastPage: 9, completed: true })
    return addFollow(db, 'volume', edition.id, name)
  }
  return { app, db, follow }
}

test('a sweep attempts every follow', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  try {
    t.follow('Iron Man', 500, false)
    t.follow('Thor', 600, false)
    expect(sweepFollows(t.app, { delayMs: 0 })).toEqual({ swept: 2 })
    await followSweepIdle()
    expect(spy).toHaveBeenCalledTimes(2)
  } finally { spy.mockRestore() }
})

// Review Focus 4: two scrapes finishing at once must not double the outbound traffic.
test('a second sweep while one is running is refused', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve('skipped'), 20)),
  )
  try {
    t.follow('Iron Man', 500, false)
    expect(sweepFollows(t.app, { delayMs: 0 })).toEqual({ swept: 1 })
    expect(sweepFollows(t.app, { delayMs: 0 })).toEqual({ already: true })
    await followSweepIdle()
    expect(spy).toHaveBeenCalledTimes(1)
  } finally { spy.mockRestore() }
})

test('a caught-up follow with an aged list is refreshed from Comic Vine', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      status_code: 1, number_of_total_results: 2,
      results: [
        { id: 501, issue_number: '1', cover_date: '2020-01-01' },
        { id: 502, issue_number: '2', cover_date: '2020-02-01' },
      ],
    }),
  })) as unknown as typeof fetch
  try {
    t.follow('Iron Man', 500, true, DAY_OLD)
    sweepFollows(t.app, { delayMs: 0 })
    await followSweepIdle()
    expect(getCachedVolumeIssues(t.db, 500)?.issues).toHaveLength(2)
  } finally { globalThis.fetch = origFetch; spy.mockRestore() }
})

test('a follow that wants something is not refreshed', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  let fetched = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => { fetched++; throw new Error('should not be asked') }) as unknown as typeof fetch
  try {
    // Not caught up: it already knows what it wants, so a fresher list changes nothing.
    t.follow('Iron Man', 500, false, DAY_OLD)
    sweepFollows(t.app, { delayMs: 0 })
    await followSweepIdle()
    expect(fetched).toBe(0)
  } finally { globalThis.fetch = origFetch; spy.mockRestore() }
})

// Review Focus 5: a fresh install with no key must still queue what the index can match.
test('with no Comic Vine key, the sweep still attempts but never refreshes', async () => {
  const t = setup({ key: '' })
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  let fetched = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => { fetched++; throw new Error('should not be asked') }) as unknown as typeof fetch
  try {
    t.follow('Iron Man', 500, true, DAY_OLD)
    sweepFollows(t.app, { delayMs: 0 })
    await followSweepIdle()
    expect(fetched).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
  } finally { globalThis.fetch = origFetch; spy.mockRestore() }
})

test('the refresh is capped so a long follow list cannot spend the hourly budget', async () => {
  const t = setup()
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  let fetched = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    fetched++
    return { ok: true, json: async () => ({ status_code: 1, number_of_total_results: 0, results: [] }) }
  }) as unknown as typeof fetch
  try {
    for (let i = 0; i < 5; i++) t.follow(`Run ${i}`, 500 + i * 10, true, DAY_OLD)
    sweepFollows(t.app, { delayMs: 0, refreshLimit: 2 })
    await followSweepIdle()
    expect(fetched).toBe(2)
  } finally { globalThis.fetch = origFetch; spy.mockRestore() }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/follow-sweep.test.ts`
Expected: FAIL — `sweepFollows` is not exported.

- [ ] **Step 3: Write the sweep**

Add to `server/services/following.ts`:

```ts
import { createComicVine } from '../lib/comicvine.js'
import { getComicVineKey } from '../models/settings.js'
import { cacheVolumeIssues, VOLUME_CACHE_MAX_AGE_MS } from '../models/volumeIssues.js'
import { cacheArc, ARC_CACHE_MAX_AGE_MS } from '../models/arcCache.js'
```

```ts
/**
 * The sweep in flight, so two scrapes finishing together cannot start two of them. One
 * handle rather than a boolean, because tests have to be able to wait for it.
 */
let sweeping: Promise<void> | null = null

/** Resolves when no sweep is running. Tests await it; nothing else needs it. */
export async function followSweepIdle(): Promise<void> {
  while (sweeping) await sweeping
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Retry every follow, in the background.
 *
 * Called when a scrape finishes, which is the precise moment a match can become newly
 * possible: fresh index rows are the only thing that turns a `no-match` into a download.
 *
 * Paced three seconds apart for the reason `queueMissingIssues` is paced - each attempt
 * fetches a post from someone else's site, and a burst is what gets a scraper shut out.
 *
 * Returns synchronously with what it is about to attempt; the downloads themselves
 * arrive over the following minutes.
 */
export function sweepFollows(
  app: App,
  { fetchPage = fetchSourcePage, delayMs = 3000, refreshLimit = 20 }: {
    fetchPage?: (url: string) => Promise<string>
    /** The pause between follows. Injected as 0 by tests, which have no site to spare. */
    delayMs?: number
    /** Comic Vine reads per sweep, against a budget of 200 an hour for the whole app. */
    refreshLimit?: number
  } = {},
): { swept: number } | { already: true } {
  if (sweeping) return { already: true }

  const follows = listFollows(app.db)
  if (follows.length === 0) return { swept: 0 }

  const run = (async () => {
    await refreshCaughtUp(app, follows, refreshLimit)
    for (const [i, follow] of follows.entries()) {
      try {
        await followingModule.attemptFollow(app, follow, fetchPage)
      } catch { /* spec §3.5; one follow must never end the sweep */ }
      if (delayMs && i < follows.length - 1) await sleep(delayMs)
    }
  })().finally(() => { sweeping = null })

  sweeping = run
  return { swept: follows.length }
}

/**
 * Re-read the issue list for follows that have run out of it.
 *
 * Only `caught-up` follows: every other state is already answered from local tables, and
 * a fresher list could not change any of them. Without a key there is nothing to ask, and
 * matching against the index still works perfectly well - so this is skipped, not fatal.
 */
async function refreshCaughtUp(app: App, follows: Follow[], limit: number): Promise<void> {
  if (!getComicVineKey(app.db)) return
  const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })

  let spent = 0
  for (const follow of follows) {
    if (spent >= limit) return
    if (nextWantedIssue(app.db, follow).state !== 'caught-up') continue

    try {
      if (follow.kind === 'volume') {
        const edition = getEdition(app.db, follow.refId)
        if (!edition?.comicvineId) continue
        // Fresh enough already: a running volume gains an issue a month.
        if (getCachedVolumeIssues(app.db, edition.comicvineId, VOLUME_CACHE_MAX_AGE_MS)) continue
        spent++
        cacheVolumeIssues(app.db, edition.comicvineId, await cv.listVolumeIssues(edition.comicvineId))
      } else {
        if (getCachedArc(app.db, follow.refId, ARC_CACHE_MAX_AGE_MS)) continue
        spent++
        cacheArc(app.db, follow.refId, await cv.getStoryArc(follow.refId))
      }
    } catch {
      // Comic Vine declining is a reason to keep the list we hold, not to stop the sweep.
    }
  }
}
```

- [ ] **Step 4: Sweep when a scrape finishes**

In `server/routes/comicIndex.ts`, add the import and extend the scrape POST handler. The sweep is started from the route rather than the runner because an attempt needs `app.downloader`, which does not exist when `index.ts` constructs the runner:

```ts
import { sweepFollows } from '../services/following.js'
```

Inside the `POST /api/comic-index/scrape` handler, after `const { started, status } = app.scraper.start(mode)`, attach to the run rather than awaiting it:

```ts
  // A scrape finishing is when a follow's match can newly succeed, so every follow is
  // retried then. Attached to the run rather than awaited: the press that started the
  // scrape is answered immediately, as it always was.
  if (started) void done.then(() => { sweepFollows(app) }).catch(() => { /* the scraper reports its own */ })
```

(Capture `done` from `app.scraper.start(mode)` — the runner already returns it alongside `started` and `status`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/follow-sweep.test.ts test/routes-comic-index-scrape.test.ts && npm run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/services/following.ts server/routes/comicIndex.ts test/follow-sweep.test.ts
git commit -m "feat: retry every follow when a scrape finishes"
```

---

### Task 9: The api client and the status line

**Files:**
- Modify: `src/api.ts`
- Create: `src/lib/followStatus.ts`
- Test: `test/follow-status.test.ts`

**Interfaces:**
- Consumes: the `GET /api/follows` shape from Task 6.
- Produces: `ApiFollow`, `FollowState`; `api.getFollows()`, `api.followVolume(editionId)`, `api.followArc(name)`, `api.unfollow(kind, refId)`; `followStatus(follow): string`.

- [ ] **Step 1: Write the failing test**

Create `test/follow-status.test.ts`:

```ts
import { test, expect } from 'vitest'
import { followStatus } from '../src/lib/followStatus'
import type { ApiFollow } from '../src/api'

const base: ApiFollow = { kind: 'volume', refId: 1, name: 'Iron Man', state: 'dormant' }

test('a follow waiting on an issue nobody has posted says which one', () => {
  expect(followStatus({ ...base, state: 'wanted', want: { id: 2, number: '7', name: null }, queued: false }))
    .toBe('#7 is out — not posted yet')
})

test('a follow whose issue is on its way says so instead', () => {
  expect(followStatus({ ...base, state: 'wanted', want: { id: 2, number: '7', name: null }, queued: true }))
    .toBe('Getting #7')
})

test('an issue with no number is still described', () => {
  expect(followStatus({ ...base, state: 'wanted', want: { id: 2, number: null, name: null }, queued: true }))
    .toBe('Getting the next issue')
})

test('a caught-up follow is waiting on an announcement', () => {
  expect(followStatus({ ...base, state: 'caught-up' })).toBe('Waiting on the next issue to be announced')
})

test('a dormant follow explains what would start it', () => {
  expect(followStatus({ ...base, state: 'dormant' }))
    .toBe('Nothing read yet — finish an issue to pull the next')
})

test('a supplied follow has nothing to say', () => {
  expect(followStatus({ ...base, state: 'supplied' })).toBe('')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/follow-status.test.ts`
Expected: FAIL — cannot resolve `../src/lib/followStatus`.

- [ ] **Step 3: Add the api types and calls**

In `src/api.ts`, beside the other exported types:

```ts
export type FollowState = 'wanted' | 'supplied' | 'dormant' | 'caught-up'

export interface ApiFollow {
  kind: 'volume' | 'arc'
  /** The edition id for a volume; Comic Vine's arc id for an arc. */
  refId: number
  name: string
  state: FollowState
  /** Only on a `wanted` follow: the issue it is after. */
  want?: { id: number; number: string | null; name: string | null }
  /** Only on a `wanted` follow: whether that issue is already in the download queue. */
  queued?: boolean
}
```

and inside `export const api = {`:

```ts
  getFollows: () => json<{ follows: ApiFollow[] }>('/api/follows'),

  /** A volume is followed by its edition, which is where its downloads land. */
  followVolume: (editionId: number) =>
    json<{ follow: ApiFollow }>('/api/follows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'volume', editionId }),
    }),

  /** An arc is followed by the name its page is reached under; the server resolves the id. */
  followArc: (name: string) =>
    json<{ follow: ApiFollow }>('/api/follows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'arc', name }),
    }),

  unfollow: (kind: 'volume' | 'arc', refId: number) =>
    json<{ unfollowed: boolean }>(`/api/follows/${kind}/${refId}`, { method: 'DELETE' }),
```

- [ ] **Step 4: Write the status line**

Create `src/lib/followStatus.ts`:

```ts
import type { ApiFollow } from '../api'

/**
 * What a follow has to say for itself, in one line.
 *
 * Every line is derived from the state the server computed rather than stored, and the
 * two kinds of waiting are deliberately different sentences: "nobody has posted it" is a
 * fact about the index, "not announced" is a fact about the publisher, and a reader can
 * do something about neither - but only one of them is going to change this week.
 *
 * A supplied follow says nothing: there is a comic on the shelf, which says it better.
 */
export function followStatus(follow: ApiFollow): string {
  switch (follow.state) {
    case 'wanted': {
      const which = follow.want?.number ? `#${follow.want.number}` : 'the next issue'
      if (follow.queued) return `Getting ${which}`
      return follow.want?.number
        ? `${which} is out — not posted yet`
        : 'The next issue is out — not posted yet'
    }
    case 'caught-up':
      return 'Waiting on the next issue to be announced'
    case 'dormant':
      return 'Nothing read yet — finish an issue to pull the next'
    case 'supplied':
      return ''
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/follow-status.test.ts && npm run typecheck`
Expected: 6 passed, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/api.ts src/lib/followStatus.ts test/follow-status.test.ts
git commit -m "feat: say what a follow is waiting for"
```

---

### Task 10: The Following shelf

**Files:**
- Create: `src/pages/Following.tsx`, `src/components/FollowWaitingTile.tsx`
- Modify: `src/App.tsx`, `src/components/LibraryRail.tsx`, `src/styles.css`
- Test: `test/Following.test.tsx`

**Interfaces:**
- Consumes: `api.getFollows`, `api.getLibraryBooks`, `api.unfollow`, `followStatus` (Task 9); `groupByVolume`, `groupByArc` from `../lib/volumeGroups`; `VolumeGroupTile`, `ArcGroupTile`.
- Produces: the `/following` route and `FollowWaitingTile`.

- [ ] **Step 1: Write the failing test**

Create `test/Following.test.tsx`:

```tsx
import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Following from '../src/pages/Following'
import { api } from '../src/api'

const BOOK = {
  id: 9, editionId: 1, editionName: 'Iron Man', seriesName: 'Iron Man', arcs: [],
  title: 'Iron Man', number: '6', pageCount: 20, comicinfoSynced: false,
  readState: 'unread' as const, percent: 0,
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Following /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [] })
})

test('a follow with unread issues draws the run, not a waiting tile', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [BOOK] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'supplied' }],
  })
  show()
  expect(await screen.findByRole('link', { name: /Iron Man #6/ })).toBeInTheDocument()
  expect(screen.queryByText(/nothing read yet/i)).not.toBeInTheDocument()
})

test('a caught-up follow says what it is waiting for', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'caught-up' }],
  })
  show()
  expect(await screen.findByText('Iron Man')).toBeInTheDocument()
  expect(screen.getByText(/waiting on the next issue to be announced/i)).toBeInTheDocument()
})

test('a follow waiting on an unposted issue names it', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{
      kind: 'volume', refId: 1, name: 'Iron Man', state: 'wanted',
      want: { id: 2, number: '7', name: null }, queued: false,
    }],
  })
  show()
  expect(await screen.findByText(/#7 is out — not posted yet/)).toBeInTheDocument()
})

test('a dormant follow explains what would start it', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'dormant' }],
  })
  show()
  expect(await screen.findByText(/finish an issue to pull the next/i)).toBeInTheDocument()
})

// The mixed case of spec §3.1: something to read AND something still missing.
test('a follow can offer a comic and still say it is waiting', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({ books: [BOOK] })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{
      kind: 'volume', refId: 1, name: 'Iron Man', state: 'wanted',
      want: { id: 2, number: '7', name: null }, queued: true,
    }],
  })
  show()
  expect(await screen.findByRole('link', { name: /Iron Man #6/ })).toBeInTheDocument()
  expect(screen.getByText('Getting #7')).toBeInTheDocument()
})

test('an arc follow draws its arc tile', async () => {
  vi.spyOn(api, 'getLibraryBooks').mockResolvedValue({
    books: [{ ...BOOK, arcs: ['Death Spiral'] }],
  })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'arc', refId: 56676, name: 'Death Spiral', state: 'supplied' }],
  })
  show()
  expect(await screen.findByText('Death Spiral')).toBeInTheDocument()
})

test('unfollowing asks the server', async () => {
  const unfollow = vi.spyOn(api, 'unfollow').mockResolvedValue({ unfollowed: true })
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 1, name: 'Iron Man', state: 'caught-up' }],
  })
  show()
  await userEvent.click(await screen.findByRole('button', { name: /unfollow iron man/i }))
  expect(unfollow).toHaveBeenCalledWith('volume', 1)
})

test('an empty shelf explains itself rather than looking broken', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [] })
  show()
  expect(await screen.findByText(/not following anything yet/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/Following.test.tsx`
Expected: FAIL — cannot resolve `../src/pages/Following`.

- [ ] **Step 3: Write the waiting tile**

Create `src/components/FollowWaitingTile.tsx`:

```tsx
import type { ApiFollow } from '../api'
import { followStatus } from '../lib/followStatus'

interface FollowWaitingTileProps {
  follow: ApiFollow
}

/**
 * A followed run or arc with nothing on the shelf to show for it.
 *
 * No cover, because there is nothing to open: a cover here would be either a spoiler for
 * an issue you have not read or a picture of one you have. The point of the tile is that
 * the follow is still alive - a shelf that hid everything it was waiting on would be
 * indistinguishable from one that had quietly forgotten.
 */
export default function FollowWaitingTile({ follow }: FollowWaitingTileProps) {
  return (
    <div className="follow-waiting">
      <p className="follow-waiting__name">{follow.name}</p>
      <p className="follow-waiting__status">{followStatus(follow)}</p>
    </div>
  )
}
```

- [ ] **Step 4: Write the page**

Create `src/pages/Following.tsx`:

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiFollow, ApiLibraryBook } from '../api'
import { groupByVolume, groupByArc } from '../lib/volumeGroups'
import { followStatus } from '../lib/followStatus'
import LibraryRail from '../components/LibraryRail'
import VolumeGroupTile from '../components/VolumeGroupTile'
import ArcGroupTile from '../components/ArcGroupTile'
import FollowWaitingTile from '../components/FollowWaitingTile'

/** The unread comics this follow holds: its edition's, or its arc's. */
function booksFor(follow: ApiFollow, books: ApiLibraryBook[]): ApiLibraryBook[] {
  return follow.kind === 'volume'
    ? books.filter((b) => b.editionId === follow.refId)
    : books.filter((b) => b.arcs.includes(follow.name))
}

export default function Following() {
  const queryClient = useQueryClient()
  const follows = useQuery({ queryKey: ['follows'], queryFn: api.getFollows })
  // The same shelf query the library makes, so the two pages share a cache entry and
  // drawing a followed run costs nothing the library had not already paid for.
  const books = useQuery({
    queryKey: ['library-books', null, 'unread'],
    queryFn: () => api.getLibraryBooks({ readState: 'unread', publisher: null }),
  })

  const unfollow = useMutation({
    mutationFn: ({ kind, refId }: { kind: 'volume' | 'arc'; refId: number }) => api.unfollow(kind, refId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['follows'] }) },
  })

  const all = follows.data?.follows ?? []
  const unread = books.data?.books ?? []

  return (
    <>
      <LibraryRail />
      <main className="library-content">
        <h1 className="page-title">Following</h1>
        {follows.isLoading && <p>Loading…</p>}
        {follows.error && <p>Failed to load what you follow.</p>}
        {follows.data && all.length === 0 && (
          <p>Not following anything yet. Open a run or a story arc and press Follow.</p>
        )}
        <div className="tile-grid">
          {all.map((follow) => {
            const held = booksFor(follow, unread)
            const status = followStatus(follow)
            return (
              // The tile is reused untouched; everything this page adds hangs off the
              // wrapper, so the library's own shelf never learns that following exists.
              <div className="follow-item" key={`${follow.kind}:${follow.refId}`}>
                {held.length > 0
                  ? (follow.kind === 'volume'
                      ? <VolumeGroupTile group={groupByVolume(held)[0]} />
                      : <ArcGroupTile group={groupByArc(held).arcs[0]} />)
                  : <FollowWaitingTile follow={follow} />}
                {/* On a tile that already draws a comic, the status is the extra line;
                    on a waiting tile it is the tile, so it is not repeated here. */}
                {held.length > 0 && status && <p className="follow-item__status">{status}</p>}
                <button
                  type="button"
                  className="follow-item__unfollow"
                  aria-label={`Unfollow ${follow.name}`}
                  onClick={() => unfollow.mutate({ kind: follow.kind, refId: follow.refId })}
                >
                  Unfollow
                </button>
              </div>
            )
          })}
        </div>
      </main>
    </>
  )
}
```

- [ ] **Step 5: Add the route and the rail door**

In `src/App.tsx`, import the page and add the route beside the other library-shell routes:

```tsx
import Following from './pages/Following'
```
```tsx
      <Route path="/following" element={<LibraryLayout><Following /></LibraryLayout>} />
```

In `src/components/LibraryRail.tsx`, add the query and the door below the Story Arcs block:

```tsx
  const { data: followsData } = useQuery({ queryKey: ['follows'], queryFn: api.getFollows })
  const onFollowing = useLocation().pathname.startsWith('/following')
```
```tsx
      {/* One door, like Story Arcs above: what you follow is a shelf of its own, not a
          filter over this one. */}
      {(followsData?.follows.length ?? 0) > 0 && (
        <aside className="filter-sidebar" aria-label="Following">
          <ul className="filter-sidebar__list">
            <li>
              <Link to="/following" className={`filter-sidebar__item${onFollowing ? ' filter-sidebar__item--active' : ''}`}>
                <span className="filter-sidebar__label">Following</span>
                <span className="filter-sidebar__count">{followsData?.follows.length}</span>
              </Link>
            </li>
          </ul>
        </aside>
      )}
```

(`onArcs` already calls `useLocation()`; reuse the one call rather than adding a second — assign `const { pathname } = useLocation()` once and derive both.)

- [ ] **Step 6: Style the new pieces**

Append to `src/styles.css`, matching the existing tile metrics:

```css
/* A followed run with nothing to show: the same footprint as a cover tile, so the shelf
   stays on its grid whether a follow has a comic on it or not. */
.follow-waiting {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.4rem;
  aspect-ratio: 2 / 3;
  padding: 1rem;
  border: 1px dashed var(--border, #3a3a3a);
  border-radius: 6px;
  text-align: center;
}
.follow-waiting__name { font-weight: 600; margin: 0; }
.follow-waiting__status { margin: 0; font-size: 0.85rem; opacity: 0.7; }

.follow-item { display: flex; flex-direction: column; gap: 0.3rem; }
.follow-item__status { margin: 0; font-size: 0.8rem; opacity: 0.7; }
.follow-item__unfollow {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  font-size: 0.8rem;
  opacity: 0.6;
  cursor: pointer;
  text-decoration: underline;
}
.follow-item__unfollow:hover { opacity: 1; }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/Following.test.tsx && npm run typecheck`
Expected: 8 passed, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Following.tsx src/components/FollowWaitingTile.tsx src/App.tsx src/components/LibraryRail.tsx src/styles.css test/Following.test.tsx
git commit -m "feat: a shelf for the runs and arcs you follow"
```

---

### Task 11: The Follow button on the run and arc pages

**Files:**
- Create: `src/components/FollowButton.tsx`
- Modify: `src/pages/Edition.tsx`, `src/pages/Arc.tsx`, `src/api.ts` (the `arcId` on the arc response)
- Test: `test/FollowButton.test.tsx`

**Interfaces:**
- Consumes: `api.getFollows`, `api.followVolume`, `api.followArc`, `api.unfollow` (Task 9).
- Produces: `FollowButton` with props `{ target: { kind: 'volume'; editionId: number } | { kind: 'arc'; name: string }; refId: number | null; unavailable?: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/FollowButton.test.tsx`:

```tsx
import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FollowButton from '../src/components/FollowButton'
import { api } from '../src/api'

function show(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [] })
})

test('a run you do not follow offers to follow it', async () => {
  const follow = vi.spyOn(api, 'followVolume').mockResolvedValue({
    follow: { kind: 'volume', refId: 3, name: 'Iron Man', state: 'dormant' },
  })
  show(<FollowButton target={{ kind: 'volume', editionId: 3 }} refId={3} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Follow' }))
  expect(follow).toHaveBeenCalledWith(3)
})

test('a run you already follow offers to stop', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 3, name: 'Iron Man', state: 'dormant' }],
  })
  const unfollow = vi.spyOn(api, 'unfollow').mockResolvedValue({ unfollowed: true })
  show(<FollowButton target={{ kind: 'volume', editionId: 3 }} refId={3} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Following' }))
  expect(unfollow).toHaveBeenCalledWith('volume', 3)
})

test('an arc is followed by name', async () => {
  const follow = vi.spyOn(api, 'followArc').mockResolvedValue({
    follow: { kind: 'arc', refId: 56676, name: 'Death Spiral', state: 'dormant' },
  })
  show(<FollowButton target={{ kind: 'arc', name: 'Death Spiral' }} refId={56676} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Follow' }))
  expect(follow).toHaveBeenCalledWith('Death Spiral')
})

test('a run with no Comic Vine match says why it cannot be followed', async () => {
  show(
    <FollowButton
      target={{ kind: 'volume', editionId: 3 }}
      refId={3}
      unavailable="Match this volume to Comic Vine to follow it"
    />,
  )
  const button = await screen.findByRole('button', { name: 'Follow' })
  expect(button).toBeDisabled()
  expect(button).toHaveAccessibleDescription('Match this volume to Comic Vine to follow it')
})

test('an arc whose id is not known yet cannot be unfollowed by guess', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'arc', refId: 56676, name: 'Death Spiral', state: 'dormant' }],
  })
  show(<FollowButton target={{ kind: 'arc', name: 'Death Spiral' }} refId={null} />)
  // With no id to match on, it offers to follow rather than claiming a state it cannot check.
  expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/FollowButton.test.tsx`
Expected: FAIL — cannot resolve `../src/components/FollowButton`.

- [ ] **Step 3: Write the button**

Create `src/components/FollowButton.tsx`:

```tsx
import { useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

interface FollowButtonProps {
  /** How to start following, which is how each kind is addressed by the api. */
  target: { kind: 'volume'; editionId: number } | { kind: 'arc'; name: string }
  /**
   * The id the follow is stored under - the edition id for a volume, Comic Vine's arc id
   * for an arc - or null when the page does not know it yet. Null means the button can
   * offer to follow but cannot claim the thing is already followed.
   */
  refId: number | null
  /** Why following is impossible here, when it is. Disables the button and explains it. */
  unavailable?: string
}

/**
 * Follow or unfollow, from the page you already open to read the thing.
 *
 * It reads the follow list rather than taking its state as a prop: the Following shelf
 * and this button are then one source of truth, and unfollowing in one place updates the
 * other without either knowing about it.
 */
export default function FollowButton({ target, refId, unavailable }: FollowButtonProps) {
  const queryClient = useQueryClient()
  const describedBy = useId()
  const { data } = useQuery({ queryKey: ['follows'], queryFn: api.getFollows })

  const followed = refId != null
    && (data?.follows ?? []).some((f) => f.kind === target.kind && f.refId === refId)

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['follows'] }) }

  const start = useMutation({
    mutationFn: () => (target.kind === 'volume'
      ? api.followVolume(target.editionId)
      : api.followArc(target.name)),
    onSuccess: refresh,
  })
  const stop = useMutation({
    mutationFn: () => api.unfollow(target.kind, refId!),
    onSuccess: refresh,
  })

  const busy = start.isPending || stop.isPending

  return (
    <>
      <button
        type="button"
        className={`follow-button${followed ? ' follow-button--on' : ''}`}
        disabled={!!unavailable || busy}
        aria-describedby={unavailable ? describedBy : undefined}
        onClick={() => (followed ? stop.mutate() : start.mutate())}
      >
        {followed ? 'Following' : 'Follow'}
      </button>
      {unavailable && <span id={describedBy} className="follow-button__why">{unavailable}</span>}
    </>
  )
}
```

- [ ] **Step 4: Put it on the two pages**

In `src/api.ts`, add `arcId` to the arc response type (Task 5 made the server send it):

```ts
  /** Comic Vine's id for this arc, which is what a follow is stored under. */
  arcId?: number | null
```

In `src/pages/Edition.tsx`, import `FollowButton` and render it beside the edition's other actions:

```tsx
<FollowButton
  target={{ kind: 'volume', editionId: edition.id }}
  refId={edition.id}
  unavailable={edition.comicvineId == null ? 'Match this volume to Comic Vine to follow it' : undefined}
/>
```

In `src/pages/Arc.tsx`, beside the arc's heading actions:

```tsx
<FollowButton target={{ kind: 'arc', name }} refId={data?.arcId ?? null} />
```

Append to `src/styles.css`:

```css
.follow-button {
  padding: 0.35rem 0.9rem;
  border: 1px solid var(--border, #3a3a3a);
  border-radius: 999px;
  background: none;
  cursor: pointer;
  font-size: 0.85rem;
}
.follow-button--on { background: var(--accent, #2f6fd0); border-color: transparent; color: #fff; }
.follow-button:disabled { opacity: 0.5; cursor: default; }
.follow-button__why { font-size: 0.8rem; opacity: 0.7; margin-left: 0.5rem; }
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test && npm run typecheck`
Expected: every test passes, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/FollowButton.tsx src/pages/Edition.tsx src/pages/Arc.tsx src/api.ts src/styles.css test/FollowButton.test.tsx
git commit -m "feat: follow a run or an arc from its own page"
```

---

### Task 12: Document it and rebuild the container

**Files:**
- Modify: `README.md`
- Test: none — this task ships what the previous eleven built.

- [ ] **Step 1: Add a Following section to the README**

Under the existing feature description, after the Comic Vine key paragraph:

```markdown
## Following

Open a run or a story arc and press **Follow**. When you finish an issue, the next
one is queued automatically — one issue per finish, so the shelf never becomes a
backlog. What you follow lives under **Following** in the library sidebar.

When the next issue cannot be found yet, the follow waits and says so, and is
retried every time a scrape finishes (**Search → Scrape**). Nothing runs on a
timer: if you never scrape, nothing arrives.

A run you follow but have not started pulls nothing until you finish an issue of it.
```

- [ ] **Step 2: Run the full suite one last time**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

- [ ] **Step 3: Rebuild the container**

Run: `docker compose up -d --build`
Expected: the container rebuilds and starts; open `http://<server-ip>:3000` and confirm the Following door appears in the library sidebar once something is followed.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: explain following a run or an arc"
```

---

## Self-review notes

**Spec coverage:** §2 → Task 1. §2.4 → Task 6. §3.1 → Tasks 2–3. §3.2 → Task 4. §3.3 → Tasks 7–8. §3.4 → Task 8. §3.5 → Tasks 4, 7, 8 (every attempt wrapped). §4.1 → Task 6 (attempt on create). §5.1 → Tasks 5–6. §5.2 → Task 10. §5.3 → Tasks 9–10. §5.4 → Tasks 10–11. §5.5 → Task 10. §6 → every task's tests.

**Deviation from the spec's file list:** the spec named `test/routes-follows.test.ts` and five others; this plan adds `test/models-follows.test.ts`, `test/following-next-wanted-arc.test.ts`, `test/arc-identity.test.ts`, `test/follow-status.test.ts` and `test/FollowButton.test.tsx`, and splits `server/services/arcIdentity.ts` out of the arc routes. All are additions in the spec's direction, none change a design decision.

**One substantive deviation:** spec §5.1 and §5.3 have a waiting follow show the store date Comic Vine holds for the issue it wants. `CvVolumeIssue` carries no store date — only `coverDate`, which runs about two months ahead of the day a comic reaches shops, so printing it would tell you an issue is late before it is due. The want carries `queued` instead: whether the thing is already on its way, which is always knowable and is the distinction a reader is actually making. Nothing else in the spec depends on the date.

**Type consistency check:** `addFollow`/`getFollow`/`listFollows`/`removeFollow`/`removeFollowsForEdition` (Task 1) are used under those names in Tasks 6–8. `nextWantedIssue(db, follow)` (Task 2) is called identically in Tasks 3, 6 and 8. `attemptFollow(app, follow, fetchPage?)` (Task 4) is called identically in Tasks 6, 7, 8 and spied on by name in Tasks 7 and 8. `FollowOutcome.state` uses the five spec names throughout, and `ApiFollow.state` (Task 9) omits `unresolved` deliberately — the route prunes those before they can reach the client.
