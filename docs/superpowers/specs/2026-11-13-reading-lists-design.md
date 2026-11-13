# Reading Lists — Design Spec

Date: 2026-11-13

## 1. Overview

A story arc is Comic Vine's: every issue it tagged, tie-ins and all, one arc at a time.
Most of those tie-ins do not matter to the story. A **reading list** is the story as a
reader would actually follow it — issues in the order a good guide gives, across as many
series and arcs as it takes — with two lengths and a switch between them:

- **Core** — the story itself.
- **Full** — the story plus its tie-ins, each placed where it reads.

The first list is the one the user started from: Hickman's *Avengers* and *New Avengers*
through *Infinity* and *Time Runs Out* to *Secret Wars* (2015) — about 92 issues in Core,
several hundred in Full.

Lists are rare, so the app has **no editor**. A list is a file in the repo. When the user
wants one, they ask Claude ("make me a reading list for X"); Claude researches the order,
resolves every issue to its Comic Vine id with a script, writes the file, and a container
rebuild ships it.

### Goals

- Read a curated story across series, in a guide's order, with Core and Full one press apart.
- See at a glance how far through the story you are, phase by phase.
- Everything an arc page can do for an issue, a list can: covers and read state for what
  you own, `Get` / `Find` inside the blank for what you don't.
- Follow a list, so finishing an issue queues the next one.
- From any issue in a list, get back to the list.
- Writing the next list works the same way in a later session that has never seen this one.

### Non-goals

- Creating, editing, reordering or deleting a list in the app.
- Importing pasted text or `.cbl` files in the app. (A `.cbl` file can feed the authoring
  script — §6 — but that is Claude's tool, not a screen.)
- Counting a collected edition toward a list. Entries are single issues; the user is
  replacing *Avengers by Jonathan Hickman: The Complete Collection* with single issues.
- A bulk "get every missing issue" button. Not asked for; can come later.
- Any change to story arcs.

### Anti-goals

- **A list that disagrees with itself.** The page, Follow, the shelf count and the line on
  an issue's page must all agree on the order and on which length is active.
- **Hand-typed metadata.** Every value in a list file comes from Comic Vine through the
  script. Comic Vine is the source of truth for a comic's details.
- **Arc clutter creeping back.** Full is exactly what the file says. Nothing is filled in
  from Comic Vine's arcs.

## 2. Approaches

The user chose a single list with a Core | Full switch over "a list is one cut, make a
second list for another length", and chose lists-as-code over any in-app creation.

For what a list file holds per issue:

| | A. Self-contained entries **(chosen)** | B. Comic Vine ids only |
|---|---|---|
| Each entry holds | the Comic Vine issue id, plus volume name, volume id, number, cover date, story title — copied from Comic Vine by the script | the Comic Vine issue id |
| At view time | nothing asked of Comic Vine; works with no key | the server reads the rest in batches and caches it a day, like arcs |
| Cost | longer files (one line per issue) | a new cache, requests on each list's first view, no page without a key |

A was chosen: a published issue's details do not change, so re-reading them buys nothing,
and the cache is the most involved part of how arcs work.

Also rejected along the way: filling Full from the Comic Vine arcs a list spans (brings
back every tie-in Comic Vine tagged, placed by date guesswork — the problem lists exist
to solve), and an in-app importer for pasted guides (resolving "New Avengers #4" to one of
four volumes needs judgement a parser does not have).

## 3. The list file

One TypeScript module per list under `server/readingLists/`, registered in
`server/readingLists/index.ts`. A typed `ReadingList` shape means `npm run typecheck`
rejects a malformed list.

```ts
export const hickmanAvengers: ReadingList = {
  id: 1,                          // fixed forever: Follow and the saved switch key on it
  slug: 'hickmans-avengers',      // the url: /lists/hickmans-avengers
  name: "Hickman's Avengers",
  publisher: 'Marvel',
  years: '2012–2015',
  description: 'Avengers and New Avengers, through Infinity and Time Runs Out, to Secret Wars.',
  cover: 'https://comicvine.gamespot.com/a/uploads/…',   // the first issue's cover, for the shelf
  phases: [
    {
      name: 'Everything Dies & Avengers World',
      note: undefined,
      issues: [
        { cv: 375214, volume: 'New Avengers', volumeId: 56000, number: '1', coverDate: '2013-03-01', title: 'Memento Mori' },
        { cv: 372870, volume: 'Avengers', volumeId: 55958, number: '1', coverDate: '2013-02-01' },
        { cv: 412345, volume: 'Mighty Avengers', volumeId: 66123, number: '1', coverDate: '2013-11-01', extra: true },
        // …
      ],
    },
    // …
  ],
}
```

(Ids above are illustrative.)

**Sections.** Where a guide splits an act further, a phase holds `sections` in place of
`issues` — each `{ name, note?, issues }`. Secret Wars is the case that needs it: Marvel
Guides reads it as eight sections (Last Days, Welcome to Battleworld, Warzones…) whose core
is one or two issues each, so as phases they made Core a bar per issue. Full shows the
sections as headings inside the phase; Core reads the phase as one run.

Rules, enforced by a test over the real files (§8):

- List `id`s and `slug`s are unique across lists; an `id` is never reused.
- A Comic Vine issue appears at most once per list.
- Phase names are unique within a list; every phase and section has at least one issue.
  A phase or section may be all extras.
- `extra: true` marks an issue that is in Full only. Absent means Core.

## 4. Where it shows up

### 4.1 The shelf

A third door in the library rail's **Shelves** group, between Story Arcs and Following:
**Reading Lists**, at `/lists`. It shows a tile grid like the arcs shelf, one tile per
list: the list's `cover`, its name, and `31 of 92` — issues you own of the Core length.

### 4.2 The list page — `/lists/:slug`

Layout **B** from the mockups ("folded phases"):

**Header.** Back link (to wherever you came from, else *All reading lists*), the name,
`Marvel · 2012–2015 · 31 of 92 in your library · 24 read` (counts in the active length),
the description.

**Actions.** The `Core 92 | Full 214` switch, `Continue`, `Follow`. A list with no extras
has no switch.

**Phases.** One bar per phase: a chevron, the name, `You're here` on the current phase, the
issue count, a progress bar (read ÷ issues), and `N read` / `all read`. The current phase
opens on load; every other phase starts folded; clicking a bar opens or folds it. Which
bars are open is not saved.

**An open phase** shows its note, then a tile grid like the arc page — in Full, one grid
per section, under the section's name and note:

- an issue you own: its cover, read badge or percent, linking to the issue;
- an issue you don't: the dashed blank with `Get` / `Find` inside it, the same component
  the arc page uses;
- in Full, an extra carries a small **Tie-in** tag.

In Core, extras are not drawn, a phase with no Core issues is not drawn at all (the
Interlude is all tie-ins), and a split phase is one grid with no section headings.

### 4.3 The next issue: `Continue` and `You're here`

*Read* and *finished* mean the same everywhere in this spec: the comic's progress is
complete, the state a follow already keys on. *Owned* means a book in the library carries
that Comic Vine issue id.

The **next issue** is the one after the last issue you have finished, in the active
length — the same rule a follow uses, so a gap you skipped stays skipped. Nothing
finished yet: the first issue. Everything finished: there is none.

- `You're here` marks the phase holding the next issue. With no next issue, nothing is
  marked and every phase starts folded.
- `Continue · Avengers #17` opens the next issue in the reader (`/read/:id`) when you own
  it. When you don't, or there is no next issue, the button is not drawn; the open phase
  already shows the gap.

### 4.4 The issue page

Under the existing **Story arc** section, a **Reading list** section (plural when there are
several) with one linked line per list holding this issue:
`Hickman's Avengers · 47 of 92`. Position and total are in that list's active length. An
extra while the list is in Core reads `Hickman's Avengers · Tie-in` instead.

Lists are local, so this needs no Comic Vine request and can arrive with the page.

### 4.5 Following

- `Follow` on the list page creates a follow of a new kind, `list`, with `refId` = the
  list's `id`, in the existing `follow` table.
- The Following shelf draws a list follow like an arc follow: the unread books you own from
  the list, under the list's name; unfollowing it is labelled *reading list*.
- Finishing a book attempts every list follow whose list holds that book's Comic Vine id.
  The outcome is the arc rule over the list's issues in the active length: next after the
  last finished, `supplied` if owned, `wanted` otherwise. A wanted issue lands in the
  edition already claiming its Comic Vine volume, else one named for the volume — the
  arc rule.
- A list only changes when its file does, so the sweep's "refresh caught-up follows from
  Comic Vine" step skips list follows.
- A follow whose list has been removed from the code stops resolving and is pruned, as a
  follow of a deleted edition is today.
- Switching length changes what is queued next. It does not cancel anything already queued.

### 4.6 Get and Find

A download route for list issues, shaped like the arc one: it finds the entry by Comic
Vine id in any list, re-derives the match at press time, and files by the arc rule. `Find`
opens the existing Find-a-release modal seeded with the issue's own volume name and cover
date.

## 5. Saved state

The Core | Full choice lives in the database, one row per list (default Core), because
Follow runs on the server and must read the same length the page shows. Changing it
on the page saves it. Nothing else about a list is stored; the file is the list.

## 6. Writing a list

### The skill

A project skill, `.claude/skills/reading-list/`, for "make me a reading list for X":

1. Research the order from dedicated reading-order sources (Comic Book Herald, Comic Book
   Reading Orders, CMRO, the DieselTech CBL collection). Follow **one** guide end to end
   rather than mixing; say which, and where sources disagree.
2. Core is the guide's essential path; Full is its complete order. Mark extras.
3. Keep the guide's phases and their notes.
4. Resolve every issue with the script. Where a name could be several volumes, pick by
   years and publisher and **tell the user which was picked**.
5. Write the file with the next unused `id`, register it, run typecheck and the
   reading-list tests, rebuild the container.

### The script

Run with `tsx`, using the app's Comic Vine client. Input is either volume ids with issue
numbers or ranges (one request per volume, via the volume's issue list), or a `.cbl` file
whose entries already carry Comic Vine issue ids. Output is the entry lines for §3,
ready to paste. It reads the Comic Vine key from the environment or read-only from the
settings table, and it never writes to the database.

## 7. The first list

*Hickman's Avengers*, as shipped: 92 core issues and 317 tie-ins, 409 in all, every id
read back from Comic Vine with no disagreement on series or number. The draft is
`scripts/reading-lists/hickmans-avengers.json`.

Core is the 92 issues the user started from — *Avengers* (2012) #1–44, *New Avengers*
(2013) #1–33, *Infinity* #1–6, *Secret Wars* (2015) #1–9 — in the guides' order, and reads
as the example's five phases. (*Avengers* #24.NOW is #24's cover branding; Comic Vine has
one issue.)

| Phase | Core | Tie-ins |
|---|---|---|
| Everything Dies & Avengers World | 20 | 13 |
| Infinity | 21 | 33 |
| The Road to Time Runs Out | 22 | 5 |
| Interlude: Before Time Runs Out | 0 | 46 |
| Time Runs Out | 20 | 2 |
| Secret Wars (The Finale), in eight sections | 9 | 218 |

**Sources, one guide per span.** Comic Book Reading Orders' *Jonathan Hickman's Marvel
with Events* for New Avengers #1 to Avengers #44; Marvel Guides' Part 12 for Secret Wars,
the only guide that sections it. Both from the DieselTech CBL collection. Where CBRO's core
order differs from the user's example (Avengers #5 before New Avengers #4–6; Infinity #1
before New Avengers #8; New Avengers #18–23 after Avengers #29–34), the guide wins.

**Known gaps.** Marvel Guides leaves out *Loki: Agent of Asgard* #14–15 and *Secret Wars,
Too* #1, which CBRO includes; they are not in the list. *Armor Wars* #½ is its own Comic
Vine volume (*Secret Wars: Armor Wars*), so a download of it lands in a folder of that
name.

## 8. Testing

All against in-memory databases and fixture lists, never `./data`.

- **The real list files:** ids, slugs and per-list issue uniqueness; every phase and
  section non-empty.
- **List model:** Core vs Full filtering, phases and sections hidden in Core, owned / read counts,
  the next issue (nothing finished, mid-list with a skipped gap, all finished).
- **Following:** list outcome in each length; finishing a book attempts list follows;
  removed list prunes; sweep skips list follows.
- **Routes:** the list, the length switch, download by Comic Vine id, the issue's lists.
- **Pages:** shelf tile counts; the list page's folding, `You're here`, switch, Tie-in tag,
  gaps, `Continue` present / absent; the issue page's Reading list line.

## 9. Calls made without asking

Listed so they can be checked in one pass:

1. The shelf tile's count is Core, whatever the list's switch says.
2. A list with no extras hides the switch.
3. Which phases are open is not remembered between visits.
4. `Continue` opens the reader directly, and is hidden when the next issue is missing.
5. The issue page shows `Tie-in` instead of a position for an extra while the list is in Core.
6. Switching length does not cancel already-queued downloads.
7. The first list is named *Hickman's Avengers* and its Full length includes the Secret
   Wars tie-ins.
8. The Interlude — 46 tie-ins the guide places before Time Runs Out — is a phase of its own,
   so Core never shows it. (Asked afterwards and agreed: Secret Wars is one phase with
   sections rather than eight phases.)

## 10. Left to the builder

Module and component names; API shapes; whether an issue's lists come with the book
payload or a small endpoint of their own; how the Following page tells which unread books
belong to a list; the script's exact input syntax.
