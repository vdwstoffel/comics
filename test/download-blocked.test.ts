import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { createDownloadRunner } from '../server/services/downloader.js'
import { listBlocked, removeBlocked, block, enqueue, pruneHistory } from '../server/models/downloadQueue.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx, cbzBytes: Uint8Array
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dl-blocked-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'), tmpDir: join(dir, 'tmp'),
    maxUploadBytes: 5 * 1024 * 1024,
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  ctx = { db: openDb(':memory:'), config }
  const src = mkdtempSync(join(tmpdir(), 'src-'))
  cbzBytes = new Uint8Array(readFileSync(await makeCbz(src, ['p1.png', 'p2.png'], 'x.cbz')))
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

function respond(body: Uint8Array | string | null, { url, status = 200, headers = {} }: { url: string; status?: number; headers?: Record<string, string> }) {
  const res = new Response(body as BodyInit, { status, headers })
  Object.defineProperty(res, 'url', { value: url })
  return res
}

const OPAQUE = 'https://getcomics.example/dls/VihnoomBUb2Wfcz'
const POST = 'https://getcomics.example/comic/amazing-spider-man-31'

/** The interstitial, as the mirror actually serves it: a 200 carrying a page. */
const CHALLENGE = '<html><body>Performing security verification</body></html>'

test('an interstitial served in the comic\'s place blocks the row instead of failing it', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => respond(CHALLENGE, {
      url: 'https://fs2.example/verify', headers: { 'content-type': 'text/html; charset=UTF-8' },
    }),
  })

  runner.enqueue({ url: OPAQUE, edition: 'Amazing Spider-Man (2025)', issueId: 12345, postUrl: POST })
  await runner.idle()

  const { blocked, history, queue } = runner.status()
  expect(queue).toEqual([])
  // Not in history: a blocked row is unfinished business, and Recent is for things that
  // are over.
  expect(history).toEqual([])
  expect(blocked).toHaveLength(1)
  expect(blocked[0].state).toBe('blocked')
  expect(blocked[0].cvIssueId).toBe(12345)
  expect(blocked[0].edition).toBe('Amazing Spider-Man (2025)')
  // The whole point of carrying it: the row can send you to a page, not a token.
  expect(blocked[0].postUrl).toBe(POST)
})

test('nothing of the challenge page is left on disk', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => respond(CHALLENGE, {
      url: 'https://fs2.example/verify', headers: { 'content-type': 'text/html' },
    }),
  })
  runner.enqueue({ url: OPAQUE })
  await runner.idle()

  expect(readdirSync(ctx.config.tmpDir)).toEqual([])
  expect(readdirSync(ctx.config.comicsDir)).toEqual([])
})

test('a 403 blocks rather than failing - it is the refusal the queue used to record', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => respond(null, { url: OPAQUE, status: 403 }),
  })
  runner.enqueue({ url: OPAQUE })
  await runner.idle()

  const { blocked, history } = runner.status()
  expect(history).toEqual([])
  expect(blocked).toHaveLength(1)
})

/**
 * The reason a bot check is its own state rather than a failure with a nicer message:
 * a retry spends an attempt to meet the same page. One request is made, and then it waits.
 */
test('a blocked download is never retried', async () => {
  let calls = 0
  const runner = createDownloadRunner(ctx, {
    retryBackoffMs: 0,
    fetchImpl: async () => {
      calls++
      return respond(CHALLENGE, { url: OPAQUE, headers: { 'content-type': 'text/html' } })
    },
  })
  runner.enqueue({ url: OPAQUE })
  await runner.idle()

  expect(calls).toBe(1)
  expect(runner.status().blocked[0].attempts).toBe(0)
})

/** A real failure keeps the behaviour it had: retried, then landed in history. */
test('an ordinary failure is still a failure, and still retried', async () => {
  let calls = 0
  const runner = createDownloadRunner(ctx, {
    retryBackoffMs: 0,
    fetchImpl: async () => { calls++; return respond(null, { url: OPAQUE, status: 500 }) },
  })
  runner.enqueue({ url: OPAQUE })
  await runner.idle()

  expect(runner.status().blocked).toEqual([])
  expect(runner.status().history[0]).toMatchObject({ state: 'failed', attempts: 2 })
  // The contrast the blocked case is defined against: this one spent its second attempt.
  expect(calls).toBe(2)
})

test('a comic that actually arrives is untouched by any of this', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => respond(cbzBytes, {
      url: 'https://fs3.example/Amazing%20Spider-Man%20031.cbz',
      headers: { 'content-type': 'application/zip' },
    }),
  })
  runner.enqueue({ url: OPAQUE, edition: 'Amazing Spider-Man (2025)' })
  await runner.idle()

  expect(runner.status().blocked).toEqual([])
  expect(runner.status().history[0].state).toBe('done')
})

test('a blocked row is dismissed once, and only while it is blocked', () => {
  const { entry } = enqueue(ctx.db, { url: OPAQUE }) as { entry: { id: number } }
  block(ctx.db, entry.id, 'the site asked for a browser instead of the file')

  expect(listBlocked(ctx.db)).toHaveLength(1)
  expect(removeBlocked(ctx.db, entry.id)).toBe(true)
  expect(listBlocked(ctx.db)).toEqual([])
  // Gone, so a second press finds nothing rather than reporting success.
  expect(removeBlocked(ctx.db, entry.id)).toBe(false)
})

/**
 * History is capped at fifty and a blocked row must not be counted among them: a busy
 * week of downloads would otherwise quietly discard the one row that remembers which
 * issue a comic you still mean to fetch belongs to.
 */
test('pruning history leaves blocked rows alone', () => {
  const { entry } = enqueue(ctx.db, { url: OPAQUE, cvIssueId: 999 }) as { entry: { id: number } }
  block(ctx.db, entry.id, 'the site asked for a browser instead of the file')

  pruneHistory(ctx.db, 0)

  expect(listBlocked(ctx.db)).toHaveLength(1)
  expect(listBlocked(ctx.db)[0].cvIssueId).toBe(999)
})
