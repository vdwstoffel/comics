import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { storeReplacing } from '../services/storeReplacing.js'
import { openDelivery } from '../services/collections.js'
import type { Delivery } from '../services/collections.js'
import type { App } from '../types.js'

export default async function uploadRoutes(app: App) {
  app.post('/api/upload', async (req, reply) => {
    const parts = req.parts()
    let editionName: string | undefined
    let issueId: string | undefined
    // Set only by the exact string 'true': the form sends a typed id this way, and anything
    // looser would let a stray field file a reminder.
    let manual = false
    // Supplied together or not at all - see StoreComicInput. They skip a naming lookup.
    let volumeName: string | undefined
    let issueNumber: string | undefined
    // The comic this upload takes the place of, which is DELETED once the new one has
    // safely landed. See the sequence below; the ordering is the whole safety property.
    let replaceBookId: string | undefined
    let tmpPath: string | undefined
    let originalName: string | undefined

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'edition') {
        editionName = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'issueId') {
        issueId = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'manual') {
        manual = String(part.value) === 'true'
      } else if (part.type === 'field' && part.fieldname === 'volumeName') {
        volumeName = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'issueNumber') {
        issueNumber = String(part.value)
      } else if (part.type === 'field' && part.fieldname === 'replaceBookId') {
        replaceBookId = String(part.value)
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

    // Digits only, no leading zero, same rule as /api/books/:id/comicvine - Number('1e3')
    // and Number('0x10') would otherwise sail through and delete a different comic than
    // the one that was named. Validated BEFORE the store, so a malformed id costs nothing.
    let replaceId: number | undefined
    if (replaceBookId != null && replaceBookId !== '') {
      if (!/^[1-9]\d*$/.test(replaceBookId)) {
        await unlink(tmpPath).catch(() => {})
        return reply.code(400).send({ error: 'replaceBookId must be a positive integer' })
      }
      replaceId = Number(replaceBookId)
    }

    // A zip is opened before anything is stored: it may be one comic in a wrapper, or a
    // whole collection that has to wait for review instead.
    const ctx = { db: app.db, config: app.config }
    const label = originalName.replace(/\.[^.]+$/, '')
    let delivery: Delivery
    try {
      delivery = await openDelivery(ctx, { tmpPath, name: originalName, label })
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'that zip could not be unpacked' })
    }
    if (delivery.kind === 'empty') return reply.code(400).send({ error: 'that zip holds no comics' })
    if (delivery.kind === 'collection') {
      // Not stored, and not an error: the comics are waiting for someone to check them.
      // A replaceBookId means nothing here - nothing was stored to take that comic's place.
      const { id, label: name, fileCount } = delivery.collection
      return { collection: { id, label: name, fileCount } }
    }

    const result = await storeReplacing(ctx, {
      tmpPath: delivery.tmpPath, originalName: delivery.name,
      editionName, issueId, manual, volumeName, issueNumber, replaceId,
    }, (message, detail) => app.log.warn(detail, message))
    if (!result.ok) return reply.code(400).send({ error: result.error })
    return result.answer
  })
}
