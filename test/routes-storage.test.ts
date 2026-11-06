import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import storageRoutes from '../server/routes/storage.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'st-'))
  const config = {
    dataDir: dir,
    comicsDir: join(dir, 'comics'),
    thumbsDir: join(dir, 'thumbnails'),
    tmpDir: join(dir, 'tmp'),
    dbPath: join(dir, 'library.sqlite'),
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  writeFileSync(join(config.comicsDir, 'throwaway-one.cbz'), Buffer.alloc(2048))

  app = Fastify()
  app.decorate('config', config)
  await app.register(storageRoutes)
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('GET /api/storage answers with the library by kind and the disk under it', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/storage' })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.comics).toBe(2048)
  expect(body.covers).toBe(0)
  expect(body.temp).toBe(0)
  expect(body.total).toBeGreaterThan(body.free)
})
