import { createWriteStream } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { listPages } from '../lib/cbz.js'
import { isCbr, convertCbrToCbz } from '../lib/cbr.js'
import { ingestFile } from '../services/indexer.js'
import { applyIssueToBook } from '../services/applyIssue.js'
import { editionFolderPath, dedupeDestPath } from '../lib/paths.js'
import { comicFileName } from '../lib/comicFileName.js'
import { createComicVine } from '../lib/comicvine.js'
import { deriveSeriesName } from '../lib/seriesName.js'
import { getEditionByName } from '../models/editions.js'
import type { App } from '../types.js'

export default async function uploadRoutes(app: App) {
  app.post('/api/upload', async (req, reply) => {
    const parts = req.parts()
    let editionName: string | undefined
    let issueId: string | undefined
    let tmpPath: string | undefined
    let originalName: string | undefined

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'edition') {
        editionName = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'issueId') {
        issueId = String(part.value)
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

    // If it's a .cbr, convert to a tmp .cbz first
    let cbzTmpPath = tmpPath
    let cbrTmpPath: string | undefined
    if (isCbr(tmpPath)) {
      cbrTmpPath = tmpPath
      cbzTmpPath = tmpPath.replace(/\.cbr$/i, '.cbz')
      try {
        await convertCbrToCbz(cbrTmpPath, cbzTmpPath)
      } catch {
        await unlink(cbrTmpPath).catch(() => {})
        await unlink(cbzTmpPath).catch(() => {})
        return reply.code(400).send({ error: 'not a valid .cbr (conversion failed)' })
      }
      // Adjust originalName to .cbz so the stored file has the right extension
      originalName = originalName.replace(/\.cbr$/i, '.cbz')
    }

    // Validate: must be a readable zip with at least one image page.
    let pages: string[] | null
    try { pages = await listPages(cbzTmpPath) } catch { pages = null }
    if (!pages || pages.length === 0) {
      await unlink(cbzTmpPath).catch(() => {})
      if (cbrTmpPath) await unlink(cbrTmpPath).catch(() => {})
      return reply.code(400).send({ error: 'not a valid .cbz (no image pages)' })
    }

    // Clean up the original .cbr tmp file now that conversion succeeded
    if (cbrTmpPath) await unlink(cbrTmpPath).catch(() => {})

    // An upload writes into the same library every other operation reads, so it files
    // the issue exactly where they would: under `<series>/<edition>` for a new edition,
    // and - for one that already exists - wherever its row says its files already are.
    // The row, not a recomputation from the name, is the authority (see
    // moveBookToEdition); recomputing would strand the upload in a second directory the
    // edition does not claim.
    const name = (editionName || '').trim() || 'Unsorted'
    const existing = getEditionByName(app.db, name)
    const folder = existing
      ? existing.folder || editionFolderPath(existing.seriesName, name)
      : editionFolderPath(deriveSeriesName(name), name)

    const destDir = join(app.config.comicsDir, folder)
    await mkdir(destDir, { recursive: true })

    // A confirmed match earns a clean name: venom_256.cbz rather than the four release
    // tags a scene file arrives with. Resolved BEFORE the write so the file lands with
    // its final name and there is no rename afterwards to unwind. Without a match the
    // file keeps the name it came with - renaming on a guess loses track of what it is.
    let finalName = originalName
    if (issueId) {
      try {
        // Built per request, not per registration: the key is read from config at call
        // time, so a key set after the routes were registered still works.
        const cv = createComicVine({ apiKey: app.config.comicVineApiKey })
        const issue = await cv.getIssue(issueId)
        const volume = issue.volumeId ? await cv.getVolume(issue.volumeId) : undefined
        const slugged = comicFileName(volume?.name, issue.number, extname(originalName))
        if (slugged) finalName = slugged
      } catch { /* a name we cannot improve is no reason to refuse the upload */ }
    }

    // Never rename onto a comic that is already there: that destroyed the existing file
    // and then failed the unique constraint on book.file_path, so the upload 500'd with
    // the original already gone. Same guard every move through the library uses.
    const destPath = dedupeDestPath(destDir, finalName)
    await rename(cbzTmpPath, destPath)

    // The NAME the user typed, not the sanitised folder: sanitising is a filesystem
    // concern, and passing the folder on as the name would rename the user's edition to
    // whatever its directory had to be called.
    const book = await ingestFile({ db: app.db, config: app.config }, destPath, name)
    if (!book || !issueId) return { book }

    // The file is on disk and indexed by now. Metadata is the bonus, so a Comic Vine that
    // will not answer costs the metadata, never the upload.
    try {
      const applied = await applyIssueToBook({ db: app.db, config: app.config }, book.id, issueId)
      return { book: applied.book, metadataApplied: true }
    } catch {
      return { book, metadataApplied: false }
    }
  })
}
