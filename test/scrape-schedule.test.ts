import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { openDb } from '../server/db.js'
import { createScrapeRunner } from '../server/services/comicIndexScraper.js'
import { nextSlot, previousSlot, slotMissed } from '../server/lib/scrapeSchedule.js'
import { checkScrapeSchedule } from '../server/services/scrapeSchedule.js'
import { upsertEdition } from '../server/models/editions.js'
import { addFollow } from '../server/models/follows.js'
import * as following from '../server/services/following.js'
import type { Config } from '../server/config.js'

// Built with the local-time constructor, so each reads as the wall-clock time it names in
// whatever zone the suite runs in. 28 October 2026 is a Wednesday.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)

// --- when ---------------------------------------------------------------------

test('the next check after a Monday is Wednesday at six in the evening', () => {
  expect(nextSlot(at(26, 10))).toEqual(at(28, 18))
})

// Release posts still trickle in after Wednesday afternoon, so Thursday looks again.
test('Wednesday\'s check is followed by Thursday\'s', () => {
  expect(nextSlot(at(28, 18))).toEqual(at(29, 18))
})

test('after Thursday\'s check the next is the Wednesday after', () => {
  expect(nextSlot(at(29, 18, 30))).toEqual(new Date(2026, 10, 4, 18))
})

// The clocks went back on Sunday 25 October. Six in the evening is a wall-clock time, so
// a schedule counted in fixed days would drift to five.
test('six in the evening stays six after the clocks change', () => {
  const next = nextSlot(at(24, 12))
  expect(next).toEqual(at(28, 18))
  expect(next.getHours()).toBe(18)
})

test('the check before a Tuesday morning is the Thursday before it', () => {
  expect(previousSlot(new Date(2026, 10, 3, 9))).toEqual(at(29, 18))
})

test('a minute before Wednesday\'s check, the last one was the week before', () => {
  expect(previousSlot(at(28, 17, 59))).toEqual(at(22, 18))
})

// --- whether ------------------------------------------------------------------

test('a library that has never scraped has missed its check', () => {
  expect(slotMissed(at(30, 9), null)).toBe(true)
})

// The container was down at six on Thursday: the check runs when it comes back.
test('a check is missed when the last scrape started before it', () => {
  expect(slotMissed(at(30, 9), at(28, 18).toISOString())).toBe(true)
})

// Pressing Check for new after six does the same job, so it counts.
test('a scrape started after the check, by hand or not, covers it', () => {
  expect(slotMissed(at(30, 9), at(29, 20).toISOString())).toBe(false)
})

// --- running it ---------------------------------------------------------------

const PANE = `<div class="su-tabs-pane" data-title="DC Comics">
  <li><a href="/a/">Batman #1 (2020)</a></li></div>`

let app: FastifyInstance

beforeEach(async () => {
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', {} as Config)
  app.decorate('scraper', createScrapeRunner(
    { db: app.db, config: app.config },
    { fetchPage: async () => PANE, delayMs: 0, retries: 1, retryBackoffMs: 0, quickPages: 2, fullPages: 4 },
  ))
})
afterEach(async () => { await app.close() })

const noNetwork = { fetchPage: async () => { throw new Error('no network') } }

test('a missed check runs a quick scrape, marked as automatic', async () => {
  const run = checkScrapeSchedule(app, new Date(), noNetwork)
  expect(run?.started).toBe(true)
  await run!.done
  expect(app.scraper.status()).toMatchObject({ mode: 'quick', scheduled: true, running: false })
  expect(app.scraper.status().inserted).toBeGreaterThan(0)
})

test('a check already covered does not scrape again', async () => {
  await app.scraper.start('quick').done
  expect(checkScrapeSchedule(app, new Date(), noNetwork)).toBeNull()
})

// The same promise the button makes: a scrape finishing is when a follow can be filled.
test('an automatic check retries the follows, as a press of the button does', async () => {
  const spy = vi.spyOn(following, 'attemptFollow').mockResolvedValue('skipped')
  try {
    const edition = upsertEdition(app.db, { name: 'Iron Man', folder: 'Iron Man' })
    addFollow(app.db, 'volume', edition.id, 'Iron Man')
    await checkScrapeSchedule(app, new Date(), noNetwork)!.done
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    await following.followSweepIdle()
    expect(spy).toHaveBeenCalledTimes(1)
  } finally { spy.mockRestore() }
})
