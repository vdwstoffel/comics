# Comic Vine Naming and Nested Storage — Design Spec

**Date:** 2026-09-03
**Status:** Draft for review

## 1. Overview

Editions are named by hand today. The library holds `Vol 7` (23 Amazing
Spider-Man issues), `2025` (one Venom issue) and `Unsorted` — three different
naming conventions arrived at by three different guesses. Comic Vine knows what
these runs are actually called, so this work makes Comic Vine the source of
truth for edition names, and reorganises storage from a flat folder list into
`series/volume`.

### Goals

- Derive an edition's canonical name from its Comic Vine volume: `The Amazing
  Spider-Man (2025)`.
- Suggest that name on the edition page; never apply it without a click.
- Store files as `<series>/<volume>/` instead of one flat level.
- Keep a series sorting under its first significant word, so `The Amazing
  Spider-Man` stays under **A**.
- Migrate the existing library into the new layout via an explicit, dry-runnable
  action.

### Non-goals

- Deriving a volume ordinal ("Vol 7"). Comic Vine has no such field; it can only
  be inferred by sorting a title's volumes by start year and discarding
  one-shots, which was verified to work for Amazing Spider-Man and Venom but
  rests on an issue-count threshold that would silently mis-number any genuinely
  short run. The year is real data and needs no inference. See §9.
- Renaming automatically on match. A wrong Comic Vine match would relocate files
  with no one watching.
- A second metadata source (Metron stores volume numbers natively but needs its
  own credentials and has thinner recent-Marvel coverage).

## 2. Background: two invariants this work changes

**Edition names are a globally unique namespace.** `edition.name` is `UNIQUE`
and `renameEdition` treats a collision as a *merge* — books are moved into the
existing edition's folder. Naming editions by bare year would therefore sweep
every 2025 series into one folder. `Series (Year)` is unique by construction,
which removes the trap rather than working around it.

**A rename deliberately preserves the old series name.** `renameEdition`
recreates the edition row and restores `carryableMetadata`, which includes
`series_name`; the comment at `server/models/editions.ts:150-155` records that
this was added because series names had been lost. So a rename alone cannot
change the series — see §4 for how the two are applied together.

## 3. Comic Vine volume data

`getVolume` already runs on every issue match, to read the publisher. Its
response carries `name` and `start_year`; neither is currently mapped.

| Change | Where |
|--------|-------|
| Map `startYear` onto `CvVolume` | `server/lib/comicvine.ts` |
| `cv_name TEXT`, `cv_start_year INTEGER` on `edition` | `server/db.ts`, additive `ALTER TABLE` per the pattern at line 139 |
| Write both, plus `comicvine_id` when empty | `server/routes/comicvine.ts:50-55`, the block that already propagates publisher |

No additional Comic Vine requests.

### Backfill

Books already matched will not re-trigger a volume fetch, so both existing
editions would sit with a null year forever. `POST /api/editions/:id/comicvine-volume`
walks to the first book in the edition carrying a `comicvine_id`, resolves its
volume once, and stores name + year + publisher. Surfaced as a "Check Comic
Vine" button on the edition page.

If no book in the edition carries a `comicvine_id`, the route reports that
nothing is matched yet rather than erroring — the edition simply has no
suggestion to offer until a book is matched.

## 4. Applying the suggestion

The suggested name is `${cv_name} (${cv_start_year})` and the suggested series
is `${cv_name}` — Comic Vine's name verbatim, including a leading article.

The edition page shows the suggestion when `cv_start_year` is set and the
current name differs. The button issues one request:

```
PATCH /api/editions/:id
{ "name": "The Amazing Spider-Man (2025)", "seriesName": "The Amazing Spider-Man" }
```

The existing handler applies `seriesName` first and renames second
(`server/routes/editions.ts:54-61`), so the rename carries the new series name
forward instead of restoring the old one. No new rename machinery.

**Merge wording.** If an edition with the suggested name already exists, the
same click performs a merge, not a rename. The button must say "Merge into <name>"
in that case. Presenting a merge as a rename is how a folder full of issues ends
up somewhere unexpected.

## 5. Nested storage

### The invariant

`edition.folder` changes from a single segment to a relative path:

```
folder = sanitizeSegment(seriesName) + "/" + sanitizeSegment(name)
```

When `series_name` is null — the column is nullable, and a scanned loose folder
may produce one — the folder is the single segment `sanitizeSegment(name)`, which
is exactly today's layout. `Unsorted` therefore stays where it is.

`book.file_path` is already stored relative to `comicsDir`
(`server/services/indexer.ts:75`) and every consumer joins it back onto
`comicsDir`, so multi-segment paths flow through unchanged.

```
data/comics/
  The Amazing Spider-Man/
    The Amazing Spider-Man (2025)/
      ASM 001.cbz
  Venom/
    Venom (2025)/
      Venom 001.cbz
  Unsorted/
    loose-issue.cbz
```

The leaf repeats the series name so each folder is self-describing when copied
out on its own, and so `folder`'s leaf stays identical to `name`.

### Sanitising

`sanitizeEditionFolder` currently collapses `/` to `_` specifically to force one
segment. It becomes a per-segment sanitise joined by the separator, retaining
the `/` and `..` collapsing *within* each segment. This is load-bearing: the
library contains a series named `Amazing Spider-Man/Venom`, which must remain a
single folder named `Amazing Spider-Man_Venom` rather than becoming a nesting
level.

### Scanning

`server/services/indexer.ts:78` derives the edition name from
`basename(dirname(absPath))`. It becomes: take the path relative to `comicsDir`;
two or more segments mean series + edition (deepest two), one segment means a
series-less edition. A loose `Unsorted/` therefore keeps working.

### Pruning

`pruneEditionIfEmpty` (`server/services/library.ts:68-70`) rmdirs the edition
folder and swallows ENOTEMPTY. It gains one step: attempt the parent series
folder afterwards, with the same tolerance. `resolveInsideComicsDir` already
guards traversal and needs no change.

## 6. Series sorting

`server/models/series.ts:54` sorts by `localeCompare`, which files `The Amazing
Spider-Man` under **T**. Sorting compares the name with a leading `The `, `A ` or
`An ` stripped, falling back to the full name when two names tie. Comic Vine's
exact name is still what gets stored and displayed; only the sort key changes.

## 7. Migration

An explicit action, not a startup task. Bulk file moves at boot happen with
nobody watching, and a half-completed one is discovered at the worst moment.

**Dry run** reports, per book, its current path and its target path, plus any
collision — and writes nothing.

**Execute** processes one book at a time: move the file, then update
`file_path`. That order means a crash leaves files moved and rows stale, rather
than rows pointing at files that are gone. Re-running is idempotent: a book
already at its target path is skipped, so an interrupted run is completed by
running it again.

Empty flat folders are pruned at the end.

Scale at time of writing: 3 series, 3 editions, 26 books.

**Before executing against the real library, copy `data/`.** The dry run shows
intent; the copy is what makes a bad outcome recoverable.

## 8. Testing

Written test-first, per the project's workflow.

| Area | Test |
|------|------|
| `getVolume` | maps `start_year` to `startYear` |
| Edition model | `cv_name` / `cv_start_year` round-trip |
| CV match route | records volume id, name and start year on the edition |
| Backfill route | resolves the volume from an already-matched book |
| Series derivation | `deriveSeriesName('The Amazing Spider-Man (2025)')` → `The Amazing Spider-Man` |
| Folder path | `Amazing Spider-Man/Venom` sanitises to one segment, not two |
| Scanner | a two-segment path yields series + edition; one segment yields a series-less edition |
| Prune | an emptied series folder is removed; a series folder with other editions is kept |
| Sort | `The Amazing Spider-Man` sorts before `Batman` |
| Migration | dry run writes nothing; execute is idempotent on a second run |
| UI | suggestion renders, hides once the name matches, says "Merge into" when the target exists |

## 9. Appendix: why not a volume ordinal

Comic Vine volumes carry a name, a start year and a publisher — no ordinal. The
ordinal can be inferred by fetching every volume whose name matches, keeping
exact-name matches from the same publisher, dropping volumes under ~5 issues,
and sorting by start year. Verified against both known cases:

| Title | Derived sequence | Result |
|-------|------------------|--------|
| Amazing Spider-Man | 1963, 1999, 2014, 2015, 2018, 2022, **2025** | vol 7 ✓ |
| Venom | 2003, 2011, 2017, 2018, 2022, **2025** | vol 6 ✓ |

Without the issue-count filter Amazing Spider-Man yields vol 10 — a 1979
one-shot, a 1982 one-shot and a 2-issue 2016 entry all share the exact title.
That threshold is a guess that happened to fit twice; a genuinely short run
would be dropped and shift every later volume by one. It also costs three paged
requests per title. The start year needs none of this, which is why it wins.
