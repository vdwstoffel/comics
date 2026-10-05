# Following — Design Spec

Date: 2026-10-04

## 1. Overview

A shelf for the runs and arcs you are keeping up with, reached from a rail entry
beside Story Arcs. You follow a volume or a story arc; finishing an issue queues
the next one; when the next one cannot be found yet, the follow waits and is
retried the next time the index is scraped.

Unread is a backlog. It accumulates — a run you are behind on puts every issue
on it at once — and answers "what is left" rather than "what am I reading". This
is the second question, and it needs a different shelf.

Everything here follows from one rule: **a follow pulls exactly one issue, and
only in response to you finishing one.** Nothing is pre-fetched, nothing is
topped up in the background, and a follow you never read pulls nothing. That is
what keeps the shelf from becoming the backlog it exists to escape.

### Goals

- Follow a volume or a story arc from the page you already open to read it.
- Finishing an issue queues the next one, with no further press.
- An issue that cannot be found yet is not lost: the next scrape retries it.
- A caught-up follow stays visible and says what it is waiting for, so a live
  watch is distinguishable from a forgotten one.
- Cost nothing when idle: no new timer, no new background process, and no
  Comic Vine request for a follow that is not waiting on anything.

### Non-goals

- **Volume succession.** When Iron Man (2020) ends and Iron Man (2024) begins,
  the follow ends with the run. Comic Vine has no "succeeded by" link, so a
  successor can only be guessed from name and year, and a wrong guess downloads
  the wrong comics. §6.2 keeps the door open.
- **Following a series or a character.** Both are standing searches over things
  that do not exist yet, which is a different feature with a different failure
  mode. You follow a run or an arc: a finite, enumerable list of issues.
- **Queueing more than one issue ahead.** "Get all" on the volume page already
  fills a run you have fallen behind on, and it is one press.
- **A timer.** Nothing in this app runs on a schedule today, and this feature
  does not change that. §4.3 states the limit this accepts.
- **Notifications.** Nothing here pushes. The shelf is where you find out.

## 2. What a follow is

```sql
CREATE TABLE IF NOT EXISTS follow (
  kind       TEXT NOT NULL,     -- 'volume' | 'arc'
  ref_id     INTEGER NOT NULL,  -- edition.id for a volume; Comic Vine's arc id for an arc
  name       TEXT NOT NULL,     -- display name as of the day you followed
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, ref_id)
);
```

### 2.1 Why a volume follow points at an edition

A download has to land somewhere, and that somewhere is the edition's own name
and folder — hand-editable, and frequently not what Comic Vine calls the volume.
`startIssueDownload` already separates the two parameters for this reason:
`volumeName` is what the match keys on, `editionName` is where the file goes.

An edition carries `comicvine_id` and `cv_name`, so from an edition the Comic
Vine side is one column away. From a Comic Vine volume id, the edition is a
lookup that can return nothing or more than one row. The direction that always
answers is the one to store.

### 2.2 Why an arc follow points at a Comic Vine id

An arc has no local row of its own. It exists as a `book_tag` value on the
issues that carry it, and the arc page is addressed by that name. The name is
therefore not stable: re-matching an issue can restate it. `resolveArcId`
already turns a name into Comic Vine's arc id, and that id is what every cached
arc and every saved arc order is already keyed by.

### 2.3 The polymorphic key, and what it costs

`(kind, ref_id)` cannot carry a foreign key, so an edition deleted out from
under a follow leaves an orphan row. Two cheap guards rather than a schema
change: the edition delete route removes the follow, and the follow list prunes
any row whose target no longer resolves. Neither can crash the shelf, which is
the only thing that matters here.

### 2.4 A volume must be matched to Comic Vine

The whole mechanism rests on an issue list and a match rule, and both need
`cv_name`. An unmatched edition therefore cannot be followed, and `POST` refuses
it with 409 and a reason naming the fix. The alternative — accepting the follow
and leaving it permanently inert — looks identical to a bug.

## 3. The engine

One new module, `server/services/following.ts`, holding one real function and a
thin wrapper around the existing download path.

### 3.1 `nextWantedIssue(app, follow)`

Walks the follow's issue list in order and returns the one issue to fetch, or
nothing with a reason.

The list is the `volume_issue` cache for a volume, and `getCachedArc` with
`applySavedOrder` for an arc — the latter so a followed arc reads in the order
you arranged it rather than the one dates computed, exactly as the arc page
does. Ownership is `book.comicvine_id`, which is an exact identity on both
sides, scoped to the edition for a volume follow and global for an arc (an arc
crosses volumes by definition).

The walk finds the last issue in the list that you **own and have finished**,
and returns the first issue after it that you do not own. Four outcomes, named
once here and used unchanged by the API (§5.1) and the tiles (§5.3):

| Outcome | Condition | Means |
|---|---|---|
| `wanted` + the issue | a gap after the last finished issue | fetch it |
| `supplied` | the next issue is already owned | nothing to do |
| `dormant` | no finished issue in the list | nothing to do |
| `caught-up` | the last finished issue is last in the list | nothing to fetch yet |

`wanted` is not exclusive with having something to read. Finish #6, be missing
#7 and own #8 unread, and the follow is simultaneously waiting on #7 and
offering #8. §5.2 is why that needs no special case.

**The anchor is the last issue you finished, not the last one you own.** An
issue abandoned halfway stops the run, deliberately: the feature exists to put
the next thing to read in front of you, and it has no business running ahead of
a comic you put down.

That case is self-explaining rather than mysterious, which is what makes the
rule safe. Abandon #6 and the follow reads `supplied` — #6 is itself the unread
issue on the shelf — so the run never goes quiet without showing you the comic
holding it up. The one genuinely silent state is `dormant`, which is why §5.3
gives it words.

### 3.2 `attemptFollow(app, follow)`

Resolves the want and hands it to `startIssueDownload`, the same function a
single Get press uses. Nothing here re-implements matching, link parsing or
queueing; in particular the match is re-derived server-side at the moment of
queueing rather than carried from whatever computed it earlier, and a
double-queue is refused by the partial unique index on live rows rather than by
a check that could interleave.

### 3.3 Two callers, one function

**Finishing a comic.** `PUT /api/books/:id/progress` attempts the follows that
contain that book — the volume follow on its edition, and any arc follow among
its `story_arc` tags — when `completed` becomes true and was not true before.
Fire-and-forget and wrapped: saving your place in a comic must never wait on, or
fail because of, someone else's web server.

**A scrape finishing.** The sweep walks every follow, three seconds apart,
reusing the pacing rule and the in-flight guard that `queueMissingIssues`
already establishes for walking a volume. The pause is for the same reason it
exists there: every attempt fetches a post from a site that has no reason to
tolerate a burst.

It is invoked from the scrape **route**, after `done` resolves — not from inside
`createScrapeRunner`. Not a style preference: the runner is constructed with
`Ctx` (`db` and `config`), while an attempt needs `app.downloader`, which does
not exist yet at the point `index.ts` builds the runner. The route is the first
place that holds both.

A scrape finishing is the precise moment a match becomes newly possible, which
is what makes this retry both free and correctly timed — fresh rows are the only
thing that can change a `no-match` into a download.

### 3.4 Refreshing Comic Vine

A `caught-up` follow is the only kind that needs a Comic Vine read: the app
cannot learn that #7 exists by re-reading a cached list that ends at #6. The
sweep refreshes caught-up follows whose cache is older than the existing 24-hour
policy, capped at 20 per sweep so a long follow list cannot spend the 200
requests an hour the whole app shares.

Every other state is answered entirely from local tables.

### 3.5 Nothing is stored about a failure

`startIssueDownload` types its refusals: `no-match`, `duplicate`, `unreadable`,
`no-link`. For a follow attempt **all four are non-events** — the want is still
wanted, and the next sweep computes it again from scratch. There is no attempt
counter, no backoff, and no pending-want row, because there is nothing that
needs to be reconciled when you read ahead by hand, delete a comic, or reorder
an arc.

The cost of this choice is that "waiting since the 3rd, tried six times" is not
available to show. It is the thing least likely to be wanted and the only thing
given up.

## 4. Limits this accepts

### 4.1 A dormant follow

Following a run you have never read pulls nothing, by design (§1). Following
attempts once on creation, so following a run you are *already* part-way
through does the obvious thing immediately rather than making you re-read an
issue to trigger it.

### 4.2 An abandoned issue stops the run

Stated in §3.1, where it is also shown to be self-explaining: the abandoned
issue is the one on the shelf.

### 4.3 Arrival is bounded by scraping

Because the retry rides on scrapes (§3.3), a follow waiting on an issue is
retried only when you scrape. Follow a dozen runs and never scrape, and nothing
ever arrives. This is the accepted cost of adding no timer, and the design does
not foreclose one: a scheduler, if it is ever wanted, calls the same sweep.

## 5. API and UI

### 5.1 Endpoints

- `GET /api/follows` — one row per follow: kind, ref id, name, the §3.1 outcome,
  and for a `wanted` one the issue number and its store date when Comic Vine has
  one. The server answers *what am I waiting for*. It does not assemble the
  shelf.
- `POST /api/follows` — addressed the way each kind is addressed everywhere
  else: `{kind: 'volume', editionId}`, or `{kind: 'arc', name}` resolved through
  the same `resolveArcId` every other arc route uses. Refuses an unmatched
  volume with 409 (§2.4) and attempts once (§4.1).
- `DELETE /api/follows/:kind/:refId` — canonical, by stored id.

So the arc page can unfollow as well as follow, `GET /api/arcs/:name` gains the
resolved `arcId` it already computes internally and currently discards.

### 5.2 The page

`/following`, rendered inside `LibraryLayout` so it keeps the rail, exactly as
`/arcs` is. Two queries: the follows above, and the same
`getLibraryBooks({ readState: 'unread' })` the Library page already makes.

Each follow draws one of two things, decided by whether it has unread issues
rather than by its outcome:

- **it has unread issues** → `groupByVolume` / `groupByArc` and the existing
  `VolumeGroupTile` / `ArcGroupTile`, unchanged, so the deck of plates, the
  "cover opens the next issue" rule and the spoiler rules hold here without
  being restated. A `wanted` outcome adds a status line beneath it; this is the
  mixed case of §3.1, and it needs no special case because the two questions
  were never the same question.
- **it has none** → `FollowWaitingTile`.

The division of labour is the point: the server knows what is wanted, the client
knows what a shelf looks like.

### 5.3 `FollowWaitingTile`

The one new component: a tile with no cover, because there is nothing to open.
It carries the name, the status line, and the unfollow control. Every line is
derived from the §3.1 outcome rather than stored, and they are different facts:

- `wanted`, and the issue is live in the download queue → **"getting #7"**
- `wanted`, and it is not → **"#7 is out — not posted yet"**
- `caught-up` → **"waiting on the next issue to be announced"**
- `dormant` → **"nothing read yet — finish an issue to pull the next"**

### 5.4 Follow and unfollow

Follow is a button on the edition page and the arc page — the pages you already
open to read the thing. Unfollow lives on a thin wrapper around each tile on the
Following page, not inside `VolumeGroupTile`: that component is drawn on the
Library shelf too and has no business knowing this feature exists.

### 5.5 The rail

One Following entry with a count of follows, built the way the Story Arcs door
is built — a single link rather than a list, for the same reason it is one
there: there is no ceiling on how many a library accumulates.

## 6. Testing

Written first, one file per module, against in-memory databases and injected
fetchers. Nothing touches the real library or the network.

- `following-next-wanted` — the four outcomes of §3.1 across volume and arc:
  a plain gap, nothing finished, next already owned, caught up; an issue
  abandoned halfway stopping the run; an arc respecting a saved order; an
  unmatched edition yielding nothing.
- `following-attempt` — queues through an injected `fetchPage`; a duplicate is
  refused; a `no-match` queues nothing and throws nothing.
- `routes-follows` — the three endpoints, the 409 for an unmatched volume, the
  attempt on create, and a deleted edition pruned from the list.
- `follow-on-finish` — completing a book attempts its volume and arc follows;
  completing one already complete attempts nothing; an attempt that throws still
  returns the saved progress.
- `follow-sweep` — a scrape finishing sweeps every follow; the guard prevents a
  second concurrent sweep; the Comic Vine refresh is capped and skipped when no
  key is set.
- `Following.test.tsx` — ready, waiting and dormant tiles; the two waiting
  reasons; unfollow calls the api.

### 6.1 Fixture note

Tests seed `volume_issue` and `arc_issue` directly rather than through a Comic
Vine fake, because every one of them is a question about ordering and ownership,
not about fetching.

### 6.2 If succession is wanted later

Nothing here forecloses it. A `caught-up` follow whose volume Comic Vine marks
ended is exactly where the question "is there a successor?" would be asked, and
it would be asked as an offer on the waiting tile.

## 7. Files

New:

- `server/models/follows.ts` — the table's reads and writes
- `server/services/following.ts` — `nextWantedIssue`, `attemptFollow`, the sweep
- `server/routes/follows.ts` — the three endpoints
- `src/pages/Following.tsx` — the shelf
- `src/components/FollowWaitingTile.tsx` — the waiting tile
- `src/components/FollowButton.tsx` — follow/unfollow, used by three pages
- `test/following-next-wanted.test.ts`, `test/following-attempt.test.ts`,
  `test/routes-follows.test.ts`, `test/follow-on-finish.test.ts`,
  `test/follow-sweep.test.ts`, `test/Following.test.tsx`

Changed:

- `server/db.ts` — the `follow` table
- `server/index.ts` — register the route
- `server/routes/books.ts` — attempt on completion
- `server/routes/comicIndex.ts` — sweep after a scrape (§3.3)
- `server/routes/editions.ts` — drop a follow with its edition
- `server/routes/arcs.ts` — expose the resolved `arcId` (§5.1)
- `src/App.tsx` — the `/following` route
- `src/api.ts` — `getFollows`, `follow`, `unfollow` and their types
- `src/components/LibraryRail.tsx` — the Following door
- `src/pages/Edition.tsx`, `src/pages/Arc.tsx` — the follow button
- `src/styles.css` — the waiting tile
