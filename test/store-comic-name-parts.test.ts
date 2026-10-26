import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { openDb } from '../server/db.js'
import uploadRoutes from '../server/routes/upload.js'
import { setComicVineKey } from '../server/models/settings.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

const ISSUE = {
  id: 1001, name: 'Infinity', issue_number: '20', cover_date: '2013-08-01',
  description: null, volume: { id: 42, name: 'Avengers' },
}
const VOLUME = { id: 42, name: 'Avengers', start_year: '2013', publisher: { name: 'Marvel' } }

let dir: string, srcDir: string, app: FastifyInstance, origFetch: typeof fetch
let issueCalls: number, volumeCalls: number

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nameparts-'))
  srcDir = mkdtempSync(join(tmpdir(), 'src-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'),
    tmpDir: join(dir, 'tmp'), maxUploadBytes: 5 * 1024 * 1024,
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })

  issueCalls = 0
  volumeCalls = 0
  origFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    const u = String(url)
    if (u.includes('/issue/')) issueCalls++
    if (u.includes('/volume/')) volumeCalls++
    return {
      ok: true,
      json: async () => ({ status_code: 1, results: u.includes('/volume/') ? VOLUME : ISSUE }),
    }
  }) as unknown as typeof fetch

  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  setComicVineKey(app.db, 'k')
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } })
  await app.register(uploadRoutes)
})

afterEach(async () => {
  globalThis.fetch = origFetch
  await app.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})

async function upload(fields: Record<string, string>, fileName = 'Avengers 020 (2013) (Digital).cbz') {
  const cbz = await makeCbz(srcDir, ['p1.png'], fileName)
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  form.set('file', new Blob([readFileSync(cbz)]), fileName)
  return app.inject({ method: 'POST', url: '/api/upload', payload: form })
}

// The whole point of the change: applying the issue still needs its own record, but the
// naming lookup is pure waste when the caller already knows both halves of the name.
test('with volumeName and issueNumber, storing makes no Comic Vine call for the name', async () => {
  const res = await upload({
    edition: 'Avengers (2013)', issueId: '1001', volumeName: 'Avengers', issueNumber: '20',
  })
  expect(res.statusCode).toBe(200)
  expect(issueCalls).toBe(1)
})

test('without them, the naming lookup still runs - the existing path is unchanged', async () => {
  const res = await upload({ edition: 'Avengers (2013)', issueId: '1001' })
  expect(res.statusCode).toBe(200)
  expect(issueCalls).toBe(2)
})

test('the file name produced is identical to the one the lookup would have produced', async () => {
  await upload({ edition: 'Avengers (2013)', issueId: '1001' }, 'looked-up.cbz')
  const viaLookup = readdirSync(join(app.config.comicsDir, 'Avengers', 'Avengers (2013)'))

  rmSync(join(app.config.comicsDir), { recursive: true, force: true })
  app.db.prepare('DELETE FROM book').run()
  app.db.prepare('DELETE FROM edition').run()

  await upload({
    edition: 'Avengers (2013)', issueId: '1001', volumeName: 'Avengers', issueNumber: '20',
  }, 'supplied.cbz')
  const viaSupplied = readdirSync(join(app.config.comicsDir, 'Avengers', 'Avengers (2013)'))

  expect(viaSupplied).toEqual(viaLookup)
  expect(viaSupplied).toEqual(['avengers_0020.cbz'])
})

// volumeName now comes from a client. comicFileName runs its series through slug(),
// which is the guard - this asserts nothing can bypass it into a path.
test('a client-supplied volume name cannot escape the edition folder', async () => {
  const res = await upload({
    edition: 'Avengers (2013)', issueId: '1001',
    volumeName: '../../../../etc/passwd', issueNumber: '20',
  })
  expect(res.statusCode).toBe(200)
  const { book } = res.json()
  expect(book.filePath.startsWith('Avengers/Avengers (2013)/')).toBe(true)
  expect(book.filePath).not.toContain('..')
  expect(existsSync(join(app.config.comicsDir, 'Avengers', 'Avengers (2013)', 'etc_passwd_0020.cbz'))).toBe(true)
})

// Task 5 renames onto this once the comic it replaces is gone.
test('wantedName reports the pre-dedupe name when the destination was taken', async () => {
  const first = await upload({
    edition: 'Avengers (2013)', issueId: '1001', volumeName: 'Avengers', issueNumber: '20',
  }, 'one.cbz')
  expect(first.json().wantedName).toBe('avengers_0020.cbz')

  const second = await upload({
    edition: 'Avengers (2013)', issueId: '1001', volumeName: 'Avengers', issueNumber: '20',
  }, 'two.cbz')
  expect(second.json().wantedName).toBe('avengers_0020.cbz')
  expect(second.json().book.filePath).toContain('avengers_0020 (2).cbz')
})
