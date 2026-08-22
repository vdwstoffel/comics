import { mkdir, rename, rmdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'
import { sanitizeSeriesFolder } from '../lib/paths.js'
import {
  upsertSeries, getSeries, getSeriesByName, deleteSeries, updateSeries, carryableMetadata,
} from '../models/series.js'
import { getBook, listBooksBySeries, setBookSeries } from '../models/books.js'
import type { Ctx } from '../types.js'
import type { Series, Book } from '../types.js'

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

export async function moveBookToSeries(
  ctx: Ctx,
  bookId: number,
  seriesName: string,
): Promise<{ book: Book; series: Series }> {
  const { db, config } = ctx
  const book = getBook(db, bookId)
  if (!book) throw new Error(`Book ${bookId} not found`)

  const targetFolder = sanitizeSeriesFolder(seriesName)
  const targetSeries = upsertSeries(db, { name: seriesName, folder: targetFolder })

  const currentAbsPath = join(config.comicsDir, book.filePath)
  const destDir = join(config.comicsDir, targetFolder)
  // Pass currentAbsPath so dedupeDestPath skips the source file when checking collisions
  const destAbsPath = dedupeDestPath(destDir, basename(book.filePath), currentAbsPath)
  const destRelPath = `${targetFolder}/${basename(destAbsPath)}`

  // Explicit no-op: file is already at the computed destination (same series, same name)
  if (destAbsPath === currentAbsPath) {
    // Ensure DB is consistent (series_id and file_path match) but skip rename and pruning
    const updatedBook = setBookSeries(db, bookId, targetSeries.id, destRelPath)
    const series = getSeries(db, targetSeries.id) as Series
    return { book: updatedBook, series }
  }

  await mkdir(destDir, { recursive: true })
  await rename(currentAbsPath, destAbsPath)

  const updatedBook = setBookSeries(db, bookId, targetSeries.id, destRelPath)

  // Prune old series if now empty
  const oldSeriesId = book.seriesId
  if (oldSeriesId !== targetSeries.id) {
    const remaining = listBooksBySeries(db, oldSeriesId)
    if (remaining.length === 0) {
      // Compute old folder path BEFORE deleting the DB row
      const oldSeries = getSeries(db, oldSeriesId)
      const oldFolderName = oldSeries?.folder ?? dirname(book.filePath)
      deleteSeries(db, oldSeriesId)
      const oldDir = join(config.comicsDir, oldFolderName)
      await rmdir(oldDir).catch(() => { /* ignore ENOTEMPTY or other errors */ })
    }
  }

  const series = getSeries(db, targetSeries.id) as Series
  return { book: updatedBook, series }
}

export async function renameSeries(
  ctx: Ctx,
  seriesId: number,
  newName: string,
): Promise<{ series: Series }> {
  const { db } = ctx

  // No-op: if the trimmed new name equals the current name, return unchanged
  const currentSeries = getSeries(db, seriesId)
  if (!currentSeries) throw new Error(`Series ${seriesId} not found`)
  if (newName.trim() === currentSeries.name) {
    return { series: currentSeries }
  }

  // Metadata to preserve across the rename/merge (the moves create/keep a different
  // series row, so it must be carried forward explicitly). Everything but the name.
  const carry = carryableMetadata(currentSeries)

  const targetExisting = getSeriesByName(db, newName)

  if (targetExisting && targetExisting.id !== seriesId) {
    // MERGE path: move all books of seriesId into targetExisting
    const books = listBooksBySeries(db, seriesId)
    for (const book of books) {
      await moveBookToSeries(ctx, book.id, newName)
    }
    // Backfill the target's metadata from the source only where the target lacks it
    const target = getSeries(db, targetExisting.id) as Series
    const patch: Record<string, unknown> = {}
    const missing = (v: unknown) => v == null || v === ''
    for (const [key, value] of Object.entries(carry)) {
      if (missing((target as unknown as Record<string, unknown>)[key]) && !missing(value)) {
        patch[key] = value
      }
    }
    if (Object.keys(patch).length > 0) updateSeries(db, target.id, patch)
    return { series: getSeries(db, target.id) as Series }
  }

  // Pure rename path.
  const books = listBooksBySeries(db, seriesId)
  if (books.length === 0) {
    // No files to move — rename the row in place, preserving all its metadata.
    updateSeries(db, seriesId, { name: newName })
    return { series: getSeries(db, seriesId) as Series }
  }
  // Move all books to the new name (upserts a fresh series + moves files, then
  // deletes the emptied source). The fresh series only has name/folder, so we
  // carry over the source's publisher/summary/comicvineId afterwards.
  for (const book of books) {
    await moveBookToSeries(ctx, book.id, newName)
  }
  const renamed = getSeriesByName(db, newName) as Series
  // The fresh row derived its own group from the new name; the old one wins.
  updateSeries(db, renamed.id, carry)
  return { series: getSeries(db, renamed.id) as Series }
}

export async function reorganizeLibrary(ctx: Ctx): Promise<{ moved: number }> {
  const { db } = ctx
  const allBooks = db.prepare('SELECT id, series_id, file_path FROM book').all() as Array<{
    id: number
    series_id: number
    file_path: string
  }>
  let moved = 0
  for (const row of allBooks) {
    const series = getSeries(db, row.series_id)
    if (!series) continue
    const expectedFolder = sanitizeSeriesFolder(series.name)
    const currentFolder = dirname(row.file_path)
    if (currentFolder !== expectedFolder) {
      await moveBookToSeries(ctx, row.id, series.name)
      moved++
    }
  }
  return { moved }
}
