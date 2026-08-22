import { test, expect, vi } from 'vitest'
import { openDb } from '../server/db.js'
import { createScrapeRunner } from '../server/services/comicIndexScraper.js'
import type { Config } from '../server/config.js'

function pageHtml(page: number, items = 1) {
  const lis = Array.from({ length: items }, (_, i) =>
    `<li><a href="/p${page}-${i}/">Comic ${page}-${i}</a></li>`).join('')
  return `<div class="su-tabs-pane" data-title="&lt;strong&gt;DC Comics&lt;/strong&gt;">
            <ul>${lis}</ul></div>`
}

function makeRunner(opts: {
  fetchPage?: (url: string) => Promise<string>
  db?: ReturnType<typeof openDb>
} = {}) {
  const db = opts.db ?? openDb(':memory:')
  const requested: string[] = []
  const fetchPage = opts.fetchPage ?? (async (url: string) => {
    requested.push(url)
    const page = Number(new URL(url).searchParams.get('lcp_page0'))
    return pageHtml(page)
  })
  const runner = createScrapeRunner({ db, config: {} as Config }, {
    fetchPage: async (url) => { requested.push(url); return fetchPage(url) },
    delayMs: 0,
    retries: 2,
    retryBackoffMs: 0,
    quickPages: 3,
    fullPages: 6,
  })
  return { db, runner, requested }
}

function rows(db: ReturnType<typeof openDb>) {
  return db.prepare('SELECT title, url, category, number, year FROM comic_index ORDER BY url').all()
}

test('status starts idle', () => {
  const { runner } = makeRunner()
  expect(runner.status()).toMatchObject({
    running: false, mode: null, page: 0, inserted: 0, updated: 0, unchanged: 0, error: null,
  })
})

test('a quick run walks its pages and stores what it finds', async () => {
  const { db, runner } = makeRunner()
  const { started, done } = runner.start('quick')
  expect(started).toBe(true)
  await done
  expect(runner.status()).toMatchObject({
    running: false, mode: 'quick', inserted: 3, updated: 0, unchanged: 0, error: null,
  })
  expect(rows(db)).toHaveLength(3)
})

test('a full run covers more pages than a quick run', async () => {
  const { runner } = makeRunner()
  await runner.start('full').done
  expect(runner.status().inserted).toBe(6)
  expect(runner.status().totalPages).toBe(6)
})

test('rows written by a run carry the derived number and year', async () => {
  const { db, runner } = makeRunner({
    fetchPage: async () => `<div class="su-tabs-pane" data-title="DC Comics">
      <li><a href="/x/">Batman #7 (2019)</a></li></div>`,
  })
  await runner.start('quick').done
  expect(rows(db)[0]).toMatchObject({ number: '007', year: 2019 })
})

test('progress is visible while a run is in flight', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const { runner } = makeRunner({
    fetchPage: async (url) => {
      if (url.includes('lcp_page0=2')) await gate
      return pageHtml(Number(new URL(url).searchParams.get('lcp_page0')))
    },
  })
  const { done } = runner.start('quick')
  await vi.waitFor(() => expect(runner.status().running).toBe(true))
  await vi.waitFor(() => expect(runner.status().page).toBeGreaterThanOrEqual(2))
  expect(runner.status().mode).toBe('quick')
  release!()
  await done
  expect(runner.status().running).toBe(false)
  expect(runner.status().finishedAt).not.toBeNull()
})

test('a second run is refused while one is already going', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const { runner } = makeRunner({
    fetchPage: async (url) => { await gate; return pageHtml(1) },
  })
  const first = runner.start('full')
  const second = runner.start('quick')
  expect(second.started).toBe(false)
  expect(runner.status().mode).toBe('full')
  release!()
  await first.done
  await second.done
})

test('a new run is allowed once the previous one finished', async () => {
  const { runner } = makeRunner()
  await runner.start('quick').done
  const again = runner.start('quick')
  expect(again.started).toBe(true)
  await again.done
  expect(runner.status().unchanged).toBe(3)
  expect(runner.status().inserted).toBe(0)
})

test('three blank pages in a row end the run early', async () => {
  const { runner, requested } = makeRunner({
    fetchPage: async (url) => {
      const page = Number(new URL(url).searchParams.get('lcp_page0'))
      return page === 1 ? pageHtml(1) : '<div>nothing</div>'
    },
  })
  await runner.start('full').done
  expect(requested.filter((u) => u.includes('lcp_page0')).length).toBeLessThan(6)
  expect(runner.status().inserted).toBe(1)
})

test('a page that keeps failing is retried, counted and skipped', async () => {
  let attempts = 0
  const { db, runner } = makeRunner({
    fetchPage: async (url) => {
      const page = Number(new URL(url).searchParams.get('lcp_page0'))
      if (page === 2) { attempts++; throw new Error('boom') }
      return pageHtml(page)
    },
  })
  await runner.start('quick').done
  expect(attempts).toBe(2)
  expect(runner.status()).toMatchObject({ failedPages: 1, error: null, running: false })
  expect(rows(db)).toHaveLength(2)
})

test('an unexpected failure is reported and clears the running flag', async () => {
  const db = openDb(':memory:')
  db.close()
  const { runner } = makeRunner({ db })
  await runner.start('quick').done
  const status = runner.status()
  expect(status.running).toBe(false)
  expect(status.error).toBeTruthy()
})

// The same post can appear on more than one listing page, sometimes with a slightly
// different title. Deduping per page is not enough: without run-level dedupe the later
// page rewrites the earlier page's title on every run, churning the same rows forever.
test('a url seen on two pages is written once and does not churn on re-runs', async () => {
  const { db, runner } = makeRunner({
    fetchPage: async (url) => {
      const page = Number(new URL(url).searchParams.get('lcp_page0'))
      const title = page === 1 ? 'Weekly Pack' : 'Weekly Pack (Mirror)'
      return `<div class="su-tabs-pane" data-title="DC Comics">
                <li><a href="/weekly/">${title}</a></li></div>`
    },
  })

  await runner.start('quick').done
  expect(runner.status().inserted).toBe(1)
  expect(rows(db)).toHaveLength(1)

  await runner.start('quick').done
  expect(runner.status()).toMatchObject({ inserted: 0, updated: 0 })
})

test('the first page a url appears on decides the title it keeps', async () => {
  const { db, runner } = makeRunner({
    fetchPage: async (url) => {
      const page = Number(new URL(url).searchParams.get('lcp_page0'))
      const title = page === 1 ? 'Weekly Pack' : 'Weekly Pack (Mirror)'
      return `<div class="su-tabs-pane" data-title="DC Comics">
                <li><a href="/weekly/">${title}</a></li></div>`
    },
  })
  await runner.start('quick').done
  expect((rows(db)[0] as { title: string }).title).toBe('Weekly Pack')
})
