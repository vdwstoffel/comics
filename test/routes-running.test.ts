import { test, expect } from 'vitest'
import Fastify from 'fastify'
import runningRoutes from '../server/routes/running.js'
import { openDb } from '../server/db.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

/** The smallest page shaped like the real one: one Active ongoing table, one series. */
function page(title: string): string {
  return JSON.stringify({
    parse: {
      text: `<div>
        <h2>Ongoing series</h2><h3>Active</h3>
        <table class="wikitable">
          <tr><th>Title</th><th>Issues</th><th>Pub. Year</th><th>Date of Final Issue</th></tr>
          <tr><td><i>${title}</i></td><td>#1–</td><td>2026</td><td></td></tr>
        </table>
      </div>`,
    },
  })
}

/** A page whose Active tables hold nothing - the shape a moved/renamed section produces. */
const EMPTY_PAGE = JSON.stringify({ parse: { text: '<div><h2>See also</h2></div>' } })

async function setup(fetchPage: (url: string) => Promise<string>, apiKey = '') {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  if (apiKey) setComicVineKey(db, apiKey)
  await app.register(runningRoutes, { fetchPage })
  return app
}

/** Answers each publisher's page by matching its title in the url. */
function byPage(marvel: () => Promise<string>, dc: () => Promise<string>) {
  const urls: string[] = []
  const fetchPage = async (url: string) => {
    urls.push(url)
    if (url.includes('Marvel')) return marvel()
    if (url.includes('DC')) return dc()
    throw new Error(`unexpected url ${url}`)
  }
  return { urls, fetchPage }
}

const ok = (title: string) => async () => page(title)
const fails = () => async () => { throw new Error('network is down') }

test('serves both publishers, in the same order and under the same names as the latest tab', async () => {
  const { fetchPage } = byPage(ok('Marvel Title'), ok('DC Title'))
  const app = await setup(fetchPage)
  const res = await app.inject({ method: 'GET', url: '/api/releases/running' })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.publishers.map((p: { name: string }) => p.name)).toEqual(['Marvel', 'DC Comics'])
  expect(body.publishers[0].series).toEqual([
    { title: 'Marvel Title', kind: 'ongoing', issues: '#1–', pubYear: 2026, endsOn: null },
  ])
  expect(body.publishers[1].series[0].title).toBe('DC Title')
  expect(body.failed).toBeUndefined()
})

test('reads each publisher through the wikipedia api, not the article url', async () => {
  const { urls, fetchPage } = byPage(ok('Marvel Title'), ok('DC Title'))
  const app = await setup(fetchPage)
  await app.inject({ method: 'GET', url: '/api/releases/running' })

  expect(urls).toHaveLength(2)
  for (const url of urls) expect(url).toContain('/w/api.php?action=parse')
})

test('carries the article url for each publisher, for the attribution link', async () => {
  const { fetchPage } = byPage(ok('Marvel Title'), ok('DC Title'))
  const app = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/running' })).json()

  expect(body.publishers[0].sourceUrl)
    .toBe('https://en.wikipedia.org/wiki/List_of_current_Marvel_Comics_publications')
})

test('one publisher failing leaves the other intact and names the one that failed', async () => {
  const { fetchPage } = byPage(ok('Marvel Title'), fails())
  const app = await setup(fetchPage)
  const res = await app.inject({ method: 'GET', url: '/api/releases/running' })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.publishers[0].series).toHaveLength(1)
  expect(body.publishers[1].series).toEqual([])
  expect(body.failed).toEqual(['DC Comics'])
})

test('both failing still answers, with every publisher named', async () => {
  const { fetchPage } = byPage(fails(), fails())
  const app = await setup(fetchPage)
  const res = await app.inject({ method: 'GET', url: '/api/releases/running' })

  expect(res.statusCode).toBe(200)
  expect(res.json().failed).toEqual(['Marvel', 'DC Comics'])
})

test('a page that yields no series counts as failed, not as a publisher that stopped', async () => {
  const { fetchPage } = byPage(ok('Marvel Title'), async () => EMPTY_PAGE)
  const app = await setup(fetchPage)
  const body = (await app.inject({ method: 'GET', url: '/api/releases/running' })).json()

  expect(body.failed).toEqual(['DC Comics'])
})

test('answers with no Comic Vine key configured - this tab does not use Comic Vine', async () => {
  const { fetchPage } = byPage(ok('Marvel Title'), ok('DC Title'))
  const app = await setup(fetchPage, '')
  const res = await app.inject({ method: 'GET', url: '/api/releases/running' })

  expect(res.statusCode).toBe(200)
  expect(res.json().publishers[0].series).toHaveLength(1)
})
