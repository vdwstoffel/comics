# Latest Releases Tab — Design Spec

**Date:** 2026-09-14
**Status:** Draft for review

## 1. Overview

The library answers "what do I have". Nothing answers "what came out". Finding
this week's Marvel and DC issues means leaving the app for Comic Vine's site,
and bringing one back means reading its name off that page and typing it into
the search page.

This work adds a `Latest` tab: the most recent Wednesday's Marvel and DC
releases, as a grid of covers, with the issues you already own marked and the
ones you don't offering the same one-press download an edition page offers.

### Goals

- Show every Marvel and DC issue that went on sale on the most recent Wednesday.
- Cost nothing on a second visit: a release day is fetched once and read from
  the database forever after.
- Mark the issues already in the library and link them to the book.
- Offer one-press download for the rest, reusing the existing matcher and
  downloader unchanged.

### Non-goals

- **Browsing back through earlier weeks.** One day, the latest one. A history
  view is a bigger question about pagination and cost; the day cache is built so
  that adding it later costs a route parameter, not a redesign.
- **Publishers other than Marvel and DC.** The feed is dominated by manga
  (§2.3); two publishers is what makes the page readable. Widening it later
  means refetching the days already cached, at two calls each.
- **A solicitation calendar.** Comic Vine lists no future-dated issues for the
  volumes measured (§2.4), so "what's coming" is not answerable from this data.
- **Read state on the tiles.** An arc page carries read badges because it is a
  reading list. This is a shop window; `owned` is the only signal it needs.
- **A bulk "get everything new" button.** Inherited from the missing-issue
  spec's reasoning: a wrong match one at a time is a nuisance, the same wrong
  match across a whole Wednesday is a mess.

## 2. Evidence

Every number below was measured against the live Comic Vine API on 2026-09-14,
not estimated.

### 2.1 A release day is one query, and it is Wednesday

`GET /issues/?filter=store_date:2026-09-09|2026-09-09` returns 116 issues. Days
either side of it are a fraction of that:

| on-sale day | issues |
| ----------- | ------ |
| 2026-09-07 (Mon) | 16 |
| 2026-09-08 (Tue) | 36 |
| **2026-09-09 (Wed)** | **116** |
| 2026-09-10 (Thu) | 15 |
| 2026-09-11 (Fri) | 22 |
| 2026-09-12 (Sat) | 0 |
| 2026-09-13 (Sun) | 0 |
| 2026-09-14 (Mon) | 1 |

Wednesday is new comic day, so the day is computed rather than searched for.

### 2.2 Paging a date *range* is unstable; a single day is not

Pulling 2026-09-01..2026-09-14 with `sort=store_date:desc` at `limit=100` and
offsets 0/100/200 returned 300 rows containing only **274 unique ids** — 23 rows
repeated between the first two pages and 3 between the next two. Rows sharing a
`store_date` have no deterministic tiebreak, so the window shifts under the
offset. Adding `sort=store_date:desc,id:desc` removed the overlap but stopped
ordering by date at all.

Querying one day at a time sidesteps this: a day fits in one or two pages and
the total is exact. This is why §3 fetches by day rather than by range.

### 2.3 Marvel and DC are a thin slice of the feed

Distinct volumes released 2026-09-07..14, by publisher:

| publisher | volumes |
| --------- | ------- |
| Kodansha | 30 |
| **Marvel** | **16** |
| Shogakukan | 15 |
| Akita Shoten | 15 |
| Square Enix | 13 |
| Image | 12 |
| **DC Comics** | **10** |
| IDW Publishing | 10 |

26 of that week's 206 unique issues were Marvel or DC. On 2026-09-09 alone:
22 issues — 12 Marvel, 10 DC.

### 2.4 Publisher requires a second lookup; covers do not

An issue record carries a `volume` stub of `{id, name}` and no publisher, and
`/issues/` has no publisher filter. `/volumes/?filter=id:a|b|c&field_list=id,publisher`
resolves them 100 at a time and was verified to return `Marvel`, `DC Comics`,
`Shogakukan` for the expected volumes.

Cover art needs no extra call: `image.small_url` comes back on the same
`/issues/` request that lists the day.

No issue in the eleven volumes measured carries a future `store_date`, which is
the basis for the solicitation-calendar non-goal in §1.

### 2.5 Cost

One uncached Wednesday: 2 `/issues/` pages (116 issues, and Comic Vine caps a
list response at 100) plus 2 `/volumes/` batches for that day's 116 distinct
volumes — **4 calls**, about 4 seconds at the client's one-call-per-second
throttle, against a budget of 200 calls an hour. Cached: **zero**.

## 3. The rule

**The day.** `mostRecentWednesday(now)` — today if today is Wednesday,
otherwise the Wednesday before. A pure function of the clock; no request.

**The fallback.** If that Wednesday yields no Marvel or DC issues, fall back
once to the previous Wednesday and use that. This covers an early-Wednesday
visit before Comic Vine has been updated, and costs one extra day fetch on a
cold cache only. It does not recurse: two empty Wednesdays report empty.

**The filter.** An issue is kept when its volume's publisher is exactly `Marvel`
or `DC Comics`. Nothing else is stored.

**Freshness.** A Wednesday in the past does not change, so it is cached
permanently. The current day is still filling in — an early-morning visit can
catch three issues of an eventual twenty, and the fallback above will not save
it because three is not zero — so a cached copy of *today* is refetched once it
is more than six hours old. `?refresh=1` forces either.

## 4. Components

### 4.1 `server/lib/releaseDay.ts` (new)

```ts
export function mostRecentWednesday(now: Date): string   // 'YYYY-MM-DD'
export function previousWednesday(day: string): string
```

Date arithmetic only, no I/O, no Comic Vine. Dates are handled as `YYYY-MM-DD`
strings throughout — Comic Vine's `store_date` is a plain date with no timezone,
and treating it as an instant would shift it across a day boundary.

### 4.2 `server/lib/comicvine.ts` (changed)

Two methods on `ComicVineClient`:

```ts
listIssuesOnSale(day: string): Promise<CvReleaseIssue[]>
getVolumePublishers(ids: number[]): Promise<Map<number, string | undefined>>
```

`listIssuesOnSale` pages `/issues/?filter=store_date:D|D` at `LIST_PAGE` per
request until the total is read, exactly as `listVolumeIssues` does, with
`field_list=id,issue_number,name,cover_date,store_date,image,site_detail_url,volume`.

`getVolumePublishers` batches `/volumes/?filter=id:a|b|c&field_list=id,publisher`
100 ids per request.

**Shared chunking.** `getStoryArc`'s `issueDetails` helper already batches ids
100 at a time; `getVolumePublishers` is the same shape. Extract the chunking
into one private helper and have both call it, rather than write a third copy.
The helper keeps the existing swallow-and-continue behaviour: a failed chunk
loses its rows, not the whole call.

### 4.3 `server/models/releases.ts` (new)

```ts
getCachedRelease(db, day, maxAgeMs): { issues: ReleaseIssue[], fetchedAt: string } | null
cacheRelease(db, day, issues: ReleaseIssue[], fetchedAt: string): void
```

The route passes `Infinity` as `maxAgeMs` for a day earlier than today and six
hours for today (§3), so the freshness rule lives at the route and the model
answers only for what it holds.

`getCachedRelease` returns `null` when the day was never fetched and an empty
`issues` array when it was fetched and held nothing — the distinction
`release_day` exists to preserve (§7).

### 4.4 `GET /api/releases` (new)

Query: `?refresh=1` to bypass the cache.

```jsonc
{
  "day": "2026-09-09",
  "fetchedAt": "2026-09-14T21:04:00.000Z",
  "stale": false,
  "publishers": [
    { "name": "Marvel", "issues": [ /* … */ ] },
    { "name": "DC Comics", "issues": [ /* … */ ] }
  ]
}
```

An issue:

```jsonc
{
  "id": 1192026, "number": "14", "name": null,
  "volumeId": 176900, "volumeName": "Black Cat",
  "coverUrl": "https://comicvine.gamespot.com/a/uploads/scale_small/…",
  "siteUrl": "https://comicvine.gamespot.com/…",
  "owned": true, "bookId": 79
  // `match` is absent here: it is computed only for issues you do not own, and
  // is null when no single index row can be the issue
}
```

Sections are Marvel then DC, fixed. Within a section, issues sort by volume name
then issue number — the same numeric-then-text comparison `listVolumeIssues`
uses, so `#10` does not sort between `#1` and `#2`.

Owned is `ownedIssueIds(db)` from `server/models/arcs.ts`, unchanged: an exact
Comic Vine id match on both sides. `match` is `findMatchForIssue(db, volumeName, issue)`
from `server/services/issueMatching.ts`, unchanged — it keys on volume name,
issue number and cover year, and needs no edition. It is computed only for
issues that are not owned, as the editions route already does.

Returns 400 when no Comic Vine API key is configured, matching `/api/arcs/:name`.

### 4.5 `POST /api/downloads` (unchanged)

The page posts `{ url, edition: volumeName, issueId: cvIssueId }`. No route
change is needed: `edition` is already optional, and `storeComic` resolves an
edition *name* to an existing edition or derives a folder for a new one.

**Consequence, accepted deliberately.** Until now a one-press download only ever
filled a gap in an edition the library already had. From this page it can create
an edition, because the tab shows series you do not own. Passing Comic Vine's
volume name rather than a free-text string is what keeps that predictable: the
new edition is named exactly as the volume is.

### 4.6 `src/components/MissingIssueTile.tsx` (new, extracted)

The cover tile, `↓ Get` button, `Find ↗` link and per-tile error line currently
live inline in `src/pages/Edition.tsx`. The releases page needs exactly that
tile. Lift it into a component taking the issue, its label, the series name for
the Find link, and the download action; both pages render it.

`Edition.tsx` changes to use it, so its existing tests come along unchanged —
they are the proof the extraction did not alter behaviour.

### 4.7 `src/pages/Releases.tsx` (new)

Rendered in `Layout`, not `LibraryLayout`: the rail's publisher and status
filters filter the library, and mean nothing on a page that is not the library.

Heading is `Latest releases` with the day written out (`Wednesday 9 September
2026`). Two sections, each a `tile-grid` of `MissingIssueTile`.

**Covers are shown here, and this is an exception.** `Arc.tsx` deliberately
hides art for an issue you do not own — a cover is a spoiler for a comic you
have not read. Every issue on a releases page is one you do not own, so applying
that rule would blank the entire page, and a shop window with no art is not a
shop window. The exception is stated in a comment at the point it is taken, with
this reason.

### 4.8 `src/App.tsx` (changed)

`Latest` joins `Search` and `+ Upload` in `Header`, routed to `/releases`.

## 5. Data flow

The fallback sits *outside* `resolve`, so a day cached as empty falls back just
as an empty fetch does. It runs at most once: two empty Wednesdays report empty.

```
resolve(day)
  ├─ cached := getCachedRelease(db, day, maxAge)   [skipped if ?refresh=1]
  │    └─ hit → return it
  └─ miss
       ├─ issues     := cv.listIssuesOnSale(day)              ~2 calls
       ├─ publishers := cv.getVolumePublishers(distinct vols) ~2 calls
       ├─ kept       := issues whose publisher is Marvel / DC Comics
       ├─ cacheRelease(db, day, kept, now)  -- only if listIssuesOnSale succeeded
       └─ return kept

GET /api/releases
  ├─ day    := mostRecentWednesday(now)
  ├─ issues := resolve(day)
  ├─ if issues is empty: day := previousWednesday(day); issues := resolve(day)
  └─ per issue:
       owned := ownedIssueIds(db).get(issue.id)
       match := owned ? undefined : findMatchForIssue(db, volumeName, issue)
```

## 6. Safety and failure

- **Comic Vine unreachable, day cached** → serve the cached day with
  `stale: true`. Mirrors `/api/editions/:id/issues`.
- **Comic Vine unreachable, nothing cached** → `unavailable: true` and an empty
  `publishers`; the page says so rather than erroring.
- **A publisher batch fails** → those volumes have no publisher, so they fail
  the filter and drop out. Only what was learned is written, so they are asked
  for again on the next uncached fetch.
- **`fetched_at` is written only when the `/issues/` call succeeded.** A partial
  publisher read must not mark the day done.
- **No API key** → 400, and the tab reports it. No blank page.

## 7. Schema

```sql
-- The release days we have asked Comic Vine about. Separate from the issues for
-- the reason volume_cache is separate: a Wednesday we hold no issues for still
-- has to record that we asked, or "no rows" and "never asked" are the same thing
-- and it refetches forever. Filtering to two publishers makes an empty day a
-- normal outcome rather than a rare one, so this matters more here, not less.
CREATE TABLE IF NOT EXISTS release_day (
  day        TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL
);

-- Marvel and DC issues only. The publisher is carried on the row rather than
-- joined from the volume, so reading a day is one query: there is no separate
-- publisher table, because with a day cached forever it would save about one
-- request a week.
CREATE TABLE IF NOT EXISTS release_issue (
  day         TEXT NOT NULL,
  cv_issue_id INTEGER NOT NULL,
  publisher   TEXT NOT NULL,
  volume_id   INTEGER NOT NULL,
  volume_name TEXT,
  number      TEXT,
  name        TEXT,
  cover_date  TEXT,
  cover_url   TEXT,
  site_url    TEXT,
  PRIMARY KEY (day, cv_issue_id)
);
```

## 8. Testing

**`mostRecentWednesday`.** A table of dates: each weekday of one week mapping to
the same Wednesday; a Wednesday mapping to itself; a month boundary; a year
boundary. `previousWednesday` steps back exactly seven days.

**Client — `listIssuesOnSale`.** Pages a 116-issue day into two requests and
returns all 116; sends `filter=store_date:D|D` with the day on both sides;
requests `image` in the field list, because covers depend on it.

**Client — `getVolumePublishers`.** Batches 150 ids into two requests of 100 and
50; maps each id to its publisher; a volume Comic Vine gives no publisher for
maps to `undefined` rather than being dropped.

**Client — shared chunking.** `getStoryArc`'s existing tests stay green, which
is the proof the extraction changed nothing.

**Model.** A cached day round-trips. A day fetched with zero issues returns an
empty array, *not* `null` — the regression that would refetch forever. A day
never fetched returns `null`. `maxAgeMs` expires a day, and `Infinity` never
does — a past Wednesday is not refetched without `?refresh=1`.

**Route.** Filters to Marvel and DC and drops everything else; groups Marvel
before DC; sorts `#10` after `#9` within a section; marks an owned issue with
its `bookId`; computes `match` only for unowned issues; falls back to the
previous Wednesday when the latest holds nothing — including when the latest is
*cached* as empty, not only when it fetches empty — and does not recurse past
one fallback; `?refresh=1` refetches; serves a cached day with `stale: true` when
Comic Vine fails; reports `unavailable` when it fails with nothing cached; 400
with no API key.

**Component — `MissingIssueTile`.** `↓ Get` renders with a match, `Find ↗`
without; a failed press reports on its own tile. Edition's existing tests pass
unchanged.

**Page.** Both publisher sections render; covers are present (the §4.7
exception, pinned by a test so a later tidy-up cannot silently reinstate the
spoiler rule); an owned issue links to `/book/:id`; the day is written out in
the heading.

## 9. Risks

- **Wednesday is a US direct-market convention, not a Comic Vine field.** A
  holiday week that ships Tuesday would show empty and fall back a week. The
  measured week supports the rule; a year of data would support it better. The
  failure mode is an older day shown, not a wrong one.
- **`'Marvel'` and `'DC Comics'` are matched as exact publisher strings.** Comic
  Vine renaming a publisher, or crediting an imprint separately, silently empties
  a section. Worth an eye on the first few weeks of real use.
- **Cover images are hotlinked from Comic Vine**, as the arc page already does.
  If they rate-limit or move them, tiles lose art. Nothing else breaks.
- **The one-press download can now create an edition** (§4.5). That is the
  intended behaviour, but it is a genuine widening of what the button did
  before, and a mis-press now leaves a new edition behind rather than a stray
  file in an existing one.
