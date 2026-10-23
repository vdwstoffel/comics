# Library search — Design Spec

Date: 2026-10-23

## 1. Overview

A box in the header that searches **the comics you own**, answering onto a results
page built from the same tiles and the same shelves as the library itself.

The only search Comix has today looks outward, at the scraped index of release
posts — the comics you do *not* have. Nothing answers "do I already own this?".
The shelf offers publisher, read state and arc grouping, and none of those is a
question about a title, a run or a person. At 208 comics across 41 editions that
is already a gap you feel; it does not get better.

One rule shapes the whole thing: **search answers with comics, on the shelves
they already live on.** It is a way into the library, not a second library with
its own vocabulary.

### Goals

- Find a comic you own by series, run, issue title or issue number.
- Find comics by who made them, whichever metadata source knows it.
- Results read exactly as the shelf reads: same tiles, same shelves, same read
  state, same progress.
- Reachable from every page you browse from. **Not from the reader**: that page
  shows nothing but the comic on purpose, and a header there would undo the
  thing it exists to do. Closing the comic is one press, and the run you land
  on has the box.
- Say plainly why a comic matched when the reason was not its name.
- An empty result hands the query straight to the download search.

### Non-goals

- **Characters and teams.** They are tagged on every matched comic and would be
  a natural tier-3; deliberately out, so that results never mix "comics called
  Venom" with "comics Venom is in" before the page is ready to explain it.
- **Summaries / full text.** See §2.1 — it is the one addition that would change
  the storage decision.
- Ranking, fuzzy or typo-tolerant matching, search history, a keyboard palette.
- A creator *index*. Searching "Hickman" finds his comics; this adds no page that
  lists creators to browse.

## 2. Approach

### 2.1 One query, no search index

208 books, 41 editions, 36 series. A `LIKE` scan over columns that are already
indexed is microseconds, and stays so at ten times this size.

SQLite FTS5 is the alternative and is rejected — though not for want of
precedent. This repo already runs an external-content FTS5 table with three sync
triggers over `comic_index` (`server/db.ts:163-174`), so the pattern is known
here and the cost of adopting it again is lower than a first use would be.

It is rejected for what it would buy, not what it would cost. At this size the
`LIKE` scan is already instant, and an index over names is a second source of
truth that can silently disagree with a renamed edition. FTS earns its keep
against summaries, not against names — so if summaries ever join §3.1, FTS is
the upgrade, and nothing in §5 changes shape when it happens.

Filtering client-side off the loaded shelf is also rejected: it cannot see
credits at all, and can only search whatever the current filter happened to
load.

### 2.2 Search is a parameter on the shelf query, not a second query

This is the decision the rest of the spec rests on.

A comic's place in the library is no longer its edition. `listLibraryBooks`
decorates every row with `shelfKey`, `shelfName` and `shelfVolumeId`, computed
by `groupIntoShelves` **over the whole library** — which is what makes thirteen
trades of one run, filed by Comic Vine under three collected-edition volumes,
draw as one shelf instead of three.

A search endpoint with its own `SELECT` would have to reproduce that, plus arcs,
plus read state, and would drift from it the first time the shelf rule changed
again. It changed twice this month.

So: `listLibraryBooks` gains an optional `q`, and search is the shelf query with
one more clause. Everything downstream — shelves, arcs, grouping, tiles — is
inherited rather than rebuilt.

## 3. What matches

### 3.1 The fields

| Source | Column | Finds |
| --- | --- | --- |
| Run | `edition.name` | the run as you named it |
| Run | `edition.series_name` | every run of a series |
| Run | `edition.cv_name` | Comic Vine's name for it |
| Run | `edition.collects_cv_name` | **the volume a collected edition collects** |
| Issue | `book.title` | a named issue or one-shot |
| Issue | `book.number` | see §3.3 |
| Creator | `book.writer`, `book.penciller` | credits from `ComicInfo.xml` |
| Creator | `book_credit.name` | credits from Comic Vine (indexed on `name`) |

### 3.2 Creators live in two places, so both are searched

A comic matched against Comic Vine has `book_credit` rows carrying name and
role. A comic that only ever arrived with a `ComicInfo.xml` has the two
denormalised columns on `book` and no credit rows at all.

Searching one source would make a result depend on a comic's import history
rather than on its credits — the same creator found on one comic and missed on
the one beside it, for a reason nothing on screen could explain.

**Any credit role matches, not only writer and penciller.** Restricting it would
mean "zdarsky" missing a book he drew the cover for, which reads as a bug. The
matched row names the role, so nothing is mysterious. (This is a deliberate
widening of the agreed tier; narrowing it is a one-line change to the role
filter.)

### 3.3 The rules

- **Case-insensitive substring.** `venom` matches *Venomverse*.
- **Multi-word is AND.** Every term must match somewhere in that comic's
  searchable text, so `hickman xmen` narrows rather than widens. Terms may match
  different fields — one the creator, one the run.
- **An all-digits query also matches `book.number` exactly.** `251` finds issue
  251 rather than every issue whose title contains "251". It still matches text
  elsewhere, so a run called *2000 AD* is not lost to this rule.

### 3.4 A matching run brings its comics

When an edition matches on any of its own fields, every comic in it is a result,
including the ones whose own fields match nothing. Searching a run's name and
getting back three of its forty issues — the three with the word in their title
— would be a worse answer than the one the shelf already gives.

This falls out of §2.2 for free: the clause is an `OR` across the joined edition,
and the join is already there.

## 4. Why a comic matched

Each returned comic carries `matched`:

| Value | Shown as |
| --- | --- |
| `'name'` | nothing — the tile already says it |
| `'number'` | nothing |
| `{ role, name }` | "written by Jonathan Hickman", "cover by Chip Zdarsky" |
| `'run'` | nothing — nothing on the comic itself matched; it came in with its edition (§3.4), and the shelf heading above it is the explanation |

A comic matching on more than one of these takes the first that applies, in the
order above: the narrowest true thing first. `'run'` is last because it is the
fallback — it says only that the match was not on this comic — and ranking it
above a credit would suppress the one reason that ever draws anything.

Computed in TypeScript from the row and the credit map, not in SQL. The row
already carries every text field, and the credit map must be fetched anyway (the
same pattern `arcsByBook` uses) — so asking SQL to also report which clause fired
would complicate the query to produce something already derivable.

## 5. API

The existing shelf route gains one parameter.

```
GET /api/books?q=<text>&readState=<unread|read>&publisher=<name>
→ { books: ApiLibraryBook[] }
```

`ApiLibraryBook` gains an optional `matched` (§4) and is otherwise untouched, so
the search page and the shelf consume the identical shape. It is present only on
an answer to a `q`; a shelf call returns rows without it, which is what keeps
this additive for every existing caller.

A new `/api/library/search` was considered and rejected: it would answer the same
question with the same payload, and the two would have to be kept honest about
shelves and arcs forever. `q` is absent for the shelf and present for the search;
that is the whole difference.

## 6. The page and the header

### 6.1 The route

`/library/search?q=…`, with the query in the url so it survives a refresh, can be
linked, and can be carried into a filter — the same reason the shelf keeps its
`?status=` and `?group=` there.

### 6.2 Rendering

Results feed straight into `groupBySeries` and `groupByVolume` and render with
`SeriesGroupTile`, `VolumeGroupTile` and `CoverTile`. No new rendering
primitives, and a collapsed shelf collapses here exactly as it does on the shelf.

Read-state and publisher filters are offered, **unfiltered by default** — a
search is a question about the whole library, so narrowing it is something you
ask for rather than something you inherit.

### 6.3 The header

A search box, and the existing `Search` link relabelled **Get comics**.

**The route `/search` does not change.** The Find buttons on the edition and
releases pages build `/search?q=…&yearFrom=…` and must keep working; this is a
label, not a move.

### 6.4 Empty

> Nothing in your library matches "knull".
> **Look for it in Get comics →**

The link carries `q`, which joins the two searches at the one moment the join is
useful: you looked for a comic you thought you had, and you do not have it.

## 7. Limits this accepts

- **No ranking.** Results arrive in shelf order. With a library this size, a
  relevance score would be a lot of machinery to reorder a dozen tiles.
- **Credits exist only where metadata does.** A comic never matched and carrying
  no `ComicInfo.xml` is findable by name alone, and nothing on the page says so.
- **Substring matching is literal.** `man` matches *Spider-Man*. Accepted: the
  corpus is small enough that a loose match is a short list, not a flood.
- **An edition holding no comics cannot appear**, since the answer is a list of
  comics. Only reachable by deleting every issue of a run but not the run.

## 8. Testing

**Model** (`listLibraryBooks` with `q`) owns the rules: case-insensitivity,
multi-word AND across different fields, the all-digits number rule, a creator
found via `book.writer`, the same creator found via `book_credit` on a comic that
has no denormalised columns, a non-writer credit role matching, a run matching by
`collects_cv_name`, and a matching edition returning comics that do not match
themselves.

**Route**: `q` combines with `readState` and `publisher`; absent `q` returns the
shelf unchanged (the regression that matters — every existing shelf call goes
through this function).

**Page**: results group onto shelves, the `matched` line renders for a credit hit
and not for a name hit, the empty state carries `q` into `/search`, and a filter
press survives in the url.

## 9. Files

| File | Change |
| --- | --- |
| `server/models/books.ts` | `q` on `listLibraryBooks`; credit-match map |
| `server/routes/books.ts` | pass `q` through |
| `src/api.ts` | `q` param, `matched` on `ApiLibraryBook` |
| `src/pages/LibrarySearch.tsx` | new |
| `src/App.tsx` | route, header box, `Search` → `Get comics` |
| `src/styles.css` | header box, the matched line |
| `test/models-library-books.test.ts` | §8 model cases |
| `test/LibrarySearch.test.tsx` | new |
