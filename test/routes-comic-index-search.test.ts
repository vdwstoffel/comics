import { test, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import comicIndexRoutes from '../server/routes/comicIndex.js'
import { upsertComicIndex } from '../server/models/comicIndex.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

const MARVEL = 'Marvel Comics'
let app: FastifyInstance

beforeEach(async () => {
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', {} as Config)
  upsertComicIndex(app.db, [
    { title: 'Thor #1 (2018)', url: 'https://x.test/1/', category: MARVEL },
    { title: 'Thor #2 (2018)', url: 'https://x.test/2/', category: MARVEL },
    { title: 'Thor #3 (2019)', url: 'https://x.test/4/', category: MARVEL },
    // One stray on its own stays its own heading; it takes two to make an "Other".
    { title: 'Astonishing Thor (TPB) (2011)', url: 'https://x.test/3/', category: MARVEL },
  ])
  await app.register(comicIndexRoutes)
})
afterEach(async () => { await app.close() })

const get = (qs: string) => app.inject({ method: 'GET', url: `/api/comic-index/search?${qs}` })

test('a plain search answers with groups rather than rows', async () => {
  const res = await get('q=thor')
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.totalGroups).toBe(2)
  expect(body.totalResults).toBe(4)
  expect(body.groups[0]).toMatchObject({ key: 'thor', name: 'Thor', total: 3 })
})

test('each group reports what kinds it holds', async () => {
  const body = (await get('q=thor')).json()
  expect(body.groups[0].kinds).toMatchObject({ issue: 3 })
})

test('naming a series answers with that group\'s rows', async () => {
  const body = (await get('q=thor&series=thor')).json()
  expect(body.total).toBe(3)
  expect(body.results.map((r: { title: string }) => r.title))
    .toEqual(['Thor #1 (2018)', 'Thor #2 (2018)', 'Thor #3 (2019)'])
})

test('naming a kind narrows an expanded group', async () => {
  const body = (await get('q=thor&series=astonishing thor&kind=collection')).json()
  expect(body.total).toBe(1)
})

test('a kind the code does not know is ignored rather than obeyed', async () => {
  const body = (await get('q=thor&series=thor&kind=nonsense')).json()
  expect(body.total).toBe(3)
})

test('the existing filters still apply to a grouped search', async () => {
  const body = (await get(`q=thor&category=${encodeURIComponent(MARVEL)}`)).json()
  expect(body.totalResults).toBe(4)
  const none = (await get('q=thor&category=DC%20Comics')).json()
  expect(none.totalResults).toBe(0)
})

test('an empty query groups nothing', async () => {
  const body = (await get('q=')).json()
  expect(body).toMatchObject({ groups: [], totalGroups: 0, totalResults: 0 })
})

test('groups can be paged', async () => {
  const body = (await get('q=thor&limit=1&offset=0')).json()
  expect(body.groups).toHaveLength(1)
  expect(body.totalGroups).toBe(2)
})

test('a group carries the runs its issues fall into', async () => {
  const body = (await get('q=thor')).json()
  expect(body.groups[0].runs[0]).toMatchObject({ total: 3, yearFrom: 2018, yearTo: 2019 })
})

test('naming a run answers with just that run', async () => {
  const runKey = (await get('q=thor')).json().groups[0].runs[0].key
  const body = (await get(`q=thor&series=thor&run=${encodeURIComponent(runKey)}`)).json()
  expect(body.total).toBe(3)
})
