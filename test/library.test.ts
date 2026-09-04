import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { upsertEdition, getEdition, getEditionByName, updateEdition, carryableMetadata, EDITION_UPDATABLE_FIELDS } from '../server/models/editions.js'
import { getBook, insertBook } from '../server/models/books.js'
import {
  moveBookToEdition, renameEdition, reorganizeLibrary, planReorganize, removeBook,
} from '../server/services/library.js'
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

test('moveBookToEdition physically moves file, updates DB, prunes empty source', async () => {
  // Set up source series with one book
  const srcDir = join(ctx.config.comicsDir, 'OldSeries')
  mkdirSync(srcDir, { recursive: true })
  const cbzPath = await makeCbz(srcDir, ['p1.png'], 'issue1.cbz')
  const srcSeries = upsertEdition(ctx.db, { name: 'OldSeries', folder: 'OldSeries' })
  const book = insertBook(ctx.db, {
    editionId: srcSeries.id,
    filePath: 'OldSeries/issue1.cbz',
    pageCount: 1,
    fileSize: 100,
  })!

  const result = await moveBookToEdition(ctx, book.id, 'NewSeries')

  // File moved
  expect(existsSync(cbzPath)).toBe(false)
  expect(existsSync(join(ctx.config.comicsDir, 'NewSeries', 'issue1.cbz'))).toBe(true)
  // DB updated
  expect(result.book.filePath).toBe('NewSeries/issue1.cbz')
  expect(result.edition.name).toBe('NewSeries')
  // Old series pruned (was empty)
  expect(getEditionByName(ctx.db, 'OldSeries')).toBeUndefined()
  // Old folder removed (was empty)
  expect(existsSync(srcDir)).toBe(false)
})

test('collision de-dupe: two files with same basename get numeric suffix', async () => {
  // First book already in target series
  const targetDir = join(ctx.config.comicsDir, 'Target')
  mkdirSync(targetDir, { recursive: true })
  await makeCbz(targetDir, ['p1.png'], 'issue.cbz')
  const targetSeries = upsertEdition(ctx.db, { name: 'Target', folder: 'Target' })
  insertBook(ctx.db, { editionId: targetSeries.id, filePath: 'Target/issue.cbz', pageCount: 1, fileSize: 100 })

  // Second book with same name in a different source series
  const srcDir = join(ctx.config.comicsDir, 'Source')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p2.png'], 'issue.cbz')
  const srcSeries = upsertEdition(ctx.db, { name: 'Source', folder: 'Source' })
  const book2 = insertBook(ctx.db, { editionId: srcSeries.id, filePath: 'Source/issue.cbz', pageCount: 1, fileSize: 100 })!

  const result = await moveBookToEdition(ctx, book2.id, 'Target')

  // Both files exist, no overwrite
  expect(existsSync(join(ctx.config.comicsDir, 'Target', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'Target', 'issue (2).cbz'))).toBe(true)
  expect(result.book.filePath).toBe('Target/issue (2).cbz')
  // Source was moved (renamed), not copied — original is gone
  expect(existsSync(join(ctx.config.comicsDir, 'Source', 'issue.cbz'))).toBe(false)
})

test('renameEdition MERGE: rename B to existing A name moves all books under A, deletes B', async () => {
  // Series A with one book
  const aDir = join(ctx.config.comicsDir, 'SeriesA')
  mkdirSync(aDir, { recursive: true })
  await makeCbz(aDir, ['p1.png'], 'a1.cbz')
  const editionA = upsertEdition(ctx.db, { name: 'SeriesA', folder: 'SeriesA' })
  insertBook(ctx.db, { editionId: editionA.id, filePath: 'SeriesA/a1.cbz', pageCount: 1, fileSize: 100 })

  // Series B with one book
  const bDir = join(ctx.config.comicsDir, 'SeriesB')
  mkdirSync(bDir, { recursive: true })
  await makeCbz(bDir, ['p2.png'], 'b1.cbz')
  const editionB = upsertEdition(ctx.db, { name: 'SeriesB', folder: 'SeriesB' })
  insertBook(ctx.db, { editionId: editionB.id, filePath: 'SeriesB/b1.cbz', pageCount: 1, fileSize: 100 })

  // Rename B → SeriesA (merge)
  const result = await renameEdition(ctx, editionB.id, 'SeriesA')

  expect(result.edition.name).toBe('SeriesA')
  expect(result.edition.id).toBe(editionA.id)
  // B's book physically moved to A's folder
  expect(existsSync(join(ctx.config.comicsDir, 'SeriesA', 'b1.cbz'))).toBe(true)
  // B's folder and DB row gone
  expect(existsSync(bDir)).toBe(false)
  expect(getEditionByName(ctx.db, 'SeriesB')).toBeUndefined()
})

test('renameEdition pure rename: moves folder + files, old series/folder gone', async () => {
  const oldDir = join(ctx.config.comicsDir, 'OldName')
  mkdirSync(oldDir, { recursive: true })
  await makeCbz(oldDir, ['p1.png'], 'issue.cbz')
  const edition = upsertEdition(ctx.db, { name: 'OldName', folder: 'OldName' })
  insertBook(ctx.db, { editionId: edition.id, filePath: 'OldName/issue.cbz', pageCount: 1, fileSize: 100 })

  const result = await renameEdition(ctx, edition.id, 'NewName')

  expect(result.edition.name).toBe('NewName')
  // A rename keeps the series the edition already had - here 'OldName', derived when it
  // was created - so the files move under THAT series, not to a fresh top-level
  // 'NewName'. This expectation used to name the flat path: the rename built its folder
  // by re-deriving a series from the new name, which left folder and series_name
  // describing different places, and the next scan's reorganize moved the file to the
  // nested path below anyway. It is pinned to the settled location now.
  const nested = 'OldName/NewName'
  expect(result.edition.folder).toBe(nested)
  expect(result.edition.seriesName).toBe('OldName')
  expect(existsSync(join(ctx.config.comicsDir, nested, 'issue.cbz'))).toBe(true)
  // Old location gone
  expect(existsSync(join(ctx.config.comicsDir, 'OldName', 'issue.cbz'))).toBe(false)
  expect(getEditionByName(ctx.db, 'OldName')).toBeUndefined()
  // Settled: row, folder and disk agree, so a following reorganize has nothing to move.
  expect(planReorganize(ctx.db)).toEqual([])
})

test('same-series move is a no-op: file keeps its exact original name, no (2) suffix', async () => {
  const seriesDir = join(ctx.config.comicsDir, 'MySeries')
  mkdirSync(seriesDir, { recursive: true })
  await makeCbz(seriesDir, ['p1.png'], 'issue.cbz')
  const edition = upsertEdition(ctx.db, { name: 'MySeries', folder: 'MySeries' })
  const book = insertBook(ctx.db, { editionId: edition.id, filePath: 'MySeries/issue.cbz', pageCount: 1, fileSize: 100 })!

  const result = await moveBookToEdition(ctx, book.id, 'MySeries')

  // File is still at the original path — no (2) suffix was introduced
  expect(existsSync(join(ctx.config.comicsDir, 'MySeries', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'MySeries', 'issue (2).cbz'))).toBe(false)
  expect(result.book.filePath).toBe('MySeries/issue.cbz')
  expect(result.edition.name).toBe('MySeries')
})

test('same-name renameEdition is a no-op: returns unchanged series, no files touched', async () => {
  const seriesDir = join(ctx.config.comicsDir, 'StableSeries')
  mkdirSync(seriesDir, { recursive: true })
  await makeCbz(seriesDir, ['p1.png'], 'issue.cbz')
  const edition = upsertEdition(ctx.db, { name: 'StableSeries', folder: 'StableSeries' })
  insertBook(ctx.db, { editionId: edition.id, filePath: 'StableSeries/issue.cbz', pageCount: 1, fileSize: 100 })

  const result = await renameEdition(ctx, edition.id, 'StableSeries')

  expect(result.edition.name).toBe('StableSeries')
  expect(result.edition.id).toBe(edition.id)
  // File untouched at original path, no spurious (2) suffix
  expect(existsSync(join(ctx.config.comicsDir, 'StableSeries', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'StableSeries', 'issue (2).cbz'))).toBe(false)
})

test('a book moved to a new edition lands under its series', async () => {
  const srcDir = join(ctx.config.comicsDir, 'Unsorted')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'asm-001.cbz')
  const src = upsertEdition(ctx.db, { name: 'Unsorted', folder: 'Unsorted' })
  const book = insertBook(ctx.db, {
    editionId: src.id, filePath: 'Unsorted/asm-001.cbz', pageCount: 1, fileSize: 100,
  })!

  const result = await moveBookToEdition(ctx, book.id, 'The Amazing Spider-Man (2025)')

  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  expect(result.edition.folder).toBe(nested)
  expect(result.book.filePath).toBe(`${nested}/asm-001.cbz`)
  expect(existsSync(join(ctx.config.comicsDir, nested, 'asm-001.cbz'))).toBe(true)
})

// The edition row is the authority on where its files live. Recomputing the path from
// the name would send files somewhere the row does not point. 'Vol 7' is chosen so its
// stored folder ('Legacy/Vol 7') diverges from sanitizeEditionFolder('Vol 7') ('Vol 7') -
// otherwise the old recompute-from-name code and the fixed read-from-row code would
// coincide and the test would pass either way.
test('a book moved into an existing edition goes where that edition already is, even if that diverges from its name', async () => {
  const srcDir = join(ctx.config.comicsDir, 'Unsorted')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'asm-002.cbz')
  const src = upsertEdition(ctx.db, { name: 'Unsorted', folder: 'Unsorted' })
  upsertEdition(ctx.db, { name: 'Vol 7', folder: 'Legacy/Vol 7' })
  const book = insertBook(ctx.db, {
    editionId: src.id, filePath: 'Unsorted/asm-002.cbz', pageCount: 1, fileSize: 100,
  })!

  const result = await moveBookToEdition(ctx, book.id, 'Vol 7')

  expect(result.book.filePath).toBe('Legacy/Vol 7/asm-002.cbz')
  expect(existsSync(join(ctx.config.comicsDir, 'Legacy/Vol 7', 'asm-002.cbz'))).toBe(true)
})

test('reorganizeLibrary moves a book whose folder does not match its series folder', async () => {
  // Place file in wrong folder
  const wrongDir = join(ctx.config.comicsDir, 'wrong-folder')
  mkdirSync(wrongDir, { recursive: true })
  await makeCbz(wrongDir, ['p1.png'], 'issue.cbz')
  const edition = upsertEdition(ctx.db, { name: 'CorrectName', folder: 'CorrectName' })
  // DB says it's in 'wrong-folder/issue.cbz' but series folder should be 'CorrectName'
  insertBook(ctx.db, { editionId: edition.id, filePath: 'wrong-folder/issue.cbz', pageCount: 1, fileSize: 100 })

  const result = await reorganizeLibrary(ctx)

  expect(result.moved).toBe(1)
  expect(existsSync(join(ctx.config.comicsDir, 'CorrectName', 'issue.cbz'))).toBe(true)
  expect(existsSync(join(ctx.config.comicsDir, 'wrong-folder', 'issue.cbz'))).toBe(false)
})

test('reorganize moves a flat edition under its series and repoints the row', async () => {
  const flat = join(ctx.config.comicsDir, 'Vol 7')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '001.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 100,
  })!

  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 1 })

  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  expect(getBook(ctx.db, book.id)!.filePath).toBe(`${nested}/001.cbz`)
  expect(getEdition(ctx.db, edition.id)!.folder).toBe(nested)
  expect(existsSync(join(ctx.config.comicsDir, nested, '001.cbz'))).toBe(true)
  expect(existsSync(flat)).toBe(false)
})

// An interrupted run is finished by running it again, so it must not trip over its
// own completed work.
test('a second reorganize finds nothing left to do', async () => {
  const flat = join(ctx.config.comicsDir, 'Vol 7')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '001.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  insertBook(ctx.db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 100 })

  await reorganizeLibrary(ctx)

  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 0 })
  expect(planReorganize(ctx.db)).toEqual([])
})

test('the plan names each move and touches nothing on disk', async () => {
  const flat = join(ctx.config.comicsDir, 'Vol 7')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '001.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 100,
  })!

  expect(planReorganize(ctx.db)).toEqual([{
    bookId: book.id,
    from: 'Vol 7/001.cbz',
    to: 'The Amazing Spider-Man/The Amazing Spider-Man (2025)/001.cbz',
  }])
  expect(existsSync(join(flat, '001.cbz'))).toBe(true)
})

test('an edition with no series of its own is left where it is', async () => {
  const dir = join(ctx.config.comicsDir, 'Unsorted')
  mkdirSync(dir, { recursive: true })
  await makeCbz(dir, ['p1.png'], 'loose.cbz')
  const edition = upsertEdition(ctx.db, { name: 'Unsorted', folder: 'Unsorted' })
  updateEdition(ctx.db, edition.id, { seriesName: null })
  insertBook(ctx.db, { editionId: edition.id, filePath: 'Unsorted/loose.cbz', pageCount: 1, fileSize: 100 })

  expect(planReorganize(ctx.db)).toEqual([])
  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 0 })
})

// Simulates a process dying between moveBookToEdition's rename() and its
// setBookEdition() call: the file already lives at the nested target, but the row
// still names the old flat path, which no longer exists. Left alone, dedupeDestPath
// would see the target "occupied" and rename onto a bogus " (2)" name for a source
// that's gone, failing on every subsequent scan forever.
test('reorganize self-heals a run interrupted between the file move and the row update', async () => {
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  // The file is already at the nested target - as if a prior run's rename succeeded -
  // but 'Vol 7' (the row's path) was never created in this test, standing in for it
  // having already vanished from disk.
  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  const nestedDir = join(ctx.config.comicsDir, nested)
  mkdirSync(nestedDir, { recursive: true })
  const filePath = await makeCbz(nestedDir, ['p1.png'], '001.cbz')
  // The row's fileSize must match the real file for self-heal to recognize it as the
  // same book (see the "different size" test below) - it is not adopted by name alone.
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: statSync(filePath).size,
  })!

  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 1, skipped: 0 })

  expect(getBook(ctx.db, book.id)!.filePath).toBe(`${nested}/001.cbz`)
  expect(existsSync(join(nestedDir, '001.cbz'))).toBe(true)
  expect(existsSync(join(nestedDir, '001 (2).cbz'))).toBe(false)
})

// A file sharing the target name is not proof it's the SAME file - it could be an
// unrelated file dropped in by hand while the book's own .cbz went missing. Adopting on
// name alone would silently repoint the row at someone else's comic; the size mismatch
// must make this fall through to the normal (failing) path instead.
test('reorganize does not self-heal onto a same-named file of a different size', async () => {
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  const nestedDir = join(ctx.config.comicsDir, nested)
  mkdirSync(nestedDir, { recursive: true })
  await makeCbz(nestedDir, ['p1.png'], '001.cbz')
  // Deliberately does not match the real file's size, standing in for an unrelated file
  // that happens to share the name.
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 999_999,
  })!

  const result = await reorganizeLibrary(ctx)

  expect(result).toMatchObject({ moved: 0, skipped: 1 })
  // Not adopted: the row keeps naming its own (now-missing) path rather than being
  // silently repointed at a file that isn't actually this book.
  expect(getBook(ctx.db, book.id)!.filePath).toBe('Vol 7/001.cbz')
})

// A self-healed move can still cross editions (e.g. mid-merge), and must get the same
// cleanup a normal cross-edition move gets - otherwise the emptied source edition's row
// and now-empty folder are left behind.
test('moveBookToEdition self-heal prunes the old edition when the move crosses editions', async () => {
  const oldEdition = upsertEdition(ctx.db, { name: 'Old', folder: 'Old' })
  const oldDir = join(ctx.config.comicsDir, 'Old')
  mkdirSync(oldDir, { recursive: true }) // empty: the file already moved out, row is stale

  const newDir = join(ctx.config.comicsDir, 'New')
  mkdirSync(newDir, { recursive: true })
  const filePath = await makeCbz(newDir, ['p1.png'], 'issue.cbz')
  const book = insertBook(ctx.db, {
    editionId: oldEdition.id, filePath: 'Old/issue.cbz', pageCount: 1, fileSize: statSync(filePath).size,
  })!

  const result = await moveBookToEdition(ctx, book.id, 'New')

  expect(result.book.filePath).toBe('New/issue.cbz')
  expect(getEditionByName(ctx.db, 'Old')).toBeUndefined()
  expect(existsSync(oldDir)).toBe(false)
})

// This runs against a real library on every scan, so a file deleted behind the app's
// back must not wedge the whole migration or desync the rows around it.
test('a book whose file vanished from disk is skipped, not fatal to the rest of the run', async () => {
  // Edition A: the row names a file that was never created - simulating one deleted
  // behind the app's back - so its move will throw ENOENT.
  const ghostEdition = upsertEdition(ctx.db, { name: 'Ghost Rider (2025)', folder: 'Vol 3' })
  updateEdition(ctx.db, ghostEdition.id, { seriesName: 'Ghost Rider' })
  const ghostBook = insertBook(ctx.db, {
    editionId: ghostEdition.id, filePath: 'Vol 3/001.cbz', pageCount: 1, fileSize: 100,
  })!

  // Edition B: an ordinary flat edition that should still migrate despite A's failure.
  const flat = join(ctx.config.comicsDir, 'Vol 7')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '001.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 100,
  })!

  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 1, skipped: 1 })

  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  expect(getBook(ctx.db, book.id)!.filePath).toBe(`${nested}/001.cbz`)
  expect(existsSync(join(ctx.config.comicsDir, nested, '001.cbz'))).toBe(true)
  // The ghost book's row is untouched - it stays where it was, ready to be retried.
  expect(getBook(ctx.db, ghostBook.id)!.filePath).toBe('Vol 3/001.cbz')
})

// A crafted or corrupted file_path (e.g. containing '..') must never let cleanup step
// outside the library, even though moveBookToEdition itself doesn't bound its source.
test('reorganize never rmdirs outside the library root, even from a crafted file_path', async () => {
  const outsideDir = join(dir, 'outside')
  mkdirSync(outsideDir, { recursive: true })
  await makeCbz(outsideDir, ['p1.png'], 'x.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: '../outside' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  insertBook(ctx.db, {
    editionId: edition.id, filePath: '../outside/x.cbz', pageCount: 1, fileSize: 100,
  })

  await reorganizeLibrary(ctx)

  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  expect(existsSync(join(ctx.config.comicsDir, nested, 'x.cbz'))).toBe(true)
  // The folder outside comicsDir must survive even though it's now empty.
  expect(existsSync(outsideDir)).toBe(true)
})

// A book living straight in the comics root gives dirname('root.cbz') === '.', which
// must never reach an unguarded rmdir(comicsDir) - only luck (ENOTEMPTY) protects that
// today if the root isn't actually empty.
test('reorganize never rmdirs the comics root itself for a root-level file', async () => {
  await makeCbz(ctx.config.comicsDir, ['p1.png'], 'root.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: '.' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  insertBook(ctx.db, { editionId: edition.id, filePath: 'root.cbz', pageCount: 1, fileSize: 100 })

  await reorganizeLibrary(ctx)

  expect(existsSync(ctx.config.comicsDir)).toBe(true)
})

// dirname('foo/../root.cbz') is the literal string 'foo/..', not '.' - a naive string
// check against '.' misses it entirely, even though it normalises straight back to the
// comics root and must be caught the same way. Here the destination folder created by
// the move keeps comicsDir non-empty regardless, so ENOTEMPTY alone would also protect
// it - see the removeBook test below for a case where that luck runs out.
test('reorganize never rmdirs the comics root when a crafted path normalises back to it', async () => {
  await makeCbz(ctx.config.comicsDir, ['p1.png'], 'root.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'foo' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  insertBook(ctx.db, { editionId: edition.id, filePath: 'foo/../root.cbz', pageCount: 1, fileSize: 100 })

  await reorganizeLibrary(ctx)

  expect(existsSync(ctx.config.comicsDir)).toBe(true)
})

// Same normalising path, but via removeBook on an edition's LAST book: nothing else is
// created anywhere, so once the file is unlinked, comicsDir really is empty - without
// the resolved-path guard, rmdir(comicsDir) would not just be attempted but would
// actually succeed here, deleting the user's entire library folder.
test('removing the last book never rmdirs the comics root when its folder normalises back to it', async () => {
  const filePath = await makeCbz(ctx.config.comicsDir, ['p1.png'], 'root.cbz')
  const edition = upsertEdition(ctx.db, { name: 'Solo', folder: 'foo/..' })
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: 'foo/../root.cbz', pageCount: 1, fileSize: statSync(filePath).size,
  })!

  await removeBook(ctx, book.id)

  expect(existsSync(ctx.config.comicsDir)).toBe(true)
})

test('renameEdition (pure rename) preserves publisher/summary/comicvineId', async () => {
  const srcDir = join(ctx.config.comicsDir, 'DC')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue1.cbz')
  const s = upsertEdition(ctx.db, { name: 'DC', folder: 'DC' })
  updateEdition(ctx.db, s.id, { publisher: 'DC Comics', summary: 'The DC universe', comicvineId: 42 })
  insertBook(ctx.db, { editionId: s.id, filePath: 'DC/issue1.cbz', pageCount: 1, fileSize: 100 })

  const result = await renameEdition(ctx, s.id, 'Detective Comics')

  expect(result.edition.name).toBe('Detective Comics')
  expect(result.edition.publisher).toBe('DC Comics')
  expect(result.edition.summary).toBe('The DC universe')
  expect(result.edition.comicvineId).toBe(42)
  // Under the series it keeps ('DC'), not a fresh top-level 'Detective Comics' - see the
  // pure-rename test above for why this expectation names the nested path.
  expect(existsSync(join(ctx.config.comicsDir, 'DC', 'Detective Comics', 'issue1.cbz'))).toBe(true)
  expect(planReorganize(ctx.db)).toEqual([])
  expect(getEditionByName(ctx.db, 'DC')).toBeUndefined()
})

test('renameEdition (merge) backfills the target publisher when it lacks one', async () => {
  const tDir = join(ctx.config.comicsDir, 'Big Two')
  mkdirSync(tDir, { recursive: true })
  await makeCbz(tDir, ['p1.png'], 't.cbz')
  const target = upsertEdition(ctx.db, { name: 'Big Two', folder: 'Big Two' })
  insertBook(ctx.db, { editionId: target.id, filePath: 'Big Two/t.cbz', pageCount: 1, fileSize: 1 })

  const sDir = join(ctx.config.comicsDir, 'DC')
  mkdirSync(sDir, { recursive: true })
  await makeCbz(sDir, ['p1.png'], 's.cbz')
  const src = upsertEdition(ctx.db, { name: 'DC', folder: 'DC' })
  updateEdition(ctx.db, src.id, { publisher: 'DC Comics' })
  insertBook(ctx.db, { editionId: src.id, filePath: 'DC/s.cbz', pageCount: 1, fileSize: 1 })

  const result = await renameEdition(ctx, src.id, 'Big Two') // merge DC → Big Two

  expect(result.edition.id).toBe(target.id)
  expect(result.edition.publisher).toBe('DC Comics')
  expect(getEditionByName(ctx.db, 'DC')).toBeUndefined()
})

test('renameEdition (pure rename) preserves the group', async () => {
  const srcDir = join(ctx.config.comicsDir, 'Amazing Spider-Man (2025)')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue1.cbz')
  const s = upsertEdition(ctx.db, { name: 'Amazing Spider-Man (2025)', folder: 'Amazing Spider-Man (2025)' })
  updateEdition(ctx.db, s.id, { seriesName: 'Amazing Spider-Man' })
  insertBook(ctx.db, { editionId: s.id, filePath: 'Amazing Spider-Man (2025)/issue1.cbz', pageCount: 1, fileSize: 100 })

  const result = await renameEdition(ctx, s.id, 'Vol 7')

  expect(result.edition.name).toBe('Vol 7')
  expect(result.edition.seriesName).toBe('Amazing Spider-Man')
})

// The reported symptom: renaming the series also renamed its group to match, because
// the recreated row derived a fresh group from the new name.
test('renameEdition does not overwrite the group with the new name', async () => {
  const srcDir = join(ctx.config.comicsDir, 'ASM Omnibus')
  mkdirSync(srcDir, { recursive: true })
  await makeCbz(srcDir, ['p1.png'], 'issue1.cbz')
  const s = upsertEdition(ctx.db, { name: 'ASM Omnibus', folder: 'ASM Omnibus' })
  updateEdition(ctx.db, s.id, { seriesName: 'Amazing Spider-Man' })
  insertBook(ctx.db, { editionId: s.id, filePath: 'ASM Omnibus/issue1.cbz', pageCount: 1, fileSize: 100 })

  const result = await renameEdition(ctx, s.id, 'Nick Spencer Omnibus')

  expect(result.edition.seriesName).not.toBe('Nick Spencer')
  expect(result.edition.seriesName).not.toBe('Nick Spencer Omnibus')
  expect(result.edition.seriesName).toBe('Amazing Spider-Man')
})

test('renameEdition (merge) keeps the target group and backfills only when it has none', async () => {
  const tDir = join(ctx.config.comicsDir, 'Target')
  mkdirSync(tDir, { recursive: true })
  await makeCbz(tDir, ['p1.png'], 't.cbz')
  const target = upsertEdition(ctx.db, { name: 'Target', folder: 'Target' })
  updateEdition(ctx.db, target.id, { seriesName: 'Keep Me' })
  insertBook(ctx.db, { editionId: target.id, filePath: 'Target/t.cbz', pageCount: 1, fileSize: 1 })

  const sDir = join(ctx.config.comicsDir, 'Source')
  mkdirSync(sDir, { recursive: true })
  await makeCbz(sDir, ['p1.png'], 's.cbz')
  const src = upsertEdition(ctx.db, { name: 'Source', folder: 'Source' })
  updateEdition(ctx.db, src.id, { seriesName: 'Discard Me' })
  insertBook(ctx.db, { editionId: src.id, filePath: 'Source/s.cbz', pageCount: 1, fileSize: 1 })

  const result = await renameEdition(ctx, src.id, 'Target')
  expect(result.edition.seriesName).toBe('Keep Me')
})

test('renameEdition (merge) takes the source group when the target has none', async () => {
  const tDir = join(ctx.config.comicsDir, 'Bare')
  mkdirSync(tDir, { recursive: true })
  await makeCbz(tDir, ['p1.png'], 't.cbz')
  const target = upsertEdition(ctx.db, { name: 'Bare', folder: 'Bare' })
  updateEdition(ctx.db, target.id, { seriesName: null })
  insertBook(ctx.db, { editionId: target.id, filePath: 'Bare/t.cbz', pageCount: 1, fileSize: 1 })

  const sDir = join(ctx.config.comicsDir, 'Donor')
  mkdirSync(sDir, { recursive: true })
  await makeCbz(sDir, ['p1.png'], 's.cbz')
  const src = upsertEdition(ctx.db, { name: 'Donor', folder: 'Donor' })
  updateEdition(ctx.db, src.id, { seriesName: 'Donated' })
  insertBook(ctx.db, { editionId: src.id, filePath: 'Donor/s.cbz', pageCount: 1, fileSize: 1 })

  const result = await renameEdition(ctx, src.id, 'Bare')
  expect(result.edition.seriesName).toBe('Donated')
})

// Guard: this is the second column (after publisher/summary/comicvineId) to be lost
// because the carry-over was an allowlist. Adding a field to SERIES_FIELDS without
// carrying it should now fail here rather than silently in the app.
test('a rename carries every updatable series field except the name', () => {
  const expected = EDITION_UPDATABLE_FIELDS.filter((f) => f !== 'name').sort()
  const carried = Object.keys(carryableMetadata({
    publisher: 'p', summary: 's', comicvineId: 1, seriesName: 'g',
  } as never)).sort()
  expect(carried).toEqual(expected)
})

// A rename keeps the series the edition already had (a PATCH may even set the two in one
// request: series first, then the rename). The folder it stores must therefore be built
// from THAT series, not from a fresh derivation off the new name. Here the two differ -
// deriveSeriesName strips ': The Complete Collection (2020)' down to 'Batman' - so a
// folder built from the derived name leaves the row claiming one series while its files
// sit under another, and the next reorganize bulk-moves every file a second time.
test('renameEdition files the edition under the series it keeps, not one derived from the new name', async () => {
  const oldDir = join(ctx.config.comicsDir, 'OldName')
  mkdirSync(oldDir, { recursive: true })
  await makeCbz(oldDir, ['p1.png'], 'issue.cbz')
  const edition = upsertEdition(ctx.db, { name: 'OldName', folder: 'OldName' })
  updateEdition(ctx.db, edition.id, { seriesName: 'Batman: The Complete Collection' })
  const book = insertBook(ctx.db, {
    editionId: edition.id, filePath: 'OldName/issue.cbz', pageCount: 1, fileSize: 100,
  })!

  const newName = 'Batman: The Complete Collection (2020)'
  const result = await renameEdition(ctx, edition.id, newName)

  const nested = `Batman: The Complete Collection/${newName}`
  expect(result.edition.seriesName).toBe('Batman: The Complete Collection')
  expect(result.edition.folder).toBe(nested)
  expect(getBook(ctx.db, book.id)!.filePath).toBe(`${nested}/issue.cbz`)
  expect(existsSync(join(ctx.config.comicsDir, nested, 'issue.cbz'))).toBe(true)
  // Row, folder and disk agree, so a following reorganize has nothing to move.
  expect(planReorganize(ctx.db)).toEqual([])
  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 0, skipped: 0 })
})

// The folder column has to be written BEFORE the moves - moveBookToEdition follows it -
// but if every move fails (EXDEV across a mount is the realistic case) the column would
// name a directory nothing ever reached while every file stayed put. A later edition
// change would then drop a book into that empty directory, splitting one edition across
// two folders.
test('an edition whose every move fails keeps pointing at the folder its files are in', async () => {
  const ghost = upsertEdition(ctx.db, { name: 'Ghost Rider (2025)', folder: 'Vol 3' })
  updateEdition(ctx.db, ghost.id, { seriesName: 'Ghost Rider' })
  // The row names a file that is not on disk, so its move throws instead of succeeding.
  insertBook(ctx.db, { editionId: ghost.id, filePath: 'Vol 3/001.cbz', pageCount: 1, fileSize: 100 })

  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 0, skipped: 1 })

  expect(getEdition(ctx.db, ghost.id)!.folder).toBe('Vol 3')
})

// The consequence the revert exists to prevent: after a failed migration, moving another
// issue into that edition must land beside the issues already there, not in the folder
// nothing reached.
test('after a failed migration a new issue still lands beside the edition it joins', async () => {
  const flat = join(ctx.config.comicsDir, 'Vol 3')
  mkdirSync(flat, { recursive: true })
  const ghost = upsertEdition(ctx.db, { name: 'Ghost Rider (2025)', folder: 'Vol 3' })
  updateEdition(ctx.db, ghost.id, { seriesName: 'Ghost Rider' })
  // Its own file vanished behind the app's back, so the migration cannot move it.
  insertBook(ctx.db, { editionId: ghost.id, filePath: 'Vol 3/001.cbz', pageCount: 1, fileSize: 100 })

  const looseDir = join(ctx.config.comicsDir, 'Unsorted')
  mkdirSync(looseDir, { recursive: true })
  await makeCbz(looseDir, ['p1.png'], '002.cbz')
  const loose = upsertEdition(ctx.db, { name: 'Unsorted', folder: 'Unsorted' })
  const looseBook = insertBook(ctx.db, {
    editionId: loose.id, filePath: 'Unsorted/002.cbz', pageCount: 1, fileSize: 100,
  })!

  await reorganizeLibrary(ctx)
  const result = await moveBookToEdition(ctx, looseBook.id, 'Ghost Rider (2025)')

  expect(result.book.filePath).toBe('Vol 3/002.cbz')
  expect(existsSync(join(flat, '002.cbz'))).toBe(true)
})

// The revert must not undo a migration that partly worked: the issues that DID move are
// at the new folder, and the column has to keep describing them.
test('a partly migrated edition keeps the new folder its moved issues are in', async () => {
  const flat = join(ctx.config.comicsDir, 'Vol 7')
  mkdirSync(flat, { recursive: true })
  await makeCbz(flat, ['p1.png'], '001.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  insertBook(ctx.db, { editionId: edition.id, filePath: 'Vol 7/001.cbz', pageCount: 1, fileSize: 100 })
  // A second issue of the same edition whose file is gone: its move fails.
  insertBook(ctx.db, { editionId: edition.id, filePath: 'Vol 7/002.cbz', pageCount: 1, fileSize: 100 })

  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 1, skipped: 1 })

  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  expect(getEdition(ctx.db, edition.id)!.folder).toBe(nested)
})

// Nor may it undo a migration that already finished on a previous run: those issues are
// at the new folder even though this run moved nothing.
test('an edition already at its target keeps it even when another issue is skipped', async () => {
  const nested = 'The Amazing Spider-Man/The Amazing Spider-Man (2025)'
  const nestedDir = join(ctx.config.comicsDir, nested)
  mkdirSync(nestedDir, { recursive: true })
  await makeCbz(nestedDir, ['p1.png'], '001.cbz')
  const edition = upsertEdition(ctx.db, { name: 'The Amazing Spider-Man (2025)', folder: 'Vol 7' })
  updateEdition(ctx.db, edition.id, { seriesName: 'The Amazing Spider-Man' })
  // Already migrated by an earlier run...
  insertBook(ctx.db, { editionId: edition.id, filePath: `${nested}/001.cbz`, pageCount: 1, fileSize: 100 })
  // ...while this row's file is gone, so its move fails and nothing moves this run.
  insertBook(ctx.db, { editionId: edition.id, filePath: 'Vol 7/002.cbz', pageCount: 1, fileSize: 100 })

  expect(await reorganizeLibrary(ctx)).toMatchObject({ moved: 0, skipped: 1 })

  expect(getEdition(ctx.db, edition.id)!.folder).toBe(nested)
})
