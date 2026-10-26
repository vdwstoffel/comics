# Bulk volume upload — Design Spec

Date: 2026-10-25

## 1. Overview

A **Bulk add** screen for the case the single-issue flow handles badly: you have
a folder holding most or all of a run, and uploading it one comic at a time
means forty trips through Upload, forty Comic Vine searches, and forty chances
to pick the wrong volume.

You pick the folder. You search Comic Vine for the volume **once**. The app
reads the issue number out of each file name, pairs it with an issue in that
volume, and shows you the whole table before anything moves. You fix what it got
wrong, then press the button and the lot goes up — each file carrying its Comic
Vine issue id, so it arrives renamed, filed into the right edition, with real
metadata written into the library and back into the archive.

One rule shapes it: **nothing is uploaded until the user has seen what it will
be matched to.** The matcher will be wrong — `024.NOW`, annuals, whatever the
next folder brings — and the cheapest place to catch that is a table on screen,
not a library you have to repair afterwards.

### Goals

- Add a whole volume in one pass, with one Comic Vine volume search.
- Match on the series *and* issue number in the file name, tolerating the
  release tags real files carry: `Avengers 020 (2013) (Digital) (Zone-Empire).cbr`
  → issue #20 of the Avengers volume, and nothing else's #20.
- Show every pairing before anything uploads, and let the user correct any row.
- Cope with a folder that spans volumes — annuals are a separate Comic Vine
  volume and will be in these folders.
- Never touch a comic already in the library unless the user ticks that row.
- Reach the same end state as the per-gap upload button: right name, right
  edition, Comic Vine metadata in the database and in `ComicInfo.xml`.
- Stay inside Comic Vine's request budget for a batch of realistic size.
- **Lose track of nothing.** A comic the matcher could not place still lands,
  and is still findable afterwards from a list that outlives the tab.

### Non-goals

- **A server-side queue.** The bytes come from the browser, so the tab must stay
  open. See §6.3.
- **Resuming an interrupted batch.** See §8.
- **Pointing the app at a folder on the server's own disk.** Upload through the
  GUI, as every other intake does.
- **Changing the single-file Upload page.** It keeps working exactly as it does;
  Bulk add is a second door, not a replacement.
- **Guessing the volume.** The user picks it from search results, always. The
  app never resolves a volume from a file name — `matchIssue`'s existing
  refusal-over-guessing rule (`server/lib/issueMatch.ts:88`) is the house
  position and this does not undercut it.
- **Scraping, or any new metadata source.** Comic Vine only.

## 2. What this is answering

### 2.1 The folder, as it actually looks

From the user's own screenshot:

```
Avengers 020 (2013) (Digital) (Zone-Empire).cbr
Avengers 021 (2013) (Digital) (Zone-Empire).cbr
Avengers 022 (2013) (Digital) (Zone-Empire).cbr
Avengers 023 (2014) (Digital) (Zone-Empire).cbr
Avengers 024.NOW (2014) (Digital) (Zone-Empire).cbr
Avengers 025 (2014) (Digital) (Zone-Empire).cbr
…
```

Scene-release naming: zero-padded number, cover year, a format tag, a group
tag. The user was explicit that **this will not always be the exact shape**, so
nothing may depend on `(Digital)` or `(Zone-Empire)` being present, or on the
year being there at all.

### 2.2 `cvQueryFromFileName` already does most of the parse

`src/lib/cvQuery.ts` strips trailing `(…)` and `[…]` groups repeatedly, then
takes a trailing number with an optional dotted suffix and drops the leading
zeros. `Avengers 020 (2013) (Digital) (Zone-Empire).cbr` yields series
`Avengers`, number `20`.

It is not exported in that shape — the parse is inlined in two query builders.
§3.2 extracts it.

### 2.3 `024.NOW` is the known gotcha, and there will be others

That parse yields `24.NOW`. Comic Vine lists the issue as number **`24`**, with
`.NOW Rogue Planet Part 1` as its *title* — `.NOW` was Marvel's branding on the
cover, not part of the issue number. An exact string compare drops that file.

The dotted suffix cannot simply be discarded: `16.1`, `1.MU` and friends are
real Comic Vine issue numbers for point-one issues, and stripping the suffix
there would match the wrong issue. §4.2 handles both.

The user's framing is the one to build to: *"I don't know what other gotchas
there will be in the future."* The matcher is allowed to fail. It is not allowed
to fail quietly.

### 2.4 Annuals are a different volume

`src/lib/annuals.ts` already records this: Comic Vine gives each year's annual
its own volume — `Avengers Annual (2014)` — holding a single issue, numbered #1.
A folder of a run will contain them. One volume per batch is therefore wrong.

### 2.5 Four Comic Vine calls per comic, against 200 an hour

This is the constraint that shapes §6.

`storeComic` calls `cv.getIssue` and `cv.getVolume` to build the file name
(`server/services/storeComic.ts:96-98`). It then calls `applyIssueToBook`, which
calls `cv.getIssue` and `cv.getVolume` **again**
(`server/services/applyIssue.ts:104,154`). Neither result is cached: `getVolume`
has no cache at all, and `getIssue`'s is per-request.

That is four requests per comic, against Comic Vine's budget of 200 an hour
(`server/routes/comicvine.ts:142`) and the client's own one-per-second throttle
(`server/lib/comicvine.ts:300`).

| Batch | Calls today | Verdict |
| --- | --- | --- |
| 42 files | 168 | 84% of the hourly budget, ~3 min of throttle |
| 100 files | 400 | Over budget. Fails partway through. |

Single-issue uploads never exposed this because nobody does forty of them in a
row. Bulk does, by definition. §6.2 cuts it to roughly one call per comic.

### 2.6 What already exists and is reused unchanged

| Piece | Where | Used for |
| --- | --- | --- |
| `GET /api/comicvine/volumes?series=` | `server/routes/comicvine.ts:144` | The volume search. Cached a day. |
| `cv.listVolumeIssues` + `volume_issue` cache | `server/models/volumeIssues.ts` | The volume's issue list. Cached a day. |
| `uploadComic({file, edition, issueId})` | `src/lib/uploadComic.ts` | One file, with progress. |
| `POST /api/upload` → `storeComic` | `server/routes/upload.ts` | Convert, validate, file, name, index, apply. |
| `ComicVineMatchDialog` | `src/components/ComicVineMatchDialog.tsx` | The per-comic escape hatch, after the fact. |
| `cv_manual_entry` + Settings list | `server/models/cvManualEntry.ts` | Where an unmatched comic surfaces for later. |

Bulk add is mostly assembly. The genuinely new code is the matcher (§4), the
screen (§5), and the request-budget fix (§6.2).

## 3. Approach

### 3.1 The batch is files × volumes, not one volume

A batch holds a list of files. Each file is in one of four states:

| State | Meaning |
| --- | --- |
| **matched** | paired with a Comic Vine issue in a chosen volume |
| **owned here** | paired, and the library already has that issue *in this volume's edition* |
| **owned elsewhere** | paired, and the library has it filed under some other edition |
| **unplaced** | no volume claims it, or its volume has no issue that fits |
| **ignored** | not a `.cbz` or `.cbr` |

A volume search **claims only unplaced files**, and claims one only when its
series *and* its number agree (§4.1 — the number alone would let the wrong
volume take a one-shot). Searching "Avengers" matches the 39 files that key to
that volume and have a number in its issue list, and leaves the annual behind;
**+ Search another volume** runs a second search offered only the leftovers, and
"Avengers Annual" picks it up. A later search can never steal a file an earlier
one matched, so the order of searches cannot change the result for an
already-matched file.

This generalises past annuals at no extra cost: a folder spanning a relaunch, or
a crossover one-shot, works the same way.

### 3.2 One parser, shared

Extract the parse currently inlined in `cvQuery.ts` into an exported function in
`src/lib/`:

```ts
export interface ParsedComicName {
  /** The name with release tags and the trailing number removed: "Avengers". */
  series: string
  /** Leading zeros dropped, dotted suffix kept: "20", "24.NOW". Null when none. */
  number: string | null
}
export function parseComicFileName(fileName: string): ParsedComicName
```

`cvQueryFromFileName` and `buildCvQuery` are rewritten on top of it so there is
one notion of "the number in this file name". Two copies would drift, and the
drift would show up as Bulk add and the Upload page disagreeing about the same
file — which is the bug `storeComic`'s own doc comment warns about for intakes.

### 3.3 Matching is client-side

The table is built in the browser from the `File` objects the picker gave and
the issue list the API returned. No new server-side matching service. The server
learns about a pairing only when the file is uploaded, as `issueId` on
`/api/upload` — exactly what `IssueUploadAction` sends today.

## 4. Matching rules

### 4.1 A volume claims a file only if the series agrees

**The number alone is not enough to claim a file, and §3.1 must not be read as
saying it is.** `Avengers World 001 (2014) (Digital).cbr` parses to number `1`,
and `Avengers (2013)` has an issue #1. On number alone that file is claimed by
the wrong volume and shown as a confident, plausible-looking match — which turns
the review table from a safety net into forty rows the user has to audit.

So a volume claims a file only when **both** the series and the number agree.

The series comparison folds the two sources' punctuation together and nothing
else: separators to spaces, a leading "the" dropped, lowercased — Comic Vine's
`The Uncanny X-Men` and a file's `Uncanny X-Men` are the same series, and a
hyphen inside a word is left alone because `Spider-Man` is a real distinction.

This is exactly `matchKey` (`server/lib/issueMatch.ts:52`), and the rule is
**deliberately copied into `src/lib/` rather than imported**: nothing under
`src/` reaches into `server/`, and `src/lib/annuals.ts:9-12` already documents
this same trade-off for the same reason. The copy must carry a comment pointing
at its twin.

The comparison is against the **volume's own name**, not the series the user
typed into the search box — they searched "avengers" and chose
`Avengers Annual (2014)`, and it is the choice that counts.

**A false negative here is cheap and a false positive is expensive.** A file
left unplaced costs one dropdown; a file matched to the wrong volume's #1 costs
a wrong comic in the library with wrong metadata written into its archive. Where
the rule is unsure, it leaves the file unplaced.

### 4.2 Normalise both sides identically

Comic Vine's `number` is a string and carries its own conventions. Run both the
parsed file number and `issue.number` through the same normaliser — trim, drop
leading zeros, keep a dotted suffix, lowercase it — before comparing. A
comparison where only one side is normalised is the bug this paragraph exists to
prevent.

### 4.3 Exact first, then the base number, then refuse

1. **Exact.** One issue in the volume whose normalised number equals the file's
   → matched. This is what protects `16.1` and `1.MU`: a volume that really has
   a `16.1` matches it here and never reaches step 2.
2. **Base number.** Only when step 1 found nothing *and* the file's number has a
   dotted suffix: compare on the part before the dot. Accepted only when
   **exactly one** issue carries that base number and **no other file** matched
   that issue exactly. This is the `024.NOW` → `#24` path.
3. **Refuse.** Anything else leaves the file unplaced.

### 4.4 Two files, one issue: neither wins

If two files resolve to the same issue, both become unplaced and both say so.
Not "first one wins" — the user has a `.cbr` and a `.cbz` of the same issue more
often than they have a matcher bug, and picking one silently is the wrong half
of the choice to make for them.

This follows `matchIssue`'s rule verbatim: *"two matches is no match"*
(`server/lib/issueMatch.ts:93`).

### 4.5 Owned is decided by Comic Vine issue id

Never by number. This is the same rule `/api/editions/:id/issues` already
enforces (`server/routes/editions.ts:289`) and for the same reason: issue
numbers repeat across volumes.

The screen needs to know which of the volume's issues the library already has.
Where an edition bound to that volume exists, `GET /api/editions/:id/issues`
already answers it. §7 adds the volume-keyed equivalent for a volume with no
edition yet.

### 4.6 Non-comics are ignored, not reported as failures

A folder picker returns everything — `readme.txt`, `.nfo`, cover `.jpg`s. Filter
to `.cbz` and `.cbr`, count them in the summary line, and do not list them as
rows needing attention. *(My call, not the user's — flagged here so it can be
overruled.)*

## 5. The screen

### 5.1 Where it lives

A new route, `/upload/bulk`, reached from a link on the Upload page. The header
keeps its single `+ Upload` entry rather than growing a second button.

### 5.2 Shape

```
Bulk add                                         42 files picked

┌ Avengers (2013) · Marvel · 44 issues · 39 matched ──────────┐
│ Avengers 020 (2013) (Digital)…      →  ✓ #20  Infinity      │
│ Avengers 024.NOW (2014) (Digital)…  →  ✓ #24  .NOW Rogue …  │
│ Avengers 026 (2014) (Digital)…      →    #26  already yours │
│                                              ☐ replace      │
│ Avengers 030 (2014) (Digital)…      →    #30  filed under   │
│                                              Unsorted       │
│                                              ☑ replace      │
└─────────────────────────────────────────────────────────────┘
┌ Avengers Annual (2014) · Marvel · 1 issue · 1 matched ──────┐
│ Avengers Annual 001 (2014) (Digital)…  →  ✓ #1              │
└─────────────────────────────────────────────────────────────┘
┌ 2 files not placed yet          [ + Search another volume ] ┐
│ Avengers World 001 (2014) (Digital)…  →  [ pick an issue ▾ ]│
└─────────────────────────────────────────────────────────────┘

[ Upload 41 comics ]   1 skipped (already yours) · 1 ignored
```

Grouped by volume, so a mis-sorted file is visible as a file under the wrong
heading rather than a wrong number in a long flat list.

### 5.3 Fixing a row is a dropdown, not a second search

An unplaced file inside a chosen volume gets a dropdown of **that volume's own
unclaimed issues**. The volume is already known, so picking #24 off a short list
beats typing an id or running another search. Issues already claimed by another
file are not offered.

A file no volume claims has no dropdown until a volume takes it —
**+ Search another volume** is its only affordance.

### 5.4 A comic you already own: skipped, with a tick to replace

Decided by the user. The row is greyed, excluded from the upload, and counted in
the summary ("1 skipped"). A per-row **replace** tick includes it.

**Unless the copy you have is filed somewhere else**, which is a different row
state with the opposite default. Decided by the user: six Avengers issues
sitting in `Unsorted` from an old scan are the ones you most wanted properly
filed, and skipping them by default means the batch quietly declines to fix
exactly what you ran it for. So the row reads *"you have this, filed under
Unsorted"*, its replace tick is **on**, and leaving it on re-files the comic
into the run with real metadata — the old copy deleted by the same §5.4
sequence as any other replace. Untick it and it skips like any owned row.

The distinction needs the owning edition, so `/api/comicvine/volumes/:id/issues`
returns it alongside `bookId` (§7).

*Checked against the live library: 219 books, every one carrying a Comic Vine
id, no strays and no edition sharing a volume with another. This row state will
be rare today — it earns its place on the first folder that overlaps an old
scan.*

**Replace means the old comic is deleted.** The user was asked and was explicit:
*"that replace should delete the other one, we don't want duplicates filling up
the server."* Two copies of every issue is the outcome this feature exists to
avoid, so a replace that merely adds a second file is not a replace.

It is a destructive act, so the order it happens in is the whole design:

1. **Upload the new file first.** It lands under a deduped name —
   `dedupeDestPath` under `renameLock` (`server/services/storeComic.ts:104-113`)
   guarantees it cannot land on top of the existing one. That guard stays
   exactly as it is; it was written after a version of this code destroyed a
   file and then failed the unique constraint on `book.file_path`.
2. **Only once it has landed and indexed**, remove the old book with the
   existing `removeBook` (`server/services/library.ts:370`) — file, thumbnail,
   row, and the edition pruned if that was its last issue.
3. **Then rename the new file** to the canonical name, now that the old one has
   released it. A failed rename is cosmetic and is not an error: the comic is in
   the library under a deduped name, which a later tidy-up corrects.

If step 1 fails, nothing is deleted and the row reports the failure. **There is
no path in which the old comic is removed before the new one is safely in.**

The row names where the existing copy lives — its edition — so a replace about
to delete a comic out of a *collection* rather than the run is visible before it
happens, not afterwards.

Two guards on top:

- The replace tick is per row and off by default. There is no "replace all".
- The Upload button's summary states the count plainly — "Upload 41 comics ·
  **3 will replace and delete** · 1 skipped" — so a batch that is about to
  delete three comics says so on the button.

### 5.5 Unplaced files upload anyway, and are findable afterwards

A row still showing "pick an issue" when Upload is pressed **goes up unmatched**.
The file lands in the volume's edition with whatever its own `ComicInfo.xml`
says and no Comic Vine id. The user was explicit: *"everything should upload,
then … a list with disputed comics that should be manually resolved."* The file
is never the thing you lose.

**The existing follow-up list would not have caught these, and that is a change
this spec makes.** Membership is computed from blank date, summary or credits
(`missingMetadata`, `server/models/metadataFollowups.ts:68-78`), deliberately
derived from the book rather than from how it was matched. A scene digital
release ships a filled-in `ComicInfo.xml`, and `ingestFile` reads date, summary
and credits straight out of it (`server/services/indexer.ts:77,90-112`) — so an
unmatched comic from one of these folders has all three, qualifies for nothing,
and disappears. It is precisely the disputed comic the user asked to keep.

So `missingMetadata` gains one arm: **no Comic Vine id**. A comic with no id
is unresolved whatever its archive says, and the list exists for exactly that.

The blast radius was measured, not estimated: **0 of 219 books in the live
library lack a `comicvine_id`**, so this adds no rows today and will show the
bulk leftovers and nothing else. It also keeps faith with that model's own
stated principle — the list reports the hole, not the route in — because an
absent id is the largest hole there is. It is listed ahead of the other three
reasons, since a comic with no id cannot be refreshed into one.

### 5.6 The end-of-run summary

What landed, what was skipped, what replaced, what failed, what arrived without
metadata — and a link to the edition. Decided by the user: this is a report, not
the system of record. The durable list is Settings (§5.5), which is still there
after the tab is closed.

A file no volume claims at all has no edition to land in; it goes to `Unsorted`,
which is what `storeComic` already does with an empty edition name.

## 6. Uploading

### 6.1 Sequential, with per-row progress

One `uploadComic` at a time, in table order. Not parallel: each upload drives a
`.cbr` → `.cbz` conversion, a page scan and a Comic Vine call on the server, and
three at once makes the throttle in §2.5 worse rather than better.

The row shows its own percent; a header bar shows "19 of 41". A file that fails
marks its row and the batch carries on — a bad archive in the middle of a folder
must not cost the other forty.

**"Landed without metadata" is its own row state, not a success.** This matters
because the server reports it as one: `storeComic` swallows a Comic Vine failure
on purpose — the naming lookup sits in a bare `catch`
(`server/services/storeComic.ts:101`, *"a name we cannot improve is no reason to
refuse the comic"*) and a non-101 apply failure binds the id and returns
`{ok: true, metadataApplied: false}` (`storeComic.ts:138-142`), so
`/api/upload` answers **200**. Taking that at face value would let a batch that
exhausted the hourly budget at file 60 report "100 of 100" while forty comics sit
bare.

So the row reads amber, the header counts them separately, and the final summary
names them. Decided by the user: **the batch carries on regardless** — every
file lands, and the bare ones are worked through afterwards from the Settings
list, which §5.5 makes sure they reach.

### 6.2 Cutting the Comic Vine calls

Two changes, both in existing server code, both of which benefit the single-file
path as well:

**a. Let the caller supply the name parts.** `storeComic` only calls
`getIssue`/`getVolume` to build `comicFileName(volume.name, issue.number, ext)`.
Bulk already holds both — the volume name from the search result, the issue
number from `listVolumeIssues`. Add optional `volumeName` and `issueNumber` to
`StoreComicInput`; when both are present, skip the lookup. Saves 2 calls per
comic. The existing path passes neither and is unchanged.

These two fields now come **from the client**, and they end up in a filename.
`comicFileName` already runs its series through `slug()`
(`server/lib/comicFileName.ts:33,56`), which strips anything that could make a
path — that is the guard, and it must not be bypassed. Nothing else about the
destination is client-controlled: the directory still comes from the edition row.

**b. Cache `getVolume` by id — in a table, not in the client.** A `volume` table
beside `volume_issue`, same day-long policy. Every comic in a batch has the same
volume, so this collapses ~42 identical requests into one. Saves ~1 call per
comic.

An in-client cache would save **nothing**: `storeComic` calls
`createComicVine(...)` fresh for every comic (`server/services/storeComic.ts:96`)
and the factory's state is per-instance (`let lastCall = 0`,
`server/lib/comicvine.ts:296-304`), so a per-instance cache would hit zero times
in a 42-file batch. The same line means the one-per-second throttle is not
global today either — worth knowing, out of scope to fix here.

That leaves the `getIssue` inside `applyIssueToBook` — one per comic, genuinely
needed, since the per-issue summary, credits, characters and cover are not in
the volume issue list.

| Batch | Before | After |
| --- | --- | --- |
| 42 files | 168 | ~44 |
| 100 files | 400 | ~102 |

A batch materially larger than ~150 files will still exhaust the hourly budget.
The screen should say so before the user starts — a plain warning above the
button when the batch exceeds 150 — rather than discovering it at file 150.
*(My call: warn, don't block.)*

### 6.3 The tab has to stay open

The bytes come from the browser, so unlike the download queue this cannot be
handed to the server and forgotten. Say so on the screen, and guard the tab with
`beforeunload` while a batch is running. A 42-file batch is roughly ten minutes.

## 7. API

One new route and one new field. Everything else reuses what exists.

```
GET /api/comicvine/volumes/:volumeId/issues
→ { volumeId,
    edition: { id, name } | null,          // the library's edition for this volume
    issues: [{ id, number, name, coverDate, siteUrl,
               owned, bookId?, ownedIn?: { editionId, editionName } }],
    fetchedAt, stale?, unavailable? }
```

The volume-keyed sibling of `GET /api/editions/:id/issues`. Same cache
(`getCachedVolumeIssues` / `cacheVolumeIssues`, a day), same
stale-beats-nothing fallback, same `unavailable` shape when Comic Vine will not
answer and nothing is held.

`owned` is resolved across the whole library by `book.comicvine_id`, not within
one edition — before a bulk add there may be no edition for this volume at all,
and the user may hold issues of it filed somewhere else.

`ownedIn` names where that copy actually lives, and `edition` names the one this
volume belongs to (by `getEditionByComicvineId`, per §7's edition rule). Comparing
the two is what separates **owned here** from **owned elsewhere** in §3.1, and
what the row prints when it says "filed under Unsorted".

It does **not** compute `match` (the scraped-release matching
`/api/editions/:id/issues` does for its download buttons). Bulk has files, not
releases.

### `replaceBookId` on `POST /api/upload`

A new optional multipart field carrying the id of the book this upload replaces.
The deletion belongs on the server, in the same request that stores the file,
because the ordering in §5.4 is the safety property — a client that uploads and
then issues a separate `DELETE /api/books/:id` can lose the race, and a tab
closed between the two calls leaves a duplicate behind, which is the thing the
user asked to avoid.

```
POST /api/upload
  file, edition, issueId, volumeName, issueNumber, replaceBookId?
→ { book, metadataApplied?, replaced?: { bookId, editionRemoved } }
```

Sequence, after `storeComic` has returned `ok: true`:

1. `removeBook(ctx, replaceBookId)` — the existing service, unchanged.
2. Rename the new file to its canonical name, now unclaimed. Best-effort:
   a failure is logged and the comic keeps its deduped name.

`storeComic` failing means the route never reaches step 1 and answers its
existing error. The field is ignored when it names a book that no longer exists.

Validated like every other id on this surface: digits only, positive integer, a
404 if there is no such book — the rule `/api/books/:id/comicvine` already
applies (`server/routes/comicvine.ts:60`).

### Which edition a batch files into

`storeComic` resolves the destination by **name** (`getEditionByName`,
`server/services/storeComic.ts:80-84`), so the name Bulk sends decides whether a
run stays whole or splits in two. Composing `` `${volume.name} (${volume.startYear})` ``
unconditionally is wrong, and the live library proves it:
`Amazing Spider-Man: Halloween Special` has `cv_start_year` **0**, so the
composed name is `… (0)` and a bulk batch of that volume would land in a second
edition beside the one that already holds it.

The rule, which is the one three existing intakes already use —
`server/routes/releases.ts:158`, `server/routes/arcs.ts:245`,
`server/services/following.ts:125`:

1. `getEditionByComicvineId(db, volumeId)` — if the library already has an
   edition for this volume, **use its existing name**, whatever it is called.
2. Otherwise `` `${name} (${startYear})` ``, and the bare `name` when
   `startYear` is missing, zero or not an integer.

The volume group's header shows the edition it will file into, so a batch about
to create a new edition, or to join an existing one under an unexpected name, is
visible before the upload rather than afterwards.

*Checked:* 55 editions, every one carrying a volume id, no two sharing one —
the library is consistent today, and rule 1 is what keeps it that way.

## 8. Limits this accepts

- **No resume.** Close the tab mid-batch and the uploaded files are in the
  library, the rest are not. Re-picking the folder and re-running is safe: the
  ones that landed come back as "already yours" and are skipped by default.
- **No server-side folder import.** Deliberate, see §1.
- **The matcher will still be wrong sometimes.** That is why §5 exists. The
  measure of success is not that it matches everything, it is that it never
  matches wrongly without showing you first.
- **Batches over ~150 files** will hit Comic Vine's hourly budget even after
  §6.2. Warned, not prevented — and when it happens mid-batch the remaining
  files still land, carrying their id but no metadata, and are repaired from
  the Settings list afterwards. The user chose this over pausing. Nothing
  counts requests, here or anywhere in the codebase; the 200/hour in
  `server/routes/comicvine.ts:142` is a comment, not a counter, so the batch
  cannot know in advance that a week of run-page views already spent the hour.
- **A replace cannot be undone.** `removeBook` deletes the file. Mitigated by
  the ordering in §5.4 — the replacement is always safely in first — and by the
  tick being per-row and off by default, but there is no trash can in this app
  and this spec does not add one.

## 9. Testing

Per `CLAUDE.md`: narrow runs plus `npm run typecheck` while iterating, one full
`npm test` before merging. Per the repo's standing rule, **nothing in these tests
may write into `./data`** — throwaway filenames and temp dirs only.

**Parser** (`parseComicFileName`)
- The real folder: `Avengers 020 (2013) (Digital) (Zone-Empire).cbr` → `Avengers`/`20`.
- Suffix kept: `Avengers 024.NOW (2014) ….cbr` → `24.NOW`.
- No tags: `Avengers 20.cbz`. No number: `Avengers Omnibus.cbz`.
- Bracketed tags, `[…]`, and stacked tags.
- `cvQueryFromFileName` and `buildCvQuery` still return exactly what they did —
  the existing tests for both must pass untouched.

**Series gating** (§4.1)
- `Avengers World 001.cbr` is **not** claimed by `Avengers (2013)`, although
  that volume has a #1. The regression this rule exists for.
- `Uncanny X-Men 001.cbr` is claimed by Comic Vine's `The Uncanny X-Men`.
- `Spider-Man` does not key to `Spider Man`'s volume via the hyphen rule.
- `Avengers Annual 001.cbr` keys to `Avengers Annual`, not `Avengers`.

**Matcher**
- Exact match across a volume's list.
- `24.NOW` → `#24` by the base-number fallback.
- `16.1` matches `16.1` exactly and does **not** collapse to `16`.
- Base-number fallback refuses when another file already matched `#24` exactly.
- Two files, one issue → both unplaced.
- Owned by issue id, not number: a library copy of a *different* volume's #20
  does not mark this one owned.
- A second volume search claims only unplaced files and cannot steal a match.

**Screen**
- Rows render in their four states; counts in the summary line agree with them.
- The dropdown offers only unclaimed issues of that row's volume.
- `replace` unticked excludes the row from the upload; ticked includes it.
- Upload is disabled with nothing to upload.

**Server**
- `/api/comicvine/volumes/:id/issues`: fresh, cached, stale-on-failure, and
  `unavailable` with nothing held.
- `owned` resolves across editions, not within one; `ownedIn` names the edition.
- Edition resolution: an existing edition for the volume is reused **under its
  own name**, and a volume with `startYear` 0 or absent composes the bare name,
  never `… (0)`. Both asserted against the `Amazing Spider-Man: Halloween
  Special` shape.
- `missingMetadata` reports `comicvine id` for a book with no id, and is
  unchanged for a book that has one.
- A book with a full `ComicInfo.xml` but no Comic Vine id **is** on the
  follow-up list. The §5.5 regression.
- `storeComic` with `volumeName` + `issueNumber` makes **no** naming lookup and
  produces the same file name as the lookup would have.
- `storeComic` without them behaves exactly as it does today.
- `getVolume` cache: two calls for the same id make one request.

**Replace** — the destructive path, so tested hardest, and on temp dirs only:
- The happy path: old file gone, old row gone, new file present under the
  canonical name, one book for that issue.
- **`storeComic` fails → the old book and its file are still there.** The
  single most important test in this document.
- The new file lands under a deduped name *before* the delete — the existing
  file is never renamed onto.
- A rename that fails after the delete still leaves the new comic in the
  library, reachable, under its deduped name.
- `replaceBookId` naming a book that does not exist: the upload still succeeds.
- Replacing the last issue of an edition prunes that edition, as `removeBook`
  already does.

## 10. Files

**New**
- `src/pages/BulkUpload.tsx` — the screen.
- `src/lib/comicFileParse.ts` — `parseComicFileName`.
- `src/lib/bulkMatch.ts` — the matcher and the batch state model.
- `src/components/BulkVolumeGroup.tsx`, `src/components/BulkIssuePicker.tsx`.
- tests alongside, per the repo's layout under `test/`.

**Changed**
- `src/lib/cvQuery.ts` — rebuilt on the shared parser.
- `src/lib/uploadComic.ts` — carries `volumeName`, `issueNumber`,
  `replaceBookId` across the multipart boundary.
- `src/App.tsx` — the `/upload/bulk` route.
- `src/pages/Upload.tsx` — a link across to it.
- `src/api.ts` — the new endpoint.
- `server/routes/comicvine.ts` — the volume-issues route.
- `server/routes/upload.ts` — the `replaceBookId` field and the §7 sequence.
- `server/services/storeComic.ts` — optional `volumeName` / `issueNumber`.
- `server/lib/comicvine.ts` — `getVolume` cache.
- *(not `renameFiles.ts`)* — step 3 of the replace needs no new naming code.
  `storeComic` already computes the name it wanted before `dedupeDestPath` took
  it away (`finalName`, `server/services/storeComic.ts:93-102`); returning that
  alongside the path it actually got is enough to rename onto it once the old
  file is gone. The library-wide tidy-up is untouched.
- `server/models/metadataFollowups.ts` — the "no Comic Vine id" arm (§5.5).
- `server/models/volumeIssues.ts` or a sibling — the `volume` cache table (§6.2b).
- `src/pages/MetadataFollowups.tsx` — render the new reason.

**Finishing**, per `CLAUDE.md`: `docker compose up -d --build`, then check it at
`http://localhost:8090`.
