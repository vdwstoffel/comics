# Find a release — Design Spec

Date: 2026-10-30

## 1. Overview

`Find ↗` is the control a gap offers when the index holds no single certain
match for it. Today it is a link to the **Search comics** page. Following it
costs you the one thing the app already knew: *which issue you were filling*.

The journey, as it stands:

1. **Thor (2025)** has a gap at **#2**. The page knows this gap is Comic Vine
   issue `1197227`, because that id is what drew the tile.
2. You press `Find ↗`. It navigates to `/search?q=Thor&yearFrom=2024`. The
   issue id is gone — it was never in the url.
3. You find `The Mortal Thor #2 (2025)` by eye and press **Download**.
4. You land on **Upload**, which has only a download link to work with.
5. You press **Fetch metadata**. The Comic Vine dialog opens on a query
   reverse-engineered from the resolved *file name* — `"Thor #2"` — and shows
   you a dozen unrelated Thors from 1998, 1999, 2008.
6. You open Comic Vine in another tab to find out what the 2025 volume is
   actually called, come back, retype the search, and pick the right one.

Steps 4–6 exist only because step 2 dropped an id the app was already holding.
Meanwhile `↓ Get`, the control shown on a gap that *does* have a certain match,
reaches the same end state with one press and no questions.

**This replaces the navigation with a modal.** `Find ↗` opens a dialog over the
page you are on, already searching the index, headed with the gap it is filling.
You pick a row; it downloads and files exactly as `Get` would. Nothing is
carried across a navigation, so nothing can be lost on the way.

### Goals

- Press `Find`, pick a release, and be done — same end state as `↓ Get`, same
  number of decisions.
- Never ask for metadata that the gap already knows. The Comic Vine dialog must
  not appear in this flow at all.
- Work where the index's name for a series and Comic Vine's name disagree
  (`Thor (2025)` vs `The Mortal Thor`), which is the case that makes `Find`
  necessary in the first place.
- Name the **issue** being filled at the moment of commit, so the press that
  starts a download also says what it will be filed as. Not the destination
  folder: on the arc page and This week that is resolved server-side and the
  client does not know it (§4).
- Available everywhere `Find` is drawn today: the edition page's grid and
  carousel, the run sidebar, the arc page, and This week.
- Leave **Search comics** exactly as it is.

### Non-goals

- Changing how `↓ Get` decides it has a match. The rule that it never guesses
  stays untouched.
- Changing the **Search comics** page, its grouping, its filters, or its
  `Download` → **Upload** path. That page is for browsing the index; this modal
  is for filling one known gap. They stay separate — the user asked for this
  explicitly.
- Remembering a query, or a series mapping, between opens. Decided against for
  now (§3.4); revisit if it grates.
- Any new scraping source, or any change to what the index holds.

### Anti-goals

Things that would make this a failure even if it shipped and worked:

- **A download filed under the wrong issue.** The whole point is that the id
  travels intact. A modal that guesses, falls back to a name search, or silently
  files against a different issue than the one in its own heading is worse than
  the status quo, because the status quo at least makes you look at the match.
- **Reintroducing a Comic Vine name search.** [editions.ts:390](../../../server/routes/editions.ts#L390)
  already carries the warning: a name search "cannot tell a dozen relaunches of
  'Captain America' apart". If this flow ever needs one, the design is wrong.
- **A fifth place that fills a gap, with its own rules.** There are four already
  and they agree because they share `startIssueDownload`. This must join that
  chokepoint, not sidestep it.

## 2. What this is answering

### 2.1 The id was always there

[MissingIssueAction.tsx:11](../../../src/components/MissingIssueAction.tsx#L11)
documents `issueId` as "Comic Vine's id for the issue — what the download
endpoint is addressed by". It is a required prop. Every call site that draws a
`Find` link is already holding the id that would make the Comic Vine dialog
unnecessary.

[findIssueHref.ts:13](../../../src/lib/findIssueHref.ts#L13) builds the href from
`seriesName` and `coverDate` only. The id is not dropped by accident so much as
never offered a seat.

### 2.2 Why the Comic Vine dialog guesses so badly here

[Upload.tsx:302](../../../src/pages/Upload.tsx#L302) seeds the dialog with
`cvQueryFromFileName(sourceName, querySeries)`. Arriving from a search result
there is no edition chosen, so `querySeries` is null and the query comes from
the resolved download file name alone — which for this post parsed to
`Thor #2`. Comic Vine matches that against every Thor volume ever published.

This is not a bug in `cvQueryFromFileName`; it is the correct behaviour for an
upload of an unknown file. It is simply the wrong tool for a gap whose identity
is known, and the fix is to not reach for it.

### 2.3 Index numbering and Comic Vine numbering diverge

The index holds `The Mortal Thor #14 (#800) (2026)`. Comic Vine calls that issue
**#800**. Marvel's legacy renumbering means the index row's apparent number and
the Comic Vine issue number cannot be relied on to agree.

**Consequence, confirmed with the user:** the modal must not try to re-derive
which gap a chosen row fills. The gap is the one the modal was opened from, full
stop. The user's words: *"it should pick two, that number jump is legacy stuff
from marvel, but comic vine should have the correct information."*

### 2.4 The prefilled query must not include the issue number

[comicIndex.ts:107](../../../server/models/comicIndex.ts#L107) builds the FTS
query as prefix tokens ANDed together: `Thor 2` becomes `"thor"* AND "2"*`.

`"2"*` matches the token `2`, but it equally matches `2024`, `2025`, `2026`, and
`#20`–`#29`. Against an index where almost every title carries a year, that
clause filters out close to nothing while implying precision.

Measured against the live index (read-only copy, 2026-10-30):

| Query | Rows | With `year >= 2024` |
|---|---|---|
| `Thor` → `"thor"*` | 503 | 64 |
| `Thor 2` → `"thor"* AND "2"*` | 487 | **64** |

Adding the issue number removes 16 rows out of 503, and **zero** once the year
floor is applied. It is not a filter, it is decoration.

Note also that `"thor"*` is a *prefix* match, so the seed `Thor` legitimately
returns `Red Thorn`, `Rose and Thorn`, `Dejah Thoris` and `Poison Ivy – Thorns`.
The seed is noisier than "the series name" makes it sound.

So the modal seeds the series name alone, plus the year floor, which is exactly
what `findIssueHref` already sends. That floor is deliberately `coverYear - 1`,
not `coverYear`; the reasoning is written out at
[findIssueHref.ts:5-10](../../../src/lib/findIssueHref.ts#L5) and must be
preserved, not re-derived.

### 2.5 One chokepoint already exists

Every path that fills a gap goes through
[startIssueDownload](../../../server/services/issueDownload.ts#L36):

| Caller | Route | Edition it files into |
|---|---|---|
| Edition page | `POST /api/editions/:id/issues/:cvIssueId/download` | the edition's own `name` |
| Arc page | `POST /api/arcs/issues/:cvIssueId/download` | `getEditionByComicvineId(volumeId)?.name ?? volumeName ?? 'Unsorted'` |
| This week | `POST /api/releases/issues/:cvIssueId/download` | same rule as arcs |
| Get all / Following | via `bulkIssueDownload` / `following` | the edition's own `name` |

Each resolves its own edition name and then hands over. `startIssueDownload`
calls `findMatchForIssue` at line 48 and refuses with `409 no-match` when there
is no unique answer — which is precisely the condition under which the page drew
`Find` instead of `Get`.

**This is the seam.** A user-chosen index row is an answer to the same question
`findMatchForIssue` was asked. Supplying it makes `Find` and `Get` literally the
same code path downstream of the choice, which is what guarantees they file
identically.

### 2.6 What is reused unchanged

- `GET /api/comic-index/search` — but **not unchanged**, see §2.7.
- `GET /api/comic-index/:id/download-link` — reads a post page for its link.
- `startIssueDownload` — fetch, parse, enqueue, duplicate detection.
- `useDownload().liveByIssue` — the queued state the tiles already read.
- The download bar, which reports the run from wherever you are.

### 2.7 The search route does not return a flat list for a bare query

[comicIndex.ts:87-104](../../../server/routes/comicIndex.ts#L87) has two shapes
behind one route. It returns `searchComicIndex`'s flat `{ results, total }`
**only** when the request carries `series`, `kind` or `run`. A bare `q` +
`yearFrom` — exactly what this dialog sends — falls through to
`groupComicIndex` and answers `{ groups, totalGroups, totalResults }`.

`api.searchComicIndex` ([api.ts:839](../../../src/api.ts#L839)) types that URL
as flat, so the mismatch is invisible to TypeScript and arrives as
`results === undefined` at runtime.

The dialog cannot supply `series` to reach the flat branch: the group key is
derived from *scraped* titles by `seriesKey`, and the whole premise of `Find` is
that the app does not know what the index calls this series. Supplying
`kind: 'issue'` reaches it but hides every row `releaseKind` classifies
otherwise — roughly a quarter of numbered rows, plus bundles and collections —
inside a dialog whose entire job is the awkward cases.

**So a flat list is not free. It needs an ungrouped mode on the route, with its
own tests.** A grouped dialog needs no server change at all — it makes the same
two calls **Search comics** already makes: the bare query for headings, then
`series=<key>` for one group's rows. This was one of the three reasons the
design went grouped (§3.2).

### 2.8 The legacy-renumbering risk is already handled downstream

Worth recording, because §2.3 reads like an open hazard and it is not. The queue
row carries `cv_issue_id` ([downloadQueue.ts:80-101](../../../server/models/downloadQueue.ts#L80)),
`downloader.ts:182` hands it to `storeComic`, and `applyIssueToBook` writes
Comic Vine's own number and metadata onto the book. A row titled `#800` filed
against the `#14` gap still lands numbered as Comic Vine has it.

The queue's duplicate rule is keyed on `cv_issue_id` among live rows rather than
on the url, so two gaps filled from the same weekly bundle post do not false-409
each other.

## 3. Approach

### 3.1 `Find` becomes a press, not a link

[IssueAction.tsx:67](../../../src/components/IssueAction.tsx#L67) renders a
react-router `<Link to={findTo}>`. It becomes a `<button>` that calls `onFind`.

`findTo: string` is replaced by `onFind: () => void` on `IssueAction` and on
`MissingIssueTile`, which passes it straight through. The accessible name stays
`Find {label}` — a page of gaps is otherwise a page of buttons reading "Find",
which is the reasoning already recorded in that file's comment.

The `↗` goes. It promised a navigation that no longer happens.

### 3.2 The modal: `FindReleaseDialog`

A new component, opened by whichever call site owns the gap.

The user first chose a flat list from mockups, then switched to grouped once the
measurements below were on the table. **Grouped is the decision.** What survives
from the first choice is the *chrome*: no publisher tabs, no year boxes, one
footer. It is a focused dialog that happens to group its results, not a copy of
**Search comics** in a panel.

```
┌────────────────────────────────────────────────────┐
│ Find a release                                     │
│ Filling Thor (2025) #2                             │
├────────────────────────────────────────────────────┤
│ [ Thor                            ] [ Search ]     │
│ ⌄ from 2024  ×                   64 in 6 series    │
│                                                    │
│ ▸ Thor                                        2    │
│ ▸ The Immortal Thor                          26    │
│ ▾ The Mortal Thor                            16    │
│     The Mortal Thor #1 (2025)       2025  Marvel   │
│   ✓ The Mortal Thor #2 (2025)       2025  Marvel   │
│     The Mortal Thor #3 (2025)       2025  Marvel   │
│ ▸ Roxxon Presents – Thor                      1    │
│ ▸ Other                                      18    │
│                                                    │
├────────────────────────────────────────────────────┤
│ Files as Thor (2025) #2      Cancel    [Download]  │
└────────────────────────────────────────────────────┘
```

Decided:

- **Collapsible series headings**, from `groupComicIndex` — the shape the route
  already returns (§2.7). Opening a heading fetches that group's rows with
  `series=<key>`, which is the flat branch the route already has. The same two
  calls **Search comics** makes, so no server work.
- **No publisher tabs and no year inputs**, which is what the user rejected
  about the mini-search-page. The year floor is a single clearable chip, not a
  pair of boxes (§3.3).
- **The heading names the gap** for the whole life of the dialog, and the footer
  names it again at the point of commit. The user asked to "see what will
  download"; this is that, without a second screen.
- **Nothing auto-expands.** Not even a single-group result: the heading *is* the
  answer to "what does the index call this series", which is the question the
  user actually arrived with.
- **Two presses to commit** — select a row, then `Download`. Selection is not
  commitment. A mis-click in a list of near-identical titles should be
  correctable by clicking the right one, not by cancelling a queued download.
- **Searches on open**, like `ComicVineMatchDialog` does
  ([line 49-55](../../../src/components/ComicVineMatchDialog.tsx#L49)) — the
  dialog opens on candidates, not on a filled box awaiting a click.
  **Unless the seed is empty**: `Releases.tsx:51` seeds
  `issue.volumeName ?? ''`, and `buildMatchQuery` returns `null` for an empty
  query, so an unconditional search-on-open would greet you with an empty list
  that looks like "nothing found" rather than "nothing asked". Empty seed →
  focus the box, search nothing.
- **The query is editable.** It is the whole escape hatch for the name-mismatch
  case: widen `Thor` until `The Mortal Thor` appears.
- **An empty result offers the way out.** A search that returns nothing means
  the index may simply not hold it, and the dialog has no `Check for new` or
  `Full scrape` — those live on **Search comics**. So a no-results state carries
  a link to `/search?q=…` with the current query, which is the one case where
  leaving the page is the right answer. *(My call, not the user's — without it
  this flow is a dead end where today's link at least landed you somewhere with
  a scrape button.)*
- **Modal furniture matches `ComicVineMatchDialog`**: `.modal-backdrop` /
  `.modal-panel`, a `Close` button, no focus trap and no Escape handler. The
  house style has none; this is not the change that should introduce one.
  `.modal-backdrop` is `position: fixed; z-index: 200`
  ([styles.css:1409](../../../src/styles.css#L1409)), so the dialog renders
  inline from a grid tile without a portal.

> **RESOLVED — why it is grouped. Measured 2026-10-30; keep this, it is the
> whole argument.**
>
> Running the seed this design specifies (`q=Thor`, `yearFrom=2024`)
> against the live index, through `ORDER_BY`
> ([comicIndex.ts:168](../../../server/models/comicIndex.ts#L168)), gives **64
> rows with `The Mortal Thor #2 (2025)` at position 36**. Ahead of it sit
> `Dejah Thoris`, `Godzilla vs. Thor`, `What If…? Donald Duck Became Thor`,
> `Roxxon Presents – Thor`, and all 24 issues of `The Immortal Thor`.
>
> `ORDER_BY` sorts by title text, not by relevance, so there is no ranking to
> lean on. The same 64 rows are what the user's own screenshot shows collapsed
> into "64 matches in 6 series" — the grouping is *why* `The Mortal Thor` was
> findable there.
>
> It is worse at the sizes `Find` will actually meet. Bare queries against the
> live index: `venom` 415 rows, `superman` 1,026, `spider` 2,313, `batman`
> 2,338. `limit` defaults to 50 and caps at 200, so a flat list is a window onto
> the middle of an alphabet with no ranking — and widening the query to find a
> renamed series makes the set *larger*, which is the opposite of what the user
> is trying to do.
>
> And per §2.7 the flat shape is the one the route does not return, so it costs
> a server change that grouping does not.
>
> Three arguments, all pointing the same way. The user originally picked the
> flat list from mockups with none of these numbers known — the mockup drawn for
> them showed four tidy rows, which was flattering rather than accurate — and
> chose grouped once shown the measurements.
>
> **Do not quietly flatten this later.** If a future change makes the grouped
> list feel heavy, re-measure first; the numbers above are why it is this way.

### 3.3 Seeding the search

Series name, and `yearFrom = coverYear - 1` when there is a cover date. Issue
number deliberately excluded (§2.4).

**The floor is a clearable chip, not a hidden filter.** `buildFilter`
([comicIndex.ts:141](../../../server/models/comicIndex.ts#L141)) drops rows with
a NULL year from any bounded query, and **3,101 of 68,209 index rows have no
parsed year** — invisible and permanently unreachable from a dialog that has no
way to relax the bound. Today's `Find` link at least lands on a page with a year
box you can empty. So the dialog shows `from 2024 ×` beside the result count;
clearing it re-runs unbounded. One chip, not the pair of year inputs the user
rejected. *(My call — the user chose the grouped list and did not answer this;
hidden-and-permanent loses capability the current link has, so the chip is the
conservative option. Easy to drop if it reads as clutter.)*

`findIssueHref` currently returns a url string. Split the decision from the
serialisation: a function returning `{ q, yearFrom? }` that both the modal and
any remaining href consumer can use, so the year-slack reasoning lives in one
place. Its existing tests (`test/find-issue-href.test.ts`) cover that reasoning
and should be carried over to whatever shape replaces it.

### 3.4 No memory between opens

Each open re-seeds from the series name. The user considered remembering the
last query per volume — with five Thor gaps, the win is real — and chose to
start fresh: *"we can always update in the future if it is annoying."*

Recorded here so a future reader knows it was weighed, not missed.

### 3.5 `indexId` on the server

`startIssueDownload` gains an optional `indexId`:

```ts
startIssueDownload(app, {
  volumeName, editionName, issue, label, indexId?, fetchPage,
})
```

When present, skip `findMatchForIssue` and load that row with
`comicIndexById`. When absent, behave exactly as now. A row id that no longer
exists is a `409 no-match`, the same refusal the derived path gives — the index
can be rescraped between the render and the press.

The three existing download routes accept an optional `indexId` in the body.
They are already `POST` and already take no body, so this is additive and no
caller changes.

**On the "server decides" principle.** The comment at
[issueDownload.ts:30-33](../../../server/services/issueDownload.ts#L30) says the
match is re-derived server-side because "a download the server did not decide on
is a download nobody checked." That principle is about *inference the client
made up*. Here there is no inference: a person read the titles and chose one,
which is strictly more checked than any rule. The server still validates that
the row exists and still owns fetching, parsing, enqueueing and duplicate
detection. **The comment should be amended rather than left to contradict the
code.**

### 3.6 What happens on press

1. `POST` the page's existing download route with `{ indexId }`.
2. `202` → close the dialog, invalidate `['download']`. The tile flips to
   `Queued` off `liveByIssue`, and the download bar takes over. This is exactly
   what `Get` does today.
3. Non-2xx → **keep the dialog open** and show the message against the footer.
   The same reasoning as
   [Upload.tsx:85-89](../../../src/pages/Upload.tsx#L85): a failure you can
   correct in place beats one that makes you start over.

The routes answer a refusal with `{ reason, error, entry }`, where `reason` is
the machine-readable half — `no-match`, `duplicate`, `unreadable`, `no-link`.
**`json()` throws away everything but `error` and `status`**
([api.ts:624-639](../../../src/api.ts#L624)), and `status` cannot separate the
two 409s: `duplicate` ("that is already in the queue", which is nearly a
success) and `no-match` ("that row is gone", which is not) arrive
indistinguishable.

So either `json()` learns to attach `reason` alongside `status` — the same
one-line `Object.assign` that already carries `status`, and useful to every
other caller — or this dialog fetches without it. **Prefer the former.** The
server's wording is already good enough to show verbatim; `reason` is only
needed to decide whether a refusal closes the dialog (`duplicate` → close, the
download the user wanted is already happening) or holds it open for another pick.

## 4. Call sites

All four, per the user: *"do everywhere, I will test it."*

| Site | Component | Has | Route |
|---|---|---|---|
| Edition grid | `VolumeIssueTile` → `MissingIssueTile` | `issue.id`, `editionId`, `seriesName`, `issue.coverDate` | editions |
| Run sidebar + carousel | `MissingIssueAction` → `IssueAction` | `issueId`, `editionId`, `seriesName`, `coverDate` | editions |
| Arc page | `Arc.tsx` → `MissingIssueTile` | `issue.id`, `issue.volumeName`, `issue.coverDate` | arcs |
| This week | `Releases.tsx` → `MissingIssueTile` | `issue.id`, `issue.volumeName`, `issue.coverDate` | releases |

Arc and This week have no `editionId` — their routes resolve the edition from
the issue's volume server-side, and keep doing so. The dialog needs only a seed
query, a gap label, and a function to call. **Builder's call:** the cleanest
shape is probably for each call site to pass `onDownload: (indexId) => Promise`,
so the dialog never knows which route it is talking to.

`Arc.tsx:52-55` and `Releases.tsx:58-60` both inline the same year-floor
calculation that `findIssueHref` performs, each with its own copy of the comment
explaining it. Folding them onto the §3.3 helper is in scope.

### 4.1 The dialog needs a second, fuller label

`IssueAction`'s existing `label` is `#2` on an edition page — it is the
accessible name (`Find #2`), and the surrounding tile supplies the context. As a
dialog heading, "Filling #2" says nothing.

So the dialog takes a **separate `gapLabel`**, composed by each call site and
threaded through `MissingIssueTile` and `IssueAction` alongside `label`:

| Site | `label` | `gapLabel` |
|---|---|---|
| Edition grid / sidebar / carousel | `#2` | `Thor (2025) #2` (edition name + number) |
| Arc page | `Thor #2` | the same, from `issue.volumeName` |
| This week | `Thor #2` | the same |

Both shared components gain one prop, and all four call sites pass it. Composed
at the call site, never in the dialog — only the page knows what context its
reader is missing.

**`Files as …` names the issue, not the folder.** On the arc page and This week
the destination edition is `existing?.name ?? volumeName ?? 'Unsorted'`,
resolved inside the route ([arcs.ts:245](../../../server/routes/arcs.ts#L245),
[releases.ts:157](../../../server/routes/releases.ts#L157)) from data the client
never sees. Promising a folder would mean exposing that resolution through three
routes to caption a button. The issue identity is what this feature exists to
protect and what the user can actually check against the row they picked; where
the file lands is each page's existing rule, unchanged here. *(My call.)*

### 4.2 Never truncate in silence

Grouping is most of the answer — `batman`'s 2,338 rows become a few dozen
headings — but it does not remove the problem, it moves it. Two places still cut:

- **The heading list.** `groupComicIndex` pages on groups; **Search comics**
  handles this with `useInfiniteQuery` and a `totalGroups` check
  ([SearchComics.tsx:158](../../../src/pages/SearchComics.tsx#L158)). The dialog
  does the same, or shows a `Show more` — but it states `64 in 6 series` either
  way, so the count is never a mystery.
- **Rows inside one group.** `series=<key>` is windowed by the same `limit`,
  default 50. A long run — `The Immortal Thor` already has 26 — can exceed it.

The result area states the total and makes the rest reachable. **A list that
silently ends is not acceptable**, and it fails hardest in the case the feature
exists for, since widening a query to find a renamed series *grows* the set.
*(My call. Which mechanism — infinite scroll or a button — is the builder's.)*

## 5. Testing

Per CLAUDE.md: narrow runs plus `npm run typecheck` while iterating, full
`npm test` before merge.

Unit:

- The §3.3 seed helper: series only, series + floor, bad/missing cover date.
  Carry over `test/find-issue-href.test.ts`.
- `startIssueDownload` with `indexId`: uses that row and does not call
  `findMatchForIssue`; unknown id → `409 no-match`; a row that would *not* have
  matched is still accepted, since that is the entire feature.
- `startIssueDownload` without `indexId`: unchanged. The existing tests are the
  regression net.

Component (`FindReleaseDialog`):

- Opens searching on the seeded query, and renders headings rather than rows.
- An empty seed (This week's `volumeName ?? ''`) searches nothing (§3.2).
- Expanding a heading fetches that group with `series=<key>`; nothing
  auto-expands.
- Selecting a row does not download; pressing `Download` does, with that row's id.
- Clearing the year chip re-runs the search unbounded (§3.3).
- A failure leaves the dialog open with the message and the selection intact;
  `duplicate` closes it (§3.6).
- `202` closes it.
- No results offers the link to `/search?q=…`.
- The total is stated, and a cut list says so (§4.2).

Integration, one per route, asserting the enqueued entry carries the right
`issueId` and `edition` — the thing the whole design exists to protect.

Manual, by the user at **http://192.168.129.11:8090** after
`docker compose up -d --build`: the Thor (2025) #2 case end to end, and one gap
each from the arc page and This week.

Nothing writes into `./data` during tests — throwaway filenames only.

## 6. Files

New:
- `src/components/FindReleaseDialog.tsx`
- `test/find-release-dialog.test.tsx`

Changed:
- `src/components/IssueAction.tsx` — `findTo` → `onFind`, `Link` → `button`, `+ gapLabel`
- `src/components/MissingIssueTile.tsx` — pass both through
- `src/components/MissingIssueAction.tsx` — own the dialog
- `src/components/VolumeIssueTile.tsx` — own the dialog
- `src/pages/Arc.tsx`, `src/pages/Releases.tsx` — own the dialog, drop inlined year floor
- `src/lib/findIssueHref.ts` — return the parts, not the url
- `src/api.ts` — `indexId` on the three download calls; `reason` on the thrown
  error (§3.6). While here: `downloadRelease` and `downloadMissingIssue` are
  typed `{ started: boolean }` but their routes answer `{ queued, entry }`
  — pre-existing drift, and these are the calls being touched anyway
- `server/services/issueDownload.ts` — optional `indexId`, amend the §3.5 comment
- `server/routes/editions.ts`, `arcs.ts`, `releases.ts` — accept `indexId`
- `test/find-issue-href.test.ts` — follow the helper

**No server route change.** Grouping is what `/api/comic-index/search` already
returns, so §2.7's ungrouped mode is not needed — that was the cost of the flat
list, and the flat list lost.

Untouched: `server/routes/comicIndex.ts`, `src/pages/SearchComics.tsx`,
`src/pages/Upload.tsx`, `ComicVineMatchDialog.tsx`, `cvQuery.ts`,
`findMatchForIssue`.

## 7. Open to the builder

- Whether `findIssueHref` keeps its name once it returns parts.
- Whether the dialog takes `onDownload(indexId)` from each call site (§4) or
  learns the route from a discriminated prop.
- Whether the four call sites' dialog state is worth a small shared hook or is
  cheaper duplicated.
- Paging mechanism for headings and for rows within a group — infinite scroll as
  **Search comics** does it, or a `Show more`. The requirement is only that
  nothing is cut in silence (§4.2).
- Whether expanded-group state resets on a new search. (It does on **Search
  comics**, [SearchComics.tsx:172](../../../src/pages/SearchComics.tsx#L172);
  matching that is the safe default.)
