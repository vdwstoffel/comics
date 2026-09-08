import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { storeComic } from '../services/storeComic.js'
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

    const result = await storeComic({ db: app.db, config: app.config }, {
      tmpPath, originalName, editionName, issueId,
    })
    if (!result.ok) return reply.code(400).send({ error: result.error })
    return result.metadataApplied === undefined
      ? { book: result.book }
      : { book: result.book, metadataApplied: result.metadataApplied }
  })
}
