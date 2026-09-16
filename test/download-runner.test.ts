import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { createDownloadRunner } from '../server/services/downloader.js'
import { enqueue, takeNext, recoverRunning, clearHistory } from '../server/models/downloadQueue.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx, cbzBytes: Uint8Array
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dl-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'), tmpDir: join(dir, 'tmp'),
    maxUploadBytes: 5 * 1024 * 1024, comicVineApiKey: '',
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  ctx = { db: openDb(':memory:'), config }
  const src = mkdtempSync(join(tmpdir(), 'src-'))
  cbzBytes = new Uint8Array(readFileSync(await makeCbz(src, ['p1.png', 'p2.png'], 'x.cbz')))
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

/** A Response whose `url` is the one a redirect would have landed on. */
function respond(body: Uint8Array | string | null, { url, status = 200, headers = {} }: { url: string; status?: number; headers?: Record<string, string> }) {
  const res = new Response(body as BodyInit, { status, headers })
  Object.defineProperty(res, 'url', { value: url })
  return res
}

const REDIRECTED = 'https://fs3.example/2026.07.08/Amazing%20Spider-Man%20031%20%282026%29%20%28Digital%29.cbz'
const OPAQUE = 'https://getcomics.example/dls/VihnoomBUb2Wfcz/NL3vKE94d8fp9SpeGrSONTXkKs7'

test('a download lands in the library and reports the book it became', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })

  const res = runner.enqueue({ url: OPAQUE, edition: 'Amazing Spider-Man (2025)' })
  expect(res.queued).toBe(true)
  await runner.idle()

  const [entry] = runner.status().history
  expect(entry.state).toBe('done')
  expect(entry.error).toBeUndefined()
  expect(entry.bookId).toBeGreaterThan(0)
  expect(entry.fileName).toBe('Amazing Spider-Man 031 (2026) (Digital).cbz')
  expect(runner.status().queue).toEqual([])
})

// The pasted link says nothing; the name has to come from where it lands.
test('the stored file is named from the redirect target, not the pasted link', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })
  runner.enqueue({ url: OPAQUE, edition: 'ASM' })
  await runner.idle()

  const files = readdirSync(join(dir, 'comics', 'ASM'))
  expect(files).toEqual(['Amazing Spider-Man 031 (2026) (Digital).cbz'])
})

// Once a download finishes, its byte counts are gone - `finish` never persists `received`/
// `total`, only the outcome. So the only place left to see progress accumulate is `active`,
// caught mid-stream. The body here is held open on purpose (never closed until the test
// says so) so the first chunk has an unbounded window to be counted before the second
// arrives - nothing here depends on how many ticks that takes, only that it eventually does.
test('progress counts the bytes as they arrive', async () => {
  const chunk1 = cbzBytes.subarray(0, 4)
  const chunk2 = cbzBytes.subarray(4)
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      controller.enqueue(chunk1)
    },
  })
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => {
      const res = new Response(body, { headers: { 'content-length': String(cbzBytes.length) } })
      Object.defineProperty(res, 'url', { value: REDIRECTED })
      return res
    },
  })

  runner.enqueue({ url: OPAQUE, edition: 'ASM' })
  for (let tries = 0; (runner.status().active[0]?.received ?? 0) === 0; tries++) {
    if (tries > 500) throw new Error('the first chunk was never counted')
    await new Promise((r) => setTimeout(r, 1))
  }

  const [live] = runner.status().active
  expect(live.received).toBe(chunk1.length)
  expect(live.total).toBe(cbzBytes.length)

  controllerRef.enqueue(chunk2)
  controllerRef.close()
  await runner.idle()
  expect(runner.status().history[0].state).toBe('done')
})

// Replaces "only one download runs at a time": enqueueing while busy is now the point.
test('a second download is queued rather than refused', async () => {
  const order: string[] = []
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async (input) => { order.push(String(input)); return respond(cbzBytes, { url: REDIRECTED }) },
  })

  expect(runner.enqueue({ url: `${OPAQUE}/1`, edition: 'ASM', label: 'one' }).queued).toBe(true)
  expect(runner.enqueue({ url: `${OPAQUE}/2`, edition: 'ASM', label: 'two' }).queued).toBe(true)
  await runner.idle()

  expect(order).toEqual([`${OPAQUE}/1`, `${OPAQUE}/2`])
  expect(runner.status().history.map((e) => e.label)).toEqual(['two', 'one'])
})

// At the shipped concurrency of 1 they run strictly one after another. Asserted by what
// overlapped, not by timing.
test('at concurrency 1 the second waits for the first to finish', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return respond(cbzBytes, { url: REDIRECTED })
    },
  })
  runner.enqueue({ url: `${OPAQUE}/1`, edition: 'ASM' })
  runner.enqueue({ url: `${OPAQUE}/2`, edition: 'ASM' })
  await runner.idle()
  expect(maxInFlight).toBe(1)
})

test('a url that is not http is refused before anything is fetched', async () => {
  let called = false
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => { called = true; return respond(null, { url: '' }) },
    retryBackoffMs: 0,
  })

  runner.enqueue({ url: 'file:///etc/passwd', edition: 'ASM' })
  await runner.idle()

  expect(called).toBe(false)
  const [entry] = runner.status().history
  expect(entry.error).toMatch(/http/i)
  expect(entry.bookId).toBeUndefined()
})

// Content-Length is the server's claim, not a fact. The cap has to hold against a lie.
test('a body larger than the cap is abandoned mid-stream', async () => {
  const big = new Uint8Array(4096).fill(1)
  const runner = createDownloadRunner(ctx, {
    maxBytes: 1024,
    fetchImpl: async () => respond(big, { url: REDIRECTED, headers: { 'content-length': '10' } }),
    retryBackoffMs: 0,
  })

  runner.enqueue({ url: OPAQUE, edition: 'ASM' })
  await runner.idle()

  const [entry] = runner.status().history
  expect(entry.error).toMatch(/too large/i)
  expect(entry.bookId).toBeUndefined()
  // Nothing half-written is left lying in tmp.
  expect(readdirSync(join(dir, 'tmp'))).toEqual([])
})

test('a failed request is reported, not swallowed', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => respond(null, { url: OPAQUE, status: 404 }),
    retryBackoffMs: 0,
  })

  runner.enqueue({ url: OPAQUE, edition: 'ASM' })
  await runner.idle()

  const [entry] = runner.status().history
  expect(entry.error).toMatch(/404/)
  expect(entry.bookId).toBeUndefined()
})

// An HTML error page saved under a .cbz name is the classic way rubbish enters a library.
test('something that is not a comic never becomes one', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => respond('<html>Not found</html>', { url: REDIRECTED }),
    retryBackoffMs: 0,
  })

  runner.enqueue({ url: OPAQUE, edition: 'ASM' })
  await runner.idle()

  const [entry] = runner.status().history
  expect(entry.error).toMatch(/not a valid/i)
  expect(entry.bookId).toBeUndefined()
  expect(existsSync(join(dir, 'comics', 'ASM'))).toBe(false)
})

test('a link that reveals no name still downloads, under a name of our own', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: OPAQUE }) })

  runner.enqueue({ url: OPAQUE, edition: 'ASM' })
  await runner.idle()

  const [entry] = runner.status().history
  expect(entry.error).toBeUndefined()
  expect(entry.bookId).toBeGreaterThan(0)
  expect(readdirSync(join(dir, 'comics', 'ASM'))[0]).toMatch(/\.cbz$/)
})

// A download interrupted by a restart must RESUME, not merely reappear in the list. The
// runner is constructed fresh here exactly as it is at boot, after a row was left running.
test('a download left running by a restart is picked up when the runner starts', async () => {
  enqueue(ctx.db, { url: OPAQUE, label: 'interrupted' })
  takeNext(ctx.db)                       // simulates the process dying mid-download
  expect(recoverRunning(ctx.db)).toBe(1)

  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })
  await runner.idle()

  expect(runner.status().history.map((e) => e.label)).toEqual(['interrupted'])
  expect(runner.status().queue).toEqual([])
})

test('a failure is retried once and then given up on', async () => {
  let calls = 0
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => { calls++; throw new Error('network down') },
    retryBackoffMs: 0,
  })
  runner.enqueue({ url: OPAQUE, edition: 'ASM', label: 'doomed' })
  await runner.idle()

  expect(calls).toBe(2)
  const [entry] = runner.status().history
  expect(entry).toMatchObject({ state: 'failed', attempts: 2, label: 'doomed' })
})

// A retry must not be taken the instant it fails, or one bad link becomes a hot loop.
test('a retry is not eligible until its backoff has passed', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => { throw new Error('network down') },
    retryBackoffMs: 50_000,
  })
  runner.enqueue({ url: OPAQUE, edition: 'ASM' })
  await runner.idle()

  const [queued] = runner.status().queue
  expect(queued).toMatchObject({ state: 'queued', attempts: 1 })
})

test('cancelling a queued download removes it and leaves the rest alone', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })
  const a = runner.enqueue({ url: `${OPAQUE}/1`, edition: 'ASM', label: 'one' })
  const b = runner.enqueue({ url: `${OPAQUE}/2`, edition: 'ASM', label: 'two' })
  if (!a.queued || !b.queued) throw new Error('unreachable')

  expect(runner.cancel(b.entry.id)).toBe(true)
  await runner.idle()
  expect(runner.status().history.map((e) => e.label)).toEqual(['one'])
})

// Stopping something is not a reason to start it again.
test('cancelling a running download aborts it and does not retry it', async () => {
  let calls = 0
  const runner = createDownloadRunner(ctx, {
    retryBackoffMs: 0,
    fetchImpl: async (_input, init) => {
      calls++
      await new Promise((resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
        setTimeout(resolve, 1000)
      })
      return respond(cbzBytes, { url: REDIRECTED })
    },
  })
  const a = runner.enqueue({ url: OPAQUE, edition: 'ASM', label: 'stopped' })
  if (!a.queued) throw new Error('unreachable')

  await new Promise((r) => setTimeout(r, 10))
  expect(runner.cancel(a.entry.id)).toBe(true)
  await runner.idle()

  expect(calls).toBe(1)
  expect(runner.status().history[0]).toMatchObject({ state: 'failed', label: 'stopped' })
})

// The pool is the point of DOWNLOAD_CONCURRENCY existing at all.
test('at concurrency 2 two downloads are in flight and no row is taken twice', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const runner = createDownloadRunner(ctx, {
    concurrency: 2,
    fetchImpl: async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight--
      return respond(cbzBytes, { url: REDIRECTED })
    },
  })
  for (const n of [1, 2, 3]) runner.enqueue({ url: `${OPAQUE}/${n}`, edition: 'ASM', label: `i${n}` })
  await runner.idle()

  const done = runner.status().history
  expect(done).toHaveLength(3)
  expect(new Set(done.map((e) => e.id)).size).toBe(3)
  expect(maxInFlight).toBe(2)
})

// The marker must not outlive the row. A cancel that lands after the fetch already
// resolved cannot stop the download - that is accepted, the mock below does not even look
// at the signal - but it must not leave a flag that makes some LATER row's genuine failure
// look like a cancellation. `download_queue.id` has no AUTOINCREMENT, so on a fresh,
// single-row table, deleting that row and inserting again hands back the exact same id.
test('a cancel that arrives too late does not poison the next download', async () => {
  let calls = 0
  const runner = createDownloadRunner(ctx, {
    retryBackoffMs: 0,
    fetchImpl: async () => {
      calls++
      if (calls === 1) return respond(cbzBytes, { url: REDIRECTED }) // row A: succeeds
      throw new Error('network down')                                // row B: always fails
    },
  })

  const a = runner.enqueue({ url: OPAQUE, edition: 'ASM', label: 'late-cancel' })
  if (!a.queued) throw new Error('unreachable')
  runner.cancel(a.entry.id) // arrives after the (instant) fetch has already resolved
  await runner.idle()
  expect(runner.status().history[0]).toMatchObject({ state: 'done', label: 'late-cancel' })

  // Freeing the row frees its id too - the very next insert on this now-empty table is
  // handed that same id straight back.
  clearHistory(ctx.db)
  const b = runner.enqueue({ url: OPAQUE, edition: 'ASM', label: 'reused-id' })
  if (!b.queued) throw new Error('unreachable')
  expect(b.entry.id).toBe(a.entry.id)
  await runner.idle()

  // 1 call for A's single successful fetch, 2 for B's two failing attempts.
  expect(calls).toBe(3)
  const [entry] = runner.status().history
  expect(entry).toMatchObject({ state: 'failed', attempts: 2, label: 'reused-id', error: 'network down' })
})

test('cancelling something already finished is refused rather than deleting it', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })
  const a = runner.enqueue({ url: OPAQUE, edition: 'ASM', label: 'done-early' })
  if (!a.queued) throw new Error('unreachable')
  await runner.idle()
  expect(runner.status().history[0]).toMatchObject({ state: 'done', label: 'done-early' })

  expect(runner.cancel(a.entry.id)).toBe(false)
  expect(runner.status().history.map((e) => e.label)).toEqual(['done-early'])
})

/** Poll until `ready()` is true, or give up rather than hang the suite. */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let tries = 0; !ready(); tries++) {
    if (tries > 2000) throw new Error(`gave up waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 1))
  }
}

// A retry that has come due while every worker is busy must not be polled about. The spin
// is not visible in any state the runner exposes, so it is counted at the one statement
// that can see it: `nextEligibleAt` is the only reader of MIN(not_before), and it prepares
// its statement on every call. With the pool saturated the row stays due, the delay the
// timer is given clamps to 0, and the timer re-enters wake() and reschedules itself -
// measured against the unfixed runner at 708 of these statements in one second, at
// concurrency 1. Nothing needs the timer at all in that state: the `.finally` on each
// worker wakes the pool again the moment one frees.
test('a retry that comes due while every worker is busy does not spin the pool', async () => {
  let eligibleQueries = 0
  const realPrepare = ctx.db.prepare.bind(ctx.db)
  ctx.db.prepare = ((sql: string) => {
    if (sql.includes('MIN(not_before)')) eligibleQueries++
    return realPrepare(sql)
  }) as unknown as typeof ctx.db.prepare

  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  const runner = createDownloadRunner(ctx, {
    concurrency: 1,
    retryBackoffMs: 200,
    fetchImpl: async (input) => {
      if (String(input).endsWith('/fails')) throw new Error('network down')
      await held
      return respond(cbzBytes, { url: REDIRECTED })
    },
  })

  // One row fails and is put back with a 200ms backoff...
  runner.enqueue({ url: `${OPAQUE}/fails`, edition: 'ASM', label: 'retrying' })
  await until(() => runner.status().queue.some((e) => e.attempts === 1), 'the failure to be requeued')

  // ...and a second download takes the only worker, so when that backoff elapses there is
  // nothing free to start the retry on.
  runner.enqueue({ url: `${OPAQUE}/holds`, edition: 'ASM', label: 'holding' })
  await until(() => runner.status().active.length === 1, 'the second download to start')

  const before = eligibleQueries
  await new Promise((r) => setTimeout(r, 400))   // well past the 200ms backoff
  const spin = eligibleQueries - before

  release()
  await runner.idle()

  // 0 with the fix. The bound leaves room for one check on the way past without leaving
  // any room at all for a loop.
  expect(spin).toBeLessThanOrEqual(2)
})
