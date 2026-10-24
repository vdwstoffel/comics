import { test, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { upsertEdition, getEdition } from '../server/models/editions.js'
import { insertBook, getBook, updateBook } from '../server/models/books.js'
import { getBookTags, getBookCredits, replaceBookCredits, replaceBookTags } from '../server/models/metadata.js'
import { applyIssueToBook } from '../server/services/applyIssue.js'
import { listManualEntries } from '../server/models/cvManualEntry.js'
import { setComicVineKey } from '../server/models/settings.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

const ISSUE = {
  // Comic Vine returns its own id on every real record. Its absence is how an empty
  // `results` - a deleted or nonexistent issue - is told from a record that is merely thin,
  // so a fixture standing in for a real response has to carry it.
  id: 1159231,
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

// A record Comic Vine has created but not yet catalogued - the state every issue is in for
// the first days after it ships, and exactly when someone reaches for a manual match. Note
// what it is NOT: the fields are JSON null and '' rather than absent, which is why emptiness
// has to be judged by value.
const THIN = {
  id: 1197227,
  issue_number: '1',
  name: null,
  cover_date: null,
  description: null,
  person_credits: [],
  character_credits: [],
  story_arc_credits: [],
  volume: { id: 177664, name: 'Amazing Spider-Man: Halloween Special' },
  site_detail_url: 'https://cv/1197227',
  image: { original_url: 'https://cv/a/blank.png' },
}
// The same volume, with the publisher Comic Vine has not filled in either.
const THIN_VOLUME = { name: 'Amazing Spider-Man: Halloween Special', start_year: '2026' }

function ctx(issue: object = ISSUE, volume: object = VOLUME): Ctx & { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'apply-'))
  const config = { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config
  mkdirSync(config.comicsDir, { recursive: true })
  mkdirSync(config.thumbsDir, { recursive: true })
  globalThis.fetch = (async (url: string) =>
    url.includes('/volume/')
      ? { ok: true, json: async () => ({ results: volume }) }
      : { ok: true, json: async () => ({ results: issue }) }) as never
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

/**
 * A book that already knows everything about itself - the one a thin Comic Vine record is
 * dangerous to. Every field here is something the old `?? null` patch erased, in the
 * database and then in the .cbz on disk.
 */
function seedPopulated(c: Ctx) {
  const { edition, book } = seed(c)
  const full = updateBook(c.db, book.id, {
    title: 'Pre-existing title', number: '255', date: '2026-01-02',
    summary: 'Pre-existing summary', writer: 'Someone', penciller: 'Someone Else',
    coverUrl: 'https://local/cover.jpg', publisher: 'Marvel', year: 2026,
  })!
  c.db.transaction(() => {
    replaceBookCredits(c.db, book.id, [{ name: 'Pre Existing', role: 'inker' }])
    replaceBookTags(c.db, book.id, [
      { kind: 'character', value: 'Venom', extId: 1234 },
      { kind: 'story_arc', value: 'Pre-existing Arc', extId: 56676 },
    ])
  })()
  return { edition, book: full }
}

/**
 * A ctx whose Comic Vine cannot be read, in each of the three ways it fails.
 *
 * `fetchImpl` null means no key is configured, which throws inside the client before any
 * request goes out - the failure that carries neither an HTTP status nor a Comic Vine one.
 */
function ctxUnread(fetchImpl: ((url: string) => Promise<unknown>) | null): Ctx & { dir: string } {
  const c = ctx()
  if (fetchImpl) globalThis.fetch = fetchImpl as never
  else setComicVineKey(c.db, '')
  return c
}

/** HTTP 200 with the failure in the body - how Comic Vine answers an id that is not there. */
const serves = (body: object) => async () => ({ ok: true, json: async () => body })
const http500 = async () => ({ ok: false, status: 500, json: async () => ({}) })

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

test('a thin record leaves every existing field intact', async () => {
  const c = ctx(THIN)
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1197227)
    expect(getBook(c.db, book.id)).toMatchObject({
      title: 'Pre-existing title', date: '2026-01-02', summary: 'Pre-existing summary',
      writer: 'Someone', penciller: 'Someone Else', coverUrl: 'https://local/cover.jpg',
      year: 2026,
    })
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('a thin record still writes the link', async () => {
  const c = ctx(THIN)
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1197227)
    expect(getBook(c.db, book.id)).toMatchObject({ comicvineId: 1197227, cvSiteUrl: 'https://cv/1197227' })
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test.each([['', 'empty'], ['   ', 'whitespace']])('a %s issue_number is not written', async (number) => {
  const c = ctx({ ...THIN, issue_number: number })
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1197227)
    expect(getBook(c.db, book.id)!.number).toBe('255')
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test.each(['https://cv/a/blank.png', 'https://cv/a/6373148-missing_cover.jpg'])(
  'the placeholder cover %s does not replace a real one', async (original_url) => {
    const c = ctx({ ...THIN, image: { original_url } })
    const { book } = seedPopulated(c)
    try {
      await applyIssueToBook(c, book.id, 1197227)
      expect(getBook(c.db, book.id)!.coverUrl).toBe('https://local/cover.jpg')
    } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
  })

test('a volume with no publisher does not erase the one on the book', async () => {
  const c = ctx(THIN, THIN_VOLUME)
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1197227)
    expect(getBook(c.db, book.id)!.publisher).toBe('Marvel')
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('credits arrive without clearing character tags', async () => {
  const c = ctx({ ...THIN, person_credits: [{ name: 'Al Ewing', role: 'writer' }] })
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1197227)
    expect(getBookTags(c.db, book.id)).toContainEqual({ kind: 'character', value: 'Venom', extId: 1234 })
    expect(getBookCredits(c.db, book.id)).toEqual([{ name: 'Al Ewing', role: 'writer' }])
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('characters arrive without clearing credits', async () => {
  const c = ctx({ ...THIN, character_credits: [{ id: 1443, name: 'Hobgoblin' }] })
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1197227)
    expect(getBookCredits(c.db, book.id)).toEqual([{ name: 'Pre Existing', role: 'inker' }])
    expect(getBookTags(c.db, book.id)).toContainEqual({ kind: 'character', value: 'Hobgoblin', extId: 1443 })
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('characters arrive without clearing story arcs', async () => {
  const c = ctx({ ...THIN, character_credits: [{ id: 1443, name: 'Hobgoblin' }] })
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1197227)
    expect(getBookTags(c.db, book.id)).toContainEqual({ kind: 'story_arc', value: 'Pre-existing Arc', extId: 56676 })
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('a populated record still overwrites', async () => {
  const c = ctx({ ...ISSUE, image: { original_url: 'https://cv/a/real-cover.jpg' } })
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1159231)
    expect(getBook(c.db, book.id)).toMatchObject({
      title: 'Death Spiral, Part 3 of 9', date: '2026-05', summary: 'Symbiote trouble.',
      writer: 'Al Ewing', coverUrl: 'https://cv/a/real-cover.jpg', year: 2026,
    })
    expect(getBookCredits(c.db, book.id)).toEqual([{ name: 'Al Ewing', role: 'writer' }])
    expect(getBookTags(c.db, book.id).map((t) => `${t.kind}:${t.value}`))
      .toEqual(['character:Venom', 'story_arc:Death Spiral'])
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('changed names only the fields that moved', async () => {
  const c = ctx()
  const { book } = seed(c)
  try {
    const r = await applyIssueToBook(c, book.id, 1159231)
    expect(r.changed).toEqual(expect.arrayContaining(['title', 'number', 'date']))
    expect(r.changed).not.toContain('comicinfoSynced')
    expect(r.metadataApplied).toBe(true)
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// THIN carries issue_number '1' over a book numbered '255'. '1' is a real value, so it is
// written and 'number' legitimately moved - hence arrayContaining, not an exact match.
test('a thin record over a full book changes nothing but the link', async () => {
  const c = ctx(THIN)
  const { book } = seedPopulated(c)
  try {
    const r = await applyIssueToBook(c, book.id, 1197227)
    expect(r.changed).toEqual(expect.arrayContaining(['comicvineId', 'cvSiteUrl']))
    for (const k of ['title', 'summary', 'date', 'writer', 'penciller', 'coverUrl', 'year',
      'publisher', 'credits', 'characters', 'teams', 'storyArcs', 'comicinfoSynced']) {
      expect(r.changed).not.toContain(k)
    }
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('changed names a tag kind only when it was replaced', async () => {
  const c = ctx({ ...THIN, character_credits: [{ id: 1443, name: 'Hobgoblin' }] })
  const { book } = seedPopulated(c)
  try {
    const r = await applyIssueToBook(c, book.id, 1197227)
    expect(r.changed).toContain('characters')
    expect(r.changed).not.toContain('storyArcs')
    expect(r.changed).not.toContain('credits')
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// The case the Refresh button exists to explain: nothing moved, so it must say so.
test('re-applying a thin record reports no change', async () => {
  const c = ctx(THIN)
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1197227)
    const r = await applyIssueToBook(c, book.id, 1197227)
    expect(r.changed).toEqual([])
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// The false-reassurance case: Refresh on a record Comic Vine has not changed still carries
// its credits and tags, so the replace runs - but nothing is different, and saying otherwise
// would read as "Comic Vine filled it in".
test('re-applying the same populated record reports no change', async () => {
  const c = ctx()
  const { book } = seed(c)
  try {
    const first = await applyIssueToBook(c, book.id, 1159231)
    expect(first.changed).toEqual(expect.arrayContaining(['credits', 'characters', 'storyArcs']))
    const second = await applyIssueToBook(c, book.id, 1159231)
    expect(second.changed).toEqual([])
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// --- Typing an id by hand -----------------------------------------------------------------
//
// The two failures below cannot be told apart by their HTTP status, and the status gets it
// exactly backwards: the id that must be REJECTED comes back 200, and the Comic Vine that
// must still BIND comes back 500. Everything here branches on Comic Vine's own status_code.

test('a status_code 101 rejects the id and writes nothing', async () => {
  const c = ctxUnread(serves({ status_code: 101, error: 'Object Not Found' }))
  const { book } = seed(c)
  try {
    await expect(applyIssueToBook(c, book.id, 999999999, { manual: true })).rejects.toThrow(/101|Object Not Found/)
    expect(getBook(c.db, book.id)!.comicvineId).toBeNull()
    expect(listManualEntries(c.db)).toEqual([])
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// A deleted record is a SUCCESS - status_code 1 - with an empty results array. Binding to
// that is as wrong as binding to a typo, so it is rejected on the same terms.
test('an empty results array is treated as no such issue', async () => {
  const c = ctxUnread(serves({ status_code: 1, results: [] }))
  const { book } = seed(c)
  try {
    await expect(applyIssueToBook(c, book.id, 1, { manual: true })).rejects.toThrow()
    expect(getBook(c.db, book.id)!.comicvineId).toBeNull()
    expect(listManualEntries(c.db)).toEqual([])
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test.each([
  ['an http 500', http500],
  ['no api key configured', null],
] as const)('%s still binds the id and files the entry', async (_label, fetchImpl) => {
  const c = ctxUnread(fetchImpl)
  const { book } = seedPopulated(c)
  try {
    const r = await applyIssueToBook(c, book.id, 1197227, { manual: true })
    expect(getBook(c.db, book.id)!.comicvineId).toBe(1197227)
    expect(r.metadataApplied).toBe(false)
    expect(r.changed).toEqual(['comicvineId'])
    // Null checkedAt is the honest state: Comic Vine has never been read for this entry.
    expect(listManualEntries(c.db)[0]).toMatchObject({ cvIssueId: 1197227, checkedAt: null, missing: [] })
    // The link is the deliverable; nothing the book already had may be spent on getting it.
    expect(getBook(c.db, book.id)).toMatchObject({ title: 'Pre-existing title', summary: 'Pre-existing summary' })
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// A book bound to issue A and re-bound by hand to issue B during an outage would otherwise
// carry B's id beside A's site url, and both the book's link and the Settings reminder row
// would open the wrong comic. There is no response to read B's url from, so it goes.
test('a failed-read re-bind does not leave the previous record url behind', async () => {
  const c = ctx()
  const { book } = seed(c)
  try {
    await applyIssueToBook(c, book.id, 1159231)
    expect(getBook(c.db, book.id)!.cvSiteUrl).toBe('https://cv/255')

    globalThis.fetch = http500 as never
    const r = await applyIssueToBook(c, book.id, 1197227, { manual: true })

    expect(getBook(c.db, book.id)).toMatchObject({ comicvineId: 1197227, cvSiteUrl: null })
    expect(r.changed).toEqual(expect.arrayContaining(['comicvineId', 'cvSiteUrl']))
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// `changed` drives what the user is told moved. Typing the id a book already carries moves
// nothing, and a hardcoded ['comicvineId'] reported a change that did not happen.
test('re-typing the id a book already carries reports no change', async () => {
  const c = ctxUnread(http500)
  const { book } = seedPopulated(c)
  try {
    const first = await applyIssueToBook(c, book.id, 1197227, { manual: true })
    expect(first.changed).toEqual(['comicvineId'])

    const again = await applyIssueToBook(c, book.id, 1197227, { manual: true })
    expect(again.changed).toEqual([])
    expect(again.metadataApplied).toBe(false)
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// Without `manual` the id did not come from the user, so there is nothing to bind on their
// authority and the failure propagates - storeComic's own catch is built on that throw.
test('a failed read on a plain apply still throws and binds nothing', async () => {
  const c = ctxUnread(http500)
  const { book } = seed(c)
  try {
    await expect(applyIssueToBook(c, book.id, 1197227)).rejects.toThrow()
    expect(getBook(c.db, book.id)!.comicvineId).toBeNull()
    expect(listManualEntries(c.db)).toEqual([])
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// What the reminder list reports is Comic Vine's gaps, not the comic's: the book here is
// fully populated and the entry still says everything is missing, because it is - from
// Comic Vine. THIN's cover is the blank placeholder, which counts as no cover.
test('a successful manual apply files the entry with what Comic Vine lacked', async () => {
  const c = ctx(THIN)
  const { book } = seedPopulated(c)
  try {
    await applyIssueToBook(c, book.id, 1197227, { manual: true })
    const row = listManualEntries(c.db)[0]!
    expect(row.missing).toEqual(['date', 'title', 'summary', 'credits', 'characters', 'cover'])
    expect(row.checkedAt).not.toBeNull()
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('a full record files an entry with nothing missing', async () => {
  const c = ctx({ ...ISSUE, image: { original_url: 'https://cv/a/real-cover.jpg' } })
  const { book } = seed(c)
  try {
    await applyIssueToBook(c, book.id, 1159231, { manual: true })
    expect(listManualEntries(c.db)[0]).toMatchObject({ cvIssueId: 1159231, missing: [] })
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

test('a non-manual apply files no entry', async () => {
  const c = ctx()
  const { book } = seed(c)
  try {
    await applyIssueToBook(c, book.id, 1159231)
    expect(listManualEntries(c.db)).toEqual([])
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// Refresh does not pass `manual` - it is not a new hand-entry - but it must still update
// what Comic Vine was missing, without re-stamping when you first typed the id.
test('a refresh updates the check without re-stamping created_at', async () => {
  const c = ctx(THIN)
  const { book } = seed(c)
  try {
    await applyIssueToBook(c, book.id, 1197227, { manual: true })
    const created = listManualEntries(c.db)[0]!.createdAt
    await applyIssueToBook(c, book.id, 1197227)
    expect(listManualEntries(c.db)[0]).toMatchObject({ createdAt: created, cvIssueId: 1197227 })
    expect(listManualEntries(c.db)[0]!.checkedAt).not.toBeNull()
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})

// The volume lookup is best-effort and always has been. A manual entry rides on the issue
// read, not on the volume read, so the entry is filed as a successful check either way.
test('a failing volume fetch still applies the issue and files the entry', async () => {
  const c = ctx()
  globalThis.fetch = (async (url: string) =>
    url.includes('/volume/')
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, json: async () => ({ results: ISSUE }) }) as never
  const { book } = seed(c)
  try {
    await applyIssueToBook(c, book.id, 1159231, { manual: true })
    expect(getBook(c.db, book.id)).toMatchObject({ title: 'Death Spiral, Part 3 of 9', comicvineId: 1159231 })
    expect(listManualEntries(c.db)).toHaveLength(1)
    expect(listManualEntries(c.db)[0]!.checkedAt).not.toBeNull()
  } finally { c.db.close(); rmSync((c as { dir: string }).dir, { recursive: true, force: true }) }
})
