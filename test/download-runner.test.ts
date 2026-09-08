import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { createDownloadRunner } from '../server/services/downloader.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx, cbzBytes: Uint8Array
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dl-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'), tmpDir: join(dir, 'tmp'),
    maxUploadBytes: 5 * 1024 * 1024, comicVineApiKey: '',
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  ctx = { db: openDb(':memory:'), config }
  const src = mkdtempSync(join(tmpdir(), 'src-'))
  cbzBytes = new Uint8Array(readFileSync(await makeCbz(src, ['p1.png', 'p2.png'], 'x.cbz')))
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

/** A Response whose `url` is the one a redirect would have landed on. */
function respond(body: Uint8Array | string | null, { url, status = 200, headers = {} }: { url: string; status?: number; headers?: Record<string, string> }) {
  const res = new Response(body as BodyInit, { status, headers })
  Object.defineProperty(res, 'url', { value: url })
  return res
}

const REDIRECTED = 'https://fs3.example/2026.07.08/Amazing%20Spider-Man%20031%20%282026%29%20%28Digital%29.cbz'
const OPAQUE = 'https://getcomics.example/dls/VihnoomBUb2Wfcz/NL3vKE94d8fp9SpeGrSONTXkKs7'

test('a download lands in the library and reports the book it became', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })

  const { started, done } = runner.start({ url: OPAQUE, edition: 'Amazing Spider-Man (2025)' })
  expect(started).toBe(true)
  await done

  const status = runner.status()
  expect(status.running).toBe(false)
  expect(status.error).toBeNull()
  expect(status.bookId).toBeGreaterThan(0)
  expect(status.fileName).toBe('Amazing Spider-Man 031 (2026) (Digital).cbz')
})

// The pasted link says nothing; the name has to come from where it lands.
test('the stored file is named from the redirect target, not the pasted link', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })
  await runner.start({ url: OPAQUE, edition: 'ASM' }).done

  const files = readdirSync(join(dir, 'comics', 'ASM'))
  expect(files).toEqual(['Amazing Spider-Man 031 (2026) (Digital).cbz'])
})

test('progress counts the bytes as they arrive', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => respond(cbzBytes, {
      url: REDIRECTED, headers: { 'content-length': String(cbzBytes.length) },
    }),
  })

  await runner.start({ url: OPAQUE, edition: 'ASM' }).done

  expect(runner.status().received).toBe(cbzBytes.length)
  expect(runner.status().total).toBe(cbzBytes.length)
})

test('only one download runs at a time', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: REDIRECTED }) })

  const first = runner.start({ url: OPAQUE, edition: 'ASM' })
  const second = runner.start({ url: OPAQUE, edition: 'ASM' })

  expect(second.started).toBe(false)
  await first.done
})

test('a url that is not http is refused before anything is fetched', async () => {
  let called = false
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => { called = true; return respond(null, { url: '' }) } })

  await runner.start({ url: 'file:///etc/passwd', edition: 'ASM' }).done

  expect(called).toBe(false)
  expect(runner.status().error).toMatch(/http/i)
  expect(runner.status().bookId).toBeNull()
})

// Content-Length is the server's claim, not a fact. The cap has to hold against a lie.
test('a body larger than the cap is abandoned mid-stream', async () => {
  const big = new Uint8Array(4096).fill(1)
  const runner = createDownloadRunner(ctx, {
    maxBytes: 1024,
    fetchImpl: async () => respond(big, { url: REDIRECTED, headers: { 'content-length': '10' } }),
  })

  await runner.start({ url: OPAQUE, edition: 'ASM' }).done

  expect(runner.status().error).toMatch(/too large/i)
  expect(runner.status().bookId).toBeNull()
  // Nothing half-written is left lying in tmp.
  expect(readdirSync(join(dir, 'tmp'))).toEqual([])
})

test('a failed request is reported, not swallowed', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => respond(null, { url: OPAQUE, status: 404 }),
  })

  await runner.start({ url: OPAQUE, edition: 'ASM' }).done

  expect(runner.status().error).toMatch(/404/)
  expect(runner.status().bookId).toBeNull()
})

// An HTML error page saved under a .cbz name is the classic way rubbish enters a library.
test('something that is not a comic never becomes one', async () => {
  const runner = createDownloadRunner(ctx, {
    fetchImpl: async () => respond('<html>Not found</html>', { url: REDIRECTED }),
  })

  await runner.start({ url: OPAQUE, edition: 'ASM' }).done

  expect(runner.status().error).toMatch(/not a valid/i)
  expect(runner.status().bookId).toBeNull()
  expect(existsSync(join(dir, 'comics', 'ASM'))).toBe(false)
})

test('a link that reveals no name still downloads, under a name of our own', async () => {
  const runner = createDownloadRunner(ctx, { fetchImpl: async () => respond(cbzBytes, { url: OPAQUE }) })

  await runner.start({ url: OPAQUE, edition: 'ASM' }).done

  expect(runner.status().error).toBeNull()
  expect(runner.status().bookId).toBeGreaterThan(0)
  expect(readdirSync(join(dir, 'comics', 'ASM'))[0]).toMatch(/\.cbz$/)
})
