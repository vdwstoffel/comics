import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { openDb } from '../server/db.js'
import editionRoutes from '../server/routes/editions.js'
import { upsertEdition, updateEdition, getEdition } from '../server/models/editions.js'
import { shelfKeyOf } from '../server/lib/shelfKey.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'
import type { CollectsProposal } from '../server/services/detectCollects.js'

let dir: string, app: FastifyInstance, id: number
let detect: ReturnType<typeof vi.fn>
let volumeLookup: ReturnType<typeof vi.fn>

const PROPOSAL: CollectsProposal = {
  volumeId: 142577,
  name: 'The Amazing Spider-Man',
  startYear: 2022,
  siteUrl: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/',
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ec-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(config.comicsDir, { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  // The real one walks the whole library and moves files; here we only need to know
  // that it was asked to.
  const refiled: number[] = []
  ;(app as unknown as { refiled: number[] }).refiled = refiled
  detect = vi.fn(async () => PROPOSAL)
  volumeLookup = vi.fn(async () => ({
    name: 'The Amazing Spider-Man', startYear: 2022, siteUrl: PROPOSAL.siteUrl ?? undefined,
  }))
  await app.register(editionRoutes, {
    detect,
    lookupVolume: volumeLookup,
    refile: async () => { refiled.push(1) },
  })

  const edition = upsertEdition(app.db, { name: 'Amazing Spider-Man By Zeb Wells (2023)', folder: 'z' })
  updateEdition(app.db, edition.id, { comicvineId: 150443 })
  id = edition.id
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

const get = (url: string) => app.inject({ method: 'GET', url })
const put = (url: string, payload: object) => app.inject({ method: 'PUT', url, payload })
const del = (url: string) => app.inject({ method: 'DELETE', url })

// The banner's whole point is that you click through to Comic Vine and check the
// proposal before saying yes. target="_blank" plus refetchOnWindowFocus means the page
// re-asks the moment you come back - and the proposal has to still be there.
test('a proposal survives being looked at twice', async () => {
  const first = (await get(`/api/editions/${id}/collects`)).json()
  expect(first.proposal.volumeId).toBe(142577)

  detect.mockClear()
  const second = (await get(`/api/editions/${id}/collects`)).json()
  expect(second.proposal).toEqual(first.proposal)
  expect(second.confirmed).toBe(false)
  // ...and Comic Vine is still only asked once.
  expect(detect).not.toHaveBeenCalled()
})

test('an edition with no volume of its own is not marked as asked', async () => {
  const unmatched = upsertEdition(app.db, { name: 'Unmatched (2025)', folder: 'u' })
  detect.mockResolvedValue(null)

  await get(`/api/editions/${unmatched.id}/collects`)
  // Nothing was asked, because there was nothing to ask about. Pressing "Check Comic
  // Vine" first and coming back must still be able to detect.
  expect(getEdition(app.db, unmatched.id)!.collectsCheckedAt).toBeNull()
})

test('a detection that threw is not recorded as an answer', async () => {
  detect.mockRejectedValue(new Error('Comic Vine is down'))
  const res = (await get(`/api/editions/${id}/collects`)).json()
  expect(res.proposal).toBeNull()
  expect(res.checkedAt).toBeNull()
  expect(getEdition(app.db, id)!.collectsCheckedAt).toBeNull()
})

test('a declined edition can be asked again by hand', async () => {
  await del(`/api/editions/${id}/collects`)
  expect((await get(`/api/editions/${id}/collects`)).json().proposal).toBeNull()

  detect.mockResolvedValue(PROPOSAL)
  const again = (await get(`/api/editions/${id}/collects?recheck=1`)).json()
  expect(again.proposal.volumeId).toBe(142577)
})

test('a proposal is offered but nothing is written', async () => {
  const { proposal, confirmed } = (await get(`/api/editions/${id}/collects`)).json()
  expect(proposal.volumeId).toBe(142577)
  expect(confirmed).toBe(false)
  expect(getEdition(app.db, id)!.collectsVolumeId).toBeNull()
})

test('confirming writes the link and the volume name', async () => {
  await put(`/api/editions/${id}/collects`, PROPOSAL)
  const back = getEdition(app.db, id)!
  expect(back.collectsVolumeId).toBe(142577)
  expect(back.collectsCvName).toBe('The Amazing Spider-Man')
  expect(back.collectsCvStartYear).toBe(2022)
  expect(back.collectsCheckedAt).not.toBeNull()
  // The edition is still its own volume; only what it reprints was added.
  expect(back.comicvineId).toBe(150443)
})

test('a confirmed edition reports itself confirmed and asks Comic Vine nothing', async () => {
  await put(`/api/editions/${id}/collects`, PROPOSAL)
  detect.mockClear()

  const { confirmed, proposal } = (await get(`/api/editions/${id}/collects`)).json()
  expect(confirmed).toBe(true)
  expect(proposal.volumeId).toBe(142577)
  expect(detect).not.toHaveBeenCalled()
})

// Spec §4.3: re-proposing a decline on every page view would make this an irritant
// within a week.
test('declining is remembered, so it is not proposed again', async () => {
  await del(`/api/editions/${id}/collects`)
  detect.mockClear()

  const again = (await get(`/api/editions/${id}/collects`)).json()
  expect(again.proposal).toBeNull()
  expect(again.confirmed).toBe(false)
  expect(again.checkedAt).not.toBeNull()
  expect(detect).not.toHaveBeenCalled()
})

// Spec §4.2: a wrong confirm is the failure mode the whole step exists to guard.
test('withdrawing a confirmed link puts the edition back on its own shelf', async () => {
  await put(`/api/editions/${id}/collects`, PROPOSAL)
  expect(shelfKeyOf(getEdition(app.db, id)!)).toBe('volume:142577')

  await del(`/api/editions/${id}/collects`)
  const back = getEdition(app.db, id)!
  expect(shelfKeyOf(back)).toBe('volume:150443')
  expect(back.collectsCvName).toBeNull()
})

test('a look that finds nothing is still a look, and is not repeated', async () => {
  detect.mockResolvedValue(null)
  const first = (await get(`/api/editions/${id}/collects`)).json()
  expect(first.proposal).toBeNull()
  expect(first.checkedAt).not.toBeNull()

  detect.mockClear()
  await get(`/api/editions/${id}/collects`)
  expect(detect).not.toHaveBeenCalled()
})

test('an edition that is not there is a 404', async () => {
  expect((await get('/api/editions/9999/collects')).statusCode).toBe(404)
  expect((await del('/api/editions/9999/collects')).statusCode).toBe(404)
})

// Spec §3.3: "An edition whose link cannot be detected must still be settable by hand."
// Detection reads prose and will miss; a miss must not be terminal.
test('a volume id alone is enough to set the link by hand', async () => {
  const res = await put(`/api/editions/${id}/collects`, { volumeId: 142577 })
  expect(res.statusCode).toBe(200)
  const back = getEdition(app.db, id)!
  expect(back.collectsVolumeId).toBe(142577)
  // Named from Comic Vine rather than left blank, so the shelf has a heading.
  expect(back.collectsCvName).toBe('The Amazing Spider-Man')
  expect(back.collectsCvStartYear).toBe(2022)
})

test('a hand-set link that Comic Vine cannot name is still set', async () => {
  volumeLookup.mockRejectedValue(new Error('Comic Vine is down'))
  const res = await put(`/api/editions/${id}/collects`, { volumeId: 142577 })
  expect(res.statusCode).toBe(200)
  expect(getEdition(app.db, id)!.collectsVolumeId).toBe(142577)
})

// Moving a comic into a volume moves it on disk too. The scan would heal it eventually,
// but "eventually" means the folders disagree with the app until you next scan.
test('confirming a link re-files the edition under the volume', async () => {
  const refile = (app as unknown as { refiled: number[] }).refiled
  await put(`/api/editions/${id}/collects`, PROPOSAL)
  expect(refile).toContain(1)
})

test('withdrawing a link re-files it back', async () => {
  const refile = (app as unknown as { refiled: number[] }).refiled
  await put(`/api/editions/${id}/collects`, PROPOSAL)
  await del(`/api/editions/${id}/collects`)
  expect(refile.length).toBe(2)
})

test('a 404 re-files nothing', async () => {
  const refile = (app as unknown as { refiled: number[] }).refiled
  await del('/api/editions/9999/collects')
  expect(refile).toHaveLength(0)
})
