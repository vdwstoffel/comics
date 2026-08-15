# Comic App

Self-hosted comic library: upload `.cbz`, browse, read in the browser with saved
progress, edit metadata, and fetch metadata from Comic Vine on demand.

## Develop

- `npm install --legacy-peer-deps`
- Terminal 1: `npm run dev:server`  (Fastify on :3000)
- Terminal 2: `npm run dev:web`      (Vite dev server, proxies /api)
- Seed from an existing folder of comics: put `.cbz` files under
  `data/comics/<Series>/` and `curl -X POST localhost:3000/api/scan`.

> **Note:** This project has a `vite@8` / `@vitejs/plugin-react@4` npm peer
> conflict. Always use `--legacy-peer-deps` when running `npm install` or
> `npm ci` (both locally and in CI/Docker).

## Test

- `npm test`

## Build (static assets)

- `npm run build`  (requires `--legacy-peer-deps` on a fresh install)
- Produces `dist/` which is served automatically by the Fastify server in
  production.

## Run (Docker)

- `COMIC_VINE_API_KEY=xxxx docker compose up -d --build`
- Open `http://<server-ip>:3000`
- Comics + DB persist in `./data`.

## Config (env)

- `COMIC_VINE_API_KEY` — free key from https://comicvine.gamespot.com/api/
- `DATA_DIR` (default `/data` in Docker), `PORT` (3000), `MAX_UPLOAD_BYTES`
