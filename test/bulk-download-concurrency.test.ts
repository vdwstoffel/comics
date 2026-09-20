import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { createDownloadRunner } from '../server/services/downloader.js'
import { queueMissingIssues, bulkIssueDownloadsIdle } from '../server/services/bulkIssueDownload.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { setDownloadConcurrency, CONCURRENCY_MAX } from '../server/models/settings.js'
import { parseNumber } from '../server/lib/comicTitle.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { App, Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

/** Eight gaps, so a pool of five has to leave three of them waiting. */
const NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8']
const RUN = NUMBERS.map((number, i) => ({ id: 400 + i, number, coverDate: '2026-01-01' }))

let dir: string, ctx: Ctx, cbzBytes: Uint8Array
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bulk-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'), tmpDir: join(dir, 'tmp'),
    maxUploadBytes: 5 * 1024 * 1024,
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  ctx = { db: openDb(':memory:'), config }
  const src = mkdtempSync(join(tmpdir(), 'src-'))
  cbzBytes = new Uint8Array(readFileSync(await makeCbz(src, ['p1.png', 'p2.png'], 'x.cbz')))
})
afterEach(async () => { await bulkIssueDownloadsIdle(); ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

function respond(body: Uint8Array, url: string) {
  const res = new Response(body as BodyInit, { status: 200 })
  Object.defineProperty(res, 'url', { value: url })
  return res
}

test('a "Get all" of eight issues downloads them five at a time, no more', async () => {
  const edition = upsertEdition(ctx.db, { name: 'Venom (2025)', folder: 'Venom', seriesName: 'Venom' })
  updateEdition(ctx.db, edition.id, { comicvineId: 167333, cvName: 'Venom' })
  const row = ctx.db.prepare(
    'INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)',
  )
  for (const number of NUMBERS) {
    // Through the same normaliser the scraper stores by, so the fixture cannot drift from
    // what a real row looks like: the index holds "001", not "1".
    const stored = parseNumber(`#${number}`)
    row.run(`Venom #${number} (2025)`, `https://x.test/post/${number}`, 'Marvel Comics', stored, 2025, '2026-09-13T00:00:00.000Z')
  }

  // The setting the app actually reads, at the highest value the app will accept.
  setDownloadConcurrency(ctx.db, CONCURRENCY_MAX)

  let inFlight = 0
  let maxInFlight = 0
  const downloader = createDownloadRunner(ctx, {
    fetchImpl: async (input: RequestInfo | URL) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      // Held long enough that every issue the walk queues has a chance to pile up: if the
      // pool were not capping this, all eight would overlap inside this window.
      await new Promise((r) => setTimeout(r, 25))
      inFlight--
      return respond(cbzBytes, `https://fs.test/${String(input)}`.replace(/[^/]+$/, 'Venom 001 (2026).cbz'))
    },
  })

  const app = { db: ctx.db, config: ctx.config, downloader } as unknown as App
  const fetchPage = async (url: string) => {
    const number = url.split('/').pop()!
    return `<div class="aio-button-center"><a href="https://dl.test/venom-${number}.cbz">DOWNLOAD NOW</a></div>`
  }

  const res = queueMissingIssues(app, {
    edition: { ...edition, cvName: 'Venom' }, issues: RUN, fetchPage, delayMs: 0,
  })

  expect(res).toEqual({ queued: 8 })
  await bulkIssueDownloadsIdle()
  await downloader.idle()

  // Every gap was taken...
  expect(downloader.status().history).toHaveLength(8)
  expect(downloader.status().queue).toEqual([])
  // ...and never more than the five the setting allows were in flight at once.
  expect(maxInFlight).toBe(CONCURRENCY_MAX)
})
