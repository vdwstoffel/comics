# Missing-Issue Download Matching — Design Spec

**Date:** 2026-09-13
**Status:** Draft for review

## 1. Overview

An edition page already knows which issues of its Comic Vine volume are missing
from the library, and the search page already knows how to download a scraped
index row. Nothing joins the two: to fill a gap you read the issue number off
one page, type it into the other, and pick a row by eye.

This work joins them. Each missing issue is matched against the scraped index,
and where exactly one row can be the issue, the tile offers a one-press
download that lands in the edition you pressed from.

### Goals

- Match a missing Comic Vine issue to at most one scraped index row.
- Offer a one-press download only when the match is unambiguous.
- Land the download in the edition it was pressed from, matched to the right
  Comic Vine issue.
- Give every unmatched missing issue a next step that does not leave the app.

### Non-goals

- **Matching `extras`.** Those are comics you own that Comic Vine does not list.
  There is nothing to download.
- **A bulk "get all missing" button.** A wrong match downloaded one at a time is
  a nuisance; the same wrong match applied to a whole run is a mess. Per-issue
  first; revisit once the rule has been trusted in real use.
- **Improving the scraped index itself.** The rule reads what the scraper
  already stores and changes none of it.
- **Matching across series.** A missing `Venom` issue is only ever matched
  against index rows whose series key is `venom`. Offshoots
  (`All-New Venom`, `Venom Inc. Alpha`) are different series and stay out.

## 2. Evidence

Every number below was measured against the real library
(`data/library.sqlite`, 67,300 index rows, 11 editions, 32 actually-missing
issues), not estimated.

### 2.1 The rule matches all 32 missing issues, unambiguously

With the rule in §3, all 32 missing issues resolve to exactly one index row,
none to zero, none to several. All 32 were printed and checked by eye:

```
Venom (2025) #251 (cv 2026-01-01)  ->  Venom #251 (2025)
Black Cat (2025) #13 (cv 2026-10-01)  ->  Black Cat #13 (2026)
Captain America (2025) #4 (cv 2025-12-01)  ->  Captain America #4 (2025)
```

### 2.2 Cover dates lead release dates, which is why the year tolerance is ±1

Comic Vine's `cover_date` runs ahead of the release the scraper sees.
`Venom #251` has cover date 2026-01 and is listed as `Venom #251 (2025)`.
Sweeping the tolerance over the same 32 issues:

| year slack | exactly one | none | **ambiguous** |
| ---------- | ----------- | ---- | ------------- |
| ±0         | 27          | 5    | 0             |
| **±1**     | **32**      | 0    | **0**         |
| ±2         | 20          | 0    | 12            |
| unbounded  | 8           | 0    | 24            |

±0 discards five real matches. ±2 admits twelve ambiguities. ±1 is the only
value that resolves every issue without admitting a single ambiguous one.

### 2.3 Ambiguity is real, and the rule detects it

The current library contains no ambiguous case, which is a fact about this
library and not about the rule. `Venom #1` exists in the index for the 2016,
2018 and 2021 volumes. Probing a volume not owned:

```
Venom (2016) #3  ->  2 candidates: "Venom #3 (2017)" || "Venom #3 (2018)"
```

The rule returns no answer here. **This refusal is the feature.** The button's
trustworthiness rests entirely on it, so it is tested directly rather than left
to emerge.

### 2.4 Performance

Prefilter selectivity is worst for `#1`: `number='001', year=2023 ±1` pulls
2,465 rows. Across all 32 missing issues, 9,019 rows are examined in total.
Measured on a copy of the real database:

| | time for all 32 |
| --- | --- |
| no index | 148.9 ms |
| with `(number, year)` index | 31.4 ms |

One small index makes on-demand matching cheap enough that nothing derived
needs storing.

## 3. The matching rule

A missing issue and an index row are the same comic when **all four** hold:

1. `releaseKind(row.title) === 'issue'` — a bundle (`#1 – 85`) or a collection
   is not a single issue, however its number parses.
2. `row.number === parseNumber('#' + issue.number)` — both sides through the
   same normaliser, so `5`, `05` and `005` are one value.
3. `|row.year − coverYear| ≤ 1`, where `coverYear` is the year of the Comic
   Vine cover date. Both must be present; a row or issue with no year is never
   matched.
4. `seriesKey(row.title) === seriesKey(edition.cvName)` — the same normaliser
   the search page groups by, so `The Mighty Thor` and `Mighty Thor` agree while
   `All-New Venom` stays separate. Comic Vine's name for the volume is used, never
   the edition's own name, which is hand-editable and may not describe the series
   at all (`Vol 7`, `Unsorted`).

**Exactly one surviving row is a match. Zero and more than one are both
`null`.** The caller cannot distinguish "nothing found" from "too many found",
because neither licenses a download.

## 4. Components

### 4.1 `server/lib/issueMatch.ts` (new)

One pure function, no database access:

```ts
export interface MissingIssue {
  seriesKey: string
  number: string       // already normalised
  coverYear: number | null
}
export interface IndexCandidate {
  id: number
  title: string
  number: string | null
  year: number | null
}
export function matchIssue(
  candidates: IndexCandidate[],
  issue: MissingIssue,
): IndexCandidate | null
```

Purity is the point: the rule in §3 is the one thing that must not be wrong, and
a function over plain arrays can be tested exhaustively — including every
ambiguity in §2.3 — without a fixture database.

### 4.2 `GET /api/editions/:id/issues` (changed)

Each un-owned issue in the response gains:

```ts
match?: { indexId: number; title: string } | null
```

- Owned issues are not matched; the work would be discarded.
- An edition with no `cvName` skips matching entirely rather than keying off a
  hand-typed folder name.
- One prepared statement, reused across the run:
  `SELECT id, title, number, year FROM comic_index WHERE number = ? AND year BETWEEN ? AND ?`
- A row with `number IS NULL` or `year IS NULL` cannot satisfy §3 and is
  excluded by the query rather than filtered later.

### 4.3 `POST /api/editions/:id/issues/:cvIssueId/download` (new)

One request per press:

1. Load the edition; 404 if absent.
2. Find `cvIssueId` in the volume's issue list, read from the `volume_issue`
   cache **at any age** (`getCachedVolumeIssues(..., Infinity)`); 404 if it is not
   an issue of this volume. A press only ever follows a page view that populated
   this cache, so Comic Vine is not called here — and an aged list is the right
   thing to trust, since the issue number and cover date of a published issue do
   not change.
3. **Re-run the match.** 409 if it is no longer unique.
4. Resolve the index row's post page to a real download link (the existing
   `parseDownloadLink`); 404 when the post offers only mirrors, matching the
   search page's behaviour.
5. Start the existing downloader with `{ url, edition: edition.name, issueId: cvIssueId }`.
6. 202 with the download status.

### 4.3.1 Metadata comes with it, and is certain here

Passing `issueId` to the downloader drives the existing `storeComic` path, so
no new metadata handling is written:

- **Before the write**, the filename is rebuilt from the volume name and issue
  number (`comicFileName`), so the comic lands as `Venom 250.cbz` rather than
  the post's scene name. Resolved pre-write so there is no rename to unwind.
- **After ingest**, `applyIssueToBook` writes title, number, cover date, summary,
  writer, penciller, year, cover url, Comic Vine id and site url, and publisher;
  replaces the credits; stores characters, teams and story arcs as tags; and
  syncs a `ComicInfo.xml` into the cbz.

This is the only import path in the app where the Comic Vine issue identity is
**known rather than inferred**. Every other route reaches an issue id by
searching Comic Vine from a filename and choosing a match; here the id comes
from the volume's own issue list, because the press started from "this specific
issue is missing". The metadata is therefore correct by construction, and it is
the same certainty that makes §3's refusal to guess worth having.

Metadata is applied after the comic is on disk and indexed, in its own
try/catch: a Comic Vine outage costs the metadata, never the download.

**Step 3 is a safety requirement, not an optimisation.** Trusting an `indexId`
posted by the page would let a tile rendered before a scrape act on a row that
has since moved. Re-deciding server-side means the rule that showed the button
is the rule that acts, and a match that has become ambiguous in the interval
refuses instead of proceeding.

### 4.4 Frontend

- `ApiVolumeIssue` gains the optional `match` field.
- A missing tile renders one action: `↓ Get` when `match` is set, `Find ↗`
  otherwise. `Find` links to `/search?q=<series>&yearFrom=<coverYear>`, which the
  search page already accepts.
- Pending and error state sit on the pressed tile, as the search page's download
  errors already do. Progress surfaces in the existing `DownloadBar`.

## 5. Data flow

```
edition page
   │  GET /api/editions/:id/issues
   ▼
for each un-owned issue:
   SQL  number = ? AND year BETWEEN ?-1 AND ?+1     (indexed)
   JS   matchIssue(rows, issue)                     (§3)
   │
   ├── one row  ──▶ match: { indexId, title }  ──▶ tile shows  ↓ Get
   └── 0 or many ─▶ match: null                ──▶ tile shows  Find ↗

press Get
   │  POST /api/editions/:id/issues/:cvIssueId/download
   ▼
   re-match  ──▶ no longer unique ──▶ 409, nothing downloaded
   │  still unique
   ▼
   resolve post page ──▶ downloader.start({ url, edition, issueId })
   ▼
   DownloadBar reports progress; file lands in this edition
```

## 6. Safety

Three properties carry the "we have to be sure" requirement, in order of how
much weight they bear:

1. **The button only exists on a unique match** (§3). Ambiguity shows `Find`.
2. **The match is re-decided at download time** (§4.3 step 3), so a stale page
   cannot act on it.
3. **Storage never overwrites.** `dedupeDestPath` appends ` (2)` on collision,
   so even a wrong download lands beside the existing file rather than over it.
   This is existing behaviour and is relied upon, not re-implemented.

## 7. Schema

One index, no new tables and no new columns:

```sql
CREATE INDEX IF NOT EXISTS idx_comic_index_number_year
  ON comic_index(number, year);
```

Nothing derived is stored, so a match can never go stale or disagree with the
grouping the search page shows.

## 8. Testing

Weighted towards the pure matcher, which is where correctness lives.

**`matchIssue` (unit, exhaustive).** One match on a clean case; the ±1 lead in
both directions; ±2 rejected; a bundle (`Venom #1 – 85`) not matching `#1`; a
collection not matching; `005` matching `#5`; a null year on either side never
matching; `All-New Venom` not matching `venom`; `The Mighty Thor` matching
`Mighty Thor`; and the real two-candidate `Venom #3` returning `null`.

**Route — issues.** `match` set for a unique case, `null` for an ambiguous one,
absent for owned issues, and matching skipped for an edition with no `cvName`.

**Route — download.** Happy path starts the downloader with the right edition
and issue id; 409 when the match is no longer unique; 404 for an issue not in
this volume; 404 when the post has no direct link.

**Component.** `↓ Get` renders with a match and `Find ↗` without; the Find link
carries series and year; a failed press reports on its own tile.

## 9. Risks

- **The scraped year is the release year, and the tolerance is a guess tuned to
  one library.** ±1 is right for all 32 issues here, but this library is
  entirely recent Marvel. Older or reprint-heavy runs may sit further from their
  cover dates. The failure mode is a missing `Get` button, not a wrong download,
  so it degrades safely.
- **`seriesKey` is shared with the search page's grouping.** Changing it to fix
  a grouping complaint silently changes what matches here. The matcher's tests
  pin the specific behaviours it depends on so such a change fails loudly.
- **One-press downloads make it easy to fetch a lot quickly.** The per-issue
  design is deliberate; see the bulk non-goal in §1.
