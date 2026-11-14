import { rename } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { storeComic } from './storeComic.js'
import type { StoreComicInput } from './storeComic.js'
import { removeBook } from './library.js'
import { getBook, setBookEdition } from '../models/books.js'
import { renameLock } from '../lib/mutex.js'
import { dedupeDestPath } from '../lib/paths.js'
import type { Ctx, Book } from '../types.js'

export interface StoreReplacingInput extends StoreComicInput {
  /** The comic this one takes the place of, DELETED once the new one has safely landed. */
  replaceId?: number
}

/** What a page that sent a comic is told about it. */
export interface StoredAnswer {
  book: Book | undefined
  metadataApplied?: boolean
  issueNotFound?: true
  wantedName?: string
  replaced?: { bookId: number; editionRemoved: boolean }
  replaceFailed?: true
}

export type StoreReplacingResult =
  | { ok: true; answer: StoredAnswer }
  | { ok: false; error: string }

type Warn = (message: string, detail: Record<string, unknown>) => void

/**
 * Store a comic, then remove the one it replaces.
 *
 * Shared by the two ways a comic can be handed over by a person - an upload, and a comic
 * filed out of a collection - because the replace sequence is the only irreversible
 * operation in the app, and two copies of it would be two chances to get the order wrong.
 */
export async function storeReplacing(
  ctx: Ctx,
  { replaceId, ...input }: StoreReplacingInput,
  warn: Warn = () => {},
): Promise<StoreReplacingResult> {
  const { db, config } = ctx
  const result = await storeComic(ctx, input)
  if (!result.ok) return result
  const { wantedName } = result
  const { issueId } = input

  /**
   * The comic this one replaces, removed only now.
   *
   * The ORDER is the safety property and must not be rearranged: the new file is on
   * disk and indexed by the time anything is deleted, so a store that failed above
   * returned already and the old comic is still there. Deleting first would mean a
   * failed upload costs you the comic you had.
   *
   * The delete lives here rather than in the client because a browser doing
   * upload-then-DELETE can lose the race, and a tab closed between the two calls leaves
   * exactly the duplicate this feature exists to avoid.
   */
  let replaced: { bookId: number; editionRemoved: boolean } | undefined
  let replaceFailed: true | undefined

  const victim = replaceId != null ? getBook(db, replaceId) : undefined
  /**
   * The named comic must be the one that holds the issue being uploaded.
   *
   * This is the only irreversible operation in the app, so it does not take the
   * client's word for which comic to destroy. The page derives replaceBookId from the
   * very issue it is uploading, so this holds for every legitimate call - and any row
   * mix-up in the browser becomes a no-op instead of a deletion. With no issueId there
   * is nothing to check against, and nothing is deleted.
   */
  const holdsThisIssue = victim != null
    && issueId != null && issueId !== ''
    && victim.comicvineId === Number(issueId)

  if (replaceId != null && result.book && victim && holdsThisIssue) {
    // Everything from here is housekeeping on a comic that is ALREADY in the library,
    // so none of it may turn a successful upload into a failed request. A 500 here
    // would have the page mark the row failed and the user upload again - which is how
    // you end up with the duplicate this feature exists to prevent.
    try {
      const removal = await removeBook(ctx, replaceId)
      replaced = { bookId: replaceId, editionRemoved: removal.editionRemoved }

      // dedupeDestPath had to step around the comic that was still there. Now that it
      // is gone the name it was holding is free, so the replacement takes it.
      const stored = getBook(db, result.book.id)
      if (stored && wantedName && basename(stored.filePath) !== wantedName) {
        const relDir = dirname(stored.filePath)
        const destDir = join(config.comicsDir, relDir)
        const from = join(config.comicsDir, stored.filePath)
        let claimed: string | undefined
        try {
          // Claim-then-rename under the shared lock, exactly as renameLibraryFiles
          // does: the name was freed a moment ago and a download filing a comic right
          // now must not be handed it in between.
          claimed = await renameLock(async () => {
            const target = dedupeDestPath(destDir, wantedName)
            await rename(from, target)
            return target
          })
          setBookEdition(db, stored.id, stored.editionId, `${relDir}/${basename(claimed)}`)
        } catch (err) {
          // The row is the only thing that can find a file again, so disk and database
          // must not be left disagreeing. dedupeDestPath reads the filesystem and never
          // the database, so a stale row claiming this name lets the rename succeed and
          // the UPDATE fail its UNIQUE constraint - and by then the old comic is gone.
          // Putting the file back is what keeps the new one reachable.
          if (claimed) await rename(claimed, from).catch(() => {})
          warn('could not rename a replacement onto the name it freed', { err, bookId: stored.id })
        }
      }
    } catch (err) {
      // removeBook deletes the comic file before the thumbnail and rethrows anything
      // that is not ENOENT, so a thumbnail it cannot unlink leaves the old comic
      // half-removed. Nothing can be done about that from here, but the upload itself
      // succeeded and the answer has to say so.
      warn('stored the replacement but could not remove the comic it replaces', { err, replaceId })
      replaceFailed = true
    }
  }

  const book = result.book ? getBook(db, result.book.id) ?? result.book : result.book
  const extra = { ...(replaced ? { replaced } : {}), ...(replaceFailed ? { replaceFailed } : {}) }
  if (result.metadataApplied === undefined) return { ok: true, answer: { book, wantedName, ...extra } }
  // A typo'd id is 200, not 404: the comic was stored, and a 404 would read as "nothing
  // happened" to a page that then offers the upload again and files a duplicate.
  return {
    ok: true,
    answer: result.issueNotFound
      ? { book, metadataApplied: false, issueNotFound: true, wantedName, ...extra }
      : { book, metadataApplied: result.metadataApplied, wantedName, ...extra },
  }
}
