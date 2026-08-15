import Fastify from 'fastify'
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import scanRoutes from './routes/scan.js'

export async function buildServer() {
  const config = loadConfig()
  const app = Fastify({ logger: false })
  app.decorate('config', config)

  const db = openDb(config.dbPath)
  app.decorate('db', db)
  app.addHook('onClose', async () => db.close())

  app.get('/api/health', async () => ({ status: 'ok' }))

  await app.register(scanRoutes)

  return app
}

// Only listen when run directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ port: app.config.port, host: '0.0.0.0' })
  console.log(`comic-app listening on :${app.config.port}`)
}
