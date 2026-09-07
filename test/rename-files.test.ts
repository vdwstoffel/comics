import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook, getBook } from '../server/models/books.js'
import { planRenames, renameLibraryFiles } from '../server/services/renameFiles.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ren-'))
  ctx = {
    db: openDb(':memory:'),
    config: { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config,
  }
  mkdirSync(ctx.config.comicsDir, { recursive: true })
  mkdirSync(ctx.config.thumbsDir, { recursive: true })
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

/** An edition holding real files, with the Comic Vine volume name the slug is built from. */
function seed(name: string, cvName: string | null, books: Array<{ file: string; number: string | null; title?: string | null }>) {
  const folder = `${cvName ?? name}/${name}`
  const edition = upsertEdition(ctx.db, { name, folder, seriesName: cvName ?? name })
  if (cvName) updateEdition(ctx.db, edition.id, { cvName, cvStartYear: 2025 })
  mkdirSync(join(ctx.config.comicsDir, folder), { recursive: true })
  return books.map(({ file, number, title }) => {
    writeFileSync(join(ctx.config.comicsDir, folder, file), file)
    const book = insertBook(ctx.db, {
      editionId: edition.id, filePath: `${folder}/${file}`, pageCount: 1, fileSize: 1,
    })!
    updateBook(ctx.db, book.id, { number, title: title ?? null, comicvineId: book.id })
    return book
  })
}

test('a matched comic is planned under its series and issue number', () => {
  seed('Venom (2025)', 'Venom', [{ file: 'Venom 255 (2026) (Digital).cbz', number: '255' }])

  expect(planRenames(ctx.db)).toEqual([
    { bookId: 1, from: 'Venom/Venom (2025)/Venom 255 (2026) (Digital).cbz', to: 'Venom/Venom (2025)/venom_255.cbz' },
  ])
})

test('a comic already correctly named is not in the plan', () => {
  seed('Venom (2025)', 'Venom', [{ file: 'venom_255.cbz', number: '255' }])
  expect(planRenames(ctx.db)).toEqual([])
})

test('an edition with no Comic Vine volume is left alone', () => {
  seed('Unsorted', null, [{ file: 'something.cbz', number: '1' }])
  expect(planRenames(ctx.db)).toEqual([])
})

test('a comic with no issue number is left alone', () => {
  seed('Venom (2025)', 'Venom', [{ file: 'mystery.cbz', number: null }])
  expect(planRenames(ctx.db)).toEqual([])
})

// Two one-shots share issue #1 of one volume. The one with a title takes it to stay
// distinct; the one Comic Vine gives no title keeps the name that already says what it is.
test('comics colliding on a name are separated by their issue titles', () => {
  seed('Death Spiral (2026)', 'Death Spiral', [
    { file: 'Death Spiral - Body Count 001.cbz', number: '1', title: null },
    { file: 'Death Spiral 001.cbz', number: '1', title: 'Part 1 of 9' },
  ])

  const plan = planRenames(ctx.db)

  expect(plan).toEqual([
    {
      bookId: 2,
      from: 'Death Spiral/Death Spiral (2026)/Death Spiral 001.cbz',
      to: 'Death Spiral/Death Spiral (2026)/death_spiral_001_part_1_of_9.cbz',
    },
  ])
})

test('two colliding comics that both have titles both keep their own name', () => {
  seed('Death Spiral (2026)', 'Death Spiral', [
    { file: 'a.cbz', number: '1', title: 'Body Count' },
    { file: 'b.cbz', number: '1', title: 'Part 1 of 9' },
  ])

  expect(planRenames(ctx.db).map((p) => p.to.split('/').pop())).toEqual([
    'death_spiral_001_body_count.cbz',
    'death_spiral_001_part_1_of_9.cbz',
  ])
})

test('planning writes nothing', async () => {
  seed('Venom (2025)', 'Venom', [{ file: 'Venom 255 (2026).cbz', number: '255' }])
  planRenames(ctx.db)
  expect(existsSync(join(ctx.config.comicsDir, 'Venom/Venom (2025)/Venom 255 (2026).cbz'))).toBe(true)
})

test('running it renames the file and repoints the row', async () => {
  const [book] = seed('Venom (2025)', 'Venom', [{ file: 'Venom 255 (2026).cbz', number: '255' }])

  expect(await renameLibraryFiles(ctx)).toMatchObject({ renamed: 1, skipped: 0 })

  expect(getBook(ctx.db, book.id)!.filePath).toBe('Venom/Venom (2025)/venom_255.cbz')
  expect(existsSync(join(ctx.config.comicsDir, 'Venom/Venom (2025)/venom_255.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'Venom/Venom (2025)/Venom 255 (2026).cbz'))).toBe(false)
})

test('the renamed file is the same comic, not an empty one', async () => {
  seed('Venom (2025)', 'Venom', [{ file: 'Venom 255 (2026).cbz', number: '255' }])
  await renameLibraryFiles(ctx)
  expect(readFileSync(join(ctx.config.comicsDir, 'Venom/Venom (2025)/venom_255.cbz'), 'utf8'))
    .toBe('Venom 255 (2026).cbz')
})

test('a second run finds nothing left to do', async () => {
  seed('Venom (2025)', 'Venom', [{ file: 'Venom 255 (2026).cbz', number: '255' }])
  await renameLibraryFiles(ctx)
  expect(await renameLibraryFiles(ctx)).toMatchObject({ renamed: 0 })
  expect(planRenames(ctx.db)).toEqual([])
})

// One bad row must not stop the rest of the library being tidied.
test('a comic whose file has gone is skipped, and the others still rename', async () => {
  const books = seed('Venom (2025)', 'Venom', [
    { file: 'Venom 255 (2026).cbz', number: '255' },
    { file: 'Venom 256 (2026).cbz', number: '256' },
  ])
  rmSync(join(ctx.config.comicsDir, 'Venom/Venom (2025)/Venom 255 (2026).cbz'))

  const result = await renameLibraryFiles(ctx)

  expect(result).toMatchObject({ renamed: 1, skipped: 1 })
  expect(getBook(ctx.db, books[1].id)!.filePath).toBe('Venom/Venom (2025)/venom_256.cbz')
})
