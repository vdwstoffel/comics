# Collected Editions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editions that reprint the same Comic Vine volume gather onto one shelf named for that volume, everywhere a volume is drawn.

**Architecture:** An edition gains `collects_volume_id` — what it reprints, distinct from `comicvine_id`, which is what it *is*. A pure `shelfKeyOf` derives a grouping key from the pair, `groupIntoShelves` folds editions on it, and the series page, the library's unread shelf, a new `/volume/:cvId` page and `BookRedirect` all read that one grouping. Comic Vine detection lands last, on top of a column that already works by hand.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React 19, react-router 7, vitest, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-18-collected-editions-design.md`

## Global Constraints

- `comicvine_id` is never cleared, overwritten or "corrected" by anything in this plan. Spec Anti-goals.
- No edition is renamed, no row deleted, no book reparented, no file moved. The grouping is drawn at read time from a column.
- Detection proposes; only a user action writes `collects_volume_id`. Spec §4.
- Comic Vine prose never decides shelf *order*. Spec Anti-goals, §5.4.
- Shelf order is by `book.date`, ascending. Spec §5.4.
- A shelf of one edition is not collapsed: it draws as that edition and links to `/edition/:id`. Spec §5.1.
- Migrations are additive, in `openDb`, guarded by `columnsOf(db, 'edition').includes(...)`. Spec §2.
- Per `CLAUDE.md`: narrow `npx vitest run <files>` plus `npm run typecheck` while iterating; one full `npm test` before merge; `docker compose up -d --build` when done; never write test files into `./data`.

## Review Focus

Five things the spec implies that no task's happy path exercises. Each has a test pinned to the task that owns the code.

1. **A collects link nobody shares.** One edition points at a volume no other edition does. It must draw as itself, not as a one-edition "shelf". — Task 2.
2. **A book with no `date` on a date-ordered shelf.** `book.date` is nullable and real rows have nulls. Undated books sort last, stably, rather than scattering the shelf. — Task 4.
3. **A self-referencing link.** `collects_volume_id === comicvine_id`, which a mis-confirm can produce. The edition must land on exactly one shelf and still be reachable. — Task 2.
4. **A description that names only sibling collections.** `149382` links `150443` with no collecting verb before it. Detection must propose nothing rather than propose the sibling. — Task 10.
5. **A stale `/volume/:cvId` bookmark.** An edition is removed and the shelf drops to one edition, or to none. The route must not render an empty shelf or 500. — Task 5.

---

### Task 1: The collects columns

**Files:**
- Modify: `server/db.ts` (additive migration block beside the `cv_name` guards)
- Modify: `server/types.ts` (`Edition`)
- Modify: `server/models/editions.ts` (`EditionRow`, `toEdition`, `EDITION_FIELDS`, `EditionUpdate`)
- Test: `test/models-editions-collects.test.ts`

**Interfaces:**
- Produces: `Edition` gains `collectsVolumeId: number | null`, `collectsCvName: string | null`, `collectsCvStartYear: number | null`, `collectsCvSiteUrl: string | null`, `collectsCheckedAt: string | null`. `EDITION_FIELDS` gains the same five keys, so `updateEdition` writes them and `carryableMetadata` carries them through a rename without further change.

- [ ] **Step 1: Write the failing test**

```ts
test('an edition stores and reads back what it collects', () => {
  const db = openDb(':memory:')
  const e = upsertEdition(db, { name: 'Amazing Spider-Man By Zeb Wells (2023)', folder: 'x' })
  updateEdition(db, e.id, {
    collectsVolumeId: 142577,
    collectsCvName: 'The Amazing Spider-Man',
    collectsCvStartYear: 2022,
    collectsCvSiteUrl: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/',
  })
  const back = getEdition(db, e.id)!
  expect(back.collectsVolumeId).toBe(142577)
  expect(back.collectsCvStartYear).toBe(2022)
  expect(back.comicvineId).toBeNull()
  db.close()
})

test('a rename carries the collects link to the new row', () => {
  // carryableMetadata is derived from EDITION_FIELDS; assert the link survives it
  const db = openDb(':memory:')
  const e = upsertEdition(db, { name: 'Old name', folder: 'Old name' })
  updateEdition(db, e.id, { collectsVolumeId: 142577 })
  expect(carryableMetadata(getEdition(db, e.id)!).collectsVolumeId).toBe(142577)
  db.close()
})

test('checked-at records a look that found nothing, distinct from never looking', () => {
  const db = openDb(':memory:')
  const e = upsertEdition(db, { name: 'Untouched', folder: 'Untouched' })
  expect(getEdition(db, e.id)!.collectsCheckedAt).toBeNull()
  updateEdition(db, e.id, { collectsCheckedAt: '2026-10-18T00:00:00.000Z' })
  const back = getEdition(db, e.id)!
  expect(back.collectsCheckedAt).toBe('2026-10-18T00:00:00.000Z')
  expect(back.collectsVolumeId).toBeNull()
  db.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/models-editions-collects.test.ts`
Expected: FAIL — `collectsVolumeId` is not a known property.

- [ ] **Step 3: Add the five columns and thread them through**

Five `ALTER TABLE edition ADD COLUMN` guards in `openDb` (`collects_volume_id INTEGER`, `collects_cv_name TEXT`, `collects_cv_start_year INTEGER`, `collects_cv_site_url TEXT`, `collects_checked_at TEXT`), the five camelCase fields on `Edition`, their snake_case twins on `EditionRow`, their mapping in `toEdition`, and their entries in `EDITION_FIELDS` / `EditionUpdate`.

Document on the type, per spec §4.3: `collectsCheckedAt` null means never looked; set with a null `collectsVolumeId` means looked and the answer was no.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/models-editions-collects.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/types.ts server/models/editions.ts test/models-editions-collects.test.ts
git commit -m "feat: record what a collected edition reprints"
```

---

### Task 2: Shelf keys and shelf grouping

**Files:**
- Create: `server/lib/shelfKey.ts`
- Create: `server/models/shelves.ts`
- Test: `test/shelf-key.test.ts`, `test/models-shelves.test.ts`

**Interfaces:**
- Consumes: `Edition` from Task 1.
- Produces:
  ```ts
  // server/lib/shelfKey.ts
  export function shelfKeyOf(e: Pick<Edition, 'id' | 'comicvineId' | 'collectsVolumeId'>): string
  export function volumeIdOfKey(key: string): number | null

  // server/models/shelves.ts
  export interface Shelf {
    key: string
    /** The volume route target, null when this shelf is one edition. */
    volumeId: number | null
    name: string
    editions: Edition[]
    bookCount: number
    siteUrl: string | null
    /** True when an edition here holds the volume's own issues. Spec §5.3. */
    holdsIssues: boolean
  }
  export function groupIntoShelves(editions: Edition[]): Shelf[]
  ```

`shelfKeyOf` returns `volume:${collectsVolumeId ?? comicvineId}` when either is set, else `edition:${id}`. `volumeIdOfKey` returns the number for a `volume:` key and null otherwise.

`groupIntoShelves` folds on the key, keeping insertion order at both levels (`listEditions` already orders by name). Per shelf: `volumeId` is `volumeIdOfKey(key)` **only when `editions.length > 1`**, else null — that single field is what the collapse rule in spec §5.1 reduces to. `bookCount` sums `edition.bookCount ?? 0`. `holdsIssues` is true when some edition's `comicvineId` equals the key's volume id.

`name`, in order: the single edition's `name` when there is one; else the `cvName (cvStartYear)` of the edition whose `comicvineId` is the shelf volume; else the first `collectsCvName (collectsCvStartYear)` present; else the first edition's `name`. `siteUrl` comes from the same edition the name did (`cvSiteUrl` or `collectsCvSiteUrl`).

- [ ] **Step 1: Write the failing tests**

```ts
// test/shelf-key.test.ts
test('a collection keys on what it reprints, a run on itself', () => {
  expect(shelfKeyOf({ id: 84, comicvineId: 150443, collectsVolumeId: 142577 })).toBe('volume:142577')
  expect(shelfKeyOf({ id: 16, comicvineId: 163325, collectsVolumeId: null })).toBe('volume:163325')
})

test('an edition Comic Vine knows nothing about keys on itself alone', () => {
  expect(shelfKeyOf({ id: 7, comicvineId: null, collectsVolumeId: null })).toBe('edition:7')
})

// Review Focus 3
test('a self-referencing link yields one key, not two', () => {
  expect(shelfKeyOf({ id: 9, comicvineId: 142577, collectsVolumeId: 142577 })).toBe('volume:142577')
})
```

```ts
// test/models-shelves.test.ts — seed helper mirrors test/models-series.test.ts
test('three collections of one volume become one shelf named for the volume', () => {
  // 149382 / 150443 / 165956, all collects 142577, with collectsCvName 'The Amazing Spider-Man' + 2022
  const shelves = groupIntoShelves(listEditions(db))
  const asm = shelves.find((s) => s.key === 'volume:142577')!
  expect(asm.name).toBe('The Amazing Spider-Man (2022)')
  expect(asm.editions).toHaveLength(3)
  expect(asm.bookCount).toBe(13)
  expect(asm.volumeId).toBe(142577)
  expect(asm.holdsIssues).toBe(false)
})

// Review Focus 1
test('a lone collection is not collapsed', () => {
  const shelf = groupIntoShelves(listEditions(db)).find((s) => s.key === 'volume:999')!
  expect(shelf.editions).toHaveLength(1)
  expect(shelf.volumeId).toBeNull()
  expect(shelf.name).toBe('Some Lone Collection (2024)')
})

test('a shelf holding the volume issues takes its name and says so', () => {
  // one edition with comicvineId 163325, one collecting 163325
  const shelf = groupIntoShelves(listEditions(db)).find((s) => s.key === 'volume:163325')!
  expect(shelf.name).toBe('The Amazing Spider-Man (2025)')
  expect(shelf.holdsIssues).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/shelf-key.test.ts test/models-shelves.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `shelfKeyOf`, `volumeIdOfKey` and `groupIntoShelves`**

Grouping is a `Map<string, Edition[]>` fold, then a map over the entries applying the name and `volumeId` rules above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/shelf-key.test.ts test/models-shelves.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/shelfKey.ts server/models/shelves.ts test/shelf-key.test.ts test/models-shelves.test.ts
git commit -m "feat: group editions onto the volume they are of"
```

---

### Task 3: The series page draws shelves

**Files:**
- Modify: `server/models/series.ts` (`Series` gains `shelves: Shelf[]`)
- Modify: `src/api.ts` (`ApiSeries` gains `shelves`; add `ApiShelf`)
- Modify: `src/pages/Series.tsx`
- Modify: `src/lib/annuals.ts` if `splitAnnuals`'s `NamedEdition` needs widening
- Test: `test/routes-series.test.ts` (extend), `test/Series.test.tsx` (extend)

**Interfaces:**
- Consumes: `groupIntoShelves`, `Shelf` from Task 2.
- Produces: `GET /api/series/:name` returns `series.shelves`. `ApiShelf` mirrors `Shelf` with `editions: ApiEdition[]`.

`listSeries` calls `groupIntoShelves(editions)` for each series and keeps `editions` as it is — nothing that reads `editions` today changes.

`Series.tsx` runs `splitAnnuals` over `shelves` (by `shelf.name`) instead of editions, and renders one `CoverTile` per shelf: `to` is `/volume/${shelf.volumeId}` when `volumeId` is non-null, else `/edition/${shelf.editions[0].id}`; `img` is the first edition's thumbnail; `subtitle` is the shelf's `bookCount`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/routes-series.test.ts
test('a series carries its shelves alongside its editions', async () => {
  const res = await app.inject({ url: '/api/series/The%20Amazing%20Spider-Man' })
  const { series } = res.json()
  expect(series.editions).toHaveLength(6)
  expect(series.shelves.map((s: ApiShelf) => s.name)).toContain('The Amazing Spider-Man (2022)')
  expect(series.shelves).toHaveLength(4)
})
```

```tsx
// test/Series.test.tsx
test('three collections of one volume draw as one tile', async () => {
  renderSeries()
  expect(await screen.findByText('The Amazing Spider-Man (2022)')).toBeInTheDocument()
  expect(screen.queryByText('Amazing Spider-Man By Zeb Wells (2023)')).not.toBeInTheDocument()
  expect(screen.getByText('13 issues')).toBeInTheDocument()
})

test('a collapsed tile opens the volume shelf and a lone volume opens its edition', async () => {
  renderSeries()
  expect((await screen.findByRole('link', { name: /The Amazing Spider-Man \(2022\)/ }))
    .getAttribute('href')).toBe('/volume/142577')
  expect(screen.getByRole('link', { name: /Epic Collection/ })
    .getAttribute('href')).toMatch(/^\/edition\/\d+/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/routes-series.test.ts test/Series.test.tsx`
Expected: FAIL — `series.shelves` undefined.

- [ ] **Step 3: Add `shelves` to `Series` and draw them**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/routes-series.test.ts test/Series.test.tsx test/models-series.test.ts test/split-annuals.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/models/series.ts src/api.ts src/pages/Series.tsx test/
git commit -m "feat: one tile per volume on the series page"
```

---

### Task 4: The volume shelf endpoint

**Files:**
- Create: `server/routes/volumes.ts`
- Modify: `server/index.ts` (register the route)
- Modify: `server/models/books.ts` (`listBooksByShelf`)
- Test: `test/routes-volumes.test.ts`

**Interfaces:**
- Consumes: `groupIntoShelves`, `volumeIdOfKey` (Task 2); `EditionFilter` / `editionFilterOf` as the series route uses them.
- Produces:
  ```ts
  // server/models/books.ts
  export function listBooksByShelf(db: Db, editionIds: number[], readState?: FilterState): Book[]
  ```
  `GET /api/volumes/:volumeId` → `{ shelf: Shelf, books: BookWithProgress[] }`, 404 when no edition keys to that volume.

Books come back ordered by `date` ascending with undated books last, ties broken by `id` so the order is stable (Review Focus 2). Each book is passed through `deriveReadState`, as `/api/editions/:id` does.

- [ ] **Step 1: Write the failing tests**

```ts
test('the shelf gathers every collection of the volume, in date order', async () => {
  const res = await app.inject({ url: '/api/volumes/142577' })
  expect(res.statusCode).toBe(200)
  const { shelf, books } = res.json()
  expect(shelf.name).toBe('The Amazing Spider-Man (2022)')
  expect(books).toHaveLength(13)
  expect(books[0].title).toBe('Volume1: World Without Love')   // 2022-10, earliest
  expect(books.at(-1).title).toBe('TPB')                       // 8 Deaths, 2025-07, latest
  expect(books.map((b: ApiBook) => b.date)).toEqual([...books.map((b: ApiBook) => b.date)].sort())
})

// Review Focus 2
test('an undated book sorts last rather than scattering the shelf', async () => {
  const { books } = (await app.inject({ url: '/api/volumes/142577' })).json()
  expect(books.at(-1).date).toBeNull()
})

// Review Focus 5
test('a volume no edition keys to is a 404, not an empty shelf', async () => {
  expect((await app.inject({ url: '/api/volumes/999999' })).statusCode).toBe(404)
})

test('a volume held by a single edition still answers, uncollapsed', async () => {
  const { shelf } = (await app.inject({ url: '/api/volumes/77149' })).json()
  expect(shelf.editions).toHaveLength(1)
  expect(shelf.volumeId).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/routes-volumes.test.ts`
Expected: FAIL — 404 on every request, route not registered.

- [ ] **Step 3: Implement `listBooksByShelf` and the route**

The route builds shelves from `listEditions(db, filter)`, finds the one whose `key` is `volume:${volumeId}`, and lists its editions' books.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/routes-volumes.test.ts test/models-library-books.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/volumes.ts server/index.ts server/models/books.ts test/routes-volumes.test.ts
git commit -m "feat: serve a volume's shelf across its collections"
```

---

### Task 5: The volume shelf page

**Files:**
- Create: `src/pages/Volume.tsx`
- Modify: `src/App.tsx` (route `/volume/:volumeId`)
- Modify: `src/api.ts` (`api.getVolumeShelf`)
- Test: `test/Volume.test.tsx`

**Interfaces:**
- Consumes: `GET /api/volumes/:volumeId` (Task 4).
- Produces: route `/volume/:volumeId`, honouring `?status=` the way `/edition/:id` does.

The page renders the shelf name as `page-title`, a subtitle of the book count, the header strip from spec §5.5 — the collections it gathers, each a link to `/edition/:id`, plus an external link to `shelf.siteUrl` — and a `tile-grid` of `CoverTile`s in the order the server sent. **No missing-issue grid:** spec §5.3, and Task 6 adds the one case that does get one.

- [ ] **Step 1: Write the failing tests**

```tsx
test('the shelf lists every trade in order', async () => {
  renderVolume('142577')
  expect(await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })).toBeInTheDocument()
  expect(screen.getByText('13 issues')).toBeInTheDocument()
  // Both ends of the date order, from all three collections. Note the first title has no
  // space after "Volume" — match the fixture, not a tidier version of it.
  expect(screen.getByText('Volume1: World Without Love')).toBeInTheDocument()
  expect(screen.getByText('TPB')).toBeInTheDocument()
})

test('the header names the collections and links out to Comic Vine', async () => {
  renderVolume('142577')
  expect(await screen.findByRole('link', { name: /Zeb Wells/ }))
    .toHaveAttribute('href', expect.stringMatching(/^\/edition\/\d+$/))
  expect(screen.getByRole('link', { name: /Comic Vine/ }))
    .toHaveAttribute('href', 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/')
})

test('a collections-only shelf draws no missing-issue tiles', async () => {
  renderVolume('142577')
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2022)' })
  expect(screen.queryByText(/Get/)).not.toBeInTheDocument()
})

// Review Focus 5
test('a volume that no longer has a shelf says so instead of blanking', async () => {
  renderVolume('999999')  // api returns 404
  expect(await screen.findByText(/not found/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/Volume.test.tsx`
Expected: FAIL — `src/pages/Volume.tsx` does not exist.

- [ ] **Step 3: Implement `Volume.tsx` and register the route**

Follow `src/pages/Series.tsx` for the query/loading/not-found shape and `useBackOrigin` / `withStatus` usage.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/Volume.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Volume.tsx src/App.tsx src/api.ts test/Volume.test.tsx
git commit -m "feat: a shelf for the volume a run was collected from"
```

---

### Task 6: A shelf holding its volume's own issues

**Files:**
- Modify: `src/pages/Volume.tsx`
- Test: `test/Volume.test.tsx` (extend), `test/models-shelves.test.ts` (extend)

**Interfaces:**
- Consumes: `shelf.holdsIssues` and `shelf.editions` (Task 2); the existing `GET /api/editions/:id/issues`.

Spec §2.3/§5.3: when `holdsIssues` is true, the shelf also draws the run's issue grid, from the edition whose `comicvineId` equals the shelf volume — the existing `EditionRun` fed by that edition's issues endpoint — with the collections listed after it. This cannot arise in the live library today (no edition carries `comicvine_id = 142577`); the tests construct it.

Interleaving collections among the issues they collect stays out of scope — spec Non-goals.

- [ ] **Step 1: Write the failing test**

```tsx
test('a shelf holding the volume issues draws the run, then the collections', async () => {
  // fixture: edition A comicvineId 163325 with 3 issues; edition B collects 163325, 1 trade
  renderVolume('163325')
  expect(await screen.findByRole('heading', { name: 'The Amazing Spider-Man (2025)' })).toBeInTheDocument()
  expect(screen.getByText('#4')).toBeInTheDocument()          // a missing issue of the run
  expect(screen.getByText('Vol. 1: Collected')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/Volume.test.tsx -t 'holding the volume issues'`
Expected: FAIL — no issue grid rendered.

- [ ] **Step 3: Draw the run when `holdsIssues`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/Volume.test.tsx test/models-shelves.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Volume.tsx test/
git commit -m "feat: draw the run on a shelf that holds the volume's issues"
```

---

### Task 7: A comic's home shelf

**Files:**
- Modify: `server/routes/books.ts` (`GET /api/books/:id` payload)
- Modify: `src/api.ts` (`ApiBookDetail` gains `shelfVolumeId`)
- Modify: `src/pages/BookRedirect.tsx`
- Modify: `src/pages/Reader.tsx:88`
- Test: `test/routes-book-detail.test.ts` (extend), `test/book-redirect.test.tsx` (extend)

**Interfaces:**
- Consumes: `groupIntoShelves` (Task 2).
- Produces: `GET /api/books/:id` returns `shelfVolumeId: number | null` — the volume route target for this book's shelf, null when its edition stands alone.

`BookRedirect` navigates to `/volume/${shelfVolumeId}?issue=book-${id}` when non-null, else the current `/edition/${editionId}?issue=book-${id}`. `Reader.tsx`'s `run` constant takes the same branch, so `back: 'run'` closes onto the shelf. Everything upstream — Downloads, Upload, Releases, the arc pages, the annuals page — names a comic by id and inherits this for free. Spec §5.2.

- [ ] **Step 1: Write the failing tests**

```ts
// test/routes-book-detail.test.ts
test('a collected comic names the volume shelf as its home', async () => {
  const { shelfVolumeId } = (await app.inject({ url: `/api/books/${tradeId}` })).json()
  expect(shelfVolumeId).toBe(142577)
})

test('a comic in a stand-alone edition has no volume shelf', async () => {
  const { shelfVolumeId } = (await app.inject({ url: `/api/books/${loneId}` })).json()
  expect(shelfVolumeId).toBeNull()
})
```

```tsx
// test/book-redirect.test.tsx
test('a collected comic redirects to its volume shelf', async () => {
  renderRedirect(tradeId)   // api.getBook → { book: { editionId: 84 }, shelfVolumeId: 142577 }
  expect(await screen.findByTestId('location')).toHaveTextContent(`/volume/142577?issue=book-${tradeId}`)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/routes-book-detail.test.ts test/book-redirect.test.tsx`
Expected: FAIL — `shelfVolumeId` undefined; redirect still goes to `/edition/84`.

- [ ] **Step 3: Add `shelfVolumeId` and branch both consumers**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/routes-book-detail.test.ts test/book-redirect.test.tsx test/Reader.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/books.ts src/api.ts src/pages/BookRedirect.tsx src/pages/Reader.tsx test/
git commit -m "feat: a collected comic belongs to its volume's shelf"
```

---

### Task 8: The unread shelf collapses too

**Files:**
- Modify: `server/models/books.ts` (`LibraryBook`, `listLibraryBooks`)
- Modify: `src/api.ts` (`ApiLibraryBook`)
- Modify: `src/lib/volumeGroups.ts` (`VolumeGroup`, `groupByVolume`)
- Modify: `src/components/VolumeGroupTile.tsx`
- Test: `test/models-library-books.test.ts`, `test/volume-groups.test.ts`, `test/VolumeGroupTile.test.tsx`, `test/Library.test.tsx` (all extend)

**Interfaces:**
- Consumes: `shelfKeyOf`, `groupIntoShelves` (Task 2).
- Produces: `LibraryBook` / `ApiLibraryBook` gain `shelfKey: string`, `shelfName: string`, `shelfVolumeId: number | null` (same meaning as Task 7). `VolumeGroup` gains `shelfKey`, `shelfName`, `shelfVolumeId` and `groupByVolume` groups on `shelfKey` rather than `editionId`.

`listLibraryBooks` computes the shelf fields from `groupIntoShelves(listEditions(db))` — the **unfiltered** edition list, so a read-state filter hiding one edition's books cannot un-collapse a shelf. Spec §5.1.

`VolumeGroupTile` shows `group.shelfName`, and its name link goes to `/volume/${shelfVolumeId}?status=unread` when non-null, else the current `/edition/${editionId}?status=unread`. Its `next` book — the cover's target — is `group.books[0]`, which is now the first unread comic across the whole shelf.

- [ ] **Step 1: Write the failing tests**

```ts
// test/models-library-books.test.ts
test('a collected comic carries its shelf, named for the volume', () => {
  const [book] = listLibraryBooks(db, {}).filter((b) => b.editionId === zebWellsId)
  expect(book.shelfKey).toBe('volume:142577')
  expect(book.shelfName).toBe('The Amazing Spider-Man (2022)')
  expect(book.shelfVolumeId).toBe(142577)
})

test('a filter that hides one collection does not un-collapse the shelf', () => {
  // mark every Wells & Romita book read; the Zeb Wells books still say the shelf is collapsed
  const books = listLibraryBooks(db, { readState: 'unread' })
  expect(books.find((b) => b.editionId === zebWellsId)!.shelfVolumeId).toBe(142577)
})
```

```ts
// test/volume-groups.test.ts
test('thirteen trades from three editions are one group', () => {
  expect(groupByVolume(books)).toHaveLength(1)
  expect(groupByVolume(books)[0].shelfName).toBe('The Amazing Spider-Man (2022)')
})
```

```tsx
// test/VolumeGroupTile.test.tsx
test('a collapsed tile is named for the volume and links to its shelf', () => {
  renderTile(collapsedGroup)
  expect(screen.getByRole('link', { name: 'The Amazing Spider-Man (2022)' }))
    .toHaveAttribute('href', '/volume/142577?status=unread')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/models-library-books.test.ts test/volume-groups.test.ts test/VolumeGroupTile.test.tsx`
Expected: FAIL — `shelfKey` undefined; `groupByVolume` returns three groups.

- [ ] **Step 3: Thread the shelf fields through and group on them**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/models-library-books.test.ts test/volume-groups.test.ts test/VolumeGroupTile.test.tsx test/Library.test.tsx test/Following.test.tsx && npm run typecheck`
Expected: PASS. The follows shelf draws the same tile — check it still does.

- [ ] **Step 5: Commit**

```bash
git add server/models/books.ts src/api.ts src/lib/volumeGroups.ts src/components/VolumeGroupTile.tsx test/
git commit -m "feat: collapse collections on the unread shelf too"
```

---

### Task 9: Stop offering a volume you have collected

**Files:**
- Modify: `src/pages/Series.tsx` (`ownedVolumeIds`)
- Test: `test/Series.test.tsx` (extend)

**Interfaces:**
- Consumes: `ApiEdition.collectsVolumeId` (Task 1, exposed in Task 3's payload).

`ownedVolumeIds` becomes every non-null `comicvineId` **and** every non-null `collectsVolumeId` across the series' editions. Spec §6.

- [ ] **Step 1: Write the failing test**

```tsx
test('a volume you own in trades is no longer offered as one to find', async () => {
  renderSeries()
  await screen.findByRole('heading', { name: 'The Amazing Spider-Man' })
  expect(screen.queryByRole('link', { name: /Find The Amazing Spider-Man \(2022\)/ })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/Series.test.tsx -t 'no longer offered'`
Expected: FAIL — the row is still listed.

- [ ] **Step 3: Add collects ids to `ownedVolumeIds`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/Series.test.tsx test/OtherVolumes.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Series.tsx test/Series.test.tsx
git commit -m "feat: do not offer a volume you own in collected form"
```

---

### Task 10: Reading what a collection collects out of Comic Vine

**Files:**
- Create: `server/lib/collectsRef.ts`
- Modify: `server/lib/comicvine.ts` (`CvVolume` gains `descriptionHtml`; `getVolume` stops being the only reader of `description`)
- Create: `server/services/detectCollects.ts`
- Test: `test/collects-ref.test.ts`, `test/services-detect-collects.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // server/lib/collectsRef.ts
  export function volumeRefFromDescription(html: string): number | null
  export function collectingLineFromIssue(html: string): { name: string; startYear: number | null } | null

  // server/services/detectCollects.ts
  export interface CollectsProposal { volumeId: number; name: string | null; startYear: number | null; siteUrl: string | null }
  export async function detectCollects(ctx: Ctx, editionId: number): Promise<CollectsProposal | null>
  ```

`volumeRefFromDescription` takes the **raw** description HTML and returns the first `data-ref-id="4050-<id>"` that appears after a collecting verb (`collects`, `collecting`, case-insensitive), or null. Spec §3.1 — a sibling link with no verb before it is not an answer.

`collectingLineFromIssue` parses `COLLECTING: <name> (<year>) <range>` out of an issue description, returning name and year only; the range is deliberately discarded (spec §8.1).

`detectCollects` tries the volume description first, falls back to the issue description of the edition's first book plus a volume search by name and year, and returns null when neither answers. It writes nothing.

**`CvVolume.summary` is `stripHtml(description)` and cannot be used here** — spec §3.1. Widen `CvVolume` with the raw field.

- [ ] **Step 1: Write the failing tests**

```ts
// test/collects-ref.test.ts — fixtures are the real 2026-10-18 responses
test('a collecting verb picks the volume out of the description', () => {
  expect(volumeRefFromDescription(ZEB_WELLS_DESC)).toBe(142577)
  expect(volumeRefFromDescription(WELLS_ROMITA_DESC)).toBe(142577)
})

// Review Focus 4
test('a sibling link with no collecting verb is not an answer', () => {
  expect(volumeRefFromDescription(
    '<p>Continued on in <a data-ref-id="4050-150443">Zeb Wells</a></p>',
  )).toBeNull()
})

test('an empty description answers nothing', () => {
  expect(volumeRefFromDescription('')).toBeNull()
})

test('the collecting line gives a name and a year, and no issue range', () => {
  expect(collectingLineFromIssue(EIGHT_DEATHS_ISSUE_DESC))
    .toEqual({ name: 'Amazing Spider-Man', startYear: 2022 })
})
```

```ts
// test/services-detect-collects.test.ts — a stub Comic Vine client, no network
test('an empty volume description falls back to the trade issue description', async () => {
  const proposal = await detectCollects(ctx, eightDeathsId)
  expect(proposal?.volumeId).toBe(142577)
})

test('detection never writes the column', async () => {
  await detectCollects(ctx, zebWellsId)
  expect(getEdition(db, zebWellsId)!.collectsVolumeId).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/collects-ref.test.ts test/services-detect-collects.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the parsers and the service**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/collects-ref.test.ts test/services-detect-collects.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/collectsRef.ts server/lib/comicvine.ts server/services/detectCollects.ts test/
git commit -m "feat: work out what a collection collects from Comic Vine"
```

---

### Task 11: Proposing, confirming, withdrawing

**Files:**
- Modify: `server/routes/editions.ts` (`GET /api/editions/:id/collects`, `PUT`, `DELETE`)
- Create: `src/components/CollectsBanner.tsx`
- Modify: `src/pages/Edition.tsx`
- Modify: `src/api.ts`
- Test: `test/routes-editions-collects.test.ts`, `test/CollectsBanner.test.tsx`

**Interfaces:**
- Consumes: `detectCollects` (Task 10); `updateEdition` (Task 1).
- Produces:
  - `GET /api/editions/:id/collects` → `{ proposal: CollectsProposal | null, confirmed: boolean, checkedAt: string | null }`. Runs detection only when `collectsCheckedAt` is null, and stamps it either way.
  - `PUT /api/editions/:id/collects` body `{ volumeId, name, startYear, siteUrl }` → writes all four columns plus `collectsCheckedAt`.
  - `DELETE /api/editions/:id/collects` → clears `collectsVolumeId` and the three name columns, leaves `collectsCheckedAt` set. This is both "no, it collects nothing" and the withdraw in spec §4.2.

`CollectsBanner` is modelled on the edition page's existing "Check Comic Vine" / "Rename to…" banner: it states the proposal, links it to Comic Vine for checking, and offers yes / no. On a confirmed edition it states what the edition collects, **linking that volume to `collectsCvSiteUrl`** — the second half of spec §5.5, which puts the quick link on every individual edition page — and offers to withdraw. It is new UI, not a reuse of `ComicVineMatchDialog` — spec §4.1.

- [ ] **Step 1: Write the failing tests**

```ts
// test/routes-editions-collects.test.ts
test('a proposal is offered but nothing is written', async () => {
  const { proposal, confirmed } = (await app.inject({ url: `/api/editions/${id}/collects` })).json()
  expect(proposal.volumeId).toBe(142577)
  expect(confirmed).toBe(false)
  expect(getEdition(db, id)!.collectsVolumeId).toBeNull()
})

test('confirming writes the link and the volume name', async () => {
  await app.inject({ method: 'PUT', url: `/api/editions/${id}/collects`,
    payload: { volumeId: 142577, name: 'The Amazing Spider-Man', startYear: 2022, siteUrl: 'https://…' } })
  expect(getEdition(db, id)!.collectsCvName).toBe('The Amazing Spider-Man')
})

test('declining is remembered, so it is not proposed again', async () => {
  await app.inject({ method: 'DELETE', url: `/api/editions/${id}/collects` })
  const again = (await app.inject({ url: `/api/editions/${id}/collects` })).json()
  expect(again.proposal).toBeNull()
  expect(again.checkedAt).not.toBeNull()
})

test('withdrawing a confirmed link puts the edition back on its own shelf', async () => {
  await app.inject({ method: 'PUT', url: `/api/editions/${id}/collects`, payload: { volumeId: 142577 } })
  await app.inject({ method: 'DELETE', url: `/api/editions/${id}/collects` })
  expect(shelfKeyOf(getEdition(db, id)!)).toBe('volume:150443')
})
```

```tsx
// test/CollectsBanner.test.tsx
test('a proposal can be checked against Comic Vine before saying yes', () => {
  renderBanner({ proposal: { volumeId: 142577, name: 'The Amazing Spider-Man', startYear: 2022, siteUrl: CV_URL } })
  expect(screen.getByRole('link', { name: /The Amazing Spider-Man \(2022\)/ })).toHaveAttribute('href', CV_URL)
  expect(screen.getByRole('button', { name: /Yes/ })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/routes-editions-collects.test.ts test/CollectsBanner.test.tsx`
Expected: FAIL — routes 404, component missing.

- [ ] **Step 3: Implement the three routes and the banner**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/routes-editions-collects.test.ts test/CollectsBanner.test.tsx test/Edition.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/editions.ts src/components/CollectsBanner.tsx src/pages/Edition.tsx src/api.ts test/
git commit -m "feat: confirm what a collection collects before it is written"
```

---

### Task 12: Merge gate

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS, ~1800 tests. Per `CLAUDE.md`, a branch does not go into `main` on a partial run.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Rebuild the container**

Run: `docker compose up -d --build`
Expected: the app answers at http://localhost:8090.

- [ ] **Step 4: Set the three links by hand and look at it**

Confirm the collects link on editions 83, 84 and 85 through the banner, then check: the Amazing Spider-Man series page shows four tiles, the shelf holds thirteen trades in date order, the home page shows one unread tile, and closing the reader on a trade lands back on the shelf.

- [ ] **Step 5: Stop**

Do not merge. The branch waits at :8090 for Stoffel's verdict.
