# Currently Running Tab — Design Spec

**Date:** 2026-09-22
**Status:** Draft for review

## 1. Overview

The Latest tab answers "what came out this Wednesday". Nothing answers "what is
being published at all right now". Deciding to pick up a new run means leaving
the app for Wikipedia, reading the list there, and typing a title back into the
search page.

This work adds a second tab to the Releases page: a table of every Marvel and DC
series currently being published — ongoing and limited — read from Wikipedia's
two "List of current … publications" pages. Clicking a title opens the existing
search page seeded with that series' name and publication year.

### Goals

- Show every currently-published Marvel and DC series, ongoing and limited, with
  its issue range and publication year.
- Mark which are open-ended runs and which are limited series.
- Send a click straight to `/search?q=…&yearFrom=…`, so a title that catches the
  eye reaches the getcomics index without retyping.
- Work with no Comic Vine key configured. This tab has nothing to do with Comic
  Vine, and must not inherit `/api/releases`' 400.

### Non-goals

- **Persistence.** No table, no migration, no cache, no refresh button. The
  pages are read on every request (§4.3). This was chosen deliberately over a
  stored copy with an age; the cost is a slower tab, the gain is that the whole
  staleness layer does not exist.
- **Upcoming series.** Both pages carry Upcoming tables. They answer a different
  question ("what launches next month") and their columns differ (§3.2). The
  parser is built to exclude them by heading, not by position.
- **Cross-referencing the library.** The table does not say what you own or how
  far behind you are. That was considered and rejected: this is a catalogue to
  browse, not a checklist. Nothing here blocks adding it later.
- **Imprint labels.** The group rows inside the DC tables (Black Label,
  Absolute, Vertigo) are skipped rather than carried onto the rows beneath
  them (§3.3). Capturing them is a two-line change if the table ever reads as
  too flat.
- **Sorting or filtering the table.** 93 series across four tables (§3.1) fits
  on a page. Wikipedia's own order is kept.

## 2. Why Wikipedia, and why the API

Comic Vine can answer "what came out on day X" but not "what is currently being
published" — the latter is an editorial judgement about whether a run is still
going, which these two Wikipedia pages maintain by hand and Comic Vine does not
model at all.

Three ways in were considered:

1. **Fetch the article URL and parse it.** What `comicIndexSource.ts` does for
   getcomics. Returns the whole skin — nav, sidebar, footer, `[edit]` links —
   which changes for reasons unrelated to the article.
2. **Fetch via the MediaWiki API** (`action=parse&prop=text&formatversion=2`).
   Returns the article body HTML alone, as JSON, from an interface meant for
   machine consumption. **Chosen.**
3. **Parse raw wikitext.** These tables are built from row templates; this means
   reimplementing template expansion. Rejected.

Measured 2026-09-22, the API response is roughly half the bytes of the article
page — which matters when the fetch happens per page view:

| page | API (`prop=text`) | article URL |
| ---- | ----------------- | ----------- |
| Marvel | 120,947 B | 250,786 B |
| DC | 100,272 B | 214,226 B |

## 3. Evidence

Everything below was measured against the two live pages on 2026-09-22 by
walking the parsed HTML with cheerio, not estimated.

### 3.1 Both pages have the same four tables, and they are small

Each page holds exactly four `table.wikitable`, under an `h2` of *Ongoing
series* / *Limited series* and an `h3` of *Active* / *Upcoming*:

| page | Ongoing/Active | Limited/Active | total kept |
| ---- | -------------- | -------------- | ---------- |
| Marvel | 19 rows | 25 rows | 44 |
| DC | 39 rows | 19 rows | 58 |

102 rows in total, of which 93 are series — the other 9 are the imprint group
rows of §3.3. This is what makes sorting, filtering and pagination non-goals.

### 3.2 Column layout is not uniform, so columns are read by header name

The Active tables carry `Title | Issues | Pub. Year | Date of Final Issue | Ref.`
But DC's *Upcoming ongoing* table has only four columns — no `Issues` — and one
row in DC's *Limited/Active* table has four cells where its siblings have five.

Reading `cells[2]` for the year is therefore wrong in the general case. The
parser reads each table's header row once, maps header text to column index, and
pulls every field by name. A column that is absent, or a row too short to reach
it, yields `null` rather than a crash or a value from the wrong column.

### 3.3 Imprint groupings are rows, not headings

There are no `h4` headings on either page. The imprint groupings sit *inside*
the tables as full-width single-cell `th` rows:

| table | single-cell rows |
| ----- | ---------------- |
| Marvel Ongoing/Active | 0 |
| Marvel Limited/Active | 3 |
| DC Ongoing/Active | 2 |
| DC Limited/Active | 4 |

Parsed naively these become series whose title is "Black Label" and whose every
other field is empty. Rows with fewer than two cells are skipped.

### 3.4 A title is not reliably a link, and not reliably italic

| table | rows | title has `<a>` | title has `<i>` |
| ----- | ---- | --------------- | --------------- |
| Marvel Ongoing/Active | 19 | 17 | 19 |
| Marvel Limited/Active | 22 | 9 | 22 |
| DC Ongoing/Active | 37 | 31 | 37 |
| DC Limited/Active | 15 | 7 | 15 |

Row counts here are the *series* rows — the group rows of §3.3 are excluded,
which is why they fall short of the totals in §3.1.

A series with no Wikipedia article of its own has no link. The title is
therefore the cell's normalised text — never `cell.find('a').text()`, which
would silently drop between 2 and 8 rows per table.

### 3.5 An announced ending is real information, and sparse

`Date of Final Issue` is filled on 4 of 19 Marvel ongoings and 1 of 39 DC
ongoings — an active run with a known last issue. Sparse enough to be worth
showing, and exactly what you want before starting something.

## 4. Design

### 4.1 The row

```ts
export type RunKind = 'ongoing' | 'limited'

export interface RunningSeries {
  title: string          // "The Amazing Spider-Man"
  kind: RunKind
  issues: string | null  // "#1–"  "#1–5"  "#957–1102"
  pubYear: number | null // 2025
  endsOn: string | null  // announced final issue, as printed
}
```

`Ref.` is dropped, and `sup.reference` superscripts are stripped from every cell
before its text is read — otherwise a year reads as `2025[4]` and fails to parse.

### 4.2 `server/lib/wikiRuns.ts` — the parser, pure and offline

No network, no database. Everything that can be got wrong lives here, where a
fixture can pin it:

- `WIKI_PAGES` — the two publishers and their page titles.
- `apiUrl(pageTitle)` — builds the `action=parse` URL.
- `parseRunsJson(body)` — pulls `parse.text` out of the API envelope.
- `parseRunsHtml(html): RunningSeries[]` — selects `h2, h3, table.wikitable` in
  document order and walks them, tracking the current `h2`/`h3`. A table is kept
  only while the `h2` is *Ongoing series* or *Limited series* **and** the `h3` is
  *Active*; `kind` comes from that `h2`. Heading text is normalised (`[edit]`
  stripped, whitespace collapsed) before comparison.

Selecting by heading rather than by table position is the point: "tables 1 and
3" breaks the first time a section is added, and silently — it would serve
Upcoming rows as though they were running.

### 4.3 `server/routes/running.ts` — `GET /api/releases/running`

- Takes an injected `fetchPage` exactly as `ReleaseRouteOpts` does in
  `routes/releases.ts`, so no test touches the network.
- Reuses `fetchSourcePage` and `USER_AGENT` from `comicIndexSource.ts`: how this
  app identifies itself stays decided in one place, as that file's comment asks.
- Fetches both publishers with `Promise.allSettled`. One publisher failing
  leaves the other's table intact; the failed one comes back with `series: []`
  and is named in `failed`, rather than the tab going blank.
- Requires **no** Comic Vine key.

```ts
{
  failed?: string[],                    // publishers whose fetch or parse failed
  publishers: Array<{
    name: 'Marvel' | 'DC Comics',
    sourceUrl: string,                  // the human article URL, for attribution
    series: RunningSeries[],
  }>,
}
```

`publishers` uses the same two names in the same order as `/api/releases`'
`SHOWN`, so both tabs agree on what a publisher is called.

### 4.4 The Releases page gains tabs

- `src/pages/Releases.tsx` keeps its current body as a `ThisWeek` block and
  gains a tab strip under the `<h1>`. The active tab lives in the URL
  (`?tab=running`) via `useSearchParams`, so a reload does not bounce back to
  the covers.
- `src/components/RunningTable.tsx` renders one publisher: a heading, a table of
  `Title · Kind · Issues · Year · Ends`, and a source link beneath it.
- The **title** is the link — not the whole row: a better touch target, and it
  matches the Find affordance already on the page. It points at
  `/search?q=<title>&yearFrom=<pubYear>`, both of which `SearchComics.tsx`
  already reads (lines 60–61). A row with no `pubYear` omits `yearFrom`.
  - The Find links on the Latest tab subtract a year from the cover year,
    because Comic Vine cover dates run ahead of the shop date. A Wikipedia
    `Pub. Year` is the actual year of publication, so it seeds exactly. This is
    a deliberate difference between the two tabs, not an oversight.
- `src/styles.css` gains `.tabs`/`.tab` and the table styles. 44px touch
  targets, as the rest of the file insists — this app is used on a tablet.
- Attribution: each table is followed by a link to the Wikipedia page it came
  from. CC BY-SA expects it, and it gives somewhere to look when a row is wrong.

### 4.5 Fetch cadence

The route caches nothing; each request reads both pages. To stop React Query's
defaults turning "every page view" into "every window refocus", this one query
gets `staleTime: 5 * 60_000`, set **on the `useQuery` call itself**, not on the
`QueryClient` in `main.tsx` — a default there would change the refetch behaviour
of every other query in the app, which is not what this is for. Fresh on each
visit, not on each alt-tab.

## 5. Failure behaviour

| what happened | what the tab shows |
| ------------- | ------------------ |
| Both fetches fail | "Couldn't reach Wikipedia." Nothing else. |
| One publisher fails | The other's table in full, plus a line naming the one that failed. |
| A page parses to zero rows | Treated as a failure for that publisher: an empty Active table means the page moved, not that Marvel stopped publishing. |
| A row is unparseable | Skipped. One malformed row must not cost the other 101. |

## 6. Testing

- `test/wiki-runs.test.ts` — the parser against a small hand-written fixture
  built to mirror the real structure, with **invented series names**: an
  Ongoing/Active and Limited/Active table to keep, an Upcoming table to exclude,
  a full-width `th` group row, a row one cell short, a title with no link, and a
  `sup.reference` inside a year cell. The fixture is synthetic so the tests pin
  structure rather than this week's contents, and do not rot every Wednesday.
- `test/routes-running.test.ts` — the route with an injected fetcher: the happy
  path, one publisher failing, both failing, and a page that yields zero rows.
  Also asserts the route answers with no Comic Vine key set.
- `test/Releases.test.tsx` — switching tabs, the tab surviving in the URL, and
  the `href` a title produces (including a row with no year).

Written test-first, as the rest of the repo was.

## 7. Files

| file | change |
| ---- | ------ |
| `server/lib/wikiRuns.ts` | new — parser, pure |
| `server/routes/running.ts` | new — `GET /api/releases/running` |
| `server/index.ts` | register the route |
| `src/api.ts` | `ApiRunningSeries`, `ApiRunning`, `api.getRunning()` |
| `src/pages/Releases.tsx` | tab strip; existing body becomes `ThisWeek` |
| `src/components/RunningTable.tsx` | new — one publisher's table |
| `src/styles.css` | `.tabs`, `.tab`, table styles |
| `test/wiki-runs.test.ts` | new |
| `test/routes-running.test.ts` | new |
| `test/Releases.test.tsx` | tab and link assertions |

No database change. No new dependency — `cheerio` is already used by the
getcomics scraper.
