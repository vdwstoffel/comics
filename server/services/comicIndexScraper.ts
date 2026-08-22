import { pageUrl, parsePage } from '../lib/comicIndexSource.js'
import { upsertComicIndex } from '../models/comicIndex.js'
import type { Ctx } from '../types.js'

export type ScrapeMode = 'quick' | 'full'

export interface ScrapeStatus {
  running: boolean
  mode: ScrapeMode | null
  page: number
  totalPages: number
  inserted: number
  updated: number
  unchanged: number
  failedPages: number
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface ScrapeDeps {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
  delayMs?: number
  retries?: number
  retryBackoffMs?: number
  quickPages?: number
  fullPages?: number
}

export interface ScrapeRunner {
  status: () => ScrapeStatus
  /** `started` is false when a run is already in flight; `done` always resolves. */
  start: (mode: ScrapeMode) => { started: boolean; status: ScrapeStatus; done: Promise<void> }
}

const UA = 'comic-app/0.1 (self-hosted personal comic library)'
const BLANK_LIMIT = 3

async function defaultFetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.text()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function idle(): ScrapeStatus {
  return {
    running: false, mode: null, page: 0, totalPages: 0,
    inserted: 0, updated: 0, unchanged: 0, failedPages: 0,
    error: null, startedAt: null, finishedAt: null,
  }
}

export function createScrapeRunner(ctx: Ctx, deps: ScrapeDeps = {}): ScrapeRunner {
  const {
    fetchPage = defaultFetchPage,
    delayMs = 1000,
    retries = 3,
    retryBackoffMs = 5000,
    quickPages = 5,
    fullPages = 133,
  } = deps

  let state = idle()

  async function fetchWithRetry(url: string): Promise<string | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fetchPage(url)
      } catch {
        if (attempt === retries) return null
        await sleep(retryBackoffMs * attempt)
      }
    }
    return null
  }

  async function run(mode: ScrapeMode): Promise<void> {
    const totalPages = mode === 'quick' ? quickPages : fullPages
    let blankStreak = 0
    // A post can be listed on several pages, occasionally under a different title.
    // Keeping the first sighting per run stops later pages rewriting earlier ones,
    // which otherwise rewrites the same handful of rows on every single run.
    const seenUrls = new Set<string>()

    try {
      for (let page = 1; page <= totalPages; page++) {
        state = { ...state, page }
        const html = await fetchWithRetry(pageUrl(page))

        if (html === null) {
          state = { ...state, failedPages: state.failedPages + 1 }
          blankStreak++
        } else {
          const entries = parsePage(html, pageUrl(page))
          if (entries.length === 0) {
            blankStreak++
          } else {
            blankStreak = 0
            const fresh = entries.filter((e) => !seenUrls.has(e.url))
            for (const entry of fresh) seenUrls.add(entry.url)
            const counts = upsertComicIndex(ctx.db, fresh)
            counts.unchanged += entries.length - fresh.length
            state = {
              ...state,
              inserted: state.inserted + counts.inserted,
              updated: state.updated + counts.updated,
              unchanged: state.unchanged + counts.unchanged,
            }
          }
        }

        // A run of pages with nothing on them means we are past the end of the listing.
        if (blankStreak >= BLANK_LIMIT) break
        if (delayMs && page < totalPages) await sleep(delayMs)
      }
    } catch (err) {
      state = { ...state, error: err instanceof Error ? err.message : String(err) }
    } finally {
      state = { ...state, running: false, finishedAt: new Date().toISOString() }
    }
  }

  return {
    status: () => state,

    start(mode) {
      if (state.running) return { started: false, status: state, done: Promise.resolve() }
      state = {
        ...idle(),
        running: true,
        mode,
        totalPages: mode === 'quick' ? quickPages : fullPages,
        startedAt: new Date().toISOString(),
      }
      return { started: true, status: state, done: run(mode) }
    },
  }
}
