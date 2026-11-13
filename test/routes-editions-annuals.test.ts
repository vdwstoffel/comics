import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition, getEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { listSeries } from '../server/models/series.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Config } from '../server/config.js'

type Db = ReturnType<typeof openDb>

// Comic Vine's own answer to "Batman Annual": the run's annual, the next run's, and a
// reprint annual from another publisher that happens to share the name.
const SEARCH = [
  { id: 49197, name: 'Batman Annual', start_year: '2012', publisher: { name: 'DC Comics' } },
  { id: 96128, name: 'Batman Annual', start_year: '2016', publisher: { name: 'DC Comics' } },
  { id: 89330, name: 'Batman Annual', start_year: '1958', publisher: { name: 'Editorial Muchnik' } },
]
const ISSUES: Record<string, unknown[]> = {
  49197: [
    { id: 3001, issue_number: '1', name: 'First Snow', cover_date: '2012-07-31' },
    { id: 3002, issue_number: '2', name: 'Cages', cover_date: '2013-09-30' },
  ],
  96128: [{ id: 4001, issue_number: '1', cover_date: '2017-01-31' }],
  89330: [{ id: 5001, issue_number: '1', cover_date: '2012-08-01' }],
}

let searches = 0

function stubCv() {
  searches = 0
  globalThis.fetch = (async (url: string) => {
    const u = new URL(String(url))
    if (u.pathname.includes('/search/')) {
      searches++
      return { ok: true, json: async () => ({ results: SEARCH }) }
    }
    const volume = /^volume:(\d+)$/.exec(u.searchParams.get('filter') ?? '')?.[1]
    const results = volume ? ISSUES[volume] ?? [] : []
    return { ok: true, json: async () => ({ number_of_total_results: results.length, results }) }
  }) as never
}

function seedBatman(db: Db) {
  const run = upsertEdition(db, { name: 'Batman (2011)', folder: 'Batman/Batman (2011)', seriesName: 'Batman' })
  updateEdition(db, run.id, {
    comicvineId: 42721, cvName: 'Batman', cvStartYear: 2011, publisher: 'DC Comics',
    cvSiteUrl: 'https://comicvine.gamespot.com/batman/4050-42721/',
  })
  cacheVolumeIssues(db, 42721, [
    { id: 2009, number: '9', coverDate: '2012-07-01' },
    { id: 2010, number: '10', coverDate: '2012-08-24' },
    { id: 2022, number: '22', coverDate: '2013-09-30' },
    { id: 2023, number: '23', coverDate: '2013-10-01' },
    { id: 2052, number: '52', coverDate: '2016-07-31' },
  ])
  // Held already, as a day's browsing would leave them: the client paces its requests,
  // and the search is the one call these tests are about.
  for (const [volumeId, issues] of Object.entries(ISSUES)) {
    cacheVolumeIssues(db, Number(volumeId), (issues as Array<{ id: number; issue_number: string; name?: string; cover_date: string }>)
      .map((i) => ({ id: i.id, number: i.issue_number, name: i.name, coverDate: i.cover_date })))
  }
  return run
}

async function server(db: Db, opts: { started?: unknown[] } = {}) {
  const app = Fastify()
  app.decorate('db', db)
  app.decorate('config', { comicsDir: '/tmp/comics', thumbsDir: '/tmp/thumbs' } as Config)
  setComicVineKey(db, 'k')
  app.decorate('downloader', {
    enqueue(req: unknown) {
      opts.started?.push(req)
      const entry = { id: 1, position: 0, state: 'queued', url: '', attempts: 0, queuedAt: new Date().toISOString() }
      return { queued: true, entry }
    },
    status() { return { active: [], queue: [], history: [] } },
    cancel: vi.fn(),
    wake: vi.fn(),
  } as never)
  const html = '<div class="aio-button-center"><a href="https://dl.test/annual-2.cbz">DOWNLOAD NOW</a></div>'
  await app.register(editionRoutes, { fetchPage: async () => html })
  return app
}

type Issue = { id: number; number: string; owned: boolean; annual?: boolean; volumeName?: string; bookId?: number }

test('a run reads its annuals in where they came out, and only its own', async () => {
  const db = openDb(':memory:')
  const run = seedBatman(db)
  stubCv()
  const app = await server(db)

  const body = (await app.inject({ url: `/api/editions/${run.id}/issues` })).json()

  expect(body.issues.map((i: Issue) => `${i.annual ? 'Annual ' : ''}${i.number}`))
    .toEqual(['9', 'Annual 1', '10', '22', 'Annual 2', '23', '52'])
  // Posted, and so searched for, under its own name.
  expect(body.issues.find((i: Issue) => i.id === 3001).volumeName).toBe('Batman Annual')
  expect(body).toMatchObject({ owned: 0, total: 7 })
  expect(getEdition(db, run.id)?.cvAnnuals.map((a) => a.volumeId)).toEqual([49197])
  await app.close(); db.close()
})

test('an annual you have, filed in its own edition, is owned and comes with its comic', async () => {
  const db = openDb(':memory:')
  const run = seedBatman(db)
  const annual = upsertEdition(db, { name: 'Batman Annual (2012)', folder: 'Batman/Batman Annual (2012)', seriesName: 'Batman' })
  updateEdition(db, annual.id, { comicvineId: 49197 })
  const book = insertBook(db, { editionId: annual.id, filePath: 'Batman/Batman Annual (2012)/1.cbz', pageCount: 40, fileSize: 1 })!
  updateBook(db, book.id, { comicvineId: 3001, number: '1' })
  stubCv()
  const app = await server(db)

  const body = (await app.inject({ url: `/api/editions/${run.id}/issues` })).json()

  const first = body.issues.find((i: Issue) => i.id === 3001)
  expect(first).toMatchObject({ owned: true, bookId: book.id })
  expect(body.annualBooks.map((b: { id: number }) => b.id)).toEqual([book.id])
  expect(body.extras).toEqual([])
  expect(body.owned).toBe(1)
  await app.close(); db.close()
})

test('the search for annuals is not repeated on every view', async () => {
  const db = openDb(':memory:')
  const run = seedBatman(db)
  stubCv()
  const app = await server(db)

  await app.inject({ url: `/api/editions/${run.id}/issues` })
  await app.inject({ url: `/api/editions/${run.id}/issues` })

  expect(searches).toBe(1)
  await app.close(); db.close()
})

// Filed in the run, an annual's metadata would rename the run after the annual's volume.
test('getting an annual files it in its own annual edition, not the run', async () => {
  const db = openDb(':memory:')
  const run = seedBatman(db)
  db.prepare('INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)')
    .run('Batman Annual #2 (2013)', 'https://x.test/post/annual-2', 'DC Comics', '002', 2013, '2026-09-13T00:00:00.000Z')
  stubCv()
  const started: unknown[] = []
  const app = await server(db, { started })
  await app.inject({ url: `/api/editions/${run.id}/issues` })

  const res = await app.inject({ method: 'POST', url: `/api/editions/${run.id}/issues/3002/download` })

  expect(res.statusCode).toBe(202)
  expect(started).toMatchObject([{ edition: 'Batman Annual (2012)', issueId: 3002 }])
  await app.close(); db.close()
})

test('the series page leaves out an annual its run has taken in, and keeps one it has not', async () => {
  const db = openDb(':memory:')
  const run = seedBatman(db)
  for (const [name, volumeId] of [['Batman Annual (2012)', 49197], ['Batman Annual (1961)', 3109]] as const) {
    const e = upsertEdition(db, { name, folder: `Batman/${name}`, seriesName: 'Batman' })
    updateEdition(db, e.id, { comicvineId: volumeId })
    insertBook(db, { editionId: e.id, filePath: `Batman/${name}/1.cbz`, pageCount: 40, fileSize: 1 })
  }
  stubCv()
  const app = await server(db)
  await app.inject({ url: `/api/editions/${run.id}/issues` })

  const batman = listSeries(db).find((s) => s.name === 'Batman')!
  expect(batman.shelves.map((s) => s.name).sort()).toEqual(['Batman (2011)', 'Batman Annual (1961)'])
  // Still the series' to delete.
  expect(batman.editions).toHaveLength(3)
  await app.close(); db.close()
})
