import { mkdir, rename, rmdir, unlink } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join, basename, extname, dirname, resolve, sep } from 'node:path'
import { editionFolderPath, dedupeDestPath } from '../lib/paths.js'
import { deriveSeriesName } from '../lib/seriesName.js'
import {
  upsertEdition, getEdition, getEditionByName, deleteEdition, updateEdition, carryableMetadata,
  listEditions, setEditionFolder,
} from '../models/editions.js'
import { getBook, listBooksByEdition, setBookEdition, deleteBook } from '../models/books.js'
import { getSeries } from '../models/series.js'
import type { Ctx, Db } from '../types.js'
import type { Edition, Book } from '../types.js'
import type { Config } from '../config.js'

/**
 * Resolve a book's stored path against the library root, refusing anything that climbs
 * out of it. file_path is built from sanitized folder names so this should never fire,
 * but an unlink driven by a DB string deserves the guard.
 */
function resolveInsideComicsDir(comicsDir: string, filePath: string): string {
  const root = resolve(comicsDir)
  const target = resolve(join(comicsDir, filePath))
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Refusing to delete ${filePath}: outside the library`)
  }
  return target
}

/**
 * Unlink a file, treating "already gone" as success. A row whose file vanished from
 * disk must still be clearable; anything other than ENOENT is a real failure.
 */
async function unlinkIfPresent(path: string): Promise<void> {
  await unlink(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err
  })
}

/**
 * rmdir `folder`, refusing to touch anything a bad `folder` value could otherwise
 * reach. Two guards, in order:
 *
 * 1. resolveInsideComicsDir rejects a path that resolves outside comicsDir (a
 *    `file_path` built from a stale or crafted DB row deserves no trust).
 * 2. The RESOLVED path is compared against the resolved comics root and refused if
 *    equal. resolveInsideComicsDir deliberately allows the root itself as "inside", so
 *    a folder that merely *normalises* back to the root - e.g. 'foo/..' - would
 *    otherwise sail through and reach `rmdir(comicsDir)`. The `folder === '.'` check
 *    below is only a cheap shortcut for the literal, common case; this resolved
 *    comparison is what actually does the work for every other spelling of the root.
 *
 * Best-effort beyond both guards: ENOTEMPTY (still holds something) and ENOENT
 * (already gone) both mean nothing to do.
 */
async function rmdirIfSafe(config: Config, folder: string): Promise<void> {
  if (!folder || folder === '.') return
  let dir: string
  try {
    dir = resolveInsideComicsDir(config.comicsDir, folder)
  } catch {
    return // outside the library - refuse to touch it
  }
  if (dir === resolve(config.comicsDir)) return // never rmdir the comics root itself
  await rmdir(dir).catch(() => { /* not empty yet, already gone, or holds other editions */ })
}

/**
 * Remove `folder`, then its now-possibly-empty parent (the series level above it),
 * if each holds nothing else - the common cleanup once a move takes the last file
 * out of a folder.
 */
async function pruneFolderIfEmpty(config: Config, folder: string): Promise<void> {
  await rmdirIfSafe(config, folder)
  const parent = dirname(folder)
  if (parent && parent !== '.' && parent !== folder) {
    await rmdirIfSafe(config, parent)
  }
}

/**
 * Drop an edition that has just lost its last issue, along with its now-empty folder.
 * `fallbackFolder` covers the case where the row is already gone and only the path on
 * disk is known. Returns whether the edition was actually removed.
 */
async function pruneEditionIfEmpty(
  ctx: Ctx,
  editionId: number,
  fallbackFolder?: string,
): Promise<boolean> {
  const { db, config } = ctx
  if (listBooksByEdition(db, editionId).length > 0) return false

  // Read the folder BEFORE deleting the row - afterwards there is nothing to read it from.
  const folder = getEdition(db, editionId)?.folder ?? fallbackFolder
  deleteEdition(db, editionId)
  if (folder) await pruneFolderIfEmpty(config, folder)
  return true
}

export async function moveBookToEdition(
  ctx: Ctx,
  bookId: number,
  editionName: string,
): Promise<{ book: Book; edition: Edition }> {
  const { db, config } = ctx
  const book = getBook(db, bookId)
  if (!book) throw new Error(`Book ${bookId} not found`)

  // A new edition is created nested under its series; an existing one keeps the folder
  // it already has, because the row - not a recomputation from the name - is the
  // authority on where its files live.
  const desiredFolder = editionFolderPath(deriveSeriesName(editionName), editionName)
  const targetEdition = upsertEdition(db, { name: editionName, folder: desiredFolder })
  const targetFolder = targetEdition.folder

  const currentAbsPath = join(config.comicsDir, book.filePath)
  const destDir = join(config.comicsDir, targetFolder)
  const filename = basename(book.filePath)
  const naiveDestAbsPath = join(destDir, filename)

  // Self-heal an interrupted run: a previous attempt can crash between the rename
  // below and setBookEdition just after it, leaving the file already at its target
  // while the row still names the old, now-missing path. Left alone, dedupeDestPath
  // would see the target "occupied" (by what is actually this same file) and mint a
  // bogus " (2)" name, then fail forever trying to rename a source that's gone.
  //
  // Adopting by name alone isn't safe: an unrelated file could coincidentally share the
  // name (e.g. something dropped into the folder by hand, or the book's own .cbz having
  // been deleted while an unrelated file of the same name already lives there) without
  // being this book's file at all - silently repointing the row would hand the user
  // someone else's comic with nothing logged. Requiring the file size to match what's
  // already on record is a cheap, good-enough identity check; a mismatch falls through
  // to the normal path below, where it fails as an ordinary missing-source error
  // instead of adopting the wrong file.
  if (!existsSync(currentAbsPath) && existsSync(naiveDestAbsPath)
      && statSync(naiveDestAbsPath).size === book.fileSize) {
    const destRelPath = `${targetFolder}/${filename}`
    const updatedBook = setBookEdition(db, bookId, targetEdition.id, destRelPath)
    // Same cross-edition cleanup the normal path below performs: a self-healed move can
    // still cross editions (e.g. mid-merge), and would otherwise leave the emptied
    // source edition's row and folder behind.
    if (book.editionId !== targetEdition.id) {
      await pruneEditionIfEmpty(ctx, book.editionId, dirname(book.filePath))
    }
    const edition = getEdition(db, targetEdition.id) as Edition
    return { book: updatedBook, edition }
  }

  // Pass currentAbsPath so dedupeDestPath skips the source file when checking collisions
  const destAbsPath = dedupeDestPath(destDir, filename, currentAbsPath)
  const destRelPath = `${targetFolder}/${basename(destAbsPath)}`

  // Explicit no-op: file is already at the computed destination (same edition, same name)
  if (destAbsPath === currentAbsPath) {
    // Ensure DB is consistent (edition_id and file_path match) but skip rename and pruning
    const updatedBook = setBookEdition(db, bookId, targetEdition.id, destRelPath)
    const edition = getEdition(db, targetEdition.id) as Edition
    return { book: updatedBook, edition }
  }

  await mkdir(destDir, { recursive: true })
  await rename(currentAbsPath, destAbsPath)

  const updatedBook = setBookEdition(db, bookId, targetEdition.id, destRelPath)

  // Prune old edition if now empty
  if (book.editionId !== targetEdition.id) {
    await pruneEditionIfEmpty(ctx, book.editionId, dirname(book.filePath))
  }

  const edition = getEdition(db, targetEdition.id) as Edition
  return { book: updatedBook, edition }
}

export async function renameEdition(
  ctx: Ctx,
  editionId: number,
  newName: string,
): Promise<{ edition: Edition }> {
  const { db } = ctx

  // No-op: if the trimmed new name equals the current name, return unchanged
  const currentEdition = getEdition(db, editionId)
  if (!currentEdition) throw new Error(`Edition ${editionId} not found`)
  if (newName.trim() === currentEdition.name) {
    return { edition: currentEdition }
  }

  // Metadata to preserve across the rename/merge (the moves create/keep a different
  // edition row, so it must be carried forward explicitly). Everything but the name.
  const carry = carryableMetadata(currentEdition)

  const targetExisting = getEditionByName(db, newName)

  if (targetExisting && targetExisting.id !== editionId) {
    // MERGE path: move all books of editionId into targetExisting
    const books = listBooksByEdition(db, editionId)
    for (const book of books) {
      await moveBookToEdition(ctx, book.id, newName)
    }
    // Backfill the target's metadata from the source only where the target lacks it
    const target = getEdition(db, targetExisting.id) as Edition
    const patch: Record<string, unknown> = {}
    const missing = (v: unknown) => v == null || v === ''
    for (const [key, value] of Object.entries(carry)) {
      if (missing((target as unknown as Record<string, unknown>)[key]) && !missing(value)) {
        patch[key] = value
      }
    }
    if (Object.keys(patch).length > 0) updateEdition(db, target.id, patch)
    return { edition: getEdition(db, target.id) as Edition }
  }

  // Pure rename path.
  const books = listBooksByEdition(db, editionId)
  if (books.length === 0) {
    // No files to move — rename the row in place, preserving all its metadata.
    updateEdition(db, editionId, { name: newName })
    return { edition: getEdition(db, editionId) as Edition }
  }
  // Create the target row FIRST, with the folder built from the series it is actually
  // going to keep. Left to moveBookToEdition, the row would be minted with a folder
  // derived afresh from the new name - and where that derivation differs from the
  // carried series (a Comic Vine series of 'Batman: The Complete Collection' against an
  // edition named 'Batman: The Complete Collection (2020)', which deriveSeriesName cuts
  // back to 'Batman') the files would land under one series folder while the row claims
  // another, leaving the next reorganize to bulk-move every one of them again. The moves
  // below then follow this row, because an existing edition's folder is authoritative.
  upsertEdition(db, {
    name: newName,
    folder: editionFolderPath(carry.seriesName, newName),
    seriesName: carry.seriesName,
  })

  // Move all books to the new name (moves files into the row just created, then
  // deletes the emptied source). That row only has name/folder/series, so we carry
  // over the source's publisher/summary/comicvineId afterwards.
  for (const book of books) {
    await moveBookToEdition(ctx, book.id, newName)
  }
  const renamed = getEditionByName(db, newName) as Edition
  updateEdition(db, renamed.id, carry)
  return { edition: getEdition(db, renamed.id) as Edition }
}

export interface MovePlan {
  bookId: number
  from: string
  to: string
}

/**
 * Every book not yet living at `<series>/<edition>/<file>`, with the path it should
 * have. Reads only - the caller looks at this before anything moves.
 */
export function planReorganize(db: Db): MovePlan[] {
  const plans: MovePlan[] = []
  for (const edition of listEditions(db)) {
    const folder = editionFolderPath(edition.seriesName, edition.name)
    for (const book of listBooksByEdition(db, edition.id)) {
      const to = `${folder}/${basename(book.filePath)}`
      if (to !== book.filePath) plans.push({ bookId: book.id, from: book.filePath, to })
    }
  }
  return plans
}

/**
 * Bring the library into line with the layout: each edition under its series.
 *
 * The folder column is updated before the move, because moveBookToEdition follows the
 * edition's stored folder - update it after and every move would be a no-op. The move
 * itself then reuses the ordinary path, so collisions and pruning behave as they do
 * everywhere else. Re-running is safe: a book already at its target is not in the plan.
 *
 * A reorganize move never changes a book's edition_id, so moveBookToEdition's own
 * pruning (keyed on the id changing) never fires here - the old flat folder would be
 * left behind as an empty directory. pruneFolderIfEmpty cleans it (and its
 * now-possibly-empty series parent) up directly.
 *
 * This runs against a real library on every scan, so one bad row must not take the
 * rest of the migration down with it: each book's move is wrapped on its own, and a
 * file that vanished from disk behind the app's back (ENOENT out of moveBookToEdition)
 * is counted as skipped rather than aborting the loop. An edition that got at least one
 * book to the new folder keeps the new column, so a later scan doesn't redo it - only
 * the skipped book keeps being retried. An edition where every single move failed is
 * put back: see the revert below.
 */
export async function reorganizeLibrary(ctx: Ctx): Promise<{ moved: number; skipped: number }> {
  const { db, config } = ctx
  let moved = 0
  let skipped = 0
  for (const edition of listEditions(db)) {
    const folder = editionFolderPath(edition.seriesName, edition.name)
    const previousFolder = edition.folder
    if (previousFolder !== folder) setEditionFolder(db, edition.id, folder)

    let movedHere = 0
    let skippedHere = 0
    let alreadyThere = 0
    for (const book of listBooksByEdition(db, edition.id)) {
      const from = dirname(book.filePath)
      if (from === folder) { alreadyThere++; continue }
      try {
        await moveBookToEdition(ctx, book.id, edition.name)
        movedHere++
        await pruneFolderIfEmpty(config, from)
      } catch (err) {
        skippedHere++
        console.warn(`reorganize: skipping book ${book.id} (${book.filePath}):`, err)
      }
    }

    // The column has to be written before the moves - moveBookToEdition follows it - but
    // a column naming a directory nothing ever reached is worse than the stale one it
    // replaced: every file is still at the old folder, and the next edition change would
    // drop a book into the new one, splitting the edition across two directories. So if
    // this edition got nothing there - no move succeeded, and no earlier run had already
    // put a book there - put the old folder back and let a later run try again.
    const nothingIsThere = movedHere === 0 && alreadyThere === 0
    if (nothingIsThere && skippedHere > 0 && previousFolder !== folder) {
      setEditionFolder(db, edition.id, previousFolder)
    }

    moved += movedHere
    skipped += skippedHere
  }
  return { moved, skipped }
}

export async function removeBook(
  ctx: Ctx,
  bookId: number,
): Promise<{ editionId: number; editionRemoved: boolean }> {
  const { db, config } = ctx
  const book = getBook(db, bookId)
  if (!book) throw new Error(`Book ${bookId} not found`)

  await unlinkIfPresent(resolveInsideComicsDir(config.comicsDir, book.filePath))
  await unlinkIfPresent(join(config.thumbsDir, `${bookId}.webp`))
  deleteBook(db, bookId)

  const editionRemoved = await pruneEditionIfEmpty(ctx, book.editionId, dirname(book.filePath))
  return { editionId: book.editionId, editionRemoved }
}

/**
 * Remove an edition and every issue in it. removeBook prunes the edition once its last
 * issue goes, so the loop is the whole job - the trailing prune only covers an edition
 * that was already empty.
 */
export async function removeEdition(ctx: Ctx, editionId: number): Promise<{ books: number }> {
  const edition = getEdition(ctx.db, editionId)
  if (!edition) throw new Error(`Edition ${editionId} not found`)

  const books = listBooksByEdition(ctx.db, editionId)
  for (const book of books) await removeBook(ctx, book.id)
  await pruneEditionIfEmpty(ctx, editionId, edition.folder)

  return { books: books.length }
}

/** Remove every edition grouped under a series name. */
export async function removeSeries(
  ctx: Ctx,
  name: string,
): Promise<{ editions: number; books: number }> {
  const series = getSeries(ctx.db, name)
  if (!series) throw new Error(`Series ${name} not found`)

  let books = 0
  for (const edition of series.editions) {
    books += (await removeEdition(ctx, edition.id)).books
  }
  return { editions: series.editions.length, books }
}
