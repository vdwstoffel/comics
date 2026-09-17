import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { downloadFileName } from '../lib/downloadName.js'
import { storeComic } from './storeComic.js'
import {
  enqueue as enqueueRow, takeNext, finish, fail, listQueue, listHistory, removeIfLive,
} from '../models/downloadQueue.js'
import type { QueueEntry } from '../models/downloadQueue.js'
import { getDownloadConcurrency } from '../models/settings.js'
import type { Ctx } from '../types.js'

/** How long a failed download waits before it is eligible again. */
export const RETRY_BACKOFF_MS = 30_000
/** At most this many attempts per download: the first, and one retry. */
const MAX_ATTEMPTS = 2

/** Live progress for one in-flight download. In memory: `received` changes per chunk. */
export interface ActiveDownload {
  id: number
  label?: string
  fileName: string | null
  received: number
  total: number
  startedAt: string
}

export interface DownloadRequest {
  url: string
  edition?: string
  issueId?: string | number
  label?: string
}

export interface DownloadDeps {
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch
  maxBytes?: number
  timeoutMs?: number
  /**
   * How many downloads run at once. A number is treated as fixed; a getter is read
   * on every wake, which is how the setting takes effect without a restart.
   * Defaults to reading the `setting` table.
   */
  concurrency?: number | (() => number)
  /** How long a failed download waits before its retry is eligible. */
  retryBackoffMs?: number
}

export interface DownloadRunner {
  status: () => { active: ActiveDownload[]; queue: QueueEntry[]; history: QueueEntry[] }
  enqueue: (req: DownloadRequest) => ReturnType<typeof enqueueRow>
  /** Resolves when nothing is in flight and nothing is takeable. Tests await it. */
  idle: () => Promise<void>
  /**
   * Stop a download. Running: abort it in place (marked failed, no retry - stopping
   * something is not a reason to start it again). Queued: drop the row outright.
   * Returns whether a row was found to act on.
   */
  cancel: (id: number) => boolean
  /**
   * Start the pool draining. Public because a row can be put back in the queue without
   * going through `enqueue` (the retry route does exactly this), and nothing else would
   * otherwise notice it.
   */
  wake: () => void
}

const HOUR = 60 * 60 * 1000

export interface ResolvedDownload {
  fileName: string | null
  size: number
}

/**
 * What a link turns out to point at, without downloading it: a HEAD following redirects,
 * read for the name and the size.
 *
 * Its whole reason for existing is that the link you paste often says nothing — an opaque
 * token like `/dls/VihnoomBUb2Wfcz` — while the url it redirects to carries the file name.
 * Knowing that name up front is what lets the comic be matched and filed correctly before
 * a single byte is stored.
 */
export async function resolveDownload(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedDownload> {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('not a valid url') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http and https urls can be downloaded')
  }

  const res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())

  const size = Number(res.headers.get('content-length'))
  return {
    fileName: downloadFileName(res.url || url, res.headers.get('content-disposition')),
    size: Number.isFinite(size) && size > 0 ? size : 0,
  }
}

export function createDownloadRunner(ctx: Ctx, deps: DownloadDeps = {}): DownloadRunner {
  const {
    fetchImpl = fetch, maxBytes = ctx.config.maxUploadBytes, timeoutMs = HOUR,
    concurrency, retryBackoffMs = RETRY_BACKOFF_MS,
  } = deps

  // Normalised once. A plain number stays accepted because every existing pool test
  // passes one, and rewriting them to pass a thunk would be churn for no gain.
  const readConcurrency: () => number =
    typeof concurrency === 'function' ? concurrency
      : concurrency != null ? () => concurrency
        : () => getDownloadConcurrency(ctx.db)

  const active = new Map<number, ActiveDownload>()
  const controllers = new Map<number, AbortController>()
  const cancelled = new Set<number>()
  let workers = 0
  let idleWaiters: Array<() => void> = []
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function settleIdle() {
    if (workers > 0) return
    for (const resolve of idleWaiters) resolve()
    idleWaiters = []
  }

  /** The body of one download. Unchanged from the old `run` except for where it reports. */
  async function runOne(entry: QueueEntry): Promise<void> {
    let tmpPath: string | undefined
    const live: ActiveDownload = {
      id: entry.id, label: entry.label, fileName: null, received: 0, total: 0,
      startedAt: entry.startedAt ?? new Date().toISOString(),
    }
    active.set(entry.id, live)
    const controller = new AbortController()
    controllers.set(entry.id, controller)
    try {
      // Checked before anything is fetched: a scheme we do not speak is a mistake, and
      // file:// in particular would hand the local disk to whoever typed the box.
      let parsed: URL
      try { parsed = new URL(entry.url) } catch { throw new Error('not a valid url') }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('only http and https urls can be downloaded')
      }

      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
      const res = await fetchImpl(entry.url, { redirect: 'follow', signal })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())

      // The name lives on the url the request LANDED on, not the one that was pasted:
      // a download link is often an opaque token that redirects to the real file.
      const landedOn = res.url || entry.url
      const named = downloadFileName(landedOn, res.headers.get('content-disposition'))
      const fileName = named ?? `download-${randomUUID()}.cbz`
      const claimed = Number(res.headers.get('content-length'))
      live.fileName = fileName
      live.total = Number.isFinite(claimed) && claimed > 0 ? claimed : 0

      tmpPath = join(ctx.config.tmpDir, `${randomUUID()}${extname(fileName) || '.cbz'}`)
      if (!res.body) throw new Error('the response had no body')

      // Counted as it streams. Content-Length is the server's claim; the cap has to hold
      // against a lie, so it is the bytes actually seen that stop this.
      async function* counting(source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          live.received += chunk.length
          if (live.received > maxBytes) throw new Error('file too large')
          yield chunk
        }
      }
      await pipeline(counting(Readable.fromWeb(res.body as never)), createWriteStream(tmpPath))

      const result = await storeComic(ctx, {
        tmpPath, originalName: fileName, editionName: entry.edition, issueId: entry.cvIssueId,
      })
      // storeComic consumes the tmp file either way, so there is nothing left to clean.
      tmpPath = undefined
      if (!result.ok) throw new Error(result.error)

      finish(ctx.db, entry.id, { bookId: result.book?.id, fileName })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (tmpPath) await unlink(tmpPath).catch(() => {})
      // A cancel and a failure both land here, and only one of them deserves a retry.
      if (cancelled.has(entry.id)) {
        fail(ctx.db, entry.id, 'cancelled')
      } else if (entry.attempts + 1 < MAX_ATTEMPTS) {
        fail(ctx.db, entry.id, message, { retryAt: new Date(Date.now() + retryBackoffMs).toISOString() })
      } else {
        fail(ctx.db, entry.id, message)
      }
    } finally {
      // Unconditional: a cancel that arrives after the fetch already resolved never
      // reaches the catch (the download just finishes normally), and an id left in this
      // Set would make a LATER row's genuine failure read as a cancellation - SQLite
      // reuses a deleted row's id, so "later" can mean "the very next one".
      cancelled.delete(entry.id)
      active.delete(entry.id)
      controllers.delete(entry.id)
    }
  }

  /**
   * The `not_before` of the queued row that will become eligible soonest, if any.
   * `QueueEntry` does not carry `not_before` - it is read straight off the table instead
   * of adding a field to the model just for this.
   */
  function nextEligibleAt(): number | undefined {
    const row = ctx.db
      .prepare(`SELECT MIN(not_before) AS t FROM download_queue WHERE state = 'queued' AND not_before IS NOT NULL`)
      .get() as { t: string | null }
    return row.t ? new Date(row.t).getTime() : undefined
  }

  /**
   * Whether some queued row could be taken right now - i.e. `takeNext` would find one.
   * A row only sitting in `queued` because its backoff has not elapsed does not count:
   * `idle()` must not wait out a retry that may be tens of seconds away.
   */
  function hasTakeableRow(): boolean {
    const row = ctx.db
      .prepare(`SELECT 1 FROM download_queue WHERE state = 'queued' AND (not_before IS NULL OR not_before <= ?) LIMIT 1`)
      .get(new Date().toISOString())
    return row !== undefined
  }

  function wake(): void {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined }
    while (workers < readConcurrency()) {
      const entry = takeNext(ctx.db)
      if (!entry) break
      workers++
      void runOne(entry).finally(() => { workers--; wake(); settleIdle() })
    }
    // Nothing was takeable right now - if something is only waiting on its backoff,
    // schedule the wake that will pick it up instead of leaving it stranded.
    //
    // Only worth a timer when a worker would actually be free to take it. With the pool
    // saturated the row is still due, so `delay` clamps to 0 and the timer re-enters
    // wake() at once, which reschedules itself: a spin of hundreds of queries a second
    // for as long as the pool stays busy. It is also unnecessary - the `.finally` above
    // wakes the pool again the moment a worker frees, which is the only moment the retry
    // could have been started anyway.
    if (workers < readConcurrency()) {
      const at = nextEligibleAt()
      if (at !== undefined) {
        const delay = Math.max(0, at - Date.now())
        // Unref'd: a scheduled retry must never be the reason the process (or a test) hangs
        // around waiting for it, and the db it would touch may be long closed by then.
        retryTimer = setTimeout(() => { try { wake() } catch { /* db closed under us */ } }, delay)
        retryTimer.unref?.()
      }
    }
    settleIdle()
  }

  // Anything recoverRunning put back at startup is already sitting in the queue, and
  // nothing else would come along to start it: wake() is otherwise only reached through
  // enqueue(). Draining on construction is what makes "requeued" mean "resumed".
  wake()

  return {
    status: () => ({
      active: [...active.values()],
      queue: listQueue(ctx.db),
      history: listHistory(ctx.db),
    }),
    enqueue(req) {
      const res = enqueueRow(ctx.db, {
        url: req.url, edition: req.edition, label: req.label,
        cvIssueId: req.issueId == null ? undefined : Number(req.issueId),
      })
      if (res.queued) wake()
      return res
    },
    idle: () => new Promise<void>((resolve) => {
      if (workers === 0 && !hasTakeableRow()) return resolve()
      idleWaiters.push(resolve)
    }),
    wake,
    cancel(id) {
      const controller = controllers.get(id)
      if (controller) {
        // Marked before aborting, so the catch can tell this from a genuine failure.
        cancelled.add(id)
        controller.abort()
        return true
      }
      // Not running: only a queued row is ours to drop. Something already finished is
      // refused, not quietly erased from history.
      return removeIfLive(ctx.db, id)
    },
  }
}

