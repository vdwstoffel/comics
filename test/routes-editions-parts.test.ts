import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import editionRoutes from '../server/routes/editions.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition, getEdition, getEditionByComicvineId } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { cacheVolumeRecord } from '../server/models/volumeRecord.js'
import { setComicVineKey } from '../server/models/settings.js'
import { detectRunPart } from '../server/services/runParts.js'
import type { Config } from '../server/config.js'

const THOR = 166460
const MORTAL_THOR = 177511

// Thor (2025) and Mortal Thor as Comic Vine files them: one run, two volumes.
const THOR_ISSUES = [
  { id: 1128967, issue_number: '1', cover_date: '2025-10-01' },
  { id: 1153503, issue_number: '6', cover_date: '2026-03-01' },
  { id: 1188293, issue_number: '800', cover_date: '2026-10-01' },
]
const MORTAL_THOR_ISSUES = [
  { id: 1156981, issue_number: '7', name: 'The Accelerationist', cover_date: '2026-04-01' },
  { id: 1162509, issue_number: '9', name: 'Inevitable', cover_date: '2026-06-01' },
  { id: 1183010, issue_number: '13', name: 'An Endless Tale of Asgard', cover_date: '2026-10-01' },
]
const VOLUMES: Record<number, object> = {
  [THOR]: {
    name: 'Thor', start_year: '2025', publisher: { name: 'Marvel' },
    site_detail_url: 'https://comicvine.gamespot.com/thor/4050-166460/',
    description: '<p>Briefly renamed to <a href="/mortal-thor/4050-177511/" data-ref-id="4050-177511">Mortal Thor</a> by indicia from #7-13.</p>',
  },
  [MORTAL_THOR]: {
    name: 'Mortal Thor', start_year: '2026', publisher: { name: 'Marvel' },
    site_detail_url: 'https://comicvine.gamespot.com/mortal-thor/4050-177511/',
    description: '<p>Brief indicia renaming of <a data-ref-id="4050-166460">Thor</a>.</p>',
  },
}
const ISSUES: Record<number, object[]> = { [THOR]: THOR_ISSUES, [MORTAL_THOR]: MORTAL_THOR_ISSUES }

/** Every Comic Vine url asked for. */
let cvUrls: string[] = []

/** A Comic Vine that knows these volumes, and nothing else. `down` refuses everything. */
function stubCv({ down = false, issues = ISSUES }: { down?: boolean; issues?: Record<number, object[]> } = {}) {
  cvUrls = []
  globalThis.fetch = (async (url: string) => {
    cvUrls.push(String(url))
    if (down) return { ok: false, status: 500, json: async () => ({}) }
    const volume = /\/volume\/4050-(\d+)\//.exec(String(url))
    if (volume) return { ok: true, json: async () => ({ results: VOLUMES[Number(volume[1])] ?? {} }) }
    const listed = /filter=volume%3A(\d+)|filter=volume:(\d+)/.exec(String(url))
    const results = listed ? issues[Number(listed[1] ?? listed[2])] ?? [] : []
    return { ok: true, json: async () => ({ number_of_total_results: results.length, results }) }
  }) as never
}

async function app(db: ReturnType<typeof openDb>, opts: Parameters<typeof editionRoutes>[1] = {}) {
  const server = Fastify()
  server.decorate('db', db)
  server.decorate('config', { comicsDir: '/tmp/comics', thumbsDir: '/tmp/thumbs' } as Config)
  const started: unknown[] = []
  server.decorate('downloader', {
    enqueue(req: unknown) {
      started.push(req)
      const entry = { id: 1, position: 0, state: 'queued', url: 'u', attempts: 0, queuedAt: '' }
      return { queued: true, entry }
    },
    status() { return { active: [], queue: [], history: [] } },
    cancel: vi.fn(),
    wake: vi.fn(),
  } as never)
  setComicVineKey(db, 'k')
  await server.register(editionRoutes, opts)
  return { server, started }
}

function seedThor(db: ReturnType<typeof openDb>) {
  const edition = upsertEdition(db, { name: 'Thor (2025)', folder: 'Thor/Thor (2025)', seriesName: 'Thor' })
  updateEdition(db, edition.id, {
    comicvineId: THOR, cvName: 'Thor', cvStartYear: 2025,
    cvSiteUrl: 'https://comicvine.gamespot.com/thor/4050-166460/',
  })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Thor/Thor (2025)/thor_0006.cbz', pageCount: 20, fileSize: 100 })!
  updateBook(db, book.id, { comicvineId: 1153503, number: '6' })
  return getEdition(db, edition.id)!
}

/**
 * Everything Comic Vine would say, already held - the Comic Vine client paces itself a
 * second a request, and most of these tests are about what happens after the read.
 */
function primeCache(db: ReturnType<typeof openDb>) {
  for (const [volumeId, raw] of Object.entries(ISSUES)) {
    cacheVolumeIssues(db, Number(volumeId), (raw as Array<{ id: number; issue_number: string; name?: string; cover_date: string }>)
      .map((r) => ({ id: r.id, number: r.issue_number, coverDate: r.cover_date, ...(r.name ? { name: r.name } : {}) })))
  }
  for (const [volumeId, raw] of Object.entries(VOLUMES) as Array<[string, Record<string, unknown>]>) {
    cacheVolumeRecord(db, Number(volumeId), {
      name: raw.name as string,
      publisher: (raw.publisher as { name: string }).name,
      descriptionHtml: raw.description as string,
      startYear: Number(raw.start_year),
      siteUrl: raw.site_detail_url as string,
    })
  }
}

const MORTAL_THOR_PART = {
  volumeId: MORTAL_THOR, name: 'Mortal Thor', startYear: 2026,
  siteUrl: 'https://comicvine.gamespot.com/mortal-thor/4050-177511/',
}

function linkMortalThor(db: ReturnType<typeof openDb>, editionId: number) {
  updateEdition(db, editionId, { cvParts: [MORTAL_THOR_PART] })
}

test('a run draws the issues of its other volume between its own, in number order', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  linkMortalThor(db, edition.id)
  stubCv()
  const { server } = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()

  expect(body.issues.map((i: { number: string; owned: boolean }) => [i.number, i.owned]))
    .toEqual([['1', false], ['6', true], ['7', false], ['9', false], ['13', false], ['800', false]])
  expect(body.issues.find((i: { number: string }) => i.number === '9')).toMatchObject({ volumeName: 'Mortal Thor' })
  expect(body.issues.find((i: { number: string }) => i.number === '800')).not.toHaveProperty('volumeName')
  expect(body).toMatchObject({ owned: 1, total: 6, volumeId: THOR })
  await server.close(); db.close()
})

test('an issue of the other volume is matched under that volume\'s name', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  linkMortalThor(db, edition.id)
  db.prepare('INSERT INTO comic_index (title, url, category, number, year, imported_at) VALUES (?,?,?,?,?,?)')
    .run('The Mortal Thor #9 (2026)', 'https://x.test/post/mt9', 'Marvel Comics', '009', 2026, '2026-06-03T00:00:00.000Z')
  stubCv()
  const { server, started } = await app(db, { fetchPage: async () => '<div class="aio-button-center"><a href="https://dl.test/mt9.cbz">DOWNLOAD NOW</a></div>' })

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()
  expect(body.issues.find((i: { number: string }) => i.number === '9').match).toMatchObject({ title: 'The Mortal Thor #9 (2026)' })

  const res = await server.inject({ method: 'POST', url: `/api/editions/${edition.id}/issues/1162509/download` })
  expect(res.statusCode).toBe(202)
  // Into the run it belongs to, under the name its posts go by.
  expect(started).toEqual([expect.objectContaining({ edition: 'Thor (2025)', issueId: 1162509, label: 'Mortal Thor #9' })])
  await server.close(); db.close()
})

test('a run with no other volumes reads exactly as it did', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  stubCv()
  const { server } = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()
  expect(body.issues.map((i: { number: string }) => i.number)).toEqual(['1', '6', '800'])
  expect(cvUrls.some((u) => u.includes(String(MORTAL_THOR)))).toBe(false)
  await server.close(); db.close()
})

test('Comic Vine\'s note on the run is offered as a part, with the stretch it holds', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  stubCv()
  const { server } = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/parts` })).json()

  expect(body.parts).toEqual([])
  expect(body.proposal).toEqual({ ...MORTAL_THOR_PART, first: '7', last: '13' })
  expect(body.checkedAt).toEqual(expect.any(String))
  // Offered, never applied.
  expect(getEdition(db, edition.id)!.cvParts).toEqual([])
  await server.close(); db.close()
})

test('the suggestion is served from what was found, not looked for again', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  stubCv()
  const detect = vi.fn(detectRunPart)
  const { server } = await app(db, { detectRunPart: detect })

  await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/parts` })
  const again = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/parts` })).json()

  expect(detect).toHaveBeenCalledTimes(1)
  expect(again.proposal).toMatchObject({ volumeId: MORTAL_THOR })
  await server.close(); db.close()
})

test('a week-old look is taken again, because a rename lands mid-run', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  updateEdition(db, edition.id, { cvPartsCheckedAt: '2026-01-01T00:00:00.000Z', cvPartsProposal: null })
  stubCv()
  const { server } = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/parts` })).json()
  expect(body.proposal).toMatchObject({ volumeId: MORTAL_THOR })
  await server.close(); db.close()
})

test('a look Comic Vine refused is not recorded as one that found nothing', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  stubCv({ down: true })
  const { server } = await app(db)

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/parts` })).json()
  expect(body.proposal).toBeNull()
  expect(getEdition(db, edition.id)!.cvPartsCheckedAt).toBeNull()
  await server.close(); db.close()
})

test('yes links the volume, and the run then includes it', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  stubCv()
  const { server } = await app(db)
  await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/parts` })

  const res = await server.inject({ method: 'PUT', url: `/api/editions/${edition.id}/parts`, payload: MORTAL_THOR_PART })

  expect(res.statusCode).toBe(200)
  expect(getEdition(db, edition.id)!.cvParts).toEqual([MORTAL_THOR_PART])
  const parts = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/parts` })).json()
  expect(parts.parts).toEqual([{ ...MORTAL_THOR_PART, first: '7', last: '13' }])
  expect(parts.proposal).toBeNull()
  await server.close(); db.close()
})

test('a volume pasted by hand is named from Comic Vine', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  stubCv()
  const { server } = await app(db)

  const res = await server.inject({ method: 'PUT', url: `/api/editions/${edition.id}/parts`, payload: { volumeId: MORTAL_THOR } })

  expect(res.statusCode).toBe(200)
  expect(getEdition(db, edition.id)!.cvParts).toEqual([MORTAL_THOR_PART])
  await server.close(); db.close()
})

test('a volume sharing the run\'s issue numbers is refused', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  // Thor (2020): a different run of the same title, from #1.
  stubCv({ issues: { ...ISSUES, 123862: [{ id: 1, issue_number: '1' }, { id: 2, issue_number: '35' }] } })
  const { server } = await app(db)

  const res = await server.inject({ method: 'PUT', url: `/api/editions/${edition.id}/parts`, payload: { volumeId: 123862 } })

  expect(res.statusCode).toBe(409)
  expect(res.json().reason).toBe('overlap')
  expect(getEdition(db, edition.id)!.cvParts).toEqual([])
  await server.close(); db.close()
})

test('the run\'s own volume cannot be added as a part of itself', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  stubCv()
  const { server } = await app(db)

  const res = await server.inject({ method: 'PUT', url: `/api/editions/${edition.id}/parts`, payload: { volumeId: THOR } })
  expect(res.statusCode).toBe(409)
  await server.close(); db.close()
})

test('no is remembered, and the volume is not suggested again', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  stubCv()
  const { server } = await app(db)
  await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/parts` })

  const res = await server.inject({ method: 'DELETE', url: `/api/editions/${edition.id}/parts/${MORTAL_THOR}` })
  expect(res.statusCode).toBe(200)

  const after = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/parts?recheck=1` })).json()
  expect(after.proposal).toBeNull()
  expect(getEdition(db, edition.id)!.cvPartsDeclined).toEqual([MORTAL_THOR])
  await server.close(); db.close()
})

test('taking a yes back takes the volume out of the run', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  primeCache(db)
  linkMortalThor(db, edition.id)
  stubCv()
  const { server } = await app(db)

  await server.inject({ method: 'DELETE', url: `/api/editions/${edition.id}/parts/${MORTAL_THOR}` })

  const body = (await server.inject({ method: 'GET', url: `/api/editions/${edition.id}/issues` })).json()
  expect(body.issues.map((i: { number: string }) => i.number)).toEqual(['1', '6', '800'])
  await server.close(); db.close()
})

test('the edition holding a volume as a part is where that volume\'s comics belong', () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  expect(getEditionByComicvineId(db, MORTAL_THOR)).toBeUndefined()
  linkMortalThor(db, edition.id)
  expect(getEditionByComicvineId(db, MORTAL_THOR)?.name).toBe('Thor (2025)')
  // A damaged column reads as no parts, rather than breaking every lookup.
  db.prepare('UPDATE edition SET cv_parts = ? WHERE id = ?').run('[{"volumeId":', edition.id)
  expect(getEditionByComicvineId(db, MORTAL_THOR)).toBeUndefined()
  db.close()
})

test('a run counted straight through never reads the volumes its note links', async () => {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'X-Men (2024)', folder: 'X-Men/X-Men (2024)', seriesName: 'X-Men' })
  updateEdition(db, edition.id, { comicvineId: 158814 })
  cacheVolumeIssues(db, 158814, [{ id: 1, number: '1' }, { id: 2, number: '2' }])
  const cv = { listVolumeIssues: vi.fn(), getVolume: vi.fn() }

  expect(await detectRunPart({ db, cv }, getEdition(db, edition.id)!)).toBeNull()
  expect(cv.listVolumeIssues).not.toHaveBeenCalled()
  expect(cv.getVolume).not.toHaveBeenCalled()
  db.close()
})

test('a volume from another publisher with the right numbers is not offered', async () => {
  const db = openDb(':memory:')
  const edition = seedThor(db)
  cacheVolumeIssues(db, THOR, [{ id: 1, number: '1' }, { id: 6, number: '6' }, { id: 800, number: '800' }])
  cacheVolumeIssues(db, MORTAL_THOR, [{ id: 7, number: '7' }])
  const cv = {
    listVolumeIssues: vi.fn(),
    getVolume: vi.fn(async (id: number | string) => Number(id) === THOR
      ? { name: 'Thor', publisher: 'Marvel', descriptionHtml: '<a data-ref-id="4050-177511">x</a>' }
      : { name: 'Mortal Thor', publisher: 'Image' }),
  }

  expect(await detectRunPart({ db, cv }, edition)).toBeNull()
  db.close()
})
