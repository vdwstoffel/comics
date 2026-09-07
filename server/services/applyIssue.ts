import { createComicVine } from '../lib/comicvine.js'
import type { CvVolume } from '../lib/comicvine.js'
import { getBook, updateBook } from '../models/books.js'
import { getEdition, updateEdition } from '../models/editions.js'
import type { EditionUpdate } from '../models/editions.js'
import { replaceBookCredits, replaceBookTags, getBookCredits, getBookTags } from '../models/metadata.js'
import { syncComicInfoFile } from './comicinfoSync.js'
import type { BookCredit, BookTag } from '../models/metadata.js'
import type { Ctx, Book } from '../types.js'

export interface AppliedIssue {
  book: Book
  credits: BookCredit[]
  tags: BookTag[]
}

/**
 * Put everything Comic Vine knows about an issue onto a book: its own fields, its credits
 * and tags, the volume's identity on the edition, and the whole lot back into the file as
 * ComicInfo.xml.
 *
 * This lives in a service because two callers need it — matching a book you already have,
 * and matching a comic as you upload it. Copied instead of shared, the two would drift,
 * and the drift would show up as metadata that depends on which screen you used.
 */
export async function applyIssueToBook(
  ctx: Ctx,
  bookId: number,
  issueId: number | string,
): Promise<AppliedIssue> {
  const { db, config } = ctx
  const book = getBook(db, bookId)
  if (!book) throw new Error(`Book ${bookId} not found`)

  const cv = createComicVine({ apiKey: config.comicVineApiKey })
  const meta = await cv.getIssue(issueId)

  // Fetch the volume BEFORE opening the transaction: better-sqlite3 transactions must be
  // synchronous, so no await may appear inside one. Best-effort — a volume we cannot read
  // is no reason to lose the issue metadata we already have.
  let volume: CvVolume | undefined
  try {
    if (meta.volumeId) volume = await cv.getVolume(meta.volumeId)
  } catch { /* best-effort; don't fail the match */ }
  const publisher = volume?.publisher

  const updatedBook = db.transaction(() => {
    const b = updateBook(db, book.id, {
      title: meta.title ?? null, number: meta.number ?? null, date: meta.date ?? null,
      summary: meta.summary ?? null, writer: meta.writer ?? null, penciller: meta.penciller ?? null,
      comicvineId: Number(issueId),
      year: meta.year ?? null, coverUrl: meta.coverUrl ?? null, cvSiteUrl: meta.siteUrl ?? null,
      publisher: publisher ?? null,
    })
    replaceBookCredits(db, book.id, meta.credits)
    replaceBookTags(db, book.id, [
      ...meta.characters.map((c) => ({ kind: 'character', value: c.name, extId: c.id })),
      ...meta.teams.map((value) => ({ kind: 'team', value })),
      ...meta.storyArcs.map((a) => ({ kind: 'story_arc', value: a.name, extId: a.id })),
    ])

    // Propagate the volume to the edition: publisher and Comic Vine identity if it has
    // none, and the volume's own name/year, which is what the edition should be called.
    // The name is only recorded here — applying it is a rename, and a rename moves files.
    if (book.editionId && (publisher || volume)) {
      const edition = getEdition(db, book.editionId)
      if (edition) {
        const patch: EditionUpdate = {}
        if (publisher && !edition.publisher) patch.publisher = publisher
        if (volume?.name) patch.cvName = volume.name
        if (volume?.startYear !== undefined) patch.cvStartYear = volume.startYear
        if (meta.volumeId && !edition.comicvineId) patch.comicvineId = Number(meta.volumeId)
        if (Object.keys(patch).length > 0) updateEdition(db, book.editionId, patch)
      }
    }
    return b
  })()

  // Everything Comic Vine just gave us goes into the file as well as the database.
  const synced = await syncComicInfoFile(ctx, book.id)

  return {
    // updateBook returns the row it wrote; a book we just read cannot vanish mid-call.
    book: (synced ?? updatedBook) as Book,
    credits: getBookCredits(db, book.id),
    tags: getBookTags(db, book.id),
  }
}
