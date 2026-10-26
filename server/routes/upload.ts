import { createWriteStream } from 'node:fs'
import { unlink, rename } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { join, basename, extname, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { storeComic } from '../services/storeComic.js'
import { removeBook } from '../services/library.js'
import { getBook, setBookEdition } from '../models/books.js'
import { renameLock } from '../lib/mutex.js'
import { dedupeDestPath } from '../lib/paths.js'
import type { App } from '../types.js'

export default async function uploadRoutes(app: App) {
  app.post('/api/upload', async (req, reply) => {
    const parts = req.parts()
    let editionName: string | undefined
    let issueId: string | undefined
    // Set only by the exact string 'true': the form sends a typed id this way, and anything
    // looser would let a stray field file a reminder.
    let manual = false
    // Supplied together or not at all - see StoreComicInput. They skip a naming lookup.
    let volumeName: string | undefined
    let issueNumber: string | undefined
    // The comic this upload takes the place of, which is DELETED once the new one has
    // safely landed. See the sequence below; the ordering is the whole safety property.
    let replaceBookId: string | undefined
    let tmpPath: string | undefined
    let originalName: string | undefined

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'edition') {
        editionName = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'issueId') {
        issueId = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'manual') {
        manual = String(part.value) === 'true'
      } else if (part.type === 'field' && part.fieldname === 'volumeName') {
        volumeName = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'issueNumber') {
        issueNumber = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'replaceBookId') {
        replaceBookId = String(part.value)
      } else if (part.type === 'file' && part.fieldname === 'file') {
        originalName = basename(part.filename)
        const ext = extname(originalName).toLowerCase()
        const isRar = ext === '.cbr'
        tmpPath = join(app.config.tmpDir, `${randomUUID()}${isRar ? '.cbr' : '.cbz'}`)
        await pipeline(part.file, createWriteStream(tmpPath))
        if (part.file.truncated) {
          await unlink(tmpPath).catch(() => {})
          return reply.code(413).send({ error: 'file too large' })
        }
      }
    }

    if (!tmpPath || !originalName) return reply.code(400).send({ error: 'no file part' })

    // Digits only, no leading zero, same rule as /api/books/:id/comicvine - Number('1e3')
    // and Number('0x10') would otherwise sail through and delete a different comic than
    // the one that was named. Validated BEFORE the store, so a malformed id costs nothing.
    let replaceId: number | undefined
    if (replaceBookId != null && replaceBookId !== '') {
      if (!/^[1-9]\d*$/.test(replaceBookId)) {
        await unlink(tmpPath).catch(() => {})
        return reply.code(400).send({ error: 'replaceBookId must be a positive integer' })
      }
      replaceId = Number(replaceBookId)
    }

    const result = await storeComic({ db: app.db, config: app.config }, {
      tmpPath, originalName, editionName, issueId, manual, volumeName, issueNumber,
    })
    if (!result.ok) return reply.code(400).send({ error: result.error })
    const { wantedName } = result

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

    const victim = replaceId != null ? getBook(app.db, replaceId) : undefined
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
        const removal = await removeBook({ db: app.db, config: app.config }, replaceId)
        replaced = { bookId: replaceId, editionRemoved: removal.editionRemoved }

        // dedupeDestPath had to step around the comic that was still there. Now that it
        // is gone the name it was holding is free, so the replacement takes it.
        const stored = getBook(app.db, result.book.id)
        if (stored && wantedName && basename(stored.filePath) !== wantedName) {
          const relDir = dirname(stored.filePath)
          const destDir = join(app.config.comicsDir, relDir)
          const from = join(app.config.comicsDir, stored.filePath)
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
            setBookEdition(app.db, stored.id, stored.editionId, `${relDir}/${basename(claimed)}`)
          } catch (err) {
            // The row is the only thing that can find a file again, so disk and database
            // must not be left disagreeing. dedupeDestPath reads the filesystem and never
            // the database, so a stale row claiming this name lets the rename succeed and
            // the UPDATE fail its UNIQUE constraint - and by then the old comic is gone.
            // Putting the file back is what keeps the new one reachable.
            if (claimed) await rename(claimed, from).catch(() => {})
            app.log.warn({ err, bookId: stored.id }, 'could not rename a replacement onto the name it freed')
          }
        }
      } catch (err) {
        // removeBook deletes the comic file before the thumbnail and rethrows anything
        // that is not ENOENT, so a thumbnail it cannot unlink leaves the old comic
        // half-removed. Nothing can be done about that from here, but the upload itself
        // succeeded and the answer has to say so.
        app.log.warn({ err, replaceId }, 'stored the replacement but could not remove the comic it replaces')
        replaceFailed = true
      }
    }

    const book = result.book ? getBook(app.db, result.book.id) ?? result.book : result.book
    const extra = { ...(replaced ? { replaced } : {}), ...(replaceFailed ? { replaceFailed } : {}) }
    if (result.metadataApplied === undefined) return { book, wantedName, ...extra }
    // A typo'd id is 200, not 404: the comic was stored, and a 404 would read as "nothing
    // happened" to a page that then offers the upload again and files a duplicate.
    return result.issueNotFound
      ? { book, metadataApplied: false, issueNotFound: true, wantedName, ...extra }
      : { book, metadataApplied: result.metadataApplied, wantedName, ...extra }
  })
}
