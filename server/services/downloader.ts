import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { downloadFileName } from '../lib/downloadName.js'
import { storeComic } from './storeComic.js'
import type { Ctx } from '../types.js'

export interface DownloadStatus {
  running: boolean
  url: string | null
  /** What the file turned out to be called, once the response says. */
  fileName: string | null
  received: number
  /** What the server claimed, or 0 when it did not say. A claim, not a fact. */
  total: number
  error: string | null
  bookId: number | null
  startedAt: string | null
  finishedAt: string | null
}

export interface DownloadRequest {
  url: string
  edition?: string
  issueId?: string | number
}

export interface DownloadDeps {
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch
  maxBytes?: number
  timeoutMs?: number
}

export interface DownloadRunner {
  status: () => DownloadStatus
  /** `started` is false when one is already in flight; `done` always resolves. */
  start: (req: DownloadRequest) => { started: boolean; status: DownloadStatus; done: Promise<void> }
}

const HOUR = 60 * 60 * 1000

function idle(): DownloadStatus {
  return {
    running: false, url: null, fileName: null, received: 0, total: 0,
    error: null, bookId: null, startedAt: null, finishedAt: null,
  }
}

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
    fetchImpl = fetch,
    maxBytes = ctx.config.maxUploadBytes,
    timeoutMs = HOUR,
  } = deps

  let state = idle()
  const snapshot = (): DownloadStatus => ({ ...state })

  async function run(req: DownloadRequest): Promise<void> {
    let tmpPath: string | undefined
    try {
      // Checked before anything is fetched: a scheme we do not speak is a mistake, and
      // file:// in particular would hand the local disk to whoever typed the box.
      let parsed: URL
      try { parsed = new URL(req.url) } catch { throw new Error('not a valid url') }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('only http and https urls can be downloaded')
      }

      const signal = AbortSignal.timeout(timeoutMs)
      const res = await fetchImpl(req.url, { redirect: 'follow', signal })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())

      // The name lives on the url the request LANDED on, not the one that was pasted:
      // a download link is often an opaque token that redirects to the real file.
      const landedOn = res.url || req.url
      const named = downloadFileName(landedOn, res.headers.get('content-disposition'))
      // Nothing said what it is called. It still downloads — whether it is really a comic
      // is decided by reading it, not by its name.
      const fileName = named ?? `download-${randomUUID()}.cbz`
      const claimed = Number(res.headers.get('content-length'))
      state = {
        ...state,
        fileName,
        total: Number.isFinite(claimed) && claimed > 0 ? claimed : 0,
      }

      tmpPath = join(ctx.config.tmpDir, `${randomUUID()}${extname(fileName) || '.cbz'}`)
      if (!res.body) throw new Error('the response had no body')

      // Counted as it streams. Content-Length is the server's claim; the cap has to hold
      // against a lie, so it is the bytes actually seen that stop this.
      let received = 0
      async function* counting(source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          received += chunk.length
          if (received > maxBytes) throw new Error('file too large')
          state = { ...state, received }
          yield chunk
        }
      }
      await pipeline(counting(Readable.fromWeb(res.body as never)), createWriteStream(tmpPath))

      const result = await storeComic(ctx, {
        tmpPath, originalName: fileName, editionName: req.edition, issueId: req.issueId,
      })
      // storeComic consumes the tmp file either way, so there is nothing left to clean.
      tmpPath = undefined
      if (!result.ok) throw new Error(result.error)

      state = { ...state, bookId: result.book?.id ?? null }
    } catch (err) {
      state = { ...state, error: err instanceof Error ? err.message : String(err) }
      // A half-written file is not a comic and must not be left behind.
      if (tmpPath) await unlink(tmpPath).catch(() => {})
    } finally {
      state = { ...state, running: false, finishedAt: new Date().toISOString() }
    }
  }

  return {
    status: snapshot,
    start(req) {
      if (state.running) return { started: false, status: snapshot(), done: Promise.resolve() }
      state = {
        ...idle(),
        running: true,
        url: req.url,
        startedAt: new Date().toISOString(),
      }
      return { started: true, status: snapshot(), done: run(req) }
    },
  }
}
