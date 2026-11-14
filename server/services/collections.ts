import { copyFile, link, mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isCbr } from '../lib/cbr.js'
import { surveyZip, unpackComics } from '../lib/zipPack.js'
import type { ZipSurvey } from '../lib/zipPack.js'
import { naturalCompare } from '../lib/naturalSort.js'
import { dedupeDestPath } from '../lib/paths.js'
import {
  createCollection, getCollection, listCollections, removeCollection, setCollectionCount,
} from '../models/collections.js'
import type { Collection } from '../models/collections.js'
import { storeReplacing } from './storeReplacing.js'
import type { StoreReplacingInput, StoreReplacingResult } from './storeReplacing.js'
import type { Ctx } from '../types.js'

const COMIC_RE = /\.(cbz|cbr)$/i
const ZIP_RE = /\.zip$/i

/**
 * What a delivered file turned out to be.
 *
 * `comic` hands the file back to be stored as it always was - possibly a different file,
 * unwrapped from the zip it came in. `collection` means several comics are now waiting
 * for review and nothing is to be stored yet. `empty` is a zip with no comic in it.
 */
export type Delivery =
  | { kind: 'comic'; tmpPath: string; name: string }
  | { kind: 'collection'; collection: Collection }
  | { kind: 'empty' }

export interface DeliveryInput {
  /** The file as it arrived, in tmp. Consumed unless it comes back as the `comic`. */
  tmpPath: string
  /** The name it arrived with. */
  name: string
  /** What the collection is called, should it become one. */
  label: string
  /**
   * Hold even a single comic for review. The bulk page asks for this: it has a table to
   * show whatever is inside, and a zip of one comic is still something it was handed to
   * match.
   */
  collect?: boolean
}

/** The name a comic is stored under: a .zip of pages is a .cbz by another name. */
function comicName(name: string): string {
  return name.replace(ZIP_RE, '.cbz')
}

/** Whether a file is a comic by its contents: a .cbr, or a zip of pages. */
function isComic(tmpPath: string, survey: ZipSurvey | null): boolean {
  return isCbr(tmpPath) || (survey != null && survey.images > 0)
}

/** The least an unpack is allowed, so a small zip of deflated pages is not refused. */
const MIN_UNPACK_BYTES = 256 * 1024 ** 2

/**
 * Put whatever a file holds into `dest`, and return the names it added. Consumes the file.
 *
 * A zip of comics is unpacked. A comic on its own - a .cbr, a .cbz, a .zip of pages - is
 * moved in whole. Anything else adds nothing.
 *
 * The unpack may write twice what the zip itself weighs. Comics are pictures that are
 * already compressed, so a pack of them barely shrinks and its contents are about its
 * own size; the bound is there to stop a zip bomb, and measured against the zip it scales
 * with the run instead of capping a long one at some fixed size.
 */
async function stage(_ctx: Ctx, tmpPath: string, name: string, dest: string, survey: ZipSurvey | null): Promise<string[]> {
  try {
    if (survey != null && survey.archives > 0) {
      const { size } = await stat(tmpPath)
      return await unpackComics(tmpPath, dest, { bytesLeft: Math.max(size * 2, MIN_UNPACK_BYTES) })
    }
    if (!isComic(tmpPath, survey)) return []
    const target = dedupeDestPath(dest, comicName(name))
    await rename(tmpPath, target)
    return [basename(target)]
  } finally {
    // Spent either way. A zip kept beside what it unpacked to would double what a
    // collection costs the disk.
    await unlink(tmpPath).catch(() => {})
  }
}

function surveyOf(tmpPath: string): Promise<ZipSurvey | null> {
  return isCbr(tmpPath) ? Promise.resolve(null) : surveyZip(tmpPath)
}

/** A new, empty collection with a folder of its own. */
async function newCollection(ctx: Ctx, label: string, parts: number): Promise<Collection> {
  const dir = randomUUID()
  await mkdir(join(ctx.config.stagingDir, dir), { recursive: true })
  return createCollection(ctx.db, { label, dir, fileCount: 0, parts })
}

/**
 * Look inside whatever a download or an upload delivered, before it is stored.
 *
 * The one place a zip is opened, so a collection behaves the same however it arrived. A
 * comic - .cbz, .cbr, or a .zip of pages - goes on to storeComic untouched. A zip of
 * comics is unpacked into the staging dir: one comic inside is unwrapped and goes on as
 * if it had come alone, several wait as a collection.
 */
export async function openDelivery(ctx: Ctx, { tmpPath, name, label, collect = false }: DeliveryInput): Promise<Delivery> {
  const survey = await surveyOf(tmpPath)
  const isPack = survey != null && survey.archives > 0
  if (!isPack && !collect) return { kind: 'comic', tmpPath, name: comicName(name) }

  const collection = await newCollection(ctx, label, 1)
  const dest = join(ctx.config.stagingDir, collection.dir)
  let names: string[]
  try {
    names = await stage(ctx, tmpPath, name, dest, survey)
  } catch (err) {
    await discardCollection(ctx, collection.id)
    throw err
  }

  if (names.length === 0) {
    await discardCollection(ctx, collection.id)
    return { kind: 'empty' }
  }
  if (names.length === 1 && !collect) {
    const [only] = names as [string]
    const out = join(ctx.config.tmpDir, `${randomUUID()}${extname(only).toLowerCase()}`)
    await rename(join(dest, only), out)
    await discardCollection(ctx, collection.id)
    return { kind: 'comic', tmpPath: out, name: only }
  }
  setCollectionCount(ctx.db, collection.id, names.length)
  return { kind: 'collection', collection: getCollection(ctx.db, collection.id)! }
}

/**
 * Queue every part of a post into one new collection, so the run is reviewed in one table.
 *
 * The collection exists before a byte has arrived: each part's queue row names it, which
 * is what lets the parts find each other however they finish, and what lets the queue say
 * how many are still to come.
 */
export async function createPartsCollection(ctx: Ctx, label: string, parts: number): Promise<Collection> {
  return newCollection(ctx, label, parts)
}

/**
 * Unpack one downloaded part into its collection, and return the collection it went into.
 *
 * A collection discarded while this part was still on its way is gone, so the part starts
 * a collection of its own rather than being thrown away: it was downloaded on purpose.
 */
export async function addToCollection(
  ctx: Ctx,
  id: number,
  { tmpPath, name, label }: { tmpPath: string; name: string; label: string },
): Promise<number> {
  const collection = getCollection(ctx.db, id)
  if (!collection) {
    const delivery = await openDelivery(ctx, { tmpPath, name, label, collect: true })
    if (delivery.kind !== 'collection') throw new Error('that download holds no comics')
    return delivery.collection.id
  }
  const dest = join(ctx.config.stagingDir, collection.dir)
  await mkdir(dest, { recursive: true })
  const added = await stage(ctx, tmpPath, name, dest, await surveyOf(tmpPath))
  setCollectionCount(ctx.db, id, (await collectionFiles(ctx, collection)).length)
  if (added.length === 0) throw new Error('that download holds no comics')
  return id
}

/** The comics still waiting in a collection, in the order a person would read them. */
export async function collectionFiles(ctx: Ctx, collection: Collection): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(join(ctx.config.stagingDir, collection.dir))
  } catch {
    return []
  }
  // A leading dot is a half-written nested zip, never a comic.
  return names.filter((n) => COMIC_RE.test(n) && !n.startsWith('.')).sort(naturalCompare)
}

export async function discardCollection(ctx: Ctx, id: number): Promise<boolean> {
  const collection = getCollection(ctx.db, id)
  if (!collection) return false
  await rm(join(ctx.config.stagingDir, collection.dir), { recursive: true, force: true })
  return removeCollection(ctx.db, id)
}

export type FileFromCollectionResult =
  | StoreReplacingResult & { remaining: number }
  | { ok: false; notFound: true }

/**
 * File one comic out of a collection, exactly as an upload of it would have been.
 *
 * The staged file is LINKED into tmp rather than moved, because storeComic consumes what
 * it is given and deletes it on failure. A comic that fails to store - a corrupt archive,
 * a .cbr that will not convert - stays in the collection, where it can be tried again or
 * discarded, instead of vanishing from the table it was listed in. The staged copy goes
 * only once the comic is safely in the library.
 *
 * The last comic out takes the collection with it, unless a part is still on its way or
 * waiting on you at a bot check - either would arrive to find nowhere to go.
 */
export async function fileFromCollection(
  ctx: Ctx,
  id: number,
  fileName: string,
  input: Omit<StoreReplacingInput, 'tmpPath' | 'originalName'>,
  warn?: Parameters<typeof storeReplacing>[2],
): Promise<FileFromCollectionResult> {
  const collection = getCollection(ctx.db, id)
  if (!collection) return { ok: false, notFound: true }
  // Only a name the folder itself lists. The client names a file, never a path, and a
  // name that is not in this list - `../library.sqlite` included - is simply not there.
  if (!(await collectionFiles(ctx, collection)).includes(fileName)) return { ok: false, notFound: true }

  const staged = join(ctx.config.stagingDir, collection.dir, fileName)
  const tmpPath = join(ctx.config.tmpDir, `${randomUUID()}${extname(fileName).toLowerCase()}`)
  try {
    await link(staged, tmpPath)
  } catch {
    // A filesystem without hard links costs a copy, not the feature.
    await copyFile(staged, tmpPath)
  }

  const result = await storeReplacing(ctx, { ...input, tmpPath, originalName: fileName }, warn)
  if (result.ok) await unlink(staged).catch(() => {})

  const remaining = (await collectionFiles(ctx, collection)).length
  const now = getCollection(ctx.db, id)
  if (remaining === 0 && now?.waiting === 0 && now.blocked === 0) await discardCollection(ctx, id)
  else setCollectionCount(ctx.db, id, remaining)
  return { ...result, remaining }
}

/**
 * Make the staging dir and the collection table agree, at startup.
 *
 * A process that died mid-unpack leaves a folder no row names, and a folder removed by
 * hand leaves a row naming nothing. Neither is anything a person could act on. A
 * collection with a part still queued, or stopped at a bot check, is left alone however
 * empty it is: that part is going to fill it.
 */
export async function reconcileCollections(ctx: Ctx): Promise<number> {
  const rows = listCollections(ctx.db)
  const named = new Set(rows.map((c) => c.dir))
  let removed = 0

  let dirs: string[] = []
  try { dirs = await readdir(ctx.config.stagingDir) } catch { /* not made yet */ }
  for (const dir of dirs) {
    if (named.has(dir)) continue
    await rm(join(ctx.config.stagingDir, dir), { recursive: true, force: true }).catch(() => {})
    removed++
  }

  for (const collection of rows) {
    // Leftovers of a nested zip that was mid-unpack when the process went.
    const dest = join(ctx.config.stagingDir, collection.dir)
    for (const name of await readdir(dest).catch(() => [] as string[])) {
      if (name.startsWith('.nested-')) await rm(join(dest, name), { force: true }).catch(() => {})
    }
    const left = (await collectionFiles(ctx, collection)).length
    if (left === 0 && collection.waiting === 0 && collection.blocked === 0) {
      await discardCollection(ctx, collection.id)
      removed++
    } else if (left !== collection.fileCount) {
      setCollectionCount(ctx.db, collection.id, left)
    }
  }
  return removed
}
