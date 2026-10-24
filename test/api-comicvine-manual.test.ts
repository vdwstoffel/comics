import { test, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import comicvineRoutes from '../server/routes/comicvine.js'
import { openDb } from '../server/db.js'
import type { Db } from '../server/types.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, getBook } from '../server/models/books.js'
import { setComicVineKey } from '../server/models/settings.js'
import { listManualEntries } from '../server/models/cvManualEntry.js'
import type { Config } from '../server/config.js'

const ISSUE = {
  id: 1197227, name: 'Death to the Tyrant', issue_number: '1', cover_date: '2025-06-01',
  description: null, volume: { id: 163325, name: 'The Amazing Spider-Man' },
}

let db: Db
let server: ReturnType<typeof Fastify>
let bookId: number
let origFetch: typeof fetch

beforeEach(async () => {
  db = openDb(':memory:')
  const ed = upsertEdition(db, { name: 'Venom (2025)', folder: 'zz-test/Venom (2025)', seriesName: 'Venom' })
  bookId = insertBook(db, { editionId: ed.id, filePath: 'zz-test/Venom (2025)/throwaway-1.cbz', pageCount: 20, fileSize: 1 })!.id
  setComicVineKey(db, 'k')
  // The stub is global fetch, as every other route suite here does it. Issue 9 is the typo:
  // Comic Vine answers it with HTTP 200 and status_code 101.
  origFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/issue/4000-9/')) {
      return { ok: true, json: async () => ({ status_code: 101, error: 'Object Not Found' }) }
    }
    return { ok: true, json: async () => ({ status_code: 1, results: String(url).includes('/volume/') ? {} : ISSUE }) }
  }) as unknown as typeof fetch
  server = Fastify()
  server.decorate('db', db)
  server.decorate('config', {} as Config)
  await server.register(comicvineRoutes)
})

afterEach(async () => {
  globalThis.fetch = origFetch
  await server.close()
  db.close()
})

const apply = (payload: unknown) =>
  server.inject({ method: 'POST', url: `/api/books/${bookId}/comicvine`, payload: payload as object })

test('manual: true files the provenance row; a plain apply does not', async () => {
  expect((await apply({ issueId: 1197227 })).statusCode).toBe(200)
  expect(listManualEntries(db)).toHaveLength(0)

  expect((await apply({ issueId: 1197227, manual: true })).statusCode).toBe(200)
  const entries = listManualEntries(db)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ bookId, cvIssueId: 1197227 })
})

// The route lists holes, not hand-typed ids. This comic was matched WITHOUT the manual
// flag and the test issue carries no description or credits, so it is listed anyway -
// which is the whole rework in one assertion.
test('the follow-up list holds a comic matched from search, naming what it lacks', async () => {
  await apply({ issueId: 1197227 })
  const followups = (await server.inject({ url: '/api/metadata-followups' })).json().followups
  expect(followups).toHaveLength(1)
  expect(followups[0]).toMatchObject({ bookId, manual: false, bookCvId: 1197227 })
  expect(followups[0].missing).toEqual(['summary', 'credits'])
})

// The list is a to-do list FOR an outage: "the api is down so it wont work now ... so
// that when the api is up again i know to requery them". It must therefore render from
// the database alone - a single Comic Vine call here would take the page down at exactly
// the moment it is the only thing worth looking at.
test('the list is served with Comic Vine unreachable, and asks it nothing', async () => {
  await apply({ issueId: 1197227 })

  let calls = 0
  globalThis.fetch = (async () => { calls += 1; throw new TypeError('fetch failed') }) as unknown as typeof fetch

  const res = await server.inject({ url: '/api/metadata-followups' })
  expect(res.statusCode).toBe(200)
  expect(res.json().followups).toHaveLength(1)
  expect(res.json().followups[0].missing).toEqual(['summary', 'credits'])
  expect(calls).toBe(0)
})

test('a hand-typed id shows as context on the row', async () => {
  await apply({ issueId: 1197227, manual: true })
  const followups = (await server.inject({ url: '/api/metadata-followups' })).json().followups
  expect(followups[0]).toMatchObject({ bookId, manual: true, typedIssueId: 1197227 })
})

test('a 101 answers 404 rather than 500, and writes nothing', async () => {
  const res = await apply({ issueId: 9, manual: true })
  expect(res.statusCode).toBe(404)
  expect(res.json()).toEqual({ error: 'Comic Vine has no issue with that id.' })
  expect(listManualEntries(db)).toHaveLength(0)
  expect(getBook(db, bookId)!.comicvineId).toBeNull()
})

// The 404 belongs to status_code 101 and to nothing else. A catch broadened to every
// CvApiError would tell the user their id does not exist whenever Comic Vine is merely
// down - which is the exact confusion this feature was built to end.
test('a failure that is not a 101 does not become "no such issue"', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch

  // Typed by hand: the id binds and the route answers 200.
  const manual = await apply({ issueId: 1197227, manual: true })
  expect(manual.statusCode).not.toBe(404)
  expect(manual.statusCode).toBe(200)
  expect(getBook(db, bookId)!.comicvineId).toBe(1197227)

  // Chosen from search, which is also what Refresh sends: the failure is reported as
  // Comic Vine's, never as "no such issue".
  const picked = await apply({ issueId: 1197227 })
  expect(picked.statusCode).not.toBe(404)
  expect(picked.statusCode).toBe(502)
})

// The message a user sees during an outage - which is precisely when this feature is
// used. Falling through to Fastify's default handler answered {"error":"Internal Server
// Error"} and the page printed it, so Comic Vine being down read as a bug in Comix.
test('a Comic Vine outage is reported as Comic Vine, not as a fault in the app', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch

  const res = await apply({ issueId: 1197227 })
  expect(res.statusCode).toBe(502)
  expect(res.json().error).toMatch(/comic vine could not be read/i)
  // The detail, so an outage can be told from a rate limit or a rejected key.
  expect(res.json().error).toMatch(/HTTP 503/)
  expect(res.json().error).not.toMatch(/internal server error/i)
})

// A connection that never completes never produces a CvApiError - node's fetch throws
// TypeError('fetch failed') with the socket error on `cause` - and it is the shape a real
// outage takes most often.
test('a connection that never completes reads as Comic Vine too', async () => {
  globalThis.fetch = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch

  const res = await apply({ issueId: 1197227 })
  expect(res.statusCode).toBe(502)
  expect(res.json().error).toMatch(/comic vine could not be read/i)
})

// Standing in for a local fault during the apply. Blaming Comic Vine for our own errors
// would make the outage message meaningless the first time it covered a real bug.
test('a failure that is not Comic Vine keeps the 500 it always had', async () => {
  globalThis.fetch = (async () => { throw new Error('the disk is on fire') }) as unknown as typeof fetch

  expect((await apply({ issueId: 1197227 })).statusCode).toBe(500)
})

/**
 * The case checked against the real library: book 164, Venom #262, Comic Vine id 1195408.
 * Locally it has a blank date and no credits; Comic Vine now holds cover_date 2026-11-01
 * and nine person credits. Reproduced here in a temp database - the real library is never
 * touched by a test - so the whole round trip is proved: listed, refreshed, gone.
 */
test('a refresh that fills the holes takes the comic off the list', async () => {
  // Bound while Comic Vine still had a thin record: a date and nothing else, which is how
  // the comic came to be on the list in the first place.
  await apply({ issueId: 1195408 })
  const listed = (await server.inject({ url: '/api/metadata-followups' })).json().followups
  expect(listed).toHaveLength(1)
  expect(listed[0].missing).toEqual(['summary', 'credits'])

  // Comic Vine has since been filled in.
  globalThis.fetch = (async (url: string) => ({
    ok: true,
    json: async () => ({
      status_code: 1,
      results: String(url).includes('/volume/') ? {} : {
        id: 1195408, name: null, issue_number: '262', cover_date: '2026-11-01',
        description: '<p>Venom returns.</p>',
        person_credits: [{ name: 'Al Ewing', role: 'writer' }, { name: 'CAFU', role: 'penciler' }],
        volume: { id: 163325, name: 'Venom' },
      },
    }),
  })) as unknown as typeof fetch

  // What Refresh sends: the book's current id, no manual flag.
  expect((await apply({ issueId: 1195408 })).statusCode).toBe(200)
  expect((await server.inject({ url: '/api/metadata-followups' })).json().followups).toEqual([])
})

// Comic Vine ids 1197231 and 1197280 in the real library: bound, read successfully, and
// still empty on Comic Vine's side. A refresh that fills nothing must leave them listed -
// that IS the to-do list working.
test('a refresh of a record Comic Vine has not filled in leaves the comic listed', async () => {
  await apply({ issueId: 1197231 })
  const after = (await server.inject({ url: '/api/metadata-followups' })).json().followups
  expect(after).toHaveLength(1)
  expect(after[0].missing).toEqual(['summary', 'credits'])
})

test('dismissing drops the note and leaves the comic, its id and its provenance alone', async () => {
  await apply({ issueId: 1197227, manual: true })
  const res = await server.inject({ method: 'DELETE', url: `/api/metadata-followups/${bookId}` })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ dismissed: true })
  expect((await server.inject({ url: '/api/metadata-followups' })).json().followups).toHaveLength(0)
  expect(getBook(db, bookId)!.comicvineId).toBe(1197227)
  // The provenance row survives: it answers how the comic was matched, which dismissing
  // a reminder does not change.
  expect(listManualEntries(db)).toHaveLength(1)
})

// A dismissal the user can undo only by acting again. Typing an id by hand IS that
// action: it says the comic is bound to a record expected to fill in later.
test('typing an id by hand brings a dismissed comic back', async () => {
  await apply({ issueId: 1197227 })
  await server.inject({ method: 'DELETE', url: `/api/metadata-followups/${bookId}` })
  expect((await server.inject({ url: '/api/metadata-followups' })).json().followups).toHaveLength(0)

  await apply({ issueId: 1197227, manual: true })
  expect((await server.inject({ url: '/api/metadata-followups' })).json().followups).toHaveLength(1)
})

// Nothing automatic un-dismisses: a plain apply is what a Refresh sends, and a reminder
// that a refresh could resurrect is one the user cannot switch off.
test('a refresh does not bring a dismissed comic back', async () => {
  await apply({ issueId: 1197227, manual: true })
  await server.inject({ method: 'DELETE', url: `/api/metadata-followups/${bookId}` })

  await apply({ issueId: 1197227 })
  expect((await server.inject({ url: '/api/metadata-followups' })).json().followups).toHaveLength(0)
})

test('a non-integer issueId is rejected', async () => {
  for (const issueId of ['abc', '12abc', 0, -5, 1.5, '1e3', null]) {
    expect((await apply({ issueId })).statusCode, String(issueId)).toBe(400)
  }
  expect(listManualEntries(db)).toHaveLength(0)
})

test('a numeric string issueId is still accepted', async () => {
  expect((await apply({ issueId: '1197227', manual: true })).statusCode).toBe(200)
})

test('an unknown book id on delete is not an error', async () => {
  const res = await server.inject({ method: 'DELETE', url: '/api/metadata-followups/99999' })
  expect(res.statusCode).toBe(200)
})
