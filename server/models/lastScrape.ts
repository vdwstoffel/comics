import type { ScrapeMode, ScrapeStatus } from '../services/comicIndexScraper.js'
import type { Db } from '../types.js'

interface Row {
  mode: ScrapeMode
  scheduled: number
  total_pages: number
  inserted: number
  updated: number
  unchanged: number
  failed_pages: number
  error: string | null
  started_at: string
  finished_at: string
}

/** Records a finished run, replacing the one before it. */
export function saveLastScrape(db: Db, status: ScrapeStatus): void {
  if (!status.mode || !status.startedAt || !status.finishedAt) return
  db.prepare(`
    INSERT OR REPLACE INTO last_scrape
      (id, mode, scheduled, total_pages, inserted, updated, unchanged, failed_pages, error,
       started_at, finished_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    status.mode, status.scheduled ? 1 : 0, status.totalPages, status.inserted, status.updated,
    status.unchanged, status.failedPages, status.error, status.startedAt, status.finishedAt,
  )
}

/** The last finished run, as the runner reported it when it ended; null before the first. */
export function loadLastScrape(db: Db): ScrapeStatus | null {
  const row = db.prepare('SELECT * FROM last_scrape WHERE id = 1').get() as Row | undefined
  if (!row) return null
  return {
    running: false,
    mode: row.mode,
    scheduled: row.scheduled === 1,
    // The page it stopped on is not kept; a finished run is reported by its counts.
    page: row.total_pages,
    totalPages: row.total_pages,
    inserted: row.inserted,
    updated: row.updated,
    unchanged: row.unchanged,
    failedPages: row.failed_pages,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}
