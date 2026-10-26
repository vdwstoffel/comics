import { mkdir, rename, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { listPages } from '../lib/cbz.js'
import { isCbr, convertCbrToCbz } from '../lib/cbr.js'
import { createComicVine, CvApiError } from '../lib/comicvine.js'
import { comicFileName } from '../lib/comicFileName.js'
import { editionFolderPath, dedupeDestPath } from '../lib/paths.js'
import { getVolumeCached } from '../models/volumeRecord.js'
import { deriveSeriesName } from '../lib/seriesName.js'
import { getEditionByName } from '../models/editions.js'
import { getBook, updateBook } from '../models/books.js'
import { ingestFile } from './indexer.js'
import { applyIssueToBook } from './applyIssue.js'
import { renameLock } from '../lib/mutex.js'
import { getComicVineKey } from '../models/settings.js'
import type { Ctx, Book } from '../types.js'

export interface StoreComicInput {
  /** A comic already on disk in the tmp dir. Consumed: moved on success, removed on failure. */
  tmpPath: string
  /** The name it arrived with, which decides its extension and its fallback file name. */
  originalName: string
  editionName?: string
  issueId?: string | number
  /** The id was typed by the user, not picked off a search result. Forwarded to the apply service, which files the reminder. */
  manual?: boolean
  /**
   * The two halves of the comic's file name, when the caller already holds them.
   *
   * Supplying both skips a getIssue and a getVolume that exist only to look them up. A
   * bulk upload knows the volume from the search result and the issue number from the
   * volume's issue list, so paying for that lookup once per comic is 2 of Comic Vine's
   * 200 requests an hour thrown away on an answer already in hand.
   *
   * Both or neither: half of a name is not a name.
   */
  volumeName?: string
  issueNumber?: string
}

export type StoreComicResult =
  | {
      ok: true
      book: Book | undefined
      metadataApplied?: boolean
      issueNotFound?: true
      /**
       * The name this comic ASKED for, before dedupeDestPath may have had to pick another.
       * A caller replacing an existing comic deletes it after the upload has safely landed,
       * and then wants the name the old file was holding.
       */
      wantedName?: string
    }
  | { ok: false; error: 'not a valid .cbr (conversion failed)' | 'not a valid .cbz (no image pages)' }

/**
 * Everything that happens to a comic between "the bytes are in tmp" and "it is in the
 * library": unpack a .cbr, check it is really a comic, work out where it belongs, name it,
 * move it in, index it, and apply the matched issue.
 *
 * A service because two intakes need it — an upload and a download from a URL. Copied
 * rather than shared, the two would drift, and the drift would show as a comic filed or
 * named differently depending on how it arrived.
 */
export async function storeComic(
  ctx: Ctx,
  { tmpPath, originalName, editionName, issueId, manual, volumeName, issueNumber }: StoreComicInput,
): Promise<StoreComicResult> {
  const { db, config } = ctx
  let name = originalName

  // A .cbr becomes a .cbz first; the library holds one archive format.
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
      return { ok: false, error: 'not a valid .cbr (conversion failed)' }
    }
    name = name.replace(/\.cbr$/i, '.cbz')
  }

  // Must be a readable zip with at least one image page. This is also what stops an HTML
  // error page, downloaded and saved under a .cbz name, from entering the library.
  let pages: string[] | null
  try { pages = await listPages(cbzTmpPath) } catch { pages = null }
  if (!pages || pages.length === 0) {
    await unlink(cbzTmpPath).catch(() => {})
    if (cbrTmpPath) await unlink(cbrTmpPath).catch(() => {})
    return { ok: false, error: 'not a valid .cbz (no image pages)' }
  }
  if (cbrTmpPath) await unlink(cbrTmpPath).catch(() => {})

  // A comic files itself exactly where every other operation would put it: under
  // `<series>/<edition>` for a new edition, and - for one that already exists - wherever
  // its row says its files already are. The row, not a recomputation from the name, is
  // the authority (see moveBookToEdition); recomputing would strand it in a second
  // directory the edition does not claim.
  const edition = (editionName || '').trim() || 'Unsorted'
  const existing = getEditionByName(db, edition)
  const folder = existing
    ? existing.folder || editionFolderPath(existing.seriesName, edition)
    : editionFolderPath(deriveSeriesName(edition), edition)

  const destDir = join(config.comicsDir, folder)
  await mkdir(destDir, { recursive: true })

  // A confirmed match earns a clean name: venom_256.cbz rather than the four release tags
  // a scene file arrives with. Resolved BEFORE the write so the file lands with its final
  // name and there is no rename afterwards to unwind. Without a match the file keeps the
  // name it came with - renaming on a guess loses track of what it is.
  //
  // A caller that already knows both halves hands them over and the lookup is skipped
  // entirely. comicFileName runs the series through slug(), which strips anything that
  // could make a path - that is what makes a client-supplied volumeName safe here, and
  // nothing may route around it.
  let finalName = name
  if (volumeName && issueNumber) {
    const slugged = comicFileName(volumeName, issueNumber, extname(name))
    if (slugged) finalName = slugged
  } else if (issueId) {
    try {
      const cv = createComicVine({ apiKey: () => getComicVineKey(db) })
      const issue = await cv.getIssue(issueId)
      const volume = issue.volumeId ? await getVolumeCached(db, cv, issue.volumeId) : undefined
      const slugged = comicFileName(volume?.name, issue.number, extname(name))
      if (slugged) finalName = slugged
    } catch { /* a name we cannot improve is no reason to refuse the comic */ }
  }

  // Never rename onto a comic that is already there: that destroyed the existing file and
  // then failed the unique constraint on book.file_path. Picking the name and renaming
  // onto it is one step, under the lock every writer into comicsDir shares - deliberately
  // narrow, so the Comic Vine naming lookup above stays outside it and one slow API call
  // cannot hold up every other download.
  const destPath = await renameLock(async () => {
    const claimed = dedupeDestPath(destDir, finalName)
    await rename(cbzTmpPath, claimed)
    return claimed
  })

  // The NAME given, not the sanitised folder: sanitising is a filesystem concern, and
  // passing the folder on would rename the edition to whatever its directory had to be.
  const book = await ingestFile(ctx, destPath, edition)
  if (!book || !issueId) return { ok: true, book, wantedName: finalName }

  // The file is on disk and indexed by now. Metadata is the bonus, so a Comic Vine that
  // will not answer costs the metadata, never the comic.
  try {
    const applied = await applyIssueToBook(ctx, book.id, issueId, { manual })
    // The service's own answer, never a hardcoded true: with `manual` a Comic Vine that
    // cannot be read no longer throws, it binds the id and reports metadataApplied false.
    // Claiming success there tells the upload page the metadata arrived, and the page
    // hides its "Fetch metadata" retry on exactly that claim.
    return { ok: true, book: applied.book, metadataApplied: applied.metadataApplied, wantedName: finalName }
  } catch (err) {
    // Comic Vine's "Object Not Found" (status_code 101) means the id is a typo, and the
    // service has written nothing. Binding it here would undo that: a comic linked to a
    // record that is not there, with the typo hidden behind a stored upload. The comic
    // itself is already in the library and stays - losing a file to a mistyped id would be
    // far worse - so this is reported as a flag, not thrown, and the caller can say so.
    if (err instanceof CvApiError && err.cvStatus === 101) {
      return { ok: true, book: getBook(db, book.id) ?? book, metadataApplied: false, issueNotFound: true, wantedName: finalName }
    }
    // The identity came from the queue, not from Comic Vine. Record it even when the
    // metadata read fails: a follow that cannot see this issue as owned fetches it again
    // on every sweep, and the finished queue row no longer blocks the duplicate.
    updateBook(db, book.id, { comicvineId: Number(issueId) })
    return { ok: true, book: getBook(db, book.id) ?? book, metadataApplied: false, wantedName: finalName }
  }
}
