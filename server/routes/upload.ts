import { createWriteStream } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { listPages } from '../lib/cbz.js'
import { isCbr, convertCbrToCbz } from '../lib/cbr.js'
import { ingestFile } from '../services/indexer.js'
import { sanitizeSeriesFolder } from '../lib/paths.js'
import type { App } from '../types.js'

export default async function uploadRoutes(app: App) {
  app.post('/api/upload', async (req, reply) => {
    const parts = req.parts()
    let seriesName: string | undefined
    let tmpPath: string | undefined
    let originalName: string | undefined

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'series') {
        seriesName = String(part.value)
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

    const finalSeries = sanitizeSeriesFolder(seriesName || 'Unsorted')
    const destDir = join(app.config.comicsDir, finalSeries)
    await mkdir(destDir, { recursive: true })
    const destPath = join(destDir, originalName)
    await rename(cbzTmpPath, destPath)

    const book = await ingestFile({ db: app.db, config: app.config }, destPath, finalSeries)
    return { book }
  })
}
