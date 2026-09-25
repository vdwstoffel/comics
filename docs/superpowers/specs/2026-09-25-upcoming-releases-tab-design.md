# Upcoming Releases Tab — Design Spec

Date: 2026-09-25

## 1. Overview

A third tab on the Releases page showing what Marvel is publishing over the
coming weeks: one continuous scroll of future Wednesdays, single issues only,
cover art and title, no download action.

The data does not come from Comic Vine. It cannot: §3.1 shows Comic Vine holds
no future-dated issues at all. It comes from Marvel's own release calendar,
which is server-rendered and carries roughly two months of solicitations.

Everything in this design follows from one property of the data: **an upcoming
week is a solicitation, not a fact.** Dates slip and issues get cancelled, so
nothing here is ever cached permanently — which is the sharpest departure from
the Latest tab, where a past Wednesday is settled forever.

### Goals

- See what is coming in the weeks ahead, by week, with covers.
- Work on a fresh install with no Comic Vine key entered, as the Currently
  Running tab does.
- Keep the page cheap to revisit: a cold load costs one request per week, every
  load inside the cache window costs none.
- Leave DC a seat at the table so a source found later is a source module, not
  a redesign.

### Non-goals

- **DC.** No usable source exists today (§3.4). DC keeps its publisher tab and
  says so inside it, which is not the same as showing an empty week list.
- **Collected editions and variants.** Marvel separates both, so excluding them
  is a filter rather than work. The library is built around single issues.
- **A Get button.** There is nothing to download; the comic does not exist yet.
  This tab is a calendar, not a shop window.
- **Matching against your library.** Flagging "a series you already collect"
  is the most valuable thing this page could eventually do and the one most
  able to be wrong. It needs its own design, not a corner of this one.
- **Notifications or a release reminder.** Nothing here pushes.

## 2. Why Marvel's own calendar

Comic Vine is the app's metadata source everywhere else, and it is the wrong
source here — not by preference but by construction. It is a retroactive
database: volunteers catalogue issues once they exist. §3.1 measures this.

Of the sources that do carry solicitations:

- **PreviewsWorld**, the historical answer, is gone. `previewsworld.com` now
  redirects to `enescobusiness.com/diamond`; Diamond's bankruptcy took the
  public catalog with it.
- **ComicList** refuses connections from this machine. Unverifiable here.
- **Metron** is alive and has the right query vocabulary, but requires an
  account, and whether it holds future store dates could not be checked
  without credentials.
- **Marvel's own calendar** is server-rendered, needs no key, and answers
  completely when asked one week at a time (§3.2).

Marvel it is, with the honest consequence that the tab covers one of the two
publishers the rest of the page covers.

## 3. Evidence

Every number below was measured against the live sources on 2026-09-25.

### 3.1 Comic Vine holds no future releases

The existing spec called this a non-goal on the basis of eleven volumes. It is
worth restating on stronger evidence, because it is the reason this tab needs a
second source at all:

| check | result |
| ----- | ------ |
| next 8 Wednesdays, `store_date` per day | 0 issues, every one (2026-09-23 returned 88) |
| `store_date` range now → 2027-03-01 | 1 issue total |
| furthest-future `store_date` in the database | 2026-10-06, plus an obvious 2057 typo |
| 20 most recently *added* issues | 0 with a future date; recent additions were 1961 back-catalogue |

`cover_date` is a trap worth naming: 320 issues carry a future cover date, but
their `store_date` values are all in the past. Cover dates run ahead of shelf
dates by convention, so a future cover date means "already out" — close to the
opposite of what this tab needs.

### 3.2 Marvel answers completely when asked one week at a time

`marvel.com/comics/calendar?dateStart=&dateEnd=&tab=comic&variants=false` is
server-rendered HTML with a JSON payload embedded in it. No JavaScript
execution, no key, no account.

A five-week range paginates — `allComicsReleases` reported `total: 75` while
returning 35 entries, newest first. A one-week range does not:

| week queried | total | returned | complete |
| ------------ | ----- | -------- | -------- |
| 2026-09-27..10-03 | 18 | 18 | yes |
| 2026-10-04..10-10 | 3 | 3 | yes |
| 2026-10-11..10-17 | 19 | 19 | yes |
| 2026-10-18..10-24 | 15 | 15 | yes |
| 2026-10-25..10-31 | 20 | 20 | yes |

Every issue in every week carried the week's Wednesday as its `releaseDate`.
This is the same reasoning §2.2 of the Latest tab spec used for Comic Vine:
one day at a time sidesteps unstable paging, and the total is exact.

### 3.3 The horizon is about nine weeks, and it moves

Walking Wednesdays forward from 2026-09-30:

| Wednesday | issues |
| --------- | ------ |
| 09-30 | 18 |
| 10-07 | 3 |
| 10-14 | 19 |
| 10-21 | 15 |
| 10-28 | 20 |
| 11-04 | 12 |
| 11-11 | 15 |
| 11-18 | 16 |
| 11-25 | 15 |
| 12-02 onward | 0 |

Solid data for nine weeks, then nothing. The boundary rolls forward as new
solicitations drop, so the design must treat "data runs out here" as a normal
state rather than a failure.

The 3-issue week matters more than it looks: it proves a *small* week is real,
so "few issues" can never be used as a signal that the parser has broken.

### 3.4 DC exposes no future view

`dc.com` server-renders comic data with exactly the right fields —
`onSaleDate`, full title, cover image, page path — but only 20 entries, all
recent or past. `?tab=upcoming`, `/comics/upcoming`, `?sort=onsale` and
`/blog/dc-solicitations` each returned a 404 or the same unchanged list.

The underlying source is a private GraphQL endpoint at
`wme-gep-graphql-prod.wme-digital.com/graphql`. Reverse-engineering an
undocumented internal API was deliberately not attempted: it may require a key,
and it can change without notice and fail silently weeks later.

### 3.5 Each entry carries everything a tile needs

Per issue, in the embedded payload:

    releaseDate         "2026-10-28"
    headline            "Alien Vs. X-Men (2026) #2"
    isVariant           0
    creators_shortlist  "Claremont, Gillen, Borges, Stegman"
    image.filename      <cover url on cdn.marvel.com>
    link.link           <marvel.com issue url, carrying a stable issue id>

The payload also holds `allCollectionsReleases` and `allMUReleases`, both
ignored here.

## 4. Design

### 4.1 `server/lib/marvelCalendar.ts` — the parser, pure and offline

Pure URL-building and parsing, no I/O, as `wikiRuns.ts` is, so it tests against
fixtures.

`calendarUrl(weekStart, weekEnd)` builds the calendar URL with `dateStart`,
`dateEnd`, `tab=comic` and `variants=false`.

`parseCalendar(html)` locates `"allComicsReleases":{` and brace-matches to the
close, respecting string literals and escapes, then `JSON.parse`s the object
and reads its `content`. An entry with no `link.link` or no `releaseDate` is
skipped rather than stored half-formed. Entries with `isVariant` set are
dropped defensively, even though the URL already asks for none.

Per entry it produces:

- `sourceId` — the issue id from the link path (`/comics/issue/134736/...`),
  a stable primary key.
- `headline` — kept verbatim. Marvel's own text is already exactly what belongs
  on a tile, and it is what the UI displays.
- `seriesName` and `number` — derived, for ordering only, via the existing
  `parseComicTitle`. Note that helper zero-pads to three digits (`2` becomes
  `002`), which is right for sorting and wrong on screen. This is precisely why
  `headline` is kept for display rather than recomposed from the parts.
- `releaseDate`, `coverUrl`, `siteUrl`, `creators`.

Ordering is decided in one place, `sortUpcomingIssues`, by series name then
number — the same single-source-of-ordering rule `sortReleaseIssues` exists to
enforce, so a cached week and a freshly fetched week can never disagree.

### 4.2 Storage

Two tables, split for the reason `release_day` and `release_issue` are split: a
week we hold no issues for still has to record that we asked, or "no rows" and
"never asked" are indistinguishable and it refetches forever.

    CREATE TABLE IF NOT EXISTS upcoming_week (
      week       TEXT PRIMARY KEY,        -- the Wednesday, YYYY-MM-DD
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS upcoming_issue (
      week         TEXT NOT NULL,
      publisher    TEXT NOT NULL,
      source_id    TEXT NOT NULL,
      headline     TEXT NOT NULL,
      series_name  TEXT,
      number       TEXT,
      release_date TEXT NOT NULL,
      cover_url    TEXT,
      site_url     TEXT,
      creators     TEXT,
      PRIMARY KEY (week, publisher, source_id)
    );

`publisher` sits on the row rather than being implied by the table, so a DC
source found later adds rows, not a migration.

`release_date` is stored alongside `week` rather than assumed equal to it.
Every issue measured landed on its Wednesday, but grouping the display by what
Marvel actually said costs one column and cannot be wrong.

### 4.3 Freshness, and why nothing here is permanent

`UPCOMING_MAX_AGE_MS = 12 hours`, flat, for every cached week.

The Latest tab's `getFreshRelease` treats a snapshot fetched after its day
ended as final, readable at any age. That is correct for history and wrong
here: a solicited week changes until it ships. A twelve-hour window keeps the
page cheap to revisit while never letting a cancelled issue or a slipped date
persist for more than a day.

Weeks that have arrived are pruned on write. The Upcoming cache only ever holds
the future; once a Wednesday is here, the Latest tab owns it.

### 4.4 `server/routes/upcoming.ts` — `GET /api/releases/upcoming`

Deliberately **not** behind the Comic Vine key check that guards
`/api/releases`, exactly as `/api/releases/running` is not: this route reads
Marvel and has nothing to do with Comic Vine, so the tab works on a fresh
install with no key entered.

The route computes the next 10 Wednesdays after the one the Latest tab is
showing, via a new `upcomingWednesdays(now, count)` added to
`server/lib/releaseDay.ts` beside `mostRecentWednesday`. Ten covers the
measured nine-week horizon with room for it to extend.

Each week is served from cache when fresh and fetched otherwise, at a
concurrency of 3 — polite to Marvel, and a cold load of ten weeks completes in
a few seconds rather than ten. `Promise.allSettled` wraps the fetches so one
failing week cannot blank the rest, the same choice `running.ts` makes across
publishers.

Trailing empty weeks are dropped, so the page ends where Marvel's solicitations
end and lengthens itself as new ones drop.

The response keeps the publisher-grouped shape the other two endpoints use, so
`PublisherTabs` and the shared `pub` param work unchanged:

    {
      publishers: [
        { name: 'Marvel',    weeks: [{ week, issues: [...] }] },
        { name: 'DC Comics', weeks: [], unsupported: true }
      ],
      staleWeeks: ['2026-11-11']
    }

`unsupported` is a distinct flag from an empty `weeks`, and the distinction is
the point: it lets the UI say *we have no DC source* rather than implying DC
has nothing coming for two months.

### 4.5 The Releases page gains a third tab

`TABS` in `src/pages/Releases.tsx` gains `{ id: 'upcoming', label: 'Upcoming' }`
and the tab is held in the url as `tab=upcoming`, as `running` already is.

Inside: the publisher strip, then each week as a date heading over the existing
`tile-grid` cover grid. Weeks read top to bottom, nearest first.

`MissingIssueTile` is not reused. It is built around a Get button, and there is
nothing to get. A new read-only `UpcomingTile` — cover, headline, creators, an
external link to Marvel — reuses the existing grid styles without bending a
component away from its purpose.

Below the last week: a line naming where the data stops, so an ending page
reads as "Marvel has not announced further" rather than as a page that failed
to finish loading.

## 5. Failure behaviour

**A quiet week versus a broken parser.** §3.3 measured a real three-issue week,
so a small week cannot mean the parser broke. The rule: zero issues in one week
is a valid answer and is cached; zero across *every* week means the markup
changed, and that is reported as a failure and not cached. This is the same
reasoning `running.ts` uses when a Wikipedia table parses to no rows.

**A week that fails to fetch** falls back to whatever is cached, at any age,
and is named in `staleWeeks`. Weeks that succeeded are unaffected — a partial
page that says which parts are old beats an error page.

**Marvel unreachable entirely** serves whatever is cached, flagged stale. With
nothing cached, the tab says it could not reach Marvel, in the shape the
Currently Running tab already uses for Wikipedia.

**A restructured payload** — `allComicsReleases` absent — throws rather than
parsing to zero, so a structural change can never be recorded as a real empty
week and frozen into the cache.

## 6. Testing

Fixture-driven, following the `fetchPage`-injection pattern both existing
release routes use, so no test touches the network.

The calendar payload used in tests is **synthetic, not a capture of the live
page**, following the convention `wiki-runs.test.ts` sets and for the same
reason: a real capture pins Marvel's current solicitations and rots every week,
while a synthetic one pins the payload's *structure* and rots only when Marvel
changes it. It is built to carry every oddity measured in §3: the three
sibling buckets, a variant entry that must be excluded, a collections entry
that must be ignored, and an entry missing its link.

- `parseCalendar` against that payload: issues extracted with all fields,
  variants excluded, collections and MU buckets ignored, entries missing a
  link or date skipped, absent bucket throwing.
- `calendarUrl` parameter construction.
- `upcomingWednesdays` arithmetic, including across a year boundary, and that
  it starts after the Wednesday the Latest tab shows.
- `sortUpcomingIssues` ordering, including that a cached read and a fresh parse
  produce the same order.
- Model tests: cache round-trip, TTL expiry at the 12-hour boundary, pruning of
  weeks now past.
- Route tests: all weeks cached, partial fetch, one week failing while others
  succeed, every week empty reported as failure and not cached, and the DC
  entry carrying `unsupported`.
- `Releases.test.tsx`: the third tab renders, weeks appear in order, and the DC
  tab shows the no-source message rather than an empty grid.

## 7. Files

New:

- `server/lib/marvelCalendar.ts` — url building and parsing
- `server/models/upcoming.ts` — cache read/write, freshness, pruning
- `server/routes/upcoming.ts` — `GET /api/releases/upcoming`
- `src/components/UpcomingTile.tsx` — read-only cover tile
- `test/marvel-calendar.test.ts`, `test/models-upcoming.test.ts`,
  `test/routes-upcoming.test.ts`

Changed:

- `server/db.ts` — the two tables
- `server/lib/releaseDay.ts` — `upcomingWednesdays`
- `server/index.ts` — register the route
- `src/api.ts` — `getUpcoming` and its types
- `src/pages/Releases.tsx` — the third tab and its panel
- `test/Releases.test.tsx` — third-tab cases
