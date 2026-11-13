import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import readingListRoutes from '../server/routes/readingLists.js'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { getListLength } from '../server/models/readingLists.js'
import type { Config } from '../server/config.js'

vi.mock('../server/readingLists/index.js', async () =>
  ({ READING_LISTS: [(await import('./helpers/readingListFixture.js')).LIST] }))

// The markup the real parser recognises: the main button in a div.aio-button-center.
const POST_HTML = '<div class="aio-button-center"><a href="https://files/mighty-avengers-1.cbz">DOWNLOAD NOW</a></div>'

async function setup(fetchPage: (url: string) => Promise<string> = async () => {
  throw new Error('unexpected fetch in this test')
}) {
  const app = Fastify()
  const db = openDb(':memory:')
  app.decorate('db', db)
  app.decorate('config', {} as Config)
  const enqueue = vi.fn(() => ({
    queued: true,
    entry: { id: 1, position: 0, state: 'queued', url: '', attempts: 0, queuedAt: new Date().toISOString() },
  }))
  app.decorate('downloader', {
    enqueue, status: () => ({ active: [], queue: [], history: [] }), cancel: vi.fn(), wake: vi.fn(),
  } as never)
  await app.register(readingListRoutes, { fetchPage })

  // One index row that can only be Mighty Avengers #1, the tie-in.
  db.prepare(
    `INSERT INTO comic_index (title, url, category, imported_at, number, year)
     VALUES (?,?,?,?,?,?)`,
  ).run('Mighty Avengers #1 (2013)', 'https://index/mighty-avengers-1', 'comics', '2026-09-14', '001', 2013)

  const avengers = upsertEdition(db, { name: 'Avengers (2012)', folder: 'Avengers (2012)' })
  updateEdition(db, avengers.id, { comicvineId: 500, cvName: 'Avengers' })
  const own = (cvId: number, finished: boolean) => {
    const b = insertBook(db, { editionId: avengers.id, filePath: `Avengers/${cvId}.cbz`, pageCount: 10, fileSize: 1 })!
    updateBook(db, b.id, { comicvineId: cvId })
    if (finished) setProgress(db, b.id, { lastPage: 9, completed: true })
    return b
  }
  return { app, db, enqueue, own, cleanup: () => app.close() }
}

test('the shelf counts each list in Core', async () => {
  const t = await setup()
  try {
    t.own(101, false)
    const res = await t.app.inject({ url: '/api/lists' })
    expect(res.json().lists).toEqual([{
      id: 7, slug: 'test-list', name: 'Test List', publisher: 'Marvel', years: '2013',
      cover: 'https://cv/cover.jpg', total: 3, owned: 1,
    }])
  } finally { await t.cleanup() }
})

// The page is sent everything in Full and leaves the tie-ins out itself, so the switch
// redraws without asking again.
test('a list comes whole, every tie-in marked, every issue owned or matched', async () => {
  const t = await setup()
  try {
    const book = t.own(101, true)
    const res = await t.app.inject({ url: '/api/lists/test-list' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.list).toMatchObject({ id: 7, name: 'Test List', description: 'A story across two series.' })
    expect(body.length).toBe('core')
    expect(body.hasExtras).toBe(true)
    expect(body.phases.map((p: { name: string }) => p.name)).toEqual(['One', 'Tie-ins only', 'Two'])

    const [first, tieIn, second] = body.phases[0].sections[0].issues
    expect(first).toMatchObject({ id: 101, owned: true, bookId: book.id, readState: 'read', extra: false })
    expect(tieIn).toMatchObject({
      id: 901, volumeName: 'Mighty Avengers', owned: false, extra: true,
      match: { title: 'Mighty Avengers #1 (2013)' },
    })
    expect(second).toMatchObject({ id: 102, name: 'The Garden', owned: false, match: null })
  } finally { await t.cleanup() }
})

// One shape for the page to draw: a phase the guide does not split is one unnamed section.
test('every phase comes as sections, named only where the guide splits it', async () => {
  const t = await setup()
  try {
    const { phases } = (await t.app.inject({ url: '/api/lists/test-list' })).json()
    expect(phases[0].sections.map((s: { name: string | null }) => s.name)).toEqual([null])
    expect(phases[2]).toMatchObject({
      name: 'Two',
      note: 'The finale.',
      sections: [
        { name: 'Last Days', note: null, issues: [expect.objectContaining({ id: 103 })] },
        { name: 'Battleworld', note: 'Tie-ins only.', issues: [expect.objectContaining({ id: 904, extra: true })] },
      ],
    })
  } finally { await t.cleanup() }
})

// Worked out here, with the follow's rule, so the page and the follow agree on it.
test('where you are is said for both lengths', async () => {
  const t = await setup()
  try {
    t.own(101, true)
    expect((await t.app.inject({ url: '/api/lists/test-list' })).json().next).toEqual({ core: 102, full: 901 })
    // The end of Core is not the end of Full: a tie-in comes after the last core issue.
    t.own(103, true)
    expect((await t.app.inject({ url: '/api/lists/test-list' })).json().next).toEqual({ core: null, full: 904 })
    t.own(904, true)
    expect((await t.app.inject({ url: '/api/lists/test-list' })).json().next).toEqual({ core: null, full: null })
  } finally { await t.cleanup() }
})

test('a list that does not exist is a 404', async () => {
  const t = await setup()
  try {
    expect((await t.app.inject({ url: '/api/lists/nope' })).statusCode).toBe(404)
    expect((await t.app.inject({ method: 'PUT', url: '/api/lists/nope/length', payload: { length: 'full' } })).statusCode).toBe(404)
  } finally { await t.cleanup() }
})

test('switching length is saved, and only to a length there is', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ method: 'PUT', url: '/api/lists/test-list/length', payload: { length: 'full' } })
    expect(res.json()).toEqual({ length: 'full' })
    expect(getListLength(t.db, 7)).toBe('full')
    expect((await t.app.inject({ url: '/api/lists/test-list' })).json().length).toBe('full')

    const bad = await t.app.inject({ method: 'PUT', url: '/api/lists/test-list/length', payload: { length: 'long' } })
    expect(bad.statusCode).toBe(400)
    expect(getListLength(t.db, 7)).toBe('full')
  } finally { await t.cleanup() }
})

test('an issue in no list cannot be downloaded from one', async () => {
  const t = await setup()
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/lists/issues/5/download' })
    expect(res.statusCode).toBe(404)
    expect(t.enqueue).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})

// The arc rule: you own nothing of the tie-in's run, so it lands under Comic Vine's name
// for that volume rather than under the list's name, which is not a series.
test('a tie-in you own no edition for lands under its own volume name', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/lists/issues/901/download' })
    expect(res.statusCode).toBe(202)
    expect(t.enqueue).toHaveBeenCalledWith(expect.objectContaining({ edition: 'Mighty Avengers', issueId: 901 }))
  } finally { await t.cleanup() }
})

test('an issue whose volume you already own files into that edition', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const mine = upsertEdition(t.db, { name: 'Mighty Avengers (2013)', folder: 'Mighty Avengers (2013)' })
    updateEdition(t.db, mine.id, { comicvineId: 900 })
    const res = await t.app.inject({ method: 'POST', url: '/api/lists/issues/901/download' })
    expect(res.statusCode).toBe(202)
    expect(t.enqueue).toHaveBeenCalledWith(expect.objectContaining({ edition: 'Mighty Avengers (2013)' }))
  } finally { await t.cleanup() }
})

test('an issue nothing uniquely matches is refused, and says why', async () => {
  const t = await setup(async () => POST_HTML)
  try {
    const res = await t.app.inject({ method: 'POST', url: '/api/lists/issues/102/download' })
    expect(res.statusCode).toBe(409)
    expect(res.json().reason).toBeTruthy()
    expect(t.enqueue).not.toHaveBeenCalled()
  } finally { await t.cleanup() }
})
