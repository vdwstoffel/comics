import { join } from 'node:path'
import { buildComicInfo } from '../lib/comicinfo.js'
import { embedComicInfo } from '../lib/embed.js'
import { getBook, updateBook } from '../models/books.js'
import { getEdition } from '../models/editions.js'
import { getBookCredits, getBookTags } from '../models/metadata.js'
import type { Ctx, Book } from '../types.js'

/**
 * Write everything we hold about a book into the ComicInfo.xml inside its .cbz, so the
 * metadata travels with the file rather than living only in this database. Called by
 * every route that changes a book's metadata; there is no manual trigger.
 *
 * Best-effort, like the Comic Vine publisher lookup: a file that cannot be rewritten
 * leaves the saved metadata alone and stays marked unsynced, rather than failing the
 * request that saved it. The book detail reads that flag, so the failure is visible.
 */
export async function syncComicInfoFile(ctx: Ctx, bookId: number): Promise<Book | undefined> {
  const { db, config } = ctx
  const book = getBook(db, bookId)
  if (!book) return undefined

  const edition = getEdition(db, book.editionId)
  const tags = getBookTags(db, book.id)
  const valuesOf = (kind: string) => tags.filter((t) => t.kind === kind).map((t) => t.value)

  const xml = buildComicInfo({
    // ComicInfo's <Series> tag names the folder the issue ships in - our edition.
    title: book.title ?? undefined, series: edition?.name, number: book.number ?? undefined,
    writer: book.writer ?? undefined, penciller: book.penciller ?? undefined,
    summary: book.summary ?? undefined,
    publisher: book.publisher ?? edition?.publisher ?? undefined,
    date: book.date ?? undefined,
    credits: getBookCredits(db, book.id),
    characters: valuesOf('character'),
    teams: valuesOf('team'),
    storyArcs: valuesOf('story_arc'),
  })

  try {
    await embedComicInfo(join(config.comicsDir, book.filePath), xml)
  } catch (err) {
    console.warn(`could not embed metadata into ${book.filePath}:`, err)
    return updateBook(db, book.id, { comicinfoSynced: false })
  }
  return updateBook(db, book.id, { comicinfoSynced: true })
}
