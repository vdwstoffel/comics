import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getCollection, waitingParts } from '../models/collections.js'
import {
  openDelivery, addToCollection, collectionFiles, discardCollection, fileFromCollection, createPartsCollection,
} from '../services/collections.js'
import { resolveDownload } from '../services/downloader.js'
import { parsePostDownloads } from '../lib/comicPostPage.js'
import type { PostPart } from '../lib/comicPostPage.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { App } from '../types.js'

export interface CollectionRouteOpts {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
  fetchImpl?: typeof fetch
}

interface IdParams { id: string }
interface LinkBody { url?: string }
interface DownloadBody { label?: string; postUrl?: string; parts?: Array<{ heading?: string; url?: string }> }
interface FileBody {
  file?: string
  edition?: string
  issueId?: number | string
  volumeName?: string
  issueNumber?: string
  replaceBookId?: number | string
}

/** Digits only, no leading zero - the rule the upload route holds replaceBookId to. */
const POSITIVE_ID = /^[1-9]\d*$/

/**
 * A getcomics post, as opposed to the /dls/ link one of its buttons points at.
 *
 * Only this site's posts are read for their parts: the layout is its own, and confining
 * the read to it keeps this from fetching and parsing any page a person pastes.
 */
export function isPostPage(url: string): boolean {
  try {
    const { hostname, pathname, protocol } = new URL(url)
    return (protocol === 'https:' || protocol === 'http:')
      && /(^|\.)getcomics\.org$/i.test(hostname)
      && pathname !== '/' && !pathname.startsWith('/dls/')
  } catch {
    return false
  }
}

export default async function collectionRoutes(app: App, opts: CollectionRouteOpts = {}) {
  const { fetchPage = fetchSourcePage, fetchImpl = fetch } = opts
  const ctx = { db: app.db, config: app.config }

  /**
   * What a pasted link would download, before anything is queued.
   *
   * A post is read for every part it offers, so a run split across zips is shown whole
   * and you choose what to take. Any other link is one download: it is asked for its name
   * the way the single upload page asks, and offered as a single part.
   */
  app.post<{ Body: LinkBody }>('/api/collections/link', async (req, reply) => {
    const url = req.body?.url?.trim()
    if (!url) return reply.code(400).send({ error: 'missing url' })

    if (isPostPage(url)) {
      let html: string
      try {
        html = await fetchPage(url)
      } catch (err) {
        return reply.code(502).send({ error: `could not read that post: ${err instanceof Error ? err.message : String(err)}` })
      }
      const post = parsePostDownloads(html, url)
      if (post.parts.length === 0) return reply.code(404).send({ error: 'that post has no direct download link' })
      return { postUrl: url, ...post }
    }

    try {
      const { fileName, size } = await resolveDownload(url, fetchImpl)
      const name = fileName?.replace(/\.[^.]+$/, '') ?? null
      const part: PostPart = { heading: name ?? url, url, ...(size ? { size: `${(size / 1_000_000).toFixed(0)} MB` } : {}) }
      return { title: name, parts: [part] }
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'could not read that link' })
    }
  })

  /**
   * Queue the parts you chose, all into one new collection, so the run is reviewed in one
   * table once the last of them lands.
   */
  app.post<{ Body: DownloadBody }>('/api/collections/download', async (req, reply) => {
    const parts = (req.body?.parts ?? []).filter((p): p is { heading?: string; url: string } =>
      typeof p?.url === 'string' && p.url.trim() !== '')
    if (parts.length === 0) return reply.code(400).send({ error: 'no parts to download' })
    const label = req.body?.label?.trim() || parts[0]!.heading?.trim() || parts[0]!.url
    const postUrl = req.body?.postUrl?.trim() || undefined

    const collection = await createPartsCollection(ctx, label, parts.length)
    for (const part of parts) {
      app.downloader.enqueue({
        url: part.url.trim(), label: part.heading?.trim() || label, postUrl, collectionId: collection.id,
      })
    }
    return reply.code(202).send({ collection: { id: collection.id, label: collection.label, parts: collection.parts } })
  })

  // One collection, with the comics still in it - what the bulk page builds its table from.
  app.get<{ Params: IdParams }>('/api/collections/:id', async (req, reply) => {
    const collection = getCollection(app.db, Number(req.params.id))
    if (!collection) return reply.code(404).send({ error: 'no such collection' })
    const { id, label, parts, waiting, blocked } = collection
    return { id, label, parts, waiting, blocked, files: await collectionFiles(ctx, collection) }
  })

  /**
   * A zip from your own disk, unpacked for review.
   *
   * Its own route rather than /api/upload, which unwraps a zip of one comic and stores it
   * straight away. Here even one comic is held: the page that sends a zip has a table to
   * show it in, and is about to ask which volume it belongs to.
   */
  app.post('/api/collections', async (req, reply) => {
    let tmpPath: string | undefined
    let originalName: string | undefined
    // Set when the zip is a part of a collection already waiting - the one a bot check
    // stopped, handed back by hand - so it joins the others instead of starting its own.
    let intoId: number | undefined
    // A run in a zip can be ten gigabytes, which the per-comic upload limit would refuse.
    // The same ceiling a download has, since this is a download done by hand.
    for await (const part of req.parts({ limits: { fileSize: app.config.maxDownloadBytes } })) {
      if (part.type === 'field' && part.fieldname === 'collectionId') {
        const raw = String(part.value)
        if (POSITIVE_ID.test(raw)) intoId = Number(raw)
        continue
      }
      if (part.type !== 'file' || part.fieldname !== 'file') continue
      originalName = basename(part.filename)
      const isRar = extname(originalName).toLowerCase() === '.cbr'
      tmpPath = join(app.config.tmpDir, `${randomUUID()}${isRar ? '.cbr' : '.zip'}`)
      await pipeline(part.file, createWriteStream(tmpPath))
      if (part.file.truncated) {
        await unlink(tmpPath).catch(() => {})
        return reply.code(413).send({ error: 'file too large' })
      }
    }
    if (!tmpPath || !originalName) return reply.code(400).send({ error: 'no file part' })

    const label = originalName.replace(/\.[^.]+$/, '')
    try {
      if (intoId != null) {
        const id = await addToCollection(ctx, intoId, { tmpPath, name: originalName, label })
        const { label: name, fileCount } = getCollection(app.db, id)!
        return { collection: { id, label: name, fileCount } }
      }
      const delivery = await openDelivery(ctx, { tmpPath, name: originalName, label, collect: true })
      if (delivery.kind !== 'collection') return reply.code(400).send({ error: 'that zip holds no comics' })
      const { id, fileCount } = delivery.collection
      return { collection: { id, label: delivery.collection.label, fileCount } }
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'that zip could not be unpacked' })
    }
  })

  /**
   * File one comic out of a collection. The same fields an upload carries, naming a file
   * in the collection instead of sending one, and answered the way an upload is.
   */
  app.post<{ Params: IdParams; Body: FileBody }>('/api/collections/:id/file', async (req, reply) => {
    const fileName = req.body?.file
    if (!fileName) return reply.code(400).send({ error: 'missing file' })

    let replaceId: number | undefined
    const replace = req.body?.replaceBookId
    if (replace != null && replace !== '') {
      if (!POSITIVE_ID.test(String(replace))) {
        return reply.code(400).send({ error: 'replaceBookId must be a positive integer' })
      }
      replaceId = Number(replace)
    }
    const issueId = req.body?.issueId
    const result = await fileFromCollection(ctx, Number(req.params.id), fileName, {
      editionName: req.body?.edition?.trim() || undefined,
      issueId: issueId == null || issueId === '' ? undefined : String(issueId),
      volumeName: req.body?.volumeName || undefined,
      issueNumber: req.body?.issueNumber || undefined,
      replaceId,
    }, (message, detail) => app.log.warn(detail, message))

    if ('notFound' in result) return reply.code(404).send({ error: 'that comic is not in the collection' })
    if (!result.ok) return reply.code(400).send({ error: result.error, remaining: result.remaining })
    return { ...result.answer, remaining: result.remaining }
  })

  app.delete<{ Params: IdParams }>('/api/collections/:id', async (req, reply) => {
    const id = Number(req.params.id)
    // Parts still on their way are stopped first. Left running, each would land to find
    // its collection gone and start a new one of its own.
    for (const rowId of waitingParts(app.db, id)) app.downloader.cancel(rowId)
    if (!(await discardCollection(ctx, id))) {
      return reply.code(404).send({ error: 'no such collection' })
    }
    return { discarded: true }
  })
}
