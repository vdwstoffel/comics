# Comic App — Design Spec

**Date:** 2026-08-15
**Status:** Draft for review

## 1. Overview

A self-hosted, self-contained comic platform for a local network. It replaces
the current Komga + rclone + komf stack with a single application we own end to
end. Users upload comics through the web UI, the app stores and indexes them in
its own database, lets users edit metadata (and optionally embed it back into
the comic files), and provides a reader with library browsing and per-book
reading progress.

### Goals
- Upload comics (`.cbz`, up to a few GB) over the LAN via the web UI.
- Store files in an app-managed library folder and index them in our own DB.
- Browse library (series → issues) with cover thumbnails.
- Read comics in the browser (PC + tablet) with saved reading progress.
- Edit metadata, stored in the DB, with an explicit action to embed it into the
  `.cbz` as `ComicInfo.xml`.
- **Fetch metadata + covers from Comic Vine** by searching and confirming a
  match, saved into the DB (assisted matching, not blind auto-tag).

### Non-goals (deferred beyond v1)
- Fully unattended auto-matching of the whole library (v1 is search-and-confirm
  per series/book).
- `.cbr` and `.pdf` support.
- Resumable/chunked uploads.
- Authentication / multi-user accounts.
- Search across the local library, collections, read lists.

## 2. Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | **React + Vite (JavaScript)** | SPA |
| Data fetching | **TanStack Query** | caching, mutations, loading states |
| Backend | **Fastify (Node, JavaScript)** | streaming-friendly HTTP server |
| Uploads | `@fastify/multipart` | stream large files to disk |
| ZIP read | `yauzl` | list/stream pages from `.cbz` |
| ZIP write | `archiver` | write `ComicInfo.xml` back into `.cbz` |
| Images | `sharp` | cover/page thumbnails (libvips) |
| Database | `better-sqlite3` | synchronous SQLite |
| Comic Vine | `undici`/`fetch` + throttle | server-side calls to the Comic Vine API (key hidden from browser) |
| Shared shapes | one `shared/` module | API request/response shapes as JS objects/JSDoc, imported by both sides |

Single language (JavaScript) across the whole stack — same runtime idioms front
and back, and a shared `shared/` module documents the API shapes both sides use.

## 3. Architecture

```
Browser (React SPA)
   │  HTTP (same origin)
   ▼
Fastify API  ──►  SQLite (library.sqlite)   ← source of truth for metadata + progress
   │
   ├─►  comics/       (app-managed .cbz files)
   └─►  thumbnails/   (cached cover/page images)
```

**Deployment:** one container. Fastify serves the built React static assets AND
the API on a single port (no CORS). In development, Vite dev server runs
separately and proxies `/api` to Fastify.

The app binds to the LAN. No auth in v1 (documented assumption; app should only
be exposed on the local network).

**Config (env vars):** `COMIC_VINE_API_KEY` (server-side only), `DATA_DIR`
(defaults to `./data`), `PORT`, `MAX_UPLOAD_BYTES`.

## 4. Storage layout

```
data/
  library.sqlite
  comics/
    <Series Name>/
      <Book File>.cbz
  thumbnails/
    <bookId>.webp          # cached cover
  tmp/                     # in-progress uploads
```

- `comics/` is **read-write** (we own it; no external sync to conflict with).
- Series folder name derived from the upload's series field (or `ComicInfo.xml`,
  or filename fallback).

## 5. Data model (SQLite)

```sql
CREATE TABLE series (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  folder         TEXT NOT NULL,        -- path under comics/
  publisher      TEXT,
  summary        TEXT,
  comicvine_id   INTEGER,              -- matched Comic Vine "volume" id (nullable)
  created_at     TEXT NOT NULL
);

CREATE TABLE book (
  id           INTEGER PRIMARY KEY,
  series_id    INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL UNIQUE,   -- path under comics/
  title        TEXT,
  number       TEXT,                   -- issue/volume number (string; supports "1.5")
  page_count   INTEGER NOT NULL,
  file_size    INTEGER NOT NULL,
  writer       TEXT,
  penciller    TEXT,
  summary      TEXT,
  date         TEXT,                   -- publication date
  comicvine_id INTEGER,                -- matched Comic Vine "issue" id (nullable)
  comicinfo_synced INTEGER NOT NULL DEFAULT 0,  -- 1 if DB metadata embedded in file
  added_at     TEXT NOT NULL
);

CREATE TABLE read_progress (
  book_id     INTEGER PRIMARY KEY REFERENCES book(id) ON DELETE CASCADE,
  last_page   INTEGER NOT NULL DEFAULT 0,   -- 0-based
  completed   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);
```

Single-user in v1 — `read_progress` is keyed by book only. A `user_id` column can
be added later without restructuring.

## 6. API (Fastify, all under `/api`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/upload` | Streamed multipart upload of one or more `.cbz`; creates series/book rows |
| GET | `/series` | List series (with cover + book count) |
| GET | `/series/:id` | Series details + its books |
| GET | `/books/:id` | Book details + metadata + progress |
| GET | `/books/:id/pages/:n` | Page image `n` (0-based); optional `?w=` for resized |
| GET | `/books/:id/thumbnail` | Cached cover thumbnail |
| GET | `/series/:id/thumbnail` | Series cover (first book's cover) |
| PATCH | `/books/:id/metadata` | Update metadata fields in DB |
| POST | `/books/:id/embed` | Write DB metadata into the `.cbz` as `ComicInfo.xml` |
| PUT | `/books/:id/progress` | Save reading progress (last page / completed) |
| POST | `/scan` | Re-index the comics folder (recover DB from files) |
| GET | `/comicvine/search?q=&type=volume\|issue` | Search Comic Vine (candidates to confirm) |
| POST | `/series/:id/comicvine` `{ volumeId }` | Apply a Comic Vine volume → series metadata |
| POST | `/books/:id/comicvine` `{ issueId }` | Apply a Comic Vine issue → book metadata (+ optional cover) |

Response bodies follow the shapes documented in the shared `shared/` module.
Comic Vine calls are made **server-side only** so the API key never reaches the
browser.

## 7. Key flows

### 7.1 Upload
1. Client streams file(s) via multipart; server writes to `data/tmp/` (no RAM
   buffering; enforce a configurable size limit, e.g. 5 GB).
2. Validate it's a readable ZIP; list entries; filter to image entries
   (`.jpg/.jpeg/.png/.webp/.gif`), **natural-sorted** → `page_count`.
3. If a `ComicInfo.xml` entry exists, parse it for initial metadata.
4. Resolve series (form field › ComicInfo › filename); ensure `comics/<Series>/`
   exists; move file from `tmp/` into place (atomic rename).
5. Insert `series` (if new) and `book` rows; generate + cache cover thumbnail.
6. Return the created book(s).

### 7.2 Reading a page
1. `GET /books/:id/pages/:n` → open the `.cbz` with `yauzl`, locate the nth
   image entry (natural sort), stream it to the response.
2. Reader preloads page `n+1`. Optional `?w=` runs it through `sharp` for
   thumbnails/low-bandwidth.

### 7.3 Thumbnails
- On upload, render page 0 to a small `webp` in `thumbnails/<bookId>.webp`.
- Series thumbnail = its first book's cover.

### 7.4 Edit + embed metadata
1. `PATCH /books/:id/metadata` updates the DB (instant source of truth).
2. `POST /books/:id/embed` builds a `ComicInfo.xml` from the DB row and writes a
   **new** `.cbz` (copy all entries via `yauzl` → `archiver`, add/replace
   `ComicInfo.xml`), then atomically replaces the original. Sets
   `comicinfo_synced = 1`. (Explicit action because it rewrites the whole file.)

### 7.5 Progress
- Reader debounces `PUT /books/:id/progress` as pages turn; DB upsert.

### 7.6 Comic Vine metadata (manual, per-comic)

**Metadata is never fetched automatically** — not on upload, not on scan. It only
happens when the user explicitly asks, from an individual comic's page.

1. User clicks a comic in a series → opens the **comic detail (description)
   page** (`/book/:id`) showing current metadata, cover, and page count.
2. On that page there's a **"Fetch metadata"** button. Clicking it calls
   `GET /comicvine/search?q=<series/title>&type=issue`; backend queries Comic
   Vine (key server-side, throttled) and returns candidate matches (name, year,
   publisher, issue number, thumbnail).
3. User **confirms the correct match** (accurate > automatic) from the candidate
   list. Frontend posts the chosen id to `/books/:id/comicvine`.
4. Backend fetches the full issue from Comic Vine, maps fields → DB:
   - volume → series: `name`, `publisher`, `summary` (deck/description), `comicvine_id`
   - issue → book: `title`, `number`, `date` (cover_date), `summary`,
     `writer`/`penciller` (from `person_credits` by role), `comicvine_id`
   - optional: download the Comic Vine cover and use it as the thumbnail
5. DB is updated (instant). Embedding into the `.cbz` remains the separate,
   explicit `/embed` action (§7.4).
6. Because `comicvine_id` is stored, re-fetching/refreshing later is one click.

**Matching aid:** when a book's folder/filename contains a Comic Vine id marker
(e.g. `[cv-12345]`), pre-select that match to skip the search step.

## 8. Frontend structure

### 8.1 Navigation flow

```
[ Library ]  →  [ Series ]  →  [ Comic detail ]  →  [ Reader ]
    /            /series/:id      /book/:id           /read/:bookId
```

1. **Library (`/`)** — home. Grid of **series** tiles: cover, series name, issue
   count, and a read-state badge (unread / in-progress / done). Standalone
   comics appear as a series of one.
2. **Series (`/series/:id`)** — series header (name, publisher, summary) + its
   **issues** in order, each with cover, number, and a progress badge.
3. **Comic detail (`/book/:id`)** — click an issue → its description page: large
   cover, full metadata, page count, progress, **Read** button, **Fetch
   metadata** (Comic Vine) button, and metadata editor. (Clicking a cover always
   lands here first — reading starts from the Read button.)
4. **Reader (`/read/:bookId`)** — full screen, **resumes at the last-read page**
   (page 1 if new). Exiting returns to the comic detail page.

Back-navigation: Reader → Comic detail → Series → Library (back button /
breadcrumbs).

### 8.2 Routes & components

```
Routes:
  /                 Library (grid of series covers)
  /series/:id       Series (list of issues; each links to its detail page)
  /book/:id         Comic detail / description page:
                      cover, metadata, page count, "Read" button,
                      "Fetch metadata" (Comic Vine) button, metadata editor
  /read/:bookId     Reader
  /upload           Upload page (drag-drop, progress bars)

Key components:
  LibraryGrid, SeriesView, BookDetail, MetadataEditor,
  ComicVineMatchDialog (candidate list + confirm),
  Reader (PageViewer + Controls), UploadForm

Reader behavior:
  - keyboard ← →, click-zones (left/right), page counter
  - fit-to-width / fit-to-height, single / double-page
  - preload next page
  - debounced progress save
```

## 9. Risks / decisions

- **Page ordering:** filenames must be **natural-sorted** (`p1, p2, … p10`), not
  lexicographic. Use a natural-sort comparator.
- **Non-image entries:** ignore `ComicInfo.xml`, `Thumbs.db`, folders, etc. when
  counting/serving pages.
- **Embed cost:** writing metadata rewrites the ZIP (~file size on disk). Kept as
  an explicit user action; DB is always the instant truth.
- **Upload limits:** configure Fastify body/file size limits generously (few GB);
  stream to disk to keep memory flat.
- **No auth (v1):** app must be bound to the LAN only.
- **Corrupt/oversized files:** validate ZIP on upload; reject non-ZIP; clean up
  `tmp/` on failure.
- **Comic Vine limits/etiquette:** the API caps ~200 requests per resource per
  hour and requires a descriptive `User-Agent`; throttle to ~1 req/sec and cache
  responses. Match to *issues* for single comics and *volumes* for series;
  collections/omnibuses may match a volume rather than a single issue. Store the
  matched id so we don't re-query needlessly.
- **API key handling:** Comic Vine key comes from an env var, used only on the
  server; never sent to the browser.

## 10. Migration & coexistence

- Build alongside the current stack; Komga/rclone keep running during dev.
- `POST /scan` can **seed** the new DB by importing existing comics: point it at
  the old `./library` (or copy those files into `data/comics/`) and index them.
- Retire Komga/rclone/komf once the new app is trusted.

## 11. v1 milestones

1. Project scaffold (Vite React + Fastify + `shared/` module + SQLite schema +
   one container that serves both).
2. Storage + DB layer; `POST /scan` to index an existing folder.
3. Library + series browsing (API + UI + thumbnails).
4. Reader (page serving + navigation + progress).
5. Upload (streamed) + cover generation.
6. Metadata editor (DB) + embed-into-file.
7. **Comic Vine integration** — search, confirm match, apply to series/book,
   optional cover download.
8. Package as a container (Comic Vine key via env var); document.

## 12. Deployment (Docker)

- **Multi-stage Dockerfile:** stage 1 builds the React app (`vite build`); stage
  2 is a Node runtime that serves the built static files **and** the Fastify API
  on one port (no CORS, no second service).
- **Base image:** a Debian-based Node image (e.g. `node:22-bookworm-slim`) so the
  native deps (`better-sqlite3`, `sharp`) build/run cleanly; install their build
  tools in the build stage only.
- **Volumes:** persist `DATA_DIR` (the `data/` folder — SQLite, comics,
  thumbnails) to a host path so uploads/library survive restarts.
- **Env:** `COMIC_VINE_API_KEY`, `DATA_DIR`, `PORT`, `MAX_UPLOAD_BYTES`.
- **Compose:** runs as its own service on the LAN. Can live in a fresh
  `docker-compose.yml` for this app, or be added to the existing stack during the
  transition off Komga/rclone. Bind to the local network only (no auth in v1).
- **Dev:** `vite` dev server + `fastify` run locally with `/api` proxied; Docker
  is for running the finished app.
```
