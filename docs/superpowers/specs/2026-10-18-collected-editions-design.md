# Collected editions — Design Spec

Date: 2026-10-18

## 1. Overview

Comic Vine gives every collected-edition *line* a volume of its own. When a
publisher rebrands the line halfway through — and Marvel does this routinely, as
a creative team changes or a story gets a marquee name — one run of trades
arrives in the library as several unrelated shelves.

The library holds the case that prompted this. Thirteen trade paperbacks, all
reprinting **The Amazing Spider-Man (2022)**, Comic Vine volume `142577`:

| Edition | Comic Vine volume | Books | What it holds |
|---|---|---|---|
| The Amazing Spider-Man by Wells and Romita Jr. (2022) | `149382` | 3 | TPB vols 1–3 |
| Amazing Spider-Man By Zeb Wells (2023) | `150443` | 9 | TPB vols 4–12 |
| Amazing Spider-Man: The 8 Deaths Of Spider-Man (2025) | `165956` | 1 | TPB, collects #61–70 |

Three shelves, one run. Every `comicvine_id` above is *correct* — each really is
its own volume on Comic Vine — which is why no amount of renaming fixes this.
Renaming an edition also moves files on disk (`renameEdition` in
`services/library.ts`) and would throw away two genuine Comic Vine links to buy
a grouping that a second field gives for free.

The rule everything here follows:

> **A collection is not a volume. It is a bundle of a volume's comics.**

An issue of The Amazing Spider-Man (2025) is one of that volume's comics, and it
sits on that volume's shelf. A trade reprinting The Amazing Spider-Man (2022) is
a bundle of *that* volume's comics, and it belongs on that volume's shelf by the
same logic. The shelf is the volume. The packaging is a detail of the book, not
a reason for a shelf of its own.

Every edition keeps its own Comic Vine link, its own row, and its files exactly
where they are. What is added is a second link — *what this reprints* — and the
shelf is drawn from that.

### Goals

- One shelf per volume, holding every comic you own of that volume, whatever
  form it arrived in.
- The three editions above draw as a single shelf named for the volume they
  reprint, with thirteen comics under it.
- **That shelf is the home shelf for its books.** Opening a comic from it and
  closing the reader bring you back to it, not to the collection the comic
  happened to ship in.
- **The collapse holds everywhere a volume is drawn** — the series page and the
  unread shelf on the Library home page both.
- Nothing renames. No file moves. No Comic Vine link is overwritten or lost.
- Continuity works the link out from Comic Vine where it can, and **asks before
  it writes**.
- The source volume is one click away from the shelf.

### Non-goals

- **Interleaving collections among the issues they collect.** A shelf may hold
  both a volume's single issues and a trade reprinting them (§2.3), but putting
  that trade at the position of the issues it collects — rather than at its own
  date — is deferred. Stoffel does not own any run in both forms today and asked
  that this wait until he does. §5.4 records the ordering rule that holds.
- **Collected-issue ranges, for anything.** §3.3 shows the data exists as prose.
  It is not parsed here and it never drives sort order. §8.1 keeps the door open
  for coverage ("you have #1–26 and #61–70, you are missing #27–60"), which is
  the only thing it is reliable enough for.
- **Merging editions.** No row is deleted, no books are reparented, nothing is
  consolidated on disk. The grouping is drawn at read time from a column.
- **Following a merged shelf.** §7.2.
- **Detecting anything without confirmation.** §4.

### Anti-goals

Things that would make this a failure even if it technically worked:

- **A shelf that rearranges itself because a Comic Vine editor retyped a
  paragraph.** The detection in §3 reads hand-written prose. Prose may be
  rewritten, truncated or blanked at any time. Nothing about the shape of the
  library may depend on it after the moment you confirm it — which is the whole
  reason the answer is stored on the edition rather than recomputed on read.
- **Losing a correct Comic Vine link to gain a grouping.** `comicvine_id` on
  each of the three editions is right. If an implementation ends up clearing,
  overwriting or "fixing" it, the implementation is wrong.
- **A guess applied silently.** A wrong source volume quietly folds two
  unrelated runs into one shelf, and the user has no obvious way to notice.
- **A feature that is true on one page and false on another.** The complaint
  that started this is "these should be together". A home page that still shows
  three tiles has not answered it.

## 2. The new link

An edition gains a pointer to the volume it reprints:

```sql
ALTER TABLE edition ADD COLUMN collects_volume_id INTEGER;
```

Added in `openDb` alongside the existing additive column migrations in
`server/db.ts` — the same `columnsOf(db, 'edition').includes(...)` guard the
`cv_name` / `cv_start_year` / `cv_site_url` columns use.

`NULL` means this edition is not known to reprint anything, which covers both
"it is an ordinary run of issues" and "nobody has looked yet". §4.3 says why
those two need telling apart and what that costs.

### 2.1 Why a second column and not a changed first one

`comicvine_id` answers *"what volume is this?"*. For edition 84 the answer is
`150443`, Amazing Spider-Man By Zeb Wells, and that is the volume whose cover,
issue list and metadata the edition page already reads. It is not wrong and it
is still needed.

`collects_volume_id` answers a different question — *"what volume does this
reprint?"* — and for all three editions above the answer is the same: `142577`.
Two questions, two columns.

### 2.2 Naming the shelf

The shelf is named for the volume it is a shelf of: **"The Amazing Spider-Man
(2022)"** — Comic Vine's name for `142577` and its start year. That name is not
on the edition row today.

The codebase already has a pattern for exactly this: `cv_name`, `cv_start_year`
and `cv_site_url` denormalise the edition's *own* volume onto the edition row so
a page view costs no Comic Vine request. Builder's call, but the obvious move is
to mirror it — `collects_cv_name`, `collects_cv_start_year`,
`collects_cv_site_url` — written at the moment the link is confirmed. The
alternative, reading it from `volume_cache` on each render, means a shelf whose
heading disappears when the cache is cold.

`collects_cv_site_url` is also the quick link in §5.5.

### 2.3 The shelf key: both columns, not one

An edition belongs to the shelf for volume *V* when **either**
`collects_volume_id = V` **or** `comicvine_id = V`.

Grouping on `collects_volume_id` alone would put a trade of ASM (2025) on a
different shelf from the 37 single issues of ASM (2025) you already own, because
the issues' edition carries `comicvine_id = 163325` and no collects link at all.
Asked directly whether those should share a shelf, Stoffel's answer was *"should
be same"*, and the Goals say so: one shelf per volume, whatever form it arrived
in.

So the key is `collects_volume_id ?? comicvine_id` — the volume this edition is
*about*, however it arrived. An ordinary run of issues keys on itself and is
unaffected; a collection keys on what it reprints and joins the run.

This cannot arise in the library today — no edition carries
`comicvine_id = 142577`, and ASM (2025) is volume `163325` — but it sets the
shape of the grouping now rather than after there is data to migrate.

A consequence for §5.3: a shelf that holds *some* of its volume's single issues
is a run with gaps in it, and should draw the issue grid the edition page draws
today. A shelf that holds only collections should not.

## 3. Working it out from Comic Vine

This was spiked against the live API on 2026-10-18 with the three volumes above.
The findings are recorded here because they are the fragile part and a builder
should not have to rediscover them.

**It is viable as a suggestion and not as a source of truth.** Two independent
places carry the answer. Neither covers all three editions on its own.

### 3.1 Source one — the collection volume's description

`GET /api/volume/4050-150443/` returns a `description` that begins:

```html
<p>Series of trade paperbacks collecting <a href="/the-amazing-spider-man/4050-142577/"
   data-ref-id="4050-142577">The Amazing Spider-Man</a></p>
<ul><li>Volume 4: <a ... data-ref-id="4050-142577">The Amazing Spider-Man</a> #15-18, ...
```

`data-ref-id="4050-<id>"` is a machine-readable volume reference. Results:

| Volume | Volume refs found | Right answer available? |
|---|---|---|
| `149382` | `142577` ×1, `150443` ×1 | yes |
| `150443` | `142577` ×6, `149382` ×1 | yes |
| `165956` | none — **description is empty** | no |

**The trap:** these descriptions also link *sibling collections*. `149382` says
"Collects … (2022). Continued on in → `150443`", and `150443` links back to
`149382`. On `149382` the two candidates are tied at one reference each, so
"most-referenced volume" is not the rule. The rule that held on both is **the
first volume referenced after a collecting verb** — `Collects`, `collecting`.
Prose, written by hand, and worth matching loosely.

**The existing client cannot see this.** `cv.getVolume` in
`server/lib/comicvine.ts` maps the response to `summary: stripHtml(r.description)`,
which strips the markup and takes every `data-ref-id` with it. Detection needs
the raw `description` field. Either widen `CvVolume` to carry it alongside the
stripped summary, or give detection its own fetch — builder's call, but reading
`summary` will silently find nothing.

### 3.2 Source two — the trade's own issue description

This is what rescues `165956`, whose volume description is empty. Its single
issue, `4000-1123097`, ends its description with:

```
COLLECTING: Amazing Spider-Man (2022) 61-70
```

Plain text. No link, so no id — becoming one needs a name-and-year lookup
against Comic Vine's volume search, which is fuzzier than a `data-ref-id` and
can land on the wrong volume where a title has been reused.

### 3.3 What this means

Between the two sources all three editions resolve. Neither alone does, and both
are free prose that can be absent (as `165956` demonstrates), reworded, or
wrong. Expect a good hit rate and regular misses.

That is exactly why the stored column in §2 is the real feature and detection is
a convenience on top of it. **An edition whose link cannot be detected must
still be settable by hand**, and a library where detection never ran at all must
still work.

The issue range in §3.2 — `61-70` — is deliberately not used. See §8.1.

## 4. Confirming

> Decided by the user, in these words: *"wait for a yes"*.

Detection **proposes**. It never writes `collects_volume_id` on its own.

The proposal appears on the edition page: this edition looks like it collects
*The Amazing Spider-Man (2022)*, with the Comic Vine link to check it against,
and a yes. Accepting writes the column and the denormalised name fields from
§2.2.

### 4.1 This is new UI, not a reuse

Worth stating plainly, because it is easy to assume otherwise: **there is no
by-hand volume picker for an edition today.** An edition's `comicvine_id` is
only ever set server-side, by `POST /api/editions/:id/comicvine-volume`
(`server/routes/editions.ts`), which walks to the first book carrying a Comic
Vine id and resolves that issue's volume. It surfaces on the edition page as the
"Check Comic Vine" / "Rename to…" banner. `ComicVineMatchDialog` is not that —
it searches Comic Vine *issues*, and is wired only to `Upload` and
`IssueEditPanel`.

So both the confirm and the by-hand override are built here. The banner on the
edition page is the closest existing pattern to follow.

### 4.2 Why a confirmation at all

The failure mode is invisible. A wrong `comicvine_id` shows up immediately as a
wrong cover or a wrong issue list. A wrong `collects_volume_id` silently folds
two unrelated runs onto one shelf and looks, at a glance, like the feature
working. A confirmation step costs one click per collection — there are three in
this library — and is the only thing standing between the user and a shelf they
cannot explain.

For the same reason a confirmed link must be **withdrawable**, not only
replaceable: clearing it has to put the edition back on its own shelf.

### 4.3 Declining has to stick, so there are three states

"No, this does not collect anything" is an answer, and re-proposing it every
time the page opens would make the feature an irritant within a week.

`collects_volume_id IS NULL` cannot distinguish *never looked*, *looked and
found nothing*, and *offered and declined*. The codebase has met this before and
solved it the same way each time — `volume_cache`, `release_day` and
`upcoming_week` all exist purely so that "no rows" and "never asked" are
different facts (see the comments in `server/db.ts`).

Builder's call how. A `collects_checked_at TEXT` beside the id is the cheapest
thing that works: null means never looked, set-with-null-id means looked and the
answer was no.

## 5. The shelf

### 5.1 Where the collapse applies

> Decided by the user: **everywhere a volume is drawn.**

Two places draw volumes today, and both collapse:

**The series page** (`src/pages/Series.tsx`). `listSeries` already gathers these
six editions under one series, "The Amazing Spider-Man" — that part works today
and is not changed. What changes is the tiles underneath. Editions sharing a
shelf key (§2.3) draw one tile, named from §2.2, subtitled with the total book
count. Six tiles become four:

```
The Amazing Spider-Man (2022)   The Amazing Spider-Man (2025)   Annual (2026)   Epic Collection
13 trades                       37 issues                       1 issue         2 issues
```

**The unread shelf on the Library home page** (`src/pages/Library.tsx`, via
`groupByVolume` in `src/lib/volumeGroups.ts` and `VolumeGroupTile`). This is
keyed on `book.editionId` today, so thirteen unread trades draw as the same
three tiles the feature exists to collapse — on the page the user looks at most.

Collapsing both means the shelf key cannot be a series-page-only derivation. The
cleanest shape is for the server to put the key (and the shelf's display name)
on each book in the library payload, and for `groupByVolume` to group on that
instead of on `editionId`; the series page then uses the same key. Builder's
call, but duplicating the rule in `src/lib/` the way `annuals.ts` duplicates
`deriveSeriesName` is a poor fit here — that rule is a regex over a name, this
one is a join across rows.

`VolumeGroupTile`'s "open the next unread comic" link needs a merged notion of
*next*: the earliest unread book by the §5.4 order across the whole shelf, not
within one edition.

The `splitAnnuals` "only collapse from two upwards" rule carries over: a lone
collection with a collects link and no sibling draws as itself, because a tile
that opens onto one tile is a click that buys nothing. The tile's cover comes
from its first book's thumbnail, as the annuals tile does.

An edition with no collects link that shares its key with nothing is untouched
and draws exactly as it does now.

### 5.2 The shelf owns its books

> Decided by the user: opening a comic from the merged shelf and closing the
> reader both land back on **the merged shelf**.

This is the part that reaches outside the new page, and it should be planned for
up front rather than discovered.

Every route to a comic in this app funnels through `BookRedirect`
(`src/pages/BookRedirect.tsx`), which sends `/book/:id` to
`/edition/:editionId?issue=book-:id`. The reader closes to the same place, and
Downloads, Upload, Releases, the arc pages and the annuals page all name a comic
by id alone and inherit whatever that redirect decides. Left as-is, every one of
them drops you onto "Amazing Spider-Man By Zeb Wells (2023)".

So `BookRedirect` is the hinge: a book whose edition has a shelf key shared with
others resolves to the volume shelf, and everything upstream follows for free.
The reader's back target and the carousel's `?issue=book-N` deep links have to
agree with it.

### 5.3 What the shelf draws

A shelf of all thirteen books, gathered across every edition sharing the key.
Each book keeps its own row, its own file, its own read progress and its own
edition underneath — the collection it came in is still visible on the book, it
is simply no longer a shelf.

A route keyed by the volume rather than an edition id — `/volume/:cvId`
alongside the existing `/edition/:id` — is the obvious shape. Builder's call.
Note it is series-blind where §5.1's grouping is not; scoping the grouping
query to the editions that share a series avoids two unrelated series gathering
on one key.

**A collections-only shelf does not draw the source volume's issue grid.**
*(My call.)* The edition page currently renders a volume's full Comic Vine issue
list with a tile per missing issue and a Get button. The Amazing Spider-Man
(2022) has roughly seventy issues and the user owns none of them as issues —
only as trades. Rendering seventy missing-issue tiles above thirteen trades
buries the thing you opened the shelf for, and offers to download issues the
user has deliberately bought in collected form.

By §2.3 the opposite case is a shelf that *does* hold single issues of its
volume. That one is a run with gaps and draws the grid exactly as the edition
page does now. The test is what the shelf holds, not what the volume has.

The individual collection edition pages are otherwise untouched, including their
own grids of the collection volume's missing trades — which is where "get Zeb
Wells volume 13 when it ships" continues to live.

### 5.4 Order

**By date.**

Numbering cannot do it: Wells & Romita holds TPB volumes 1, 2, 3 and Zeb Wells
holds 4 through 12 — those chain cleanly — but 8 Deaths is its own volume "1",
so a shelf sorted by number puts it above volume 2. Date puts it last, which is
correct: it collects #61–70 and the others cover #1–26. All thirteen books carry
a date, spanning 2022-10 to 2025-07, and that order is the right reading order.

A book with no date is the only judgement call, and it is the builder's.

### 5.5 Getting back to the collections, and the quick link

*(My call — the reviewer was right that §5.1 removes the only general route to
these pages.)*

The shelf header lists the collections it gathers — "Wells & Romita Jr. ·
Zeb Wells · The 8 Deaths of Spider-Man" — each linking to its edition page. That
is where Follow, Edit, Remove edition, the missing-trade grid and the §4
override all still live, and the list is also the plainest statement of why
thirteen books from three paperback lines are on one shelf.

Beside it, a link out to the source volume on Comic Vine, from
`collects_cv_site_url`. Each individual edition page carries the same link — it
is the clearest statement of what that edition actually is.

## 6. Other volumes on Comic Vine

> Decided by the user: once the trades are confirmed, **stop offering** the run
> they collect.

`src/pages/Series.tsx` builds `ownedVolumeIds` from `edition.comicvineId` and
hands it to `OtherVolumes`, which lists the series' Comic Vine volumes you do
not have. Left alone, the series page would offer "The Amazing Spider-Man (2022)
· Marvel · ~70 issues · Find ↗" directly beneath a shelf named The Amazing
Spider-Man (2022), which reads as a bug.

`ownedVolumeIds` gains every confirmed `collects_volume_id`. The cost, accepted
knowingly: the offer to go and find that run as single issues disappears, which
is the right call for a run you have bought in collected form.

## 7. What this must not disturb

### 7.1 Series grouping

`series_name` and `listSeries` are untouched. This feature draws *within* a
series; it does not change which series an edition is in.

### 7.2 Follows

`follow.ref_id` is `edition.id` for a volume follow, because a download has to
land in an edition's folder. A merged shelf spans three editions and has no
single folder, so **the merged shelf is not followable** in this iteration.
Follow stays on the individual edition pages, which §5.5 keeps reachable.
Revisit if it bites.

### 7.3 Downloads and uploads

Both target an edition folder. §5.3 keeps the missing-issue grid off a
collections-only shelf, so there is no Get and no upload-into-a-gap on it, and
the question of which of three folders a download lands in does not arise. A
mixed shelf (§2.3) that does draw a grid has an unambiguous answer: the edition
holding that volume's single issues.

### 7.4 Deleting

"Remove series" and "remove edition" keep their current scope. Nothing acquires
the power to delete thirteen books across three editions in one press as a side
effect of them now sharing a tile.

### 7.5 Read progress, filters, read state

All per-book and all unaffected.

## 8. Left to the builder

- The exact column set in §2.2, and the three-state representation in §4.3.
- Where the shelf key is computed and how it reaches the Library payload (§5.1).
- Route naming, and whether the shelf reuses the Edition page's components or
  gets its own.
- How the §4 proposal is surfaced, and where the by-hand override and the
  withdraw live.
- Whether `CvVolume` widens to carry the raw description or detection fetches
  its own (§3.1).
- Where detection runs: on scan, on first view of an edition page, or only on
  request. It costs one Comic Vine request per collection and the key is rate
  limited to 200/hour, so it should not run speculatively across the library.
- The undated-book fallback in §5.4.
- Tests. Per `CLAUDE.md`: narrow runs plus `npm run typecheck` while iterating,
  one full `npm test` before the branch merges.

### 8.1 The door left open

The issue ranges in §3.1 and §3.2 — `Volume 4: ... #15-18`, `COLLECTING: ...
61-70` — are enough to say *"you have #1–26 and #61–70 of this volume; you are
missing #27–60"*. That is worth having, and it is the right home for the gap
information §5.3 keeps off the shelf.

It is out of scope here because it rests on the least reliable data in the
spec, and because the user asked for the shelf. If it is built later, the rule
from the Anti-goals stands: ranges may inform what the shelf *says*, and may
never decide what order the shelf is *in*.
