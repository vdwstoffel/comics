import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import scanRoutes from './routes/scan.js'
import seriesRoutes from './routes/series.js'
import booksRoutes from './routes/books.js'
import uploadRoutes from './routes/upload.js'
import comicvineRoutes from './routes/comicvine.js'
import comicIndexRoutes from './routes/comicIndex.js'
import { createScrapeRunner } from './services/comicIndexScraper.js'
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

  app.decorate('scraper', createScrapeRunner({ db, config }))

  app.get('/api/health', async () => ({ status: 'ok' }))

  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } })
  await app.register(scanRoutes)
  await app.register(seriesRoutes)
  await app.register(booksRoutes)
  await app.register(uploadRoutes)
  await app.register(comicvineRoutes)
  await app.register(comicIndexRoutes)

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
