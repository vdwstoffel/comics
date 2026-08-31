import { mkdir, rename, rmdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname, resolve, sep } from 'node:path'
import { sanitizeEditionFolder } from '../lib/paths.js'
import {
  upsertEdition, getEdition, getEditionByName, deleteEdition, updateEdition, carryableMetadata,
} from '../models/editions.js'
import { getBook, listBooksByEdition, setBookEdition, deleteBook } from '../models/books.js'
import { getSeries } from '../models/series.js'
import type { Ctx } from '../types.js'
import type { Edition, Book } from '../types.js'

/**
 * Returns a dest path that does not yet exist, de-duping with (2), (3), … suffixes.
 * Pass srcAbsPath to exclude the source file itself from collision detection (self-move guard).
 */
function dedupeDestPath(destDir: string, filename: string, srcAbsPath?: string): string {
  const ext = extname(filename)
  const base = filename.slice(0, filename.length - ext.length)
  let candidate = join(destDir, filename)
  let n = 2
  while (existsSync(candidate) && candidate !== srcAbsPath) {
    if (n > 9999) throw new Error('too many filename collisions')
    candidate = join(destDir, `${base} (${n})${ext}`)
    n++
  }
  return candidate
}

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
  if (folder) await rmdir(join(config.comicsDir, folder)).catch(() => { /* ENOTEMPTY etc. */ })
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

  const targetFolder = sanitizeEditionFolder(editionName)
  const targetEdition = upsertEdition(db, { name: editionName, folder: targetFolder })

  const currentAbsPath = join(config.comicsDir, book.filePath)
  const destDir = join(config.comicsDir, targetFolder)
  // Pass currentAbsPath so dedupeDestPath skips the source file when checking collisions
  const destAbsPath = dedupeDestPath(destDir, basename(book.filePath), currentAbsPath)
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
  // Move all books to the new name (upserts a fresh edition + moves files, then
  // deletes the emptied source). The fresh edition only has name/folder, so we
  // carry over the source's publisher/summary/comicvineId afterwards.
  for (const book of books) {
    await moveBookToEdition(ctx, book.id, newName)
  }
  const renamed = getEditionByName(db, newName) as Edition
  // The fresh row derived its own series from the new name; the old one wins.
  updateEdition(db, renamed.id, carry)
  return { edition: getEdition(db, renamed.id) as Edition }
}

export async function reorganizeLibrary(ctx: Ctx): Promise<{ moved: number }> {
  const { db } = ctx
  const allBooks = db.prepare('SELECT id, edition_id, file_path FROM book').all() as Array<{
    id: number
    edition_id: number
    file_path: string
  }>
  let moved = 0
  for (const row of allBooks) {
    const edition = getEdition(db, row.edition_id)
    if (!edition) continue
    const expectedFolder = sanitizeEditionFolder(edition.name)
    const currentFolder = dirname(row.file_path)
    if (currentFolder !== expectedFolder) {
      await moveBookToEdition(ctx, row.id, edition.name)
      moved++
    }
  }
  return { moved }
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
