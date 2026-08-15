import { mkdir, rename, rmdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'
import { sanitizeSeriesFolder } from '../lib/paths.js'
import { upsertSeries, getSeries, getSeriesByName, deleteSeries } from '../models/series.js'
import { getBook, listBooksBySeries, setBookSeries } from '../models/books.js'
import type { Ctx } from '../types.js'
import type { Series, Book } from '../types.js'

/** Returns a dest path that does not yet exist, de-duping with (2), (3), … suffixes. */
function dedupeDestPath(destDir: string, filename: string): string {
  const ext = extname(filename)
  const base = filename.slice(0, filename.length - ext.length)
  let candidate = join(destDir, filename)
  let n = 2
  while (existsSync(candidate)) {
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
  const destAbsPath = dedupeDestPath(destDir, basename(book.filePath))
  const destRelPath = `${targetFolder}/${basename(destAbsPath)}`

  // Only move if path actually changes
  if (destAbsPath !== currentAbsPath) {
    await mkdir(destDir, { recursive: true })
    await rename(currentAbsPath, destAbsPath)
  }

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
  const targetExisting = getSeriesByName(db, newName)

  if (targetExisting && targetExisting.id !== seriesId) {
    // MERGE path: move all books of seriesId into targetExisting
    const books = listBooksBySeries(db, seriesId)
    for (const book of books) {
      await moveBookToSeries(ctx, book.id, newName)
    }
    return { series: getSeries(db, targetExisting.id) as Series }
  }

  // Pure rename path: move all books to new name (upserts the new series)
  const books = listBooksBySeries(db, seriesId)
  for (const book of books) {
    await moveBookToSeries(ctx, book.id, newName)
  }
  // seriesId was emptied and deleted by moveBookToSeries
  const renamed = getSeriesByName(db, newName) as Series
  return { series: renamed }
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
