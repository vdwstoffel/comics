import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server/index.js'

// buildServer resolves its data directory from DATA_DIR, defaulting to ./data - the
// real library. Point it at a temp directory so the suite never opens, migrates or
// writes to actual user data.
let dir: string, previous: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'health-'))
  previous = process.env.DATA_DIR
  process.env.DATA_DIR = dir
})

afterEach(() => {
  if (previous === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = previous
  rmSync(dir, { recursive: true, force: true })
})

test('GET /api/health returns ok', async () => {
  const app = await buildServer()
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ status: 'ok' })
  await app.close()
})

test('buildServer does not touch the real data directory', async () => {
  const app = await buildServer()
  expect(app.config.dataDir).toBe(dir)
  expect(app.config.dbPath.startsWith(dir)).toBe(true)
  await app.close()
})
