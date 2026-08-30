import { mkdir, rename, rmdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'
import { sanitizeEditionFolder } from '../lib/paths.js'
import {
  upsertEdition, getEdition, getEditionByName, deleteEdition, updateEdition, carryableMetadata,
} from '../models/editions.js'
import { getBook, listBooksByEdition, setBookEdition } from '../models/books.js'
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
  const oldEditionId = book.editionId
  if (oldEditionId !== targetEdition.id) {
    const remaining = listBooksByEdition(db, oldEditionId)
    if (remaining.length === 0) {
      // Compute old folder path BEFORE deleting the DB row
      const oldEdition = getEdition(db, oldEditionId)
      const oldFolderName = oldEdition?.folder ?? dirname(book.filePath)
      deleteEdition(db, oldEditionId)
      const oldDir = join(config.comicsDir, oldFolderName)
      await rmdir(oldDir).catch(() => { /* ignore ENOTEMPTY or other errors */ })
    }
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
