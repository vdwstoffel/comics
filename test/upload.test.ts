import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { openDb } from '../server/db.js'
import uploadRoutes from '../server/routes/upload.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

let dir: string, app: FastifyInstance
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'up-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'),
    tmpDir: join(dir, 'tmp'), maxUploadBytes: 5 * 1024 * 1024,
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } })
  await app.register(uploadRoutes)
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

test('uploading a cbz ingests it into the given series', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'src-'))
  const cbz = await makeCbz(srcDir, ['p1.png', 'p2.png', 'p3.png'], 'Issue 1.cbz')

  const form = new FormData()
  form.set('series', 'Spider-Man')
  form.set('file', new Blob([readFileSync(cbz)]), 'Issue 1.cbz')

  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: form })
  expect(res.statusCode).toBe(200)
  const { book } = res.json()
  expect(book.pageCount).toBe(3)

  const series = app.db.prepare('SELECT * FROM series').get() as { name: string }
  expect(series.name).toBe('Spider-Man')
  expect(existsSync(join(app.config.comicsDir, 'Spider-Man', 'Issue 1.cbz'))).toBe(true)
  rmSync(srcDir, { recursive: true, force: true })
})

test('rejecting a non-cbz upload', async () => {
  const form = new FormData()
  form.set('file', new Blob([Buffer.from('not a zip')]), 'bad.cbz')
  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: form })
  expect(res.statusCode).toBe(400)
})

test('path traversal in series field is neutralised', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'src-'))
  const cbz = await makeCbz(srcDir, ['p1.png'], 'evil.cbz')

  const form = new FormData()
  form.set('series', '../../evil')
  form.set('file', new Blob([readFileSync(cbz)]), 'evil.cbz')

  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: form })
  expect(res.statusCode).toBe(200)

  const { book } = res.json()
  // book.filePath is relative to comicsDir; reconstruct absolute path
  const absFilePath = join(app.config.comicsDir, book.filePath)
  // The file must exist inside comicsDir
  expect(absFilePath.startsWith(app.config.comicsDir)).toBe(true)
  expect(existsSync(absFilePath)).toBe(true)
  // No file should exist at the traversal target (two levels above comicsDir)
  const escapedPath = join(app.config.comicsDir, '..', '..', 'evil', 'evil.cbz')
  expect(existsSync(escapedPath)).toBe(false)

  rmSync(srcDir, { recursive: true, force: true })
})
