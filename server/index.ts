import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import scanRoutes from './routes/scan.js'
import editionRoutes from './routes/editions.js'
import seriesRoutes from './routes/series.js'
import booksRoutes from './routes/books.js'
import uploadRoutes from './routes/upload.js'
import comicvineRoutes from './routes/comicvine.js'
import arcRoutes from './routes/arcs.js'
import comicIndexRoutes from './routes/comicIndex.js'
import downloadRoutes from './routes/downloads.js'
import libraryRoutes from './routes/library.js'
import releaseRoutes from './routes/releases.js'
import runningRoutes from './routes/running.js'
import settingsRoutes from './routes/settings.js'
import { clearTmpDir } from './lib/tmpFiles.js'
import { createDownloadRunner } from './services/downloader.js'
import { createScrapeRunner } from './services/comicIndexScraper.js'
import { backfillSeriesNames } from './models/series.js'
import { recoverRunning } from './models/downloadQueue.js'
import type { App } from './types.js'

export function registerSpa(app: App, _distDir: string): void {
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url && req.raw.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' })
    return reply.type('text/html').sendFile('index.html')
  })
}

export async function buildServer(): Promise<App> {
  const config = loadConfig()
  const app = Fastify({ logger: false })
  app.decorate('config', config)

  const db = openDb(config.dbPath)
  app.decorate('db', db)
  app.addHook('onClose', async () => db.close())

  // One-off for editions that predate series_name; only fills rows that have none.
  const named = backfillSeriesNames(db)
  if (named) console.log(`assigned a series to ${named} editions`)

  // A run that died mid-upload or mid-download left its staging file behind. Nothing has
  // been accepted yet, so anything in tmp belongs to a run that is already over.
  const swept = await clearTmpDir(config.tmpDir)
  if (swept) console.log(`cleared ${swept} leftover file${swept === 1 ? '' : 's'} from tmp`)

  app.decorate('scraper', createScrapeRunner({ db, config }))

  // A row still marked running belongs to a process that is gone. Its staging file went
  // with the tmp sweep above; the row goes back to the front of the queue.
  const requeued = recoverRunning(db)
  if (requeued) console.log(`requeued ${requeued} interrupted download${requeued === 1 ? '' : 's'}`)
  app.decorate('downloader', createDownloadRunner({ db, config }))

  app.get('/api/health', async () => ({ status: 'ok' }))

  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } })
  await app.register(scanRoutes)
  await app.register(editionRoutes)
  await app.register(seriesRoutes)
  await app.register(booksRoutes)
  await app.register(uploadRoutes)
  await app.register(comicvineRoutes)
  await app.register(arcRoutes)
  await app.register(comicIndexRoutes)
  await app.register(libraryRoutes)
  await app.register(downloadRoutes)
  await app.register(releaseRoutes)
  await app.register(runningRoutes)
  await app.register(settingsRoutes)

  const distDir = join(process.cwd(), 'dist')
  if (existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir })
    registerSpa(app, distDir)
  }

  return app
}

// Only listen when run directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ port: app.config.port, host: '0.0.0.0' })
  console.log(`comic-app listening on :${app.config.port}`)
}
