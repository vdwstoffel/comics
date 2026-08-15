import { readdirSync, statSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { listPages } from '../lib/cbz.js'
import { generateCover } from '../lib/thumbnails.js'
import { parseComicInfo } from '../lib/comicinfo.js'
import { upsertSeries } from '../models/series.js'
import { insertBook, findBookByPath } from '../models/books.js'
import yauzl from 'yauzl'

async function readComicInfo(cbzPath) {
  return new Promise((resolve) => {
    yauzl.open(cbzPath, { lazyEntries: true }, (err, zip) => {
      if (err) return resolve(undefined)
      let found = false
      zip.on('entry', (entry) => {
        if (/(^|\/)ComicInfo\.xml$/i.test(entry.fileName)) {
          found = true
          zip.openReadStream(entry, async (e, s) => {
            if (e) { zip.close(); return resolve(undefined) }
            const chunks = []
            for await (const c of s) chunks.push(c)
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

function walkCbz(rootDir) {
  const out = []
  const visit = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) visit(p)
      else if (/\.cbz$/i.test(name)) out.push(p)
    }
  }
  try { visit(rootDir) } catch { /* dir may not exist yet */ }
  return out
}

export async function ingestFile(ctx, absPath, seriesName) {
  const { db, config } = ctx
  const relPath = relative(config.comicsDir, absPath)
  const pages = await listPages(absPath)
  const info = (await readComicInfo(absPath)) || {}
  const name = seriesName || info.series || basename(dirname(absPath))
  const series = upsertSeries(db, { name, folder: name })
  const book = insertBook(db, {
    seriesId: series.id,
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
  await generateCover(absPath, join(config.thumbsDir, `${book.id}.webp`))
  return book
}

export async function scanLibrary(ctx) {
  const { db, config } = ctx
  const files = walkCbz(config.comicsDir)
  let added = 0
  for (const abs of files) {
    const rel = relative(config.comicsDir, abs)
    if (findBookByPath(db, rel)) continue
    await ingestFile(ctx, abs)
    added++
  }
  return { added, total: files.length }
}
