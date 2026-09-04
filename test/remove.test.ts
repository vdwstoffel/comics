import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { upsertEdition, getEdition } from '../server/models/editions.js'
import { insertBook, getBook } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { replaceBookCredits, replaceBookTags } from '../server/models/metadata.js'
import { removeBook, removeEdition, removeSeries } from '../server/services/library.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rm-'))
  ctx = {
    db: openDb(':memory:'),
    config: { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config,
  }
  mkdirSync(ctx.config.comicsDir, { recursive: true })
  mkdirSync(ctx.config.thumbsDir, { recursive: true })
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

/** An edition folder holding `names` issues, each a real .cbz with a thumbnail beside it. */
async function seedEdition(name: string, names: string[]) {
  const folder = join(ctx.config.comicsDir, name)
  mkdirSync(folder, { recursive: true })
  const edition = upsertEdition(ctx.db, { name, folder: name })
  const books = []
  for (const file of names) {
    await makeCbz(folder, ['p1.png'], file)
    const book = insertBook(ctx.db, {
      editionId: edition.id, filePath: `${name}/${file}`, pageCount: 1, fileSize: 100,
    })!
    writeFileSync(join(ctx.config.thumbsDir, `${book.id}.webp`), 'thumb')
    books.push(book)
  }
  return { edition, books, folder }
}

/** An edition folder nested under its series, holding one real .cbz. */
async function seedNested(series: string, name: string, file: string) {
  const folder = `${series}/${name}`
  mkdirSync(join(ctx.config.comicsDir, folder), { recursive: true })
  const edition = upsertEdition(ctx.db, { name, folder })
  await makeCbz(join(ctx.config.comicsDir, folder), ['p1.png'], file)
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: `${folder}/${file}`, pageCount: 1, fileSize: 100,
  })!
  return { edition, book }
}

test('emptying the last edition of a series removes the series folder too', async () => {
  const { book } = await seedNested('Venom', 'Venom (2025)', '001.cbz')

  await removeBook(ctx, book.id)

  expect(existsSync(join(ctx.config.comicsDir, 'Venom/Venom (2025)'))).toBe(false)
  expect(existsSync(join(ctx.config.comicsDir, 'Venom'))).toBe(false)
})

test('a series folder with another edition still in it is left alone', async () => {
  const { book } = await seedNested('Venom', 'Venom (2025)', '001.cbz')
  await seedNested('Venom', 'Venom (2022)', '001.cbz')

  await removeBook(ctx, book.id)

  expect(existsSync(join(ctx.config.comicsDir, 'Venom/Venom (2025)'))).toBe(false)
  expect(existsSync(join(ctx.config.comicsDir, 'Venom/Venom (2022)'))).toBe(true)
})

test('removeBook deletes the file, its thumbnail and its row', async () => {
  const { books, folder } = await seedEdition('Saga', ['01.cbz', '02.cbz'])
  const [victim] = books

  await removeBook(ctx, victim.id)

  expect(existsSync(join(folder, '01.cbz'))).toBe(false)
  expect(existsSync(join(ctx.config.thumbsDir, `${victim.id}.webp`))).toBe(false)
  expect(getBook(ctx.db, victim.id)).toBeUndefined()
  // The sibling issue is untouched
  expect(existsSync(join(folder, '02.cbz'))).toBe(true)
})

test('removeBook prunes the edition when it held the last issue', async () => {
  const { edition, books, folder } = await seedEdition('One Shot', ['only.cbz'])

  await removeBook(ctx, books[0].id)

  expect(getEdition(ctx.db, edition.id)).toBeUndefined()
  expect(existsSync(folder)).toBe(false)
})

test('removeBook keeps an edition that still has issues', async () => {
  const { edition, books, folder } = await seedEdition('Saga', ['01.cbz', '02.cbz'])

  await removeBook(ctx, books[0].id)

  expect(getEdition(ctx.db, edition.id)).toBeDefined()
  expect(existsSync(folder)).toBe(true)
})

test('removeBook still clears the row when the .cbz is already gone from disk', async () => {
  const { books, folder } = await seedEdition('Saga', ['01.cbz', '02.cbz'])
  rmSync(join(folder, '01.cbz'))

  await removeBook(ctx, books[0].id)

  expect(getBook(ctx.db, books[0].id)).toBeUndefined()
})

test('removeBook still clears the row when the book never got a thumbnail', async () => {
  const { books } = await seedEdition('Saga', ['01.cbz', '02.cbz'])
  rmSync(join(ctx.config.thumbsDir, `${books[0].id}.webp`))

  await removeBook(ctx, books[0].id)

  expect(getBook(ctx.db, books[0].id)).toBeUndefined()
})

// file_path is built from sanitized folder names, so this should never happen - but an
// unlink driven by a DB string is worth a cheap guard against escaping the library.
test('removeBook refuses a file path that escapes the comics dir', async () => {
  const outside = join(dir, 'outside.cbz')
  writeFileSync(outside, 'precious')
  const edition = upsertEdition(ctx.db, { name: 'Sneaky', folder: 'Sneaky' })
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: '../outside.cbz', pageCount: 1, fileSize: 1,
  })!

  await expect(removeBook(ctx, book.id)).rejects.toThrow(/outside the library/i)

  expect(existsSync(outside)).toBe(true)
  expect(getBook(ctx.db, book.id)).toBeDefined()
})

test('removeEdition deletes every issue, their thumbnails, the folder and the row', async () => {
  const { edition, books, folder } = await seedEdition('Saga', ['01.cbz', '02.cbz', '03.cbz'])
  const { folder: keptFolder } = await seedEdition('Untouched', ['01.cbz'])

  const result = await removeEdition(ctx, edition.id)

  expect(result.books).toBe(3)
  expect(existsSync(folder)).toBe(false)
  expect(getEdition(ctx.db, edition.id)).toBeUndefined()
  for (const b of books) {
    expect(getBook(ctx.db, b.id)).toBeUndefined()
    expect(existsSync(join(ctx.config.thumbsDir, `${b.id}.webp`))).toBe(false)
  }
  // A neighbouring edition is left alone
  expect(existsSync(keptFolder)).toBe(true)
})

test('removeSeries deletes every edition grouped under it', async () => {
  const a = await seedEdition('Amazing Spider-Man (2025)', ['01.cbz', '02.cbz'])
  const b = await seedEdition('Amazing Spider-Man by Nick Spencer Omnibus', ['vol1.cbz'])
  const other = await seedEdition('Batman Vol. 2 (New 52 TPB)', ['01.cbz'])

  const result = await removeSeries(ctx, 'Amazing Spider-Man')

  expect(result).toEqual({ editions: 2, books: 3 })
  expect(existsSync(a.folder)).toBe(false)
  expect(existsSync(b.folder)).toBe(false)
  expect(getEdition(ctx.db, a.edition.id)).toBeUndefined()
  expect(getEdition(ctx.db, b.edition.id)).toBeUndefined()
  // The unrelated series survives intact
  expect(existsSync(other.folder)).toBe(true)
  expect(getEdition(ctx.db, other.edition.id)).toBeDefined()
})

test('removeSeries rejects a series name that matches nothing', async () => {
  await expect(removeSeries(ctx, 'No Such Series')).rejects.toThrow(/not found/i)
})

// The delete path leans on the schema's ON DELETE CASCADE rather than clearing these by
// hand, so pin that down: a reimplementation that bypasses the cascade must fail here.
test('removeBook takes the read progress, credits and tags with it', async () => {
  const { books } = await seedEdition('Saga', ['01.cbz', '02.cbz'])
  const { id } = books[0]
  setProgress(ctx.db, id, { lastPage: 7, completed: false })
  replaceBookCredits(ctx.db, id, [{ name: 'Brian K. Vaughan', role: 'writer' }])
  replaceBookTags(ctx.db, id, [{ kind: 'character', value: 'Hazel' }])

  await removeBook(ctx, id)

  const count = (table: string) =>
    (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE book_id = ?`).get(id) as { n: number }).n
  expect(count('read_progress')).toBe(0)
  expect(count('book_credit')).toBe(0)
  expect(count('book_tag')).toBe(0)
})
