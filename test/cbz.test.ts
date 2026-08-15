import { test, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { naturalCompare } from '../server/lib/naturalSort.js'
import { listPages, readPage } from '../server/lib/cbz.js'
import { makeCbz } from './helpers/makeCbz.js'

let dir: string
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'cbz-')) })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('naturalCompare orders numbers like a human', () => {
  const arr = ['p10.jpg', 'p2.jpg', 'p1.jpg'].sort(naturalCompare)
  expect(arr).toEqual(['p1.jpg', 'p2.jpg', 'p10.jpg'])
})

test('listPages returns only images, natural-sorted, ignoring ComicInfo.xml', async () => {
  const cbz = await makeCbz(dir, ['p2.png', 'p10.png', 'p1.png', 'ComicInfo.xml'])
  const pages = await listPages(cbz)
  expect(pages).toEqual(['p1.png', 'p2.png', 'p10.png'])
})

test('readPage streams the requested page bytes', async () => {
  const cbz = await makeCbz(dir, ['p1.png', 'p2.png'], 'two.cbz')
  const { stream, entryName } = await readPage(cbz, 1)
  expect(entryName).toBe('p2.png')
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  const buf = Buffer.concat(chunks)
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
})
