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
    // Set only by the exact string 'true': the form sends a typed id this way, and anything
    // looser would let a stray field file a reminder.
    let manual = false
    let tmpPath: string | undefined
    let originalName: string | undefined

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'edition') {
        editionName = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'issueId') {
        issueId = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'manual') {
        manual = String(part.value) === 'true'
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
      tmpPath, originalName, editionName, issueId, manual,
    })
    if (!result.ok) return reply.code(400).send({ error: result.error })
    if (result.metadataApplied === undefined) return { book: result.book }
    // A typo'd id is 200, not 404: the comic was stored, and a 404 would read as "nothing
    // happened" to a page that then offers the upload again and files a duplicate.
    return result.issueNotFound
      ? { book: result.book, metadataApplied: false, issueNotFound: true }
      : { book: result.book, metadataApplied: result.metadataApplied }
  })
}
