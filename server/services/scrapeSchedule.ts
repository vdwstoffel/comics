import { fetchSourcePage } from '../lib/comicIndexSource.js'
import { slotMissed } from '../lib/scrapeSchedule.js'
import type { ScrapeMode, ScrapeRunner } from './comicIndexScraper.js'
import { sweepFollows } from './following.js'
import type { App } from '../types.js'

type FetchPage = (url: string) => Promise<string>

/**
 * Scrape the release index, then retry every follow.
 *
 * What Check for new does, shared so the automatic check cannot drift from it. A scrape
 * finishing is when a follow's match can newly succeed, so every follow is retried then -
 * attached to the run rather than awaited, so the caller is answered immediately.
 */
export function scrapeAndSweep(
  app: App,
  mode: ScrapeMode,
  { scheduled = false, fetchPage = fetchSourcePage }: { scheduled?: boolean; fetchPage?: FetchPage } = {},
): ReturnType<ScrapeRunner['start']> {
  const started = app.scraper.start(mode, { scheduled })
  if (started.started) {
    void started.done.then(() => { sweepFollows(app, { fetchPage }) }).catch(() => { /* the scraper reports its own */ })
  }
  return started
}

/**
 * Runs the quick scrape if a Wednesday or Thursday check went by without one; null when
 * nothing was due, or a scrape is already running.
 *
 * Asked every minute rather than set as a timer for the next check: a timer set for
 * Wednesday is lost if the container is down at six, while this notices on the first
 * minute it is back - which is also what makes a missed check catch up on startup.
 */
export function checkScrapeSchedule(
  app: App,
  now = new Date(),
  opts: { fetchPage?: FetchPage } = {},
): ReturnType<ScrapeRunner['start']> | null {
  const status = app.scraper.status()
  if (status.running || !slotMissed(now, status.startedAt)) return null
  return scrapeAndSweep(app, 'quick', { ...opts, scheduled: true })
}

/** Starts the check, once now and then every minute. */
export function startScrapeSchedule(app: App, intervalMs = 60_000): void {
  checkScrapeSchedule(app)
  // unref: the check is never a reason for the process to stay alive.
  setInterval(() => checkScrapeSchedule(app), intervalMs).unref()
}
