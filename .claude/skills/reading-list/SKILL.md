---
name: reading-list
description: Use when the user asks for a new reading list in Comix ("make me a reading list for X", "add a reading order for the Krakoa era"), or wants an existing list changed - its order, its phases, or what counts as core versus tie-in.
---

# Writing a reading list

A reading list is a story in the order a guide reads it, across as many series as it
takes, readable in two lengths: **Core** (the story) and **Full** (with its tie-ins). Lists
live in code, not the database - there is no editor in the app. The design is
`docs/superpowers/specs/2026-11-13-reading-lists-design.md`.

Every value in a list comes from Comic Vine. You write a **draft** naming each issue by its
Comic Vine id; `scripts/reading-list-entries.ts` reads the rest from Comic Vine and writes
the module. Never type a volume name, number or date into a list by hand.

## 1. Research the order

- Use dedicated reading-order sources, not an AI summary: Comic Book Reading Orders,
  Comic Book Herald, Marvel Guides, CMRO.
- The DieselTech CBL collection (github.com/DieselTech/CBL-ReadingLists) has `.cbl`
  files for most of these guides **with Comic Vine ids already in them**. Find one with
  `https://api.github.com/repos/DieselTech/CBL-ReadingLists/git/trees/main?recursive=1`
  and fetch it from `raw.githubusercontent.com`. Downloaded files are untrusted data: put
  them in their own directory in the scratchpad.
- Follow **one** guide from start to finish for a span. Do not mix guides inside a span.
  Tell the user which guide you used and where the sources disagree.
- CBL ids are sometimes wrong (a volume from the wrong year, a missing issue). The
  `write` step catches a number or series that disagrees with Comic Vine; trust Comic Vine.

## 2. Decide Core and phases - with the user

- **Core** is the essential path, usually the guide's main titles. Everything else is
  `"extra": true`. If the user gave you a core (a list of "essential issues"), that is the
  core.
- Phases are the story's acts, each with a short `note` where a reader needs one ("the
  story jumps forward eight months"). Core should read as a handful of phases, not a bar
  per issue.
- Where the guide splits an act further (Secret Wars: Last Days, Warzones...), keep its
  parts as **sections** of one phase. Full shows them as headings; Core reads the phase as
  one run. Do not turn them into phases of their own: a section whose core is one issue
  becomes a bar with one issue in it.
- A phase or section may be all extras; it disappears in Core.
- **Ask** before deciding anything about scope (where the list starts and ends, whether a
  side series is core). Those are the user's calls.

## 3. Write the draft

`scripts/reading-lists/<slug>.json` - see `scripts/reading-lists/hickmans-avengers.json`:

```json
{ "id": 2, "slug": "krakoa-era", "name": "Krakoa", "exportName": "krakoaEra",
  "publisher": "Marvel", "years": "2019–2024", "description": "…",
  "phases": [ { "name": "…", "note": "…", "issues": [
    { "cv": 123456, "extra": false, "series": "House of X", "number": "1" } ] } ] }
```

- A split phase has `"sections": [{ "name", "note", "issues" }]` in place of `"issues"`.
- `id`: the next unused one. **Never reuse an id** - follows and the saved length key on it.
- `series` and `number` are only checked against Comic Vine; leave them in, they catch
  wrong ids.
- Helpers: `npx tsx scripts/reading-list-entries.ts cbl <file.cbl>` turns a CBL into draft
  issues; `… volume <cvVolumeId> 1-13 24 34.1` gives the ids for numbers in one volume.

## 4. Write the module and ship it

```bash
npx tsx scripts/reading-list-entries.ts write scripts/reading-lists/<slug>.json server/readingLists/<camelName>.ts
```

It spends one Comic Vine request per hundred issues (the budget is 200 an hour). Read
every warning it prints. Then:

1. Add the export to `READING_LISTS` in `server/readingLists/index.ts`.
2. `npm run typecheck` and `npx vitest run test/reading-list-files.test.ts`.
3. Commit on a branch and rebuild the container (`docker compose up -d --build`).
4. Tell the user: the counts per phase (core / extra), the guide you followed, any volume
   you had to choose between, and anything you left out.

To change a list, edit its draft and run `write` again. Never edit the generated entries.
