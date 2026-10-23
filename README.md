# Comix

A self-hosted comic library built around the **run** — not just the comics you own, but
the gaps in the middle of them and the issues coming out on Wednesday.

Comic Vine says what a run should contain, so a missing issue is not an absence: it holds
its place in the run, with a button on it. Finish an issue of something you follow and the
next one queues itself.

Written in TypeScript (strict). Fastify + better-sqlite3 on the server, React + Vite in the
browser, about 1800 tests under vitest.

---

## What it does

### Your library

Three levels: **Series → Edition → Issue**. An edition is one run of a title — *Uncanny
X-Men (1963)* — and is the only place a comic lives; there is no separate page for a single
issue. Series that belong together gather into one franchise tile.

- Filter the shelf by publisher, or by what you have and have not read.
- Gather the unread shelf by series or by story arc.
- Browse story arcs on their own, in reading order rather than by issue id.
- Annuals stay with their run instead of scattering into a volume each.
- Rename, merge and move series; the files on disk follow.

### Reading

The reader is the comic and nothing else. It takes the whole screen on the way in and
gives it back on the way out, and your place is kept — you open where you stopped rather
than where a cache last saw you.

- Pinch, scroll or drag to zoom; double-press to put the page back.
- Arrow keys turn the page, `f` toggles fullscreen, the scrubber finds a page.
- Look a character up without leaving the page.
- The page bar can be hidden for good under Settings.

### Filling the gaps

An edition knows which issues are missing, and each gap offers to fill itself:

- **Get** when exactly one scraped release can be that issue. It never guesses: anything
  less certain offers **Find**, which opens the search with the series and year filled in
  so you choose by eye.
- **Upload** a file you already have straight into the gap.
- Fill every gap in an edition in one press.
- Downloads land in a queue you can reorder, cancel, retry and clear, running one at a
  time by default and up to five if you say so.

Everything that arrives is filed under `<Series>/<Edition>/` with a name built from its
Comic Vine metadata, and that metadata is written into the `.cbz` as `ComicInfo.xml`.
`.cbr` files are converted to `.cbz` on the way in. Existing library files can be renamed
to match.

### Keeping up

Three views under **Latest releases**:

- **This week** — what came out on Wednesday, by publisher, with a button on anything you
  do not own. Comic Vine fills its store dates in over several days, so a thin Wednesday
  early in the week is usually Comic Vine catching up rather than a quiet week.
- **Upcoming** — about ten Wednesdays of solicitations ahead, read from Marvel's calendar.
- **Currently running** — every Marvel and DC series being published, read from Wikipedia.
  This one needs no Comic Vine key.

Press **Follow** on an edition or a story arc and it appears under **Following** in the
library rail. Finish an issue and the next one is queued — one issue per finish, so the
shelf never turns into a backlog. When the next issue cannot be found yet, the follow says
so, and is retried after each scrape (**Search → Scrape**). Nothing runs on a timer: if you
never scrape, nothing arrives. An edition you follow but have not started pulls nothing until
you finish an issue of it.

---

## Running it

```bash
docker compose up -d --build
```

Then open **http://\<host\>:8090**. The app always listens on 3000 inside the container;
8090 is the published port, and the only part of `docker-compose.yml` that is a choice.

Comics, thumbnails and the database persist in `./data`, which is bind-mounted and written
as your host user.

### The Comic Vine key

Open **Settings** and paste a Comic Vine API key — a free one comes from
<https://comicvine.gamespot.com/api/>. It is a setting stored in the database, not an
environment variable, and it is checked against Comic Vine when you save it.

Without a key: search, matching, gap-filling and **This week** are unavailable. Reading,
uploading, browsing, **Upcoming** and **Currently running** all work.

---

## Developing

```bash
npm install --legacy-peer-deps
npm run dev:server   # Fastify on :3000, via tsx watch
npm run dev:web      # Vite, proxying /api
npm run typecheck
```

> `--legacy-peer-deps` is required on every install, locally and in Docker:
> `@vitejs/plugin-react@4` declares a peer range that stops at `vite@7`, and this project
> runs `vite@8`.

To seed from comics you already have, put files under `data/comics/<Series>/` and
`curl -X POST localhost:3000/api/scan`.

### Testing

```bash
npm test                                      # the whole suite, ~80s
npx vitest run test/Edition.test.tsx          # while iterating
```

### Building

```bash
npm run build   # tsc -p tsconfig.server.json → build/, vite build → dist/
npm start       # node build/server/index.js, serving dist/
```

---

## Configuration

| Variable | Default | What it is |
| --- | --- | --- |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where everything below lives |
| `PORT` | `3000` | The port the server listens on |
| `MAX_UPLOAD_BYTES` | `5368709120` | Ceiling on a single upload |

Inside `DATA_DIR`:

```
comics/      the comics themselves, as <Series>/<Edition>/<file>.cbz
thumbnails/  generated covers
library.sqlite
tmp/         staging for uploads and downloads, cleared at startup
```

## Where the outside data comes from

| Source | Used for |
| --- | --- |
| Comic Vine | Volumes, issues, story arcs, credits, covers, release dates |
| A scraped public index of release posts | Finding a file for an issue you are missing |
| Wikipedia | Which Marvel and DC series are currently running |
| Marvel's own calendar | Solicitations for the weeks ahead |
