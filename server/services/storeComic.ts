import { mkdir, rename, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { listPages } from '../lib/cbz.js'
import { isCbr, convertCbrToCbz } from '../lib/cbr.js'
import { createComicVine } from '../lib/comicvine.js'
import { comicFileName } from '../lib/comicFileName.js'
import { editionFolderPath, dedupeDestPath } from '../lib/paths.js'
import { deriveSeriesName } from '../lib/seriesName.js'
import { getEditionByName } from '../models/editions.js'
import { ingestFile } from './indexer.js'
import { applyIssueToBook } from './applyIssue.js'
import type { Ctx, Book } from '../types.js'

export interface StoreComicInput {
  /** A comic already on disk in the tmp dir. Consumed: moved on success, removed on failure. */
  tmpPath: string
  /** The name it arrived with, which decides its extension and its fallback file name. */
  originalName: string
  editionName?: string
  issueId?: string | number
}

export type StoreComicResult =
  | { ok: true; book: Book | undefined; metadataApplied?: boolean }
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
  { tmpPath, originalName, editionName, issueId }: StoreComicInput,
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
  let finalName = name
  if (issueId) {
    try {
      const cv = createComicVine({ apiKey: config.comicVineApiKey })
      const issue = await cv.getIssue(issueId)
      const volume = issue.volumeId ? await cv.getVolume(issue.volumeId) : undefined
      const slugged = comicFileName(volume?.name, issue.number, extname(name))
      if (slugged) finalName = slugged
    } catch { /* a name we cannot improve is no reason to refuse the comic */ }
  }

  // Never rename onto a comic that is already there: that destroyed the existing file and
  // then failed the unique constraint on book.file_path. Same guard every library move uses.
  const destPath = dedupeDestPath(destDir, finalName)
  await rename(cbzTmpPath, destPath)

  // The NAME given, not the sanitised folder: sanitising is a filesystem concern, and
  // passing the folder on would rename the edition to whatever its directory had to be.
  const book = await ingestFile(ctx, destPath, edition)
  if (!book || !issueId) return { ok: true, book }

  // The file is on disk and indexed by now. Metadata is the bonus, so a Comic Vine that
  // will not answer costs the metadata, never the comic.
  try {
    const applied = await applyIssueToBook(ctx, book.id, issueId)
    return { ok: true, book: applied.book, metadataApplied: true }
  } catch {
    return { ok: true, book, metadataApplied: false }
  }
}
