import { test, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { upsertEdition, getEdition, getEditionByName, updateEdition } from '../server/models/editions.js'
import { insertBook, getBook } from '../server/models/books.js'
import { applyIssueToBook } from '../server/services/applyIssue.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

// Batman Annual #1, as Comic Vine answers for it: issue first, then its volume.
const ISSUE = {
  id: 337480, name: 'First Snow', issue_number: '1', cover_date: '2012-07-31',
  volume: { id: 49197, name: 'Batman Annual' },
  person_credits: [], character_credits: [], story_arc_credits: [],
  site_detail_url: 'https://cv/337480',
}
const VOLUME = { name: 'Batman Annual', start_year: '2012', publisher: { name: 'DC Comics' } }

type TestCtx = Ctx & { dir: string }

function ctx(fetchImpl?: () => Promise<unknown>): TestCtx {
  const dir = mkdtempSync(join(tmpdir(), 'unsorted-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(config.thumbsDir, { recursive: true })
  globalThis.fetch = (fetchImpl ?? (async (url: string) =>
    url.includes('/volume/')
      ? { ok: true, json: async () => ({ results: VOLUME }) }
      : { ok: true, json: async () => ({ results: ISSUE }) })) as never
  const db = openDb(':memory:')
  setComicVineKey(db, 'k')
  return { db, config, dir } as TestCtx
}

/** A comic in Unsorted, with a real file behind it: a move has to have something to move. */
function inUnsorted(c: TestCtx, fileName: string) {
  const unsorted = upsertEdition(c.db, { name: 'Unsorted', folder: 'Unsorted' })
  mkdirSync(join(c.config.comicsDir, 'Unsorted'), { recursive: true })
  writeFileSync(join(c.config.comicsDir, 'Unsorted', fileName), 'not really a comic')
  const book = insertBook(c.db, {
    editionId: unsorted.id, filePath: `Unsorted/${fileName}`, pageCount: 20, fileSize: 18,
  })!
  return { unsorted, book }
}

const done = (c: TestCtx) => { c.db.close(); rmSync(c.dir, { recursive: true, force: true }) }

// Unsorted means nothing was known when the comic arrived. A match is the moment that
// changes: the issue belongs to one volume, and that volume's edition is where it goes.
test('a comic matched in Unsorted moves into an edition named after its volume', async () => {
  const c = ctx()
  const { book } = inUnsorted(c, 'Batman Annual 01 (2012).cbz')
  try {
    await applyIssueToBook(c, book.id, 337480)

    const moved = getBook(c.db, book.id)!
    const edition = getEdition(c.db, moved.editionId)!
    expect(edition).toMatchObject({
      name: 'Batman Annual (2012)',
      // An annual is filed beside its run, as every other way in files it.
      seriesName: 'Batman',
      comicvineId: 49197,
      cvName: 'Batman Annual',
      cvStartYear: 2012,
      publisher: 'DC Comics',
    })
    expect(existsSync(join(c.config.comicsDir, moved.filePath))).toBe(true)
    expect(moved.filePath.startsWith('Batman/Batman Annual (2012)/')).toBe(true)
  } finally { done(c) }
})

// Found by Comic Vine id, never by name: a second edition beside the one that already
// holds the volume would split it in two.
test('it joins the edition you already have for that volume, whatever it is called', async () => {
  const c = ctx()
  const mine = upsertEdition(c.db, { name: 'Batman Annuals', folder: 'Batman/Batman Annuals', seriesName: 'Batman' })
  updateEdition(c.db, mine.id, { comicvineId: 49197 })
  const { book } = inUnsorted(c, 'Batman Annual 01 (2012).cbz')
  try {
    await applyIssueToBook(c, book.id, 337480)
    expect(getBook(c.db, book.id)!.editionId).toBe(mine.id)
    expect(getEditionByName(c.db, 'Batman Annual (2012)')).toBeUndefined()
  } finally { done(c) }
})

// What went wrong with the Batman annuals: matching one stamped Unsorted itself with the
// annual's volume, and accepting the name it then suggested renamed everything in it.
test('Unsorted never takes on the volume of a comic matched in it', async () => {
  const c = ctx()
  const { unsorted, book } = inUnsorted(c, 'Batman Annual 01 (2012).cbz')
  inUnsorted(c, 'something else entirely.cbz')
  try {
    await applyIssueToBook(c, book.id, 337480)
    expect(getEdition(c.db, unsorted.id)).toMatchObject({
      name: 'Unsorted', comicvineId: null, cvName: null, cvStartYear: null, publisher: null,
    })
  } finally { done(c) }
})

test('a comic already in a real edition stays where it is', async () => {
  const c = ctx()
  const run = upsertEdition(c.db, { name: 'Batman (2011)', folder: 'Batman/Batman (2011)', seriesName: 'Batman' })
  const book = insertBook(c.db, { editionId: run.id, filePath: 'Batman/Batman (2011)/a.cbz', pageCount: 20, fileSize: 1 })!
  try {
    await applyIssueToBook(c, book.id, 337480)
    expect(getBook(c.db, book.id)!.editionId).toBe(run.id)
  } finally { done(c) }
})

// The id is checked before anything moves: a mistyped id must leave the comic exactly
// where it was, not filed under whatever it was mistaken for.
test('an id Comic Vine does not have moves nothing', async () => {
  const c = ctx(async () => ({ ok: true, json: async () => ({ status_code: 101, error: 'Object Not Found' }) }))
  const { unsorted, book } = inUnsorted(c, 'Batman Annual 01 (2012).cbz')
  try {
    await expect(applyIssueToBook(c, book.id, 999)).rejects.toThrow()
    expect(getBook(c.db, book.id)).toMatchObject({ editionId: unsorted.id, filePath: 'Unsorted/Batman Annual 01 (2012).cbz' })
  } finally { done(c) }
})
