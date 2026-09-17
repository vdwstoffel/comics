# Comic App

Self-hosted comic library: upload `.cbz`, browse, read in the browser with saved
progress, edit metadata, and fetch metadata from Comic Vine on demand.

Written in **TypeScript** (strict). Backend is Fastify + better-sqlite3 (compiled
with `tsc`, NodeNext); frontend is React + Vite (bundler resolution).

## Develop

- `npm install --legacy-peer-deps`
- Terminal 1: `npm run dev:server`  (Fastify on :3000, via `tsx watch`)
- Terminal 2: `npm run dev:web`      (Vite dev server, proxies /api)
- Type-check everything with `npm run typecheck`.
- Seed from an existing folder of comics: put `.cbz` files under
  `data/comics/<Series>/` and `curl -X POST localhost:3000/api/scan`.

> **Note:** This project has a `vite@8` / `@vitejs/plugin-react@4` npm peer
> conflict. Always use `--legacy-peer-deps` when running `npm install` or
> `npm ci` (both locally and in CI/Docker).

## Test

- `npm test`

## Build

- `npm run build`  (requires `--legacy-peer-deps` on a fresh install)
- Compiles the backend with `tsc -p tsconfig.server.json` into `build/`
  (runnable Node output) and bundles the frontend with Vite into `dist/`.
- Start the compiled server with `npm start`
  (`node build/server/index.js`); it serves `dist/` automatically in production.

## Run (Docker)

- `docker compose up -d --build`
- Open `http://<server-ip>:3000`
- Open **Settings** and paste your Comic Vine API key — a free key comes from
  https://comicvine.gamespot.com/api/. Without one, search, matching and Latest
  releases are unavailable; everything else works.
- Comics + DB persist in `./data`.
- Upgrading: `COMIC_VINE_API_KEY` is no longer read. Re-enter your key once under
  Settings; you can delete the line from your `.env`.

## Config (env)

- `DATA_DIR` (default `/data` in Docker), `PORT` (3000), `MAX_UPLOAD_BYTES`

The Comic Vine API key is not an environment variable — it is a setting, entered
in the app under Settings and stored in the database.
