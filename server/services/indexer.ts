import { readdirSync, statSync } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { join, relative, dirname, extname } from 'node:path'
import { listPages } from '../lib/cbz.js'
import { isCbr, convertCbrToCbz } from '../lib/cbr.js'
import { generateCover } from '../lib/thumbnails.js'
import { parseComicInfo } from '../lib/comicinfo.js'
import { upsertEdition } from '../models/editions.js'
import { insertBook, findBookByPath } from '../models/books.js'
import { replaceBookCredits, replaceBookTags } from '../models/metadata.js'
import yauzl from 'yauzl'
import type { Entry } from 'yauzl'
import type { Ctx, ComicMeta, Book } from '../types.js'

async function readComicInfo(cbzPath: string): Promise<ComicMeta | undefined> {
  return new Promise((resolve) => {
    yauzl.open(cbzPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return resolve(undefined)
      let found = false
      zip.on('entry', (entry: Entry) => {
        if (/(^|\/)ComicInfo\.xml$/i.test(entry.fileName)) {
          found = true
          zip.openReadStream(entry, async (e, s) => {
            if (e || !s) { zip.close(); return resolve(undefined) }
            const chunks: Buffer[] = []
            for await (const c of s) chunks.push(c as Buffer)
            zip.close()
            resolve(parseComicInfo(Buffer.concat(chunks).toString('utf8')))
          })
        } else {
          zip.readEntry()
        }
      })
      zip.on('end', () => { if (!found) resolve(undefined) })
      zip.on('error', () => resolve(undefined))
      zip.readEntry()
    })
  })
}

/** Walk rootDir recursively, returning all .cbz and .cbr files. */
export function walkComics(rootDir: string): string[] {
  const out: string[] = []
  const visit = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) visit(p)
      else if (/\.(cbz|cbr)$/i.test(name)) out.push(p)
    }
  }
  try { visit(rootDir) } catch { /* dir may not exist yet */ }
  return out
}

/** Generate a sibling .cbz path that doesn't collide with existing files. */
function dedupeCbzPath(cbrPath: string): string {
  const base = cbrPath.replace(/\.cbr$/i, '')
  let candidate = `${base}.cbz`
  let n = 1
  while (true) {
    try {
      statSync(candidate)
      // exists — try a numeric suffix
      candidate = `${base}-${n}.cbz`
      n++
    } catch {
      return candidate
    }
  }
}

export async function ingestFile(ctx: Ctx, absPath: string, editionName?: string): Promise<Book | undefined> {
  const { db, config } = ctx
  const relPath = relative(config.comicsDir, absPath)
  const pages = await listPages(absPath)
  const info: ComicMeta = (await readComicInfo(absPath)) || {}
  // The folder an edition owns is where its files actually are, not a guess from its
  // name. A path of `<series>/<edition>/file.cbz` yields both; a single level yields an
  // edition with no series, which is how a loose `Unsorted/` keeps working.
  const segments = relPath.split('/').slice(0, -1)
  const leaf = segments[segments.length - 1]
  const parent = segments.length >= 2 ? segments[segments.length - 2] : null
  const name = editionName || info.series || leaf || 'Unsorted'
  const folder = segments.join('/') || 'Unsorted'
  const edition = upsertEdition(db, { name, folder, seriesName: parent })
  const book = insertBook(db, {
    editionId: edition.id,
    filePath: relPath,
    title: info.title,
    number: info.number,
    pageCount: pages.length,
    fileSize: statSync(absPath).size,
    writer: info.writer,
    penciller: info.penciller,
    summary: info.summary,
    date: info.date,
  })
  if (!book) return book

  // A file that was embedded before carries its credits and tags; take them back so a
  // wipe-and-rescan does not quietly drop everything Comic Vine once supplied.
  const tags = [
    ...(info.characters ?? []).map((value) => ({ kind: 'character', value })),
    ...(info.teams ?? []).map((value) => ({ kind: 'team', value })),
    ...(info.storyArcs ?? []).map((value) => ({ kind: 'story_arc', value })),
  ]
  if (info.credits?.length || tags.length) {
    db.transaction(() => {
      replaceBookCredits(db, book.id, info.credits ?? [])
      replaceBookTags(db, book.id, tags)
    })()
  }

  await generateCover(absPath, join(config.thumbsDir, `${book.id}.webp`))
  return book
}

export async function scanLibrary(ctx: Ctx): Promise<{ added: number; total: number }> {
  const { db, config } = ctx
  const files = walkComics(config.comicsDir)
  let added = 0
  for (const abs of files) {
    if (isCbr(abs)) {
      // Convert .cbr → sibling .cbz, then ingest the .cbz
      const cbzPath = dedupeCbzPath(abs)
      const cbzRel = relative(config.comicsDir, cbzPath)
      // Skip if the target .cbz is already indexed
      if (findBookByPath(db, cbzRel)) continue
      try {
        await mkdir(dirname(cbzPath), { recursive: true })
        await convertCbrToCbz(abs, cbzPath)
        // Only delete the .cbr after the .cbz is fully written
        await unlink(abs).catch(() => {})
        await ingestFile(ctx, cbzPath)
        added++
      } catch {
        // If conversion failed, clean up partial output and skip
        await unlink(cbzPath).catch(() => {})
      }
    } else {
      const rel = relative(config.comicsDir, abs)
      if (findBookByPath(db, rel)) continue
      await ingestFile(ctx, abs)
      added++
    }
  }
  return { added, total: files.length }
}
