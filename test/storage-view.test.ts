import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../server/services/storage.js'
import type { Config } from '../server/config.js'

let dir: string, config: Config

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'storage-'))
  config = {
    dataDir: dir,
    comicsDir: join(dir, 'comics'),
    thumbsDir: join(dir, 'thumbnails'),
    tmpDir: join(dir, 'tmp'),
    dbPath: join(dir, 'library.sqlite'),
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('each kind of file is weighed on its own', async () => {
  writeFileSync(join(config.comicsDir, 'throwaway-one.cbz'), Buffer.alloc(4000))
  writeFileSync(join(config.thumbsDir, 'throwaway-one.jpg'), Buffer.alloc(300))
  writeFileSync(config.dbPath, Buffer.alloc(900))
  writeFileSync(join(config.tmpDir, 'throwaway-part'), Buffer.alloc(50))

  const view = await createStorage(config).read()

  expect(view.comics).toBe(4000)
  expect(view.covers).toBe(300)
  expect(view.database).toBe(900)
  expect(view.temp).toBe(50)
})

// The write-ahead log is a real part of what sqlite is occupying - 15 MB of it here -
// and reporting the .sqlite file alone would understate the database by most of itself.
test("sqlite's side files count towards the database", async () => {
  writeFileSync(config.dbPath, Buffer.alloc(900))
  writeFileSync(`${config.dbPath}-wal`, Buffer.alloc(600))
  writeFileSync(`${config.dbPath}-shm`, Buffer.alloc(32))

  expect((await createStorage(config).read()).database).toBe(1532)
})

test('the disk it all sits on is reported whole, with the room left on it', async () => {
  const view = await createStorage(config).read()

  expect(view.total).toBeGreaterThan(0)
  expect(view.free).toBeGreaterThan(0)
  expect(view.free).toBeLessThanOrEqual(view.total)
})

// Walking the comics folder costs a stat per file, and the pane re-asks on every visit.
test('a second look inside the window reuses the first walk', async () => {
  const storage = createStorage(config)
  writeFileSync(join(config.comicsDir, 'throwaway-one.cbz'), Buffer.alloc(4000))
  expect((await storage.read()).comics).toBe(4000)

  writeFileSync(join(config.comicsDir, 'throwaway-two.cbz'), Buffer.alloc(1000))
  expect((await storage.read()).comics).toBe(4000)
})

test('past the window the walk happens again', async () => {
  const storage = createStorage(config, { ttlMs: 0 })
  writeFileSync(join(config.comicsDir, 'throwaway-one.cbz'), Buffer.alloc(4000))
  expect((await storage.read()).comics).toBe(4000)

  writeFileSync(join(config.comicsDir, 'throwaway-two.cbz'), Buffer.alloc(1000))
  expect((await storage.read()).comics).toBe(5000)
})
