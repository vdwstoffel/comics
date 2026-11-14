import yauzl from 'yauzl'
import type { ZipFile, Entry } from 'yauzl'
import { createWriteStream } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dedupeDestPath } from './paths.js'

const COMIC_RE = /\.(cbz|cbr)$/i
const ZIP_RE = /\.zip$/i
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i

/**
 * How many zips deep a comic is looked for. A pack of a run split into zips per year is
 * one level; nothing real goes further, and a limit is what stops a zip that contains
 * itself.
 */
const MAX_DEPTH = 2

/**
 * Entries that are never a comic, whatever they are called. Directories, and the
 * AppleDouble shadows a Mac zips beside every file: `__MACOSX/._Venom 001.cbz` is a few
 * hundred bytes named exactly like the comic it shadows.
 */
function isJunk(name: string): boolean {
  return name.endsWith('/') || name.split('/').some((part) => part === '__MACOSX' || part.startsWith('._'))
}

function openZip(path: string): Promise<ZipFile | null> {
  return new Promise((resolve) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => resolve(err || !zip ? null : zip))
  })
}

/** What a zip holds, counted by kind. */
export interface ZipSurvey {
  /** Pages: what a comic is made of. */
  images: number
  /** Comics, and zips that may hold comics: what a collection is made of. */
  archives: number
}

/**
 * Count what a zip holds without unpacking any of it, or null when it is not a zip at all.
 *
 * This is what tells a comic from a collection. A .cbz IS a zip, and so is a pack of
 * forty .cbz files, and the name on the outside is no help: a download with no name is
 * saved as .cbz, and a single issue often arrives as .zip. Only the contents say which.
 */
export async function surveyZip(path: string): Promise<ZipSurvey | null> {
  const zip = await openZip(path)
  if (!zip) return null
  return new Promise((resolve) => {
    const survey: ZipSurvey = { images: 0, archives: 0 }
    zip.on('entry', (entry: Entry) => {
      const name = entry.fileName
      if (!isJunk(name)) {
        if (IMAGE_RE.test(name)) survey.images++
        else if (COMIC_RE.test(name) || ZIP_RE.test(name)) survey.archives++
      }
      zip.readEntry()
    })
    zip.on('end', () => resolve(survey))
    zip.on('error', () => { zip.close(); resolve(null) })
    zip.readEntry()
  })
}

/** Shared across nested zips, so a zip of zips cannot spend the limit once per level. */
export interface UnpackBudget {
  bytesLeft: number
}

/**
 * A file name an entry can safely be written under.
 *
 * Flattened to the base name: the folders inside a pack are scene packaging, and every
 * comic's own name already says its series and number, which is all the matcher reads.
 * Flattening is also what makes a hostile `../../` entry harmless - yauzl refuses those
 * already, and this would write it beside the others even if it did not.
 */
function flatName(entryName: string): string {
  return basename(entryName.replace(/\\/g, '/')).trim() || `comic-${randomUUID()}.cbz`
}

function extract(zip: ZipFile, entry: Entry, target: string, budget: UnpackBudget): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error(`could not read ${entry.fileName}`))
      // Counted as it streams. The size in the zip's directory is the zip's claim; the
      // limit has to hold against a lie, so it is the bytes written that stop this.
      const counter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          budget.bytesLeft -= chunk.length
          if (budget.bytesLeft < 0) done(new Error('the zip unpacks to more than the size limit'))
          else done(null, chunk)
        },
      })
      pipeline(stream, counter, createWriteStream(target)).then(resolve, async (e) => {
        await unlink(target).catch(() => {})
        reject(e)
      })
    })
  })
}

/**
 * Write every comic in a zip into `destDir`, side by side, and return the names written.
 *
 * Anything that is not a comic - a cover image, a .txt, an .nfo - is left behind. A
 * nested zip is opened in turn, and one that turns out to hold pages rather than comics
 * is a comic itself, the way a single issue so often arrives, so it is kept as a .cbz.
 *
 * Two comics with one name (the same file in two folders of the pack) both survive: the
 * second takes the same " (2)" a collision in the library would.
 */
export async function unpackComics(zipPath: string, destDir: string, budget: UnpackBudget): Promise<string[]> {
  const written: string[] = []
  try {
    await unpackInto(zipPath, destDir, budget, 0, written)
  } catch (err) {
    // All or nothing. Half a zip left behind would be unpacked again on the retry, beside
    // itself, and every comic in it would then be two files claiming one issue.
    for (const name of written) await unlink(join(destDir, name)).catch(() => {})
    throw err
  }
  return written
}

async function unpackInto(
  zipPath: string,
  destDir: string,
  budget: UnpackBudget,
  depth: number,
  written: string[],
): Promise<void> {
  const zip = await openZip(zipPath)
  if (!zip) throw new Error('not a readable zip')

  async function take(entry: Entry): Promise<void> {
    const name = entry.fileName
    if (isJunk(name)) return
    const isComic = COMIC_RE.test(name)
    const isZip = ZIP_RE.test(name) && depth < MAX_DEPTH
    if (!isComic && !isZip) return

    const target = isComic ? dedupeDestPath(destDir, flatName(name)) : join(destDir, `.nested-${randomUUID()}.zip`)
    await extract(zip!, entry, target, budget)
    if (isComic) {
      written.push(basename(target))
      return
    }

    try {
      const inner = await surveyZip(target)
      if (inner && inner.archives === 0 && inner.images > 0) {
        const asComic = dedupeDestPath(destDir, flatName(name).replace(ZIP_RE, '.cbz'))
        await rename(target, asComic)
        written.push(basename(asComic))
      } else if (inner) {
        await unpackInto(target, destDir, budget, depth + 1, written)
      }
    } finally {
      await unlink(target).catch(() => {})
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('entry', (entry: Entry) => { take(entry).then(() => zip.readEntry(), reject) })
      zip.on('end', () => resolve())
      zip.on('error', reject)
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
}
