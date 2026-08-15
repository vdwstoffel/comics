import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { upsertSeries, getSeriesByName, updateSeries } from '../server/models/series.js'
import { insertBook } from '../server/models/books.js'
import { moveBookToSeries, renameSeries, reorganizeLibrary } from '../server/services/library.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lib-'))
  ctx = {
    db: openDb(':memory:'),
    config: { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config,
  }
  mkdirSync(ctx.config.comicsDir, { recursive: true })
  mkdirSync(ctx.config.thumbsDir, { recursive: true })
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

test('moveBookToSeries physically moves file, updates DB, prunes empty source', async () => {
  // Set up source series with one book
  const srcDir = join(ctx.config.comicsDir, 'OldSeries')
  mkdirSync(srcDir, { recursive: true })
  const cbzPath = await makeCbz(srcDir, ['p1.png'], 'issue1.cbz')
  const srcSeries = upsertSeries(ctx.db, { name: 'OldSeries', folder: 'OldSeries' })
  const book = insertBook(ctx.db, {
    seriesId: srcSeries.id,
    filePath: 'OldSeries/issue1.cbz',
    pageCount: 1,
    fileSize: 100,
  })!

  const result = await moveBookToSeries(ctx, book.id, 'NewSeries')

  // File moved
  expect(existsSync(cbzPath)).toBe(false)
  expect(existsSync(join(ctx.config.comicsDir, 'NewSeries', 'issue1.cbz'))).toBe(true)
  // DB updated
  expect(result.book.filePath).toBe('NewSeries/issue1.cbz')
  expect(result.series.name).toBe('NewSeries')
  // Old series pruned (was empty)
  expect(getSeriesByName(ctx.db, 'OldSeries')).toBeUndefined()
  // Old folder removed (was empty)
  expect(existsSync(srcDir)).toBe(false)
})

test('collision de-dupe: two files with same basename get numeric suffix', async () => {
  // First book already in target series
  const targetDir = join(ctx.config.comicsDir, 'Target')
  mkdirSync(targetDir, { recursive: true })
  await makeCbz(targetDir, ['p1.png'], 'issue.cbz')
  const targetSeries = upsertSeries(ctx.db, { name: 'Target', folder: 'Target' })
  insertBook(ctx.db, { seriesId: targetSeries.id, filePath: 'Target/issue.cbz', pageCount: 1, fileSize: 100 })

  // Second book with same name in a different source series
  const srcDir = join(ctx.config.comicsDir, 'Source')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p2.png'], 'issue.cbz')
  const srcSeries = upsertSeries(ctx.db, { name: 'Source', folder: 'Source' })
  const book2 = insertBook(ctx.db, { seriesId: srcSeries.id, filePath: 'Source/issue.cbz', pageCount: 1, fileSize: 100 })!

  const result = await moveBookToSeries(ctx, book2.id, 'Target')

  // Both files exist, no overwrite
  expect(existsSync(join(ctx.config.comicsDir, 'Target', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'Target', 'issue (2).cbz'))).toBe(true)
  expect(result.book.filePath).toBe('Target/issue (2).cbz')
  // Source was moved (renamed), not copied — original is gone
  expect(existsSync(join(ctx.config.comicsDir, 'Source', 'issue.cbz'))).toBe(false)
})

test('renameSeries MERGE: rename B to existing A name moves all books under A, deletes B', async () => {
  // Series A with one book
  const aDir = join(ctx.config.comicsDir, 'SeriesA')
  mkdirSync(aDir, { recursive: true })
  await makeCbz(aDir, ['p1.png'], 'a1.cbz')
  const seriesA = upsertSeries(ctx.db, { name: 'SeriesA', folder: 'SeriesA' })
  insertBook(ctx.db, { seriesId: seriesA.id, filePath: 'SeriesA/a1.cbz', pageCount: 1, fileSize: 100 })

  // Series B with one book
  const bDir = join(ctx.config.comicsDir, 'SeriesB')
  mkdirSync(bDir, { recursive: true })
  await makeCbz(bDir, ['p2.png'], 'b1.cbz')
  const seriesB = upsertSeries(ctx.db, { name: 'SeriesB', folder: 'SeriesB' })
  insertBook(ctx.db, { seriesId: seriesB.id, filePath: 'SeriesB/b1.cbz', pageCount: 1, fileSize: 100 })

  // Rename B → SeriesA (merge)
  const result = await renameSeries(ctx, seriesB.id, 'SeriesA')

  expect(result.series.name).toBe('SeriesA')
  expect(result.series.id).toBe(seriesA.id)
  // B's book physically moved to A's folder
  expect(existsSync(join(ctx.config.comicsDir, 'SeriesA', 'b1.cbz'))).toBe(true)
  // B's folder and DB row gone
  expect(existsSync(bDir)).toBe(false)
  expect(getSeriesByName(ctx.db, 'SeriesB')).toBeUndefined()
})

test('renameSeries pure rename: moves folder + files, old series/folder gone', async () => {
  const oldDir = join(ctx.config.comicsDir, 'OldName')
  mkdirSync(oldDir, { recursive: true })
  await makeCbz(oldDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(ctx.db, { name: 'OldName', folder: 'OldName' })
  insertBook(ctx.db, { seriesId: series.id, filePath: 'OldName/issue.cbz', pageCount: 1, fileSize: 100 })

  const result = await renameSeries(ctx, series.id, 'NewName')

  expect(result.series.name).toBe('NewName')
  // File physically at new location
  expect(existsSync(join(ctx.config.comicsDir, 'NewName', 'issue.cbz'))).toBe(true)
  // Old location gone
  expect(existsSync(join(ctx.config.comicsDir, 'OldName', 'issue.cbz'))).toBe(false)
  expect(existsSync(oldDir)).toBe(false)
  expect(getSeriesByName(ctx.db, 'OldName')).toBeUndefined()
})

test('same-series move is a no-op: file keeps its exact original name, no (2) suffix', async () => {
  const seriesDir = join(ctx.config.comicsDir, 'MySeries')
  mkdirSync(seriesDir, { recursive: true })
  await makeCbz(seriesDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(ctx.db, { name: 'MySeries', folder: 'MySeries' })
  const book = insertBook(ctx.db, { seriesId: series.id, filePath: 'MySeries/issue.cbz', pageCount: 1, fileSize: 100 })!

  const result = await moveBookToSeries(ctx, book.id, 'MySeries')

  // File is still at the original path — no (2) suffix was introduced
  expect(existsSync(join(ctx.config.comicsDir, 'MySeries', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'MySeries', 'issue (2).cbz'))).toBe(false)
  expect(result.book.filePath).toBe('MySeries/issue.cbz')
  expect(result.series.name).toBe('MySeries')
})

test('same-name renameSeries is a no-op: returns unchanged series, no files touched', async () => {
  const seriesDir = join(ctx.config.comicsDir, 'StableSeries')
  mkdirSync(seriesDir, { recursive: true })
  await makeCbz(seriesDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(ctx.db, { name: 'StableSeries', folder: 'StableSeries' })
  insertBook(ctx.db, { seriesId: series.id, filePath: 'StableSeries/issue.cbz', pageCount: 1, fileSize: 100 })

  const result = await renameSeries(ctx, series.id, 'StableSeries')

  expect(result.series.name).toBe('StableSeries')
  expect(result.series.id).toBe(series.id)
  // File untouched at original path, no spurious (2) suffix
  expect(existsSync(join(ctx.config.comicsDir, 'StableSeries', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'StableSeries', 'issue (2).cbz'))).toBe(false)
})

test('reorganizeLibrary moves a book whose folder does not match its series folder', async () => {
  // Place file in wrong folder
  const wrongDir = join(ctx.config.comicsDir, 'wrong-folder')
  mkdirSync(wrongDir, { recursive: true })
  await makeCbz(wrongDir, ['p1.png'], 'issue.cbz')
  const series = upsertSeries(ctx.db, { name: 'CorrectName', folder: 'CorrectName' })
  // DB says it's in 'wrong-folder/issue.cbz' but series folder should be 'CorrectName'
  insertBook(ctx.db, { seriesId: series.id, filePath: 'wrong-folder/issue.cbz', pageCount: 1, fileSize: 100 })

  const result = await reorganizeLibrary(ctx)

  expect(result.moved).toBe(1)
  expect(existsSync(join(ctx.config.comicsDir, 'CorrectName', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'wrong-folder', 'issue.cbz'))).toBe(false)
})

test('renameSeries (pure rename) preserves publisher/summary/comicvineId', async () => {
  const srcDir = join(ctx.config.comicsDir, 'DC')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue1.cbz')
  const s = upsertSeries(ctx.db, { name: 'DC', folder: 'DC' })
  updateSeries(ctx.db, s.id, { publisher: 'DC Comics', summary: 'The DC universe', comicvineId: 42 })
  insertBook(ctx.db, { seriesId: s.id, filePath: 'DC/issue1.cbz', pageCount: 1, fileSize: 100 })

  const result = await renameSeries(ctx, s.id, 'Detective Comics')

  expect(result.series.name).toBe('Detective Comics')
  expect(result.series.publisher).toBe('DC Comics')
  expect(result.series.summary).toBe('The DC universe')
  expect(result.series.comicvineId).toBe(42)
  expect(existsSync(join(ctx.config.comicsDir, 'Detective Comics', 'issue1.cbz'))).toBe(true)
  expect(getSeriesByName(ctx.db, 'DC')).toBeUndefined()
})

test('renameSeries (merge) backfills the target publisher when it lacks one', async () => {
  const tDir = join(ctx.config.comicsDir, 'Big Two')
  mkdirSync(tDir, { recursive: true })
  await makeCbz(tDir, ['p1.png'], 't.cbz')
  const target = upsertSeries(ctx.db, { name: 'Big Two', folder: 'Big Two' })
  insertBook(ctx.db, { seriesId: target.id, filePath: 'Big Two/t.cbz', pageCount: 1, fileSize: 1 })

  const sDir = join(ctx.config.comicsDir, 'DC')
  mkdirSync(sDir, { recursive: true })
  await makeCbz(sDir, ['p1.png'], 's.cbz')
  const src = upsertSeries(ctx.db, { name: 'DC', folder: 'DC' })
  updateSeries(ctx.db, src.id, { publisher: 'DC Comics' })
  insertBook(ctx.db, { seriesId: src.id, filePath: 'DC/s.cbz', pageCount: 1, fileSize: 1 })

  const result = await renameSeries(ctx, src.id, 'Big Two') // merge DC → Big Two

  expect(result.series.id).toBe(target.id)
  expect(result.series.publisher).toBe('DC Comics')
  expect(getSeriesByName(ctx.db, 'DC')).toBeUndefined()
})
