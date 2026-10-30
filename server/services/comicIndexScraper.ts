import { pageUrl, parsePage, fetchSourcePage } from '../lib/comicIndexSource.js'
import { upsertComicIndex } from '../models/comicIndex.js'
import { loadLastScrape, saveLastScrape } from '../models/lastScrape.js'
import type { Ctx } from '../types.js'

export type ScrapeMode = 'quick' | 'full'

export interface ScrapeStatus {
  running: boolean
  mode: ScrapeMode | null
  /** Started by the Wednesday and Thursday check rather than by a press of the button. */
  scheduled: boolean
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
  start: (mode: ScrapeMode, opts?: { scheduled?: boolean }) =>
    { started: boolean; status: ScrapeStatus; done: Promise<void> }
}

const BLANK_LIMIT = 3

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function idle(): ScrapeStatus {
  return {
    running: false, mode: null, scheduled: false, page: 0, totalPages: 0,
    inserted: 0, updated: 0, unchanged: 0, failedPages: 0,
    error: null, startedAt: null, finishedAt: null,
  }
}

export function createScrapeRunner(ctx: Ctx, deps: ScrapeDeps = {}): ScrapeRunner {
  const {
    fetchPage = fetchSourcePage,
    delayMs = 1000,
    retries = 3,
    retryBackoffMs = 5000,
    quickPages = 5,
    fullPages = 133,
  } = deps

  // The last run is read back from the database, so a restart does not forget whether
  // Wednesday's check happened.
  let state = loadLastScrape(ctx.db) ?? idle()

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
      // Every page failing is the site being unreachable, not a week with nothing in it.
      if (state.page > 0 && state.failedPages === state.page) {
        state = { ...state, error: 'Could not reach the release index' }
      }
    } catch (err) {
      state = { ...state, error: err instanceof Error ? err.message : String(err) }
    } finally {
      state = { ...state, running: false, finishedAt: new Date().toISOString() }
      // The run is over whether or not it can be written down.
      try { saveLastScrape(ctx.db, state) } catch { /* reported by the status in memory */ }
    }
  }

  return {
    status: () => state,

    start(mode, { scheduled = false } = {}) {
      if (state.running) return { started: false, status: state, done: Promise.resolve() }
      state = {
        ...idle(),
        running: true,
        mode,
        scheduled,
        totalPages: mode === 'quick' ? quickPages : fullPages,
        startedAt: new Date().toISOString(),
      }
      return { started: true, status: state, done: run(mode) }
    },
  }
}
