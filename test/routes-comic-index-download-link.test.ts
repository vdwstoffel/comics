import { test, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import comicIndexRoutes from '../server/routes/comicIndex.js'
import { upsertComicIndex } from '../server/models/comicIndex.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

const POST_URL = 'https://getcomics.org/marvel/knull-5-2026/'
const MIRRORS_ONLY_URL = 'https://getcomics.org/marvel/mirrors-only/'
const DLS = 'https://getcomics.org/dls/tC3kM3XUCQrAyhWkBASEc:X1Em/N7zYbPZ7w=='

const withButton = `<div class="aio-button-center">
  <a href="${DLS}" class="aio-red" title="DOWNLOAD NOW">DOWNLOAD NOW</a></div>
  <div class="aio-button-center"><a href="https://rootz.so/d/x" title="ROOTZ">ROOTZ</a></div>`
const mirrorsOnly = `<div class="aio-button-center">
  <a href="https://rootz.so/d/x" title="ROOTZ">ROOTZ</a></div>`

let app: FastifyInstance
let asked: string[]

function idFor(url: string): number {
  return (app.db.prepare('SELECT id FROM comic_index WHERE url = ?').get(url) as { id: number }).id
}

beforeEach(async () => {
  asked = []
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', {} as Config)
  upsertComicIndex(app.db, [
    { title: 'Knull #5 (2026)', url: POST_URL, category: 'Marvel Comics' },
    { title: 'Mirrors Only #1', url: MIRRORS_ONLY_URL, category: 'Marvel Comics' },
  ])
  await app.register(comicIndexRoutes, {
    fetchPage: async (url: string) => {
      asked.push(url)
      if (url === MIRRORS_ONLY_URL) return mirrorsOnly
      if (url === POST_URL) return withButton
      throw new Error('502 Bad Gateway')
    },
  })
})
afterEach(async () => { await app.close() })

const get = (id: number | string) =>
  app.inject({ method: 'GET', url: `/api/comic-index/${id}/download-link` })

test('returns the main download link for an indexed post', async () => {
  const res = await get(idFor(POST_URL))
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ url: DLS })
})

test('fetches the post url stored on that row', async () => {
  await get(idFor(POST_URL))
  expect(asked).toEqual([POST_URL])
})

test('answers 404 for a row id that is not in the index', async () => {
  const res = await get(999999)
  expect(res.statusCode).toBe(404)
  expect(asked).toEqual([])
})

test('answers 404 when the post offers only third-party mirrors', async () => {
  const res = await get(idFor(MIRRORS_ONLY_URL))
  expect(res.statusCode).toBe(404)
  expect(res.json().error).toMatch(/download/i)
})

test('answers 400 for an id that is not a number', async () => {
  const res = await get('abc')
  expect(res.statusCode).toBe(400)
  expect(asked).toEqual([])
})

test('answers 502 when the post page cannot be fetched', async () => {
  app.db.prepare('UPDATE comic_index SET url = ? WHERE url = ?').run('https://x.test/gone/', POST_URL)
  const res = await get(idFor('https://x.test/gone/'))
  expect(res.statusCode).toBe(502)
})
