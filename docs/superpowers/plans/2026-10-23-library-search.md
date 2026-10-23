# Library Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A header search box that finds the comics you already own — by series, run, issue title, issue number or creator — and answers onto a results page built from the library's own shelves and tiles.

**Architecture:** Search is a parameter on the existing shelf query, not a query of its own. `listLibraryBooks` gains an optional `q`; the filtering happens in SQL as one OR-group per search term, ANDed together, so a term may match a run's name while another matches a credit. Everything downstream — shelves, arcs, read state, grouping helpers, tiles — is inherited unchanged.

**Tech Stack:** TypeScript (strict), Fastify, better-sqlite3, React + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-library-search-design.md`

## Global Constraints

- The app is called **Comix**. The header link currently labelled `Search` becomes **`Get comics`** — that exact copy.
- **The route `/search` does not change.** The Find buttons on Edition and Releases build `/search?q=…&yearFrom=…`; this is a relabel, not a move.
- `matched` is present only on an answer to a `q`. A shelf call (no `q`) returns rows without it, and every existing caller of `listLibraryBooks` must be unaffected.
- Results are **unfiltered by default**; read state and publisher are offered, not inherited.
- **Any credit role matches**, not only writer and penciller.
- Out of scope, do not add: characters, teams, summaries, ranking, fuzzy matching, search history, a keyboard palette.
- Per `CLAUDE.md`: run only the touched tests plus `npm run typecheck` while iterating; the full suite once before merge.

## Review Focus

Five input classes the spec implies but does not pin. Each has a test in the task that owns the code.

1. **Blank `q`** (`?q=` or `?q=%20%20`) — a cleared search box. Must return the shelf unchanged, not zero results and not an error. (Task 1)
2. **LIKE wildcards in the query** (`%`, `_`, `\`) — someone searches `100%`. Unescaped, `%` matches the entire library. Must be escaped and matched literally. (Task 1)
3. **Non-ASCII case** — SQLite's built-in `LIKE` folds case for ASCII only, so `días` will not match `Días`. The limit is accepted, not fixed; it must be pinned by a test so nobody later "fixes" it by accident. (Task 1)
4. **A comic with nothing on it** — no title, no number, no credits, found only through its run. The reason computation must not crash and must report `'run'`. (Task 2)
5. **A pasted sentence** — one OR-group per term is 9 bound parameters; SQLite's variable ceiling is 999. Terms are capped at 8, the rest ignored. (Task 1)

---

### Task 1: Matching in the model

**Files:**
- Modify: `server/models/books.ts` (`listLibraryBooks`, ~line 138)
- Test: `test/models-library-books.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `listLibraryBooks(db, { readState?, publisher?, q? })` — `q?: string` added to the existing options object; return type `LibraryBook[]` unchanged. Also `searchTerms(q: string): string[]` (exported for Task 2), which trims, splits on whitespace, drops empties and caps at 8.

- [ ] **Step 1: Write the failing tests**

In `test/models-library-books.test.ts`, against a fixture library (reuse the file's existing helpers):

```ts
test('a run is found by its name, and brings its comics with it')
  // edition 'Uncanny X-Men (1963)' with issues #1 and #2, neither titled;
  // q: 'uncanny' → both books returned

test('a comic is found by its own title')
  // q: 'days of future past' → the one book

test('matching ignores case')
  // q: 'UNCANNY' → same two books

test('every term must match, though not the same field')
  // book titled 'Inferno' in 'Uncanny X-Men (1963)' written by Chris Claremont
  // q: 'uncanny inferno'  → found
  // q: 'uncanny daredevil' → not found

test('an all-digits query matches the issue number exactly')
  // issues #251 and #1251 → q: '251' returns only #251

test('a creator from ComicInfo is found', ...)       // book.writer
test('a creator from Comic Vine is found', ...)      // book_credit row, book.writer null
test('a credit that is not writer or penciller is found', ...)  // role 'cover'
test('a collected edition is found by the volume it collects')
  // edition 'By Zeb Wells (2023)' with collects_cv_name 'The Amazing Spider-Man'
  // q: 'amazing spider-man' → its books

// Review Focus 1
test('a blank query returns the whole shelf, as if it were absent')
  // q: '   ' → same length as listLibraryBooks(db, {})

// Review Focus 2
test('a wildcard in the query is matched literally, not as a wildcard')
  // one edition named '100% Marvel', one named 'Daredevil'
  // q: '%' → nothing; q: '100%' → only '100% Marvel'

// Review Focus 3
test('case folding is ASCII only, which is a limit this pins')
  // edition 'Días de Futuro' → q: 'Días' finds it; q: 'días' does not

// Review Focus 5
test('a query of many words is capped at eight terms')
  // nine terms where the ninth matches nothing → still found on the first eight
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/models-library-books.test.ts`
Expected: the new tests fail (`q` is not a known option, nothing filters).

- [ ] **Step 3: Implement the term parsing**

Add to `server/models/books.ts`:

```ts
export function searchTerms(q: string): string[]
function likePattern(term: string): string   // escapes \ % _ then wraps in %…%
```

`MAX_TERMS = 8`, with the ceiling explained in a comment (9 bound parameters per term against SQLite's 999).

- [ ] **Step 4: Implement the clause**

In `listLibraryBooks`, accept `q?: string`. For each term push one group onto the existing `clauses` array, so it ANDs with the read-state and publisher clauses already there:

```sql
(e.name LIKE ? ESCAPE '\' OR e.series_name LIKE ? ESCAPE '\'
 OR e.cv_name LIKE ? ESCAPE '\' OR e.collects_cv_name LIKE ? ESCAPE '\'
 OR b.title LIKE ? ESCAPE '\' OR b.number LIKE ? ESCAPE '\'
 OR b.writer LIKE ? ESCAPE '\' OR b.penciller LIKE ? ESCAPE '\'
 OR EXISTS (SELECT 1 FROM book_credit c WHERE c.book_id = b.id AND c.name LIKE ? ESCAPE '\'))
```

An all-digits term appends ` OR b.number = ?` to its own group. A `q` of no terms adds no clause at all, which is what makes Review Focus 1 fall out rather than being special-cased.

The `SELECT` needs `e.cv_name` and `e.collects_cv_name` only in the `WHERE`, so the projection does not change.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/models-library-books.test.ts && npm run typecheck`
Expected: PASS, and no other model test disturbed.

- [ ] **Step 6: Commit**

```bash
git add server/models/books.ts test/models-library-books.test.ts
git commit -m "feat: find a comic in the library by name, number or creator"
```

---

### Task 2: Why a comic matched

**Files:**
- Modify: `server/models/books.ts` (`LibraryBook`, `listLibraryBooks`)
- Test: `test/models-library-books.test.ts`

**Interfaces:**
- Consumes: `searchTerms` from Task 1.
- Produces: `LibraryBook.matched?: MatchReason` where
  `type MatchReason = 'name' | 'number' | 'run' | { role: string; name: string }`,
  and `creditsMatching(db, terms: string[]): Map<number, { name: string; role: string }>` — the first matching credit per book, following the `arcsByBook` pattern at `server/models/books.ts:113`.

- [ ] **Step 1: Write the failing tests**

```ts
test('a comic matched on its own title says so')            // matched === 'name'
test('a comic matched on its number says so')               // matched === 'number'
test('a comic matched through its run says run')            // matched === 'run'
test('a comic matched on a credit names the person and the role')
  // matched === { role: 'writer', name: 'Chris Claremont' }
test('a title match wins over a credit match on the same comic')
  // 'claremont' in both the title and the credits → matched === 'name'

// Review Focus 4
test('a comic with no title, no number and no credits still reports run')

test('a shelf call carries no reason at all')
  // listLibraryBooks(db, {}) → every row has matched === undefined
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/models-library-books.test.ts`
Expected: FAIL — `matched` is undefined everywhere.

- [ ] **Step 3: Implement `creditsMatching`**

One query over `book_credit` for the terms, grouped into a `Map` by `book_id`, keeping the first row per book. Same shape and reasoning as `arcsByBook`.

- [ ] **Step 4: Assign the reason**

In the `.map()` that builds each `LibraryBook`, set `matched` only when `q` had terms, choosing the first that applies in this exact order: `'name'` (any term in `b.title`), `'number'`, the credit map, then `'run'`. Order is from spec §4 — the narrowest true thing first, and only the credit case ever draws anything on screen.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/models-library-books.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/models/books.ts test/models-library-books.test.ts
git commit -m "feat: say why a comic turned up in a search"
```

---

### Task 3: The endpoint and the client

**Files:**
- Modify: `server/routes/books.ts:31-37` (the `/api/books` handler)
- Modify: `src/api.ts` (`ApiLibraryBook`, a new `searchLibrary`)
- Test: `test/routes-library.test.ts`

**Interfaces:**
- Consumes: `listLibraryBooks(db, { readState?, publisher?, q? })` from Tasks 1–2.
- Produces: `GET /api/books?q=&readState=&publisher=` → `{ books: ApiLibraryBook[] }`; client `api.searchLibrary({ q, readState?, publisher? }): Promise<{ books: ApiLibraryBook[] }>`.

- [ ] **Step 1: Write the failing tests**

```ts
test('GET /api/books?q= narrows the shelf to what matches')
test('q combines with readState and publisher')
  // an unread match and a read match → ?q=…&readState=unread returns one
test('GET /api/books with no q is the shelf, unchanged')
  // the regression that matters: every existing caller goes through here
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/routes-library.test.ts`
Expected: the `q` tests fail; the no-`q` test already passes.

- [ ] **Step 3: Pass `q` through the route**

Add `q?: string` to the handler's `Querystring` type and hand `req.query.q` to `listLibraryBooks`, trimmed the same way `publisher` already is.

- [ ] **Step 4: Add the client call and the type**

In `src/api.ts`: add `matched?: MatchReason` to `ApiLibraryBook` (mirroring the server type), and add `searchLibrary` beside `getLibraryBooks`. It is its own function rather than a loosened `getLibraryBooks` because that one requires `readState`, and a search starts with none.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/routes-library.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/books.ts src/api.ts test/routes-library.test.ts
git commit -m "feat: serve library search from the shelf endpoint"
```

---

### Task 4: The results page

**Files:**
- Create: `src/pages/LibrarySearch.tsx`
- Modify: `src/App.tsx` (the `/library/search` route only — the header is Task 5)
- Modify: `src/styles.css` (the matched line)
- Test: `test/LibrarySearch.test.tsx`

**Interfaces:**
- Consumes: `api.searchLibrary` from Task 3; `groupBySeries` / `groupByVolume` from `src/lib/volumeGroups.ts`; `SeriesGroupTile`, `VolumeGroupTile`, `CoverTile`; `useDocumentTitle` from `src/lib/useDocumentTitle.ts`.
- Produces: the route `/library/search?q=…`.

- [ ] **Step 1: Write the failing tests**

```ts
test('results draw on the shelves the library uses')
  // two editions sharing a shelfKey → one shelf tile, not two
test('a credit match says who and in what role')      // "written by Chris Claremont"
test('a name match says nothing extra')
test('the query comes from the url, so a reload keeps the results')
test('pressing a read-state filter puts it in the url')
test('nothing matching offers the download search, carrying the query')
  // link href === '/search?q=knull'
test('the tab is named for the search')               // document.title
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/LibrarySearch.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the page**

`export default function LibrarySearch()`. Read `q`, `status` and `publisher` from `useSearchParams` (the shelf's own pattern — `statusFrom` in `src/lib/readStatus.ts`), query with `useQuery`, group with `groupBySeries` + `groupByVolume`, render with the existing tiles. `useDocumentTitle(q || 'Search')`.

Empty state: the sentence from spec §6.4 and a `Link` to `/search?q=<q>`.

- [ ] **Step 4: Add the route**

In `src/App.tsx`, `/library/search` inside `LibraryLayout`, so the rail stands where it does on every other library page.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/LibrarySearch.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/LibrarySearch.tsx src/App.tsx src/styles.css test/LibrarySearch.test.tsx
git commit -m "feat: a page for the comics you already have"
```

---

### Task 5: The header

**Files:**
- Modify: `src/App.tsx` (`Header`, ~lines 55-67)
- Modify: `src/styles.css` (the box)
- Test: `test/App.test.tsx`

**Interfaces:**
- Consumes: the `/library/search` route from Task 4.
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing tests**

```ts
test('the header searches the library you have')
  // type 'venom', submit → url is /library/search?q=venom
test('the link to the download search says Get comics')
test('Get comics still points at /search')
  // the Find buttons depend on this route; the label moved, the route did not
test('an empty box submits nothing')
  // submitting blank leaves the url where it was
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/App.test.tsx`
Expected: FAIL — no search box, link still reads `Search`.

- [ ] **Step 3: Add the box and relabel the link**

A `<form>` with a labelled input in `Header`, navigating to `/library/search?q=…` on submit. Relabel `Search` to `Get comics`, leaving `to="/search"` untouched.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/App.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles.css test/App.test.tsx
git commit -m "feat: search the library from anywhere in it"
```

---

### Task 6: Merge gate

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: every test passes. A narrow run cannot see what `listLibraryBooks` broke two pages away, and every shelf in the app goes through it.

- [ ] **Step 2: Rebuild the container**

Run: `docker compose up -d --build`
Expected: the `comix` container up, and `curl localhost:8090/api/health` → `{"status":"ok"}`.

- [ ] **Step 3: Check it against the real library**

Search a run you own, a creator you own, and something you do not have. Confirm the shelves match the home page's, and that the empty state's link reaches Get comics with the query in the box.

- [ ] **Step 4: Stop**

The branch waits at **http://localhost:8090** for the user's verdict. A green suite is not permission to merge.
