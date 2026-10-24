# Manual Comic Vine id entry — Design Spec

Date: 2026-10-24

## 1. Overview

A way to bind a comic to its Comic Vine record **by typing the id**, when search
cannot find it or cannot run at all; a **Refresh from Comic Vine** that re-reads
a record you are already bound to; and a short list on Settings reminding you
which comics you linked by hand and what Comic Vine still owes them.

One rule shapes the whole thing: **the link is the deliverable, and metadata is
only ever added.** Binding a comic to Comic Vine must be possible when Comic
Vine knows nothing about it yet — or cannot be reached at all — and must never
cost you a field you already had.

### Goals

- Attach a Comic Vine issue id to a comic without going through search.
- Accept what you would actually paste: an issue URL, `4000-1197227`, or `1197227`.
- Applying a record that Comic Vine has not filled in yet leaves every existing
  field alone — the id lands, nothing is lost.
- Bind the id even when the read fails, except when the id does not exist.
- Re-read a record later, from the book or from the reminder list, with no
  search involved.
- Keep a record of what you linked by hand and what Comic Vine was still missing
  at the last read, removable only by you.

### Non-goals

- **Manual entry of a volume id on an edition.** `/api/editions/:id/comicvine`
  already takes a `volumeId` and carries the identical `?? null` bug, but the
  volume gets matched elsewhere in the app and this stays about one comic.
- **Scraping comicvine.gamespot.com.** See §2.3.
- **Automatic removal from the reminder list.** See §5.4.
- **A "refresh all" button.** See §8.
- Any change to how issues are matched for *download* (`findMatchForIssue`) —
  see §8.

## 2. What this is answering

### 2.1 Issue search is down; everything else is up

Probed 2026-10-24, with the configured key, three tries on the failing call:

| Call | Result |
| --- | --- |
| `/search/?resources=issue` | **HTTP 500**, HTML error page, 3/3 |
| `/search/?resources=volume` | 200 OK |
| `/search/` (no `resources`) | 200 OK |
| `/issue/4000-1197227/` | 200 OK |
| `/volume/4050-177664/` | 200 OK |
| `/volumes/?filter=name:…` | 200 OK |
| `/issues/?filter=volume:177664` | 200 OK |

`ComicVineMatchDialog` makes exactly one Comic Vine call —
`api.cvSearch(query, 'issue')` — and it is the broken one. `get()` throws
`Comic Vine HTTP 500` (`server/lib/comicvine.ts:35`), the dialog catches it and
renders a bare "Search failed". So while this outage lasts, **no comic in the
library can be matched at all**, by any route, although the endpoint that would
do the work answers in half a second.

An id typed by hand reaches `getIssue` directly and never touches `/search/`.

### 2.2 A new record is thin for days

*Amazing Spider-Man: Halloween Special* #1 — issue `1197227`, volume `177664`,
added to Comic Vine 2026-10-21 — carries a cover image and nothing else:
`name`, `cover_date`, `store_date` all null, zero credits, and no `start_year`
on the volume. This is ordinary for a new release and fills in over days.

The two failures are independent, and the fix for the first must not be defeated
by the second: the point of typing an id for this comic is to bind it *while the
record is still empty*, so the metadata arrives on its own when Comic Vine
backfills.

### 2.3 Reading the id off the website was considered and rejected

The obvious move — paste the URL, scrape the page — buys nothing. The page
renders the same empty record the API returns, so the missing fields are not
there to be had. What the URL genuinely carries is the id, which is plain text in
the path (`/4050-177664/`, `/4000-1197227/`) and needs no fetch to read.

So the URL is parsed, never fetched. This also keeps the feature working while
comicvine.gamespot.com answers a plain request with HTTP 403, which it did
throughout this investigation.

### 2.4 Applying a thin record currently destroys data

`applyIssueToBook` builds its patch with `?? null` on every field:

```ts
title: meta.title ?? null, number: meta.number ?? null, date: meta.date ?? null,
summary: meta.summary ?? null, writer: meta.writer ?? null, penciller: meta.penciller ?? null,
```

`updateBook` writes every key it is handed, nulls included
(`server/models/books.ts:44`). `replaceBookCredits` and `replaceBookTags`
replace wholesale, so an empty list empties the table. Then `syncComicInfoFile`
writes the result back into the comic's own `ComicInfo.xml`.

Matching today's Halloween special to a book would therefore erase that book's
title, date, summary, credits and characters — **in the database and on disk** —
and replace them with the nothing Comic Vine currently holds. This is a
pre-existing bug on the normal search path; it is in scope because §2.2 walks
straight into it.

## 3. Approach

### 3.1 Empties are omitted, not written

The patch is built by **leaving keys out** when Comic Vine has nothing for them,
rather than by setting them to null.

No change to `updateBook` is needed: it already iterates `if (k in fields)`, so
an absent key is an untouched column. The change is entirely in how
`applyIssueToBook` assembles the object.

**What counts as empty** is value-based, not `undefined`-based. The API returns
JSON `null` for an unset string and the client types it `string | undefined`, and
`issue_number` can come back as `''`. So: `v == null || v.trim() === ''`.

Two fields are exempt and always written:

| Field | Why it is always written |
| --- | --- |
| `comicvineId` | It is the thing being set. It never comes from the response. |
| `cvSiteUrl` | Comic Vine returns it for every record, thin or not. |

**The cover is guarded but is not a known hazard.** Comic Vine is documented as
serving a generic placeholder for records with no cover, which would pass a
null check and overwrite a good cover with a blank. It was not reproducible:
200 issues sampled across 2015 and 2026, and all 208 `cover_url` values in the
library, contained no `blank`/`missing` placeholder. Treat a cover URL whose
filename matches `blank` or `missing` as empty — one predicate, no cost — and do
not build anything larger around it.

**Credits and tags replace per kind, not wholesale.** `replaceBookTags` deletes
every kind in one statement, so a record with characters and no story arcs would
clear the arcs. Credits, characters, teams and story arcs are judged separately,
and a kind is replaced only when the response carries at least one of it. This
needs a kind-scoped variant in `server/models/metadata.ts`; the existing
whole-table function stays for callers that mean it.

### 3.2 This changes the search path too, on purpose

The guard lives in `applyIssueToBook`, shared by manual entry, the search-based
match and the upload match. It is not conditional on how the id was obtained.

The cost: re-matching can no longer **clear** a wrong field by binding to a
sparse record. A bad title now has to be corrected in the metadata editor, which
already exists for exactly that.

The trade is deliberate. A stale field is visible and one edit away; a field
silently emptied — in the database and written through to the file — is neither.
Making the behaviour depend on which button you pressed would be worse than
either rule on its own.

### 3.3 Refresh is apply, with the id already on the book

Once `book.comicvine_id` is set, re-reading the record is the existing apply call
with the stored id. There is no new fetching machinery and no search, so refresh
works during this outage and any future one confined to `/search/`.

With §3.1 in place, refresh is safe to press on anything: a record that is still
empty writes nothing and leaves the comic as it was.

### 3.4 A failed read still binds the id — unless the id is wrong

The identity came from you, not from Comic Vine, so a Comic Vine that will not
answer costs the metadata and never the link. `storeComic.ts:121-127` already
takes this position for uploads, with a comment making the same argument.

The exception is an id that does not exist. Binding a comic to a record that
isn't there serves nobody and hides a typo behind a success message.

**Telling those apart means reading Comic Vine's own status code, not the HTTP
one.** A nonexistent id answers **HTTP 200 with `status_code: 101`, "Object Not
Found"** — verified against ids `1` and `999999999`. The HTTP status is 200 in
exactly the case that must be rejected, and 500 in the case that must succeed.

So `get()` throws a typed error carrying Comic Vine's `status_code` (and the
HTTP status where there is no body to read), and `applyIssueToBook` branches on
it:

| Condition | Outcome |
| --- | --- |
| `status_code: 101` | Reject. Nothing written. "Comic Vine has no issue with that id." |
| Any other failure — HTTP 500, network, no key configured | Bind `comicvineId`, file the reminder with `checked_at` null, report that the metadata did not arrive. |
| Success | Apply per §3.1. |

## 4. Accepting an id

One input, several shapes, parsed by a pure function (`parseCvIssueId`) in
`src/lib/cvIssueId.ts`:

| Input | Result |
| --- | --- |
| `https://comicvine.gamespot.com/amazing-spider-man-halloween-special-1/4000-1197227/` | `1197227` |
| `comicvine.gamespot.com/…/4000-1197227/` (no scheme) | `1197227` |
| `4000-1197227` | `1197227` |
| `1197227` | `1197227` |
| surrounding whitespace, trailing `?…` or `#…` | ignored |
| `https://comicvine.gamespot.com/amazing-spider-man-halloween-special/4050-177664/` | **rejected**, "That is a volume link. Paste the link to a single issue." |
| any other `NNNN-` prefix (`4005-`, `4045-`) | **rejected**, named for what it is |
| anything else | rejected, "That does not look like a Comic Vine issue id or link." |

The volume rejection is why this is a parser and not a regex for digits.
`4050-177664` contains `177664`, a perfectly valid *issue* id belonging to an
unrelated comic, so a lenient parser would bind the book to the wrong record and
report success. A volume link is the most likely wrong paste — it is what you get
by clicking the series name — so it is named explicitly rather than falling into
the generic error.

Parsing happens client-side so the message appears without a round trip. The
route still validates that it received a positive integer: it is a public
endpoint and the page is not its only caller.

## 5. The reminder list

### 5.1 What it is

A record of comics you bound by hand and what Comic Vine still owes them, so
that "which of these was Comic Vine still filling in?" survives closing the tab.
It is bookkeeping: nothing about a comic's behaviour depends on whether it has a
row here.

### 5.2 Schema

Added to `SCHEMA` in `server/db.ts`; `CREATE TABLE IF NOT EXISTS` is the whole
migration.

```sql
CREATE TABLE IF NOT EXISTS cv_manual_entry (
  book_id     INTEGER PRIMARY KEY REFERENCES book(id) ON DELETE CASCADE,
  cv_issue_id INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  checked_at  TEXT,
  cv_missing  TEXT
);
```

`book_id` as the primary key, so entering an id twice for the same comic —
correcting a typo — updates the row instead of leaving a stale one beside it.
`ON DELETE CASCADE` matches `read_progress`, `book_credit` and `book_tag`.
`created_at` is what makes the list readable in the order you made the entries.

`checked_at` and `cv_missing` are §5.3. `checked_at` is null when Comic Vine has
never been successfully read for this entry — the §3.4 case — which is different
from "read, and had everything".

### 5.3 What the list reports is Comic Vine's gaps, not the comic's

This is the correction that gives the list its point.

Because §3.1 guarantees a comic *keeps* every field it had, the comic's own row
cannot answer "is Comic Vine still thin?". A comic scanned with a
`ComicInfo.xml` already has title, date, summary and credits, so a column
computed from it would read "complete" the instant you bound it — whether Comic
Vine returned a full record or the empty one from §2.2. It would describe your
comic and claim to describe Comic Vine.

So what Comic Vine returned is recorded at the moment it is read.
`applyIssueToBook` writes `cv_missing` — a JSON array of the field names the
response did not supply, drawn from the same emptiness test as §3.1 — and stamps
`checked_at`, for any book that has an entry. Every apply and every refresh
updates both.

Tracked names: `date`, `title`, `summary`, `credits`, `characters`, `cover`. A
JSON array rather than columns, because the set will change as the tracked fields
do and this table is read by one page.

This is also what keeps §6.1 honest without a live Comic Vine call per row.

### 5.4 Removal is manual, always

Refreshing a row never removes it. A refresh that finds Comic Vine still empty is
the case the list exists for, and auto-removal would quietly discard exactly the
reminder you wanted.

Removal drops the bookkeeping note and nothing else: the comic keeps its Comic
Vine id, its metadata and its file. The row is a sticky note, and taking it down
is not an edit to the comic.

### 5.5 Refresh sends the book's current id, never the stored one

`cv_issue_id` records what you typed. It is not kept in step with
`book.comicvine_id`: match the same comic through search afterwards and the book
moves to a new id while the row still holds the old one.

A refresh that posted `cv_issue_id` would silently re-bind the comic to the id
you typed weeks ago and discard the later correction — a data-loss path in a
feature whose thesis is that nothing is overwritten.

So **refresh always posts `book.comicvine_id`**, and the row displays that id.
`cv_issue_id` is kept as the historical note of what you entered; when the two
differ the row says so, rather than showing one and acting on the other.

## 6. UI

### 6.1 Settings → Comic Vine

A subsection under the existing **Comic Vine** section of
`src/pages/Settings.tsx`, below the API key. Hidden entirely when the list is
empty, so Settings does not grow a permanent empty box.

Each row carries:

- the comic, linked to its page
- the Comic Vine id (§5.5), linked to `cv_site_url`
- **what Comic Vine still lacks** — `cv_missing` from §5.3, or "complete" when
  the array is empty, or "not yet read" when `checked_at` is null
- when you entered it, and when it was last read
- **Refresh** and **Remove**

Read straight from the stored columns, not from a Comic Vine call per row: the
list has to be readable without spending a request per row against a
one-per-second throttle, and the stored values are current as of the last
refresh, which is what the column claims to report.

### 6.2 In the match dialog

A second input below the search box: a label, a field, and an **Apply** button,
with the parse error (§4) under it. Present always, not only after a search
fails — during this outage the search returns an error rather than an empty list,
and a path that only appears on the happy failure is a path you cannot reach on
the unhappy one.

**`onPick` has to carry where the id came from.** Its current signature,
`(r: CvSearchResult) => void`, cannot say "typed by hand", and the call sites are
what invoke the API. It gains a second argument — `(r, opts?: { manual?: boolean })`
— and both sites pass it through. This is the one place where "neither call site
needs to change" does not hold.

**A hand-typed pick needs a label.** `Upload.tsx` builds `matchLabel` from
`r.name`, `r.issueNumber` and `r.year`, so an `{ id }`-only result renders a bare
"✓" with no text. The manual path synthesizes a `CvSearchResult` whose `name`
reads `Comic Vine #1197227`, so the upload page shows what it is about to apply.

### 6.3 Refresh from Comic Vine

A button in `IssueEditPanel`, beside the existing match button, shown only when
the comic has a `comicvineId`. It posts that id back to the apply route.

Reported honestly: it says what changed, or that Comic Vine had nothing new.
"Refreshed" alone would be indistinguishable from the thin-record case that §3.1
makes a no-op — the case most likely to be true right after you type an id.

**The diff is computed server-side.** `applyIssueToBook` already reads the book
before updating it, so it holds both sides; `AppliedIssue` gains an optional
`changed: string[]`. The client cannot do this: `IssueEditPanel` has no credits
or tags to compare against, so credit changes would be invisible, and
`comicinfo_synced` flips on every call via `syncComicInfoFile` and would make
every refresh look like a change. `comicinfoSynced` is excluded from the diff for
that reason.

Adding an optional field to `AppliedIssue` is additive for its other consumers
(`storeComic`, the route, `BookResponse`), which is what keeps this from
rippling.

The Settings row's Refresh reports the same thing in the row, and updates
`checked_at` and `cv_missing` in place.

## 7. API

```
POST   /api/books/:id/comicvine              { issueId, manual? }   (exists; gains `manual`)
GET    /api/comicvine/manual-entries         → { entries: ManualEntry[] }
DELETE /api/comicvine/manual-entries/:bookId → { removed: true }
```

Manual entry and refresh both go through the **existing** apply route. They
differ only in where the id came from, and a separate route would be the same
call under a different name — two paths to keep honest about §3.1 forever.

`manual: true` is set by the manual-entry input and by nothing else. Refresh does
not set it, so pressing Refresh does not re-stamp `created_at`, and matching
through search never files a reminder.

**The upload path needs the same flag plumbed through.** `Upload.tsx`'s
pre-upload `choose(r)` stashes the id in component state and ships it as a
multipart field to `/api/upload`, which reaches `applyIssueToBook` via
`storeComic.ts:121` and never touches the apply route at all. So the upload form
gains a `manual` field, the upload route reads it, and `storeComic` passes it on.

**The recording lives in `applyIssueToBook`, not in the route.** It is the one
choke point both callers pass through, and putting it there is what stops the
upload path and the library path from drifting. The service signature gains
`{ manual }`.

`ManualEntry` carries the book id, title and file name, the Comic Vine id and
site url, `created_at`, `checked_at` and the parsed `cv_missing` — enough to draw
a row without a second call per entry.

## 8. Limits this accepts

- **A wrong id binds to the wrong comic.** Nothing checks that issue `1197227`
  resembles the comic you are looking at; a typo landing on a real id applies
  that record. §3.4 catches only ids that exist nowhere. Re-entering the correct
  id fixes it, and §3.1 means the wrong record's empties did not overwrite
  anything on the way through.
- **`cv_missing` is as old as the last read.** It reflects `checked_at`, not
  Comic Vine as of now. Pressing Refresh is what makes it current, and that is
  the button next to it.
- **Nothing tells you an entry became complete.** You find out by looking, or by
  refreshing. A background re-check across the list would be a scheduler, a
  request budget and a notification surface, none of which exist yet. For the
  same reason there is no "refresh all": with a one-per-second throttle, per-row
  is honest about what it is doing.
- **Downloads are unaffected.** `findMatchForIssue` still returns nothing for an
  issue with no `coverDate` (`server/services/issueMatching.ts:58`), so a comic
  bound by hand to a thin record still cannot be downloaded through the
  missing-issue button until Comic Vine publishes a cover date. The index search
  at `/search` reaches those files today and is the route for that; changing the
  matcher is a separate question about download safety and is deliberately not
  opened here.

## 9. Testing

**Parser** (`test/cv-issue-id.test.ts`, new) owns §4 exhaustively: each accepted
shape, the volume rejection by message, the other `NNNN-` prefixes, whitespace,
query strings and fragments, and the junk case.

**`applyIssueToBook`** (`test/apply-issue.test.ts`, extend) owns §3.1 and §3.4 —
the cases that matter most, because the subject is data loss:

- a thin record (every optional field absent, no credits, no characters) applied
  to a book with a full set of fields leaves every one of them intact
- the same call still writes `comicvineId` and `cvSiteUrl`
- `''` and whitespace-only values are treated as empty, not written
- a cover url ending `blank.png` does not replace an existing cover
- a record with credits but no characters replaces credits and leaves tags
  alone, and the reverse — the per-kind guard
- a populated record still overwrites; the feature is not "never update"
- a book with nothing set still receives everything the record has
- `status_code: 101` rejects and writes nothing
- an HTTP 500 and a missing API key each bind `comicvineId` and file an entry
  with `checked_at` null
- `changed` lists only what moved, and never `comicinfoSynced`

**Model** (`test/cv-manual-entry.test.ts`, new): insert, re-insert for the same
book updating in place rather than duplicating, `checked_at`/`cv_missing` round
trip, delete, and cascade on book deletion.

**Route**: `manual: true` files an entry, a plain apply does not, refresh does
not re-stamp `created_at`, and the delete route removes the row while leaving
`book.comicvine_id` set — the §5.4 guarantee, and the one a future refactor is
most likely to break.

**Upload** (`test/upload*.test.ts` or alongside `storeComic`'s tests): a manual
id supplied through the upload form files an entry; a searched one does not.

**Dialog** (`test/ComicVineMatchDialog.test.tsx`, extend): a pasted issue URL
calls `onPick` with the parsed id and `{ manual: true }`; a pasted volume URL
calls nothing and shows the volume message; the manual input is reachable when
the search call has thrown.

**Settings** (`test/Settings.test.tsx`, extend or new): rows render `cv_missing`,
"not yet read" for a null `checked_at`, the divergence note of §5.5, the section
is absent when the list is empty, and Remove calls the delete route.

Per `CLAUDE.md`: iterate with the touched files plus `npm run typecheck`; the
full suite runs once before merge, and it is the gate here rather than a
formality, because §3.2 changes a path every existing match test already walks.

## 10. Files

| File | Change |
| --- | --- |
| `src/lib/cvIssueId.ts` | new — §4 parser |
| `server/lib/comicvine.ts` | typed error carrying `status_code` (§3.4) |
| `server/services/applyIssue.ts` | §3.1 omit-empties; §3.4 bind-on-failure; §5.3 record; §6.3 `changed` |
| `server/models/metadata.ts` | kind-scoped tag replace (§3.1) |
| `server/db.ts` | `cv_manual_entry` in `SCHEMA` |
| `server/models/cvManualEntry.ts` | new — upsert/list/delete |
| `server/routes/comicvine.ts` | `manual` on the apply route; list and delete routes |
| `server/routes/upload.ts` | read the `manual` form field (§7) |
| `server/services/storeComic.ts` | pass `manual` through (§7) |
| `src/api.ts` | `manual` flag, `ManualEntry`, `changed`, the two new calls |
| `src/components/ComicVineMatchDialog.tsx` | §6.2 manual input; `onPick` opts |
| `src/components/IssueEditPanel.tsx` | §6.3 Refresh button; pass `manual` |
| `src/pages/Upload.tsx` | pass `manual`; §6.2 synthesized label |
| `src/pages/Settings.tsx` | §6.1 reminder list |
| `src/styles.css` | the input row, the list rows |
| `test/cv-issue-id.test.ts` | new |
| `test/cv-manual-entry.test.ts` | new |
| `test/apply-issue.test.ts` | §9 cases |
| `test/ComicVineMatchDialog.test.tsx` | manual input cases |
| `test/Settings.test.tsx` | reminder list cases |
| route / upload tests | as §9 |
