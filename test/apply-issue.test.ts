import { test, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { upsertEdition, getEdition } from '../server/models/editions.js'
import { insertBook, getBook } from '../server/models/books.js'
import { getBookTags } from '../server/models/metadata.js'
import { applyIssueToBook } from '../server/services/applyIssue.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

const ISSUE = {
  name: 'Death Spiral, Part 3 of 9',
  issue_number: '255',
  cover_date: '2026-05-01',
  description: '<p>Symbiote trouble.</p>',
  volume: { id: 167333, name: 'Venom' },
  person_credits: [{ name: 'Al Ewing', role: 'writer' }],
  character_credits: [{ id: 1234, name: 'Venom' }],
  story_arc_credits: [{ id: 56676, name: 'Death Spiral' }],
  site_detail_url: 'https://cv/255',
}
const VOLUME = { name: 'Venom', start_year: '2025', publisher: { name: 'Marvel' } }

function ctx(): Ctx & { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'apply-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(config.comicsDir, { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  globalThis.fetch = (async (url: string) =>
    url.includes('/volume/')
      ? { ok: true, json: async () => ({ results: VOLUME }) }
      : { ok: true, json: async () => ({ results: ISSUE }) }) as never
  const db = openDb(':memory:')
  setComicVineKey(db, 'k')
  return { db, config, dir } as Ctx & { dir: string }
}

function seed(c: Ctx) {
  const edition = upsertEdition(c.db, { name: 'Venom (2025)', folder: 'Venom/Venom (2025)', seriesName: 'Venom' })
  const book = insertBook(c.db, {
    editionId: edition.id, filePath: 'Venom/Venom (2025)/255.cbz', pageCount: 20, fileSize: 100,
  })!
  return { edition, book }
}

test('applying an issue writes its metadata onto the book', async () => {
  const c = ctx()
  const { book } = seed(c)
  try {
    await applyIssueToBook(c, book.id, 1159231)
    expect(getBook(c.db, book.id)).toMatchObject({
      title: 'Death Spiral, Part 3 of 9',
      number: '255',
      comicvineId: 1159231,
      writer: 'Al Ewing',
      publisher: 'Marvel',
    })
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('applying an issue records its characters and arcs', async () => {
  const c = ctx()
  const { book } = seed(c)
  try {
    await applyIssueToBook(c, book.id, 1159231)
    const kinds = getBookTags(c.db, book.id).map((t) => `${t.kind}:${t.value}`)
    expect(kinds).toContain('character:Venom')
    expect(kinds).toContain('story_arc:Death Spiral')
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('applying an issue tells the edition which Comic Vine volume it is', async () => {
  const c = ctx()
  const { edition, book } = seed(c)
  try {
    await applyIssueToBook(c, book.id, 1159231)
    expect(getEdition(c.db, edition.id)).toMatchObject({
      cvName: 'Venom', cvStartYear: 2025, comicvineId: 167333, publisher: 'Marvel',
    })
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('applying an issue to a book that is not there fails loudly', async () => {
  const c = ctx()
  try {
    await expect(applyIssueToBook(c, 999, 1159231)).rejects.toThrow(/not found/i)
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})
