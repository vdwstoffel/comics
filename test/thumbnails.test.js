import { test, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { generateCover } from '../server/lib/thumbnails.js'
import { makeCbz } from './helpers/makeCbz.js'

let dir
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'thumb-')) })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('generateCover writes a webp of the requested width', async () => {
  const cbz = await makeCbz(dir, ['a.png', 'b.png'])
  const out = join(dir, 'cover.webp')
  await generateCover(cbz, out, 200)
  expect(existsSync(out)).toBe(true)
  const meta = await sharp(out).metadata()
  expect(meta.format).toBe('webp')
  expect(meta.width).toBe(200)
})
