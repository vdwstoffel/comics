/**
 * Tests for server/lib/cbr.ts
 *
 * NOTE: No real .rar file ships with node-unrar-js, so the end-to-end test
 * using node-unrar-js directly is skipped. All functional tests use the
 * injected `opts.extract` path instead.
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { isCbr, convertCbrToCbz } from '../server/lib/cbr.js'
import { listPages, readPage } from '../server/lib/cbz.js'

let dir: string
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'cbr-')) })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function tinyPng(color: { r: number; g: number; b: number }): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: color },
  }).png().toBuffer()
  return new Uint8Array(buf)
}

test('isCbr detects .cbr extension case-insensitively', () => {
  expect(isCbr('/some/path/Comic.cbr')).toBe(true)
  expect(isCbr('/some/path/Comic.CBR')).toBe(true)
  expect(isCbr('/some/path/Comic.cbz')).toBe(false)
  expect(isCbr('/some/path/Comic.zip')).toBe(false)
})

test('convertCbrToCbz: images are natural-sorted and ComicInfo.xml is preserved', async () => {
  // Create tiny PNGs named out-of-natural order
  const p10 = await tinyPng({ r: 200, g: 0, b: 0 })
  const p2  = await tinyPng({ r: 100, g: 0, b: 0 })
  const p1  = await tinyPng({ r:  50, g: 0, b: 0 })
  const comicInfoXml = new TextEncoder().encode('<ComicInfo />')

  // Injected extractor returns entries in the "wrong" order — conversion must sort them
  const fakeEntries = [
    { name: 'p10.png', data: p10 },
    { name: 'ComicInfo.xml', data: comicInfoXml },
    { name: 'p2.png',  data: p2  },
    { name: 'p1.png',  data: p1  },
  ]

  // Write a dummy file at the cbrPath (the function reads it, but our injected
  // extractor ignores the bytes, so any non-empty file works)
  const cbrPath = join(dir, 'fake.cbr')
  writeFileSync(cbrPath, Buffer.from('dummy'))

  const cbzPath = join(dir, 'output.cbz')
  await convertCbrToCbz(cbrPath, cbzPath, {
    extract: async () => fakeEntries,
  })

  // Verify natural-sorted image order
  const pages = await listPages(cbzPath)
  expect(pages).toEqual(['p1.png', 'p2.png', 'p10.png'])

  // Verify each page has PNG magic bytes
  for (let i = 0; i < pages.length; i++) {
    const { stream } = await readPage(cbzPath, i)
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(c as Buffer)
    const buf = Buffer.concat(chunks)
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  }
})

test('convertCbrToCbz: throws when no image entries', async () => {
  const cbrPath = join(dir, 'empty.cbr')
  writeFileSync(cbrPath, Buffer.from('dummy'))
  const cbzPath = join(dir, 'empty-out.cbz')

  await expect(
    convertCbrToCbz(cbrPath, cbzPath, {
      extract: async () => [{ name: 'readme.txt', data: new Uint8Array([1, 2, 3]) }],
    }),
  ).rejects.toThrow(/no image entries/)
})
