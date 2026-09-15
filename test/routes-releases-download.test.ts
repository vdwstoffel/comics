import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import releaseRoutes from '../server/routes/releases.js'
import { openDb } from '../server/db.js'
import { cacheRelease } from '../server/models/releases.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import type { ReleaseIssue } from '../server/models/releases.js'
import type { Config } from '../server/config.js'

const ISSUE: ReleaseIssue = {
  id: 1192026, number: '14', publisher: 'Marvel', volumeId: 176900,
  volumeName: 'Black Cat', coverDate: '2026-11-01', storeDate: '2026-09-09',
  coverUrl: 'c.jpg', siteUrl: 'https://cv/1',
}

// The post-page markup the real parser (server/lib/comicPostPage.ts) actually recognises:
// the main button lives in a div.aio-button-center and is labelled "DOWNLOAD NOW". A bare
// `<a>` outside that wrapper, or labelled just "Download", would parse as no-link.
const POST_HTML = '<div class="aio-button-center"><a href="https://files/black-cat-14.cbz">DOWNLOAD NOW</a></div>'

// Injected via the plugin option rather than a global fetch stub (Ruling 2): the real page
// fetcher is `fetchSourcePage`, which does more than call fetch, and a bare stub of
// `globalThis.fetch` cannot drive it the way `server/routes/editions.ts` already solves this
// with an optional `fetchPage` plugin option. Defaulting to a throwing stub means any test
// that reaches the network path without meaning to fails loudly instead of hitting the wire.
async function setup(fetchPage: (url: string) => Promise<string> = async () => {
  throw new Error('unexpected fetch in this test')
}) {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', { comicVineApiKey: 'test-key' } as Config)
  const start = vi.fn(() => ({ started: true, status: { running: true } }))
  app.decorate('downloader', { start, status: () => ({ running: false }) } as never)
  await app.register(releaseRoutes, { fetchPage })

  // One index row that can only be Black Cat #14. Cover date 2026-11 and the scraped
  // year 2026 are within the matcher's one-year tolerance. `category` and `imported_at`
  // are NOT NULL on this table, so both have to be supplied even though neither matters here.
  // `number` is stored zero-padded to 3 digits (see parseComicTitle / parseNumber), the
  // same form the matcher's candidate query compares against - not the raw scraped digits.
  db.prepare(
    `INSERT INTO comic_index (title, url, category, imported_at, number, year)
     VALUES (?,?,?,?,?,?)`,
  ).run('Black Cat #14 (2026)', 'https://index/black-cat-14', 'comics', '2026-09-14', '014', 2026)

  cacheRelease(db, '2026-09-09', [ISSUE], '2026-09-14T12:00:00.000Z')
  return { app, db, start, cleanup: async () => { await app.close() } }
}

test('an issue with no cached release day 404s', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/releases/issues/9999999/download' })
    expect(res.statusCode).toBe(404)
  } finally { await t.cleanup() }
})

// The new edition is named exactly as Comic Vine names the volume. That is what makes
// a download from this tab predictable when you own nothing of the series.
test('the download lands under the volume name', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/releases/issues/1192026/download' })
    expect(res.statusCode).toBe(202)
    expect(t.start).toHaveBeenCalledWith(
      expect.objectContaining({ edition: 'Black Cat', issueId: 1192026 }),
    )
  } finally { await t.cleanup() }
})

test('an unreadable post reports 502 rather than starting anything', async () => {
  const t = await setup(async () => { throw new Error('offline') })
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/releases/issues/1192026/download' })
    expect(res.statusCode).toBe(502)
    expect(t.start).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

// --- Finding 3: the tab lists every Marvel and DC issue of the day, so a brand-new issue
// of a series you already own carries a Get button too - it is not in ownedIssueIds
// because you do not have that issue yet. Filing it by the bare volume name missed the
// edition you already have and created a second one with its own folder, splitting the
// run across two places on disk. edition.comicvine_id IS the Comic Vine volume id.

test('an issue whose volume you already own files into that edition, by its real name', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    // The run you already have, named the way the app itself suggests naming it.
    const owned = upsertEdition(t.db, { name: 'Black Cat (2019)', folder: 'Black Cat (2019)' })
    updateEdition(t.db, owned.id, { comicvineId: ISSUE.volumeId })

    const res = await t.app.inject({ method: 'POST', url: '/api/releases/issues/1192026/download' })
    expect(res.statusCode).toBe(202)
    expect(t.start).toHaveBeenCalledWith(
      expect.objectContaining({ edition: 'Black Cat (2019)', issueId: 1192026 }),
    )
  } finally { await t.cleanup() }
})

// An edition for some *other* volume that happens to be named after this one must not
// capture the download by name alone - identity is the volume id, not the label. Marvel
// and DC relaunch under identical names constantly.
test('an edition for a different volume does not claim the issue', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const other = upsertEdition(t.db, { name: 'Black Cat (2010)', folder: 'Black Cat (2010)' })
    updateEdition(t.db, other.id, { comicvineId: 999999 })

    const res = await t.app.inject({ method: 'POST', url: '/api/releases/issues/1192026/download' })
    expect(res.statusCode).toBe(202)
    // No edition claims volume 176900, so §4.5's promise applies: the volume name, which
    // creates the edition for a series you own nothing of.
    expect(t.start).toHaveBeenCalledWith(
      expect.objectContaining({ edition: 'Black Cat', issueId: 1192026 }),
    )
  } finally { await t.cleanup() }
})
