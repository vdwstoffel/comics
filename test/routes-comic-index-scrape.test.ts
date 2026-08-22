import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import comicIndexRoutes from '../server/routes/comicIndex.js'
import { createScrapeRunner } from '../server/services/comicIndexScraper.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

const PANE = `<div class="su-tabs-pane" data-title="DC Comics">
  <li><a href="/a/">Batman #1 (2020)</a></li></div>`

let app: FastifyInstance
let release: (() => void) | undefined
let gate: Promise<void>

beforeEach(async () => {
  gate = new Promise<void>((resolve) => { release = resolve })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', {} as Config)
  app.decorate('scraper', createScrapeRunner(
    { db: app.db, config: app.config },
    {
      fetchPage: async (url) => { if (url.includes('lcp_page0=2')) await gate; return PANE },
      delayMs: 0, retries: 1, retryBackoffMs: 0, quickPages: 2, fullPages: 4,
    },
  ))
  await app.register(comicIndexRoutes)
})
afterEach(async () => { release?.(); await app.close() })

const post = (payload?: unknown) =>
  app.inject({ method: 'POST', url: '/api/comic-index/scrape', payload: payload ?? {} })
const get = () => app.inject({ method: 'GET', url: '/api/comic-index/scrape' })

test('GET reports an idle scraper before anything runs', async () => {
  const res = await get()
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ running: false, mode: null, inserted: 0 })
})

test('POST starts a run and reports it as accepted', async () => {
  const res = await post({ mode: 'quick' })
  expect(res.statusCode).toBe(202)
  expect(res.json()).toMatchObject({ started: true, status: { running: true, mode: 'quick' } })
})

test('POST defaults to a quick run when no mode is given', async () => {
  const res = await post()
  expect(res.json().status.mode).toBe('quick')
})

test('POST rejects an unknown mode', async () => {
  const res = await post({ mode: 'everything' })
  expect(res.statusCode).toBe(400)
  expect((await get()).json().running).toBe(false)
})

test('POST while a run is in flight returns 409 and does not start a second', async () => {
  await post({ mode: 'full' })
  const second = await post({ mode: 'quick' })
  expect(second.statusCode).toBe(409)
  expect(second.json()).toMatchObject({ started: false })
  expect((await get()).json().mode).toBe('full')
})

test('GET reflects progress and then completion', async () => {
  await post({ mode: 'quick' })
  expect((await get()).json().running).toBe(true)
  release!()
  await vi.waitFor(async () => expect((await get()).json().running).toBe(false))
  const done = (await get()).json()
  expect(done.inserted).toBeGreaterThan(0)
  expect(done.finishedAt).not.toBeNull()
})
