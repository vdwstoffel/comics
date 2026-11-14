import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { surveyZip, unpackComics } from '../server/lib/zipPack.js'
import { listPages } from '../server/lib/cbz.js'
import { makeCbz } from './helpers/makeCbz.js'
import { makeZip } from './helpers/makeZip.js'

let dir: string, src: string, dest: string, cbz: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zp-'))
  src = join(dir, 'src'); dest = join(dir, 'dest')
  mkdirSync(src); mkdirSync(dest)
  cbz = await makeCbz(src, ['p1.png', 'p2.png'], 'comic.cbz')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const plenty = () => ({ bytesLeft: 100 * 1024 * 1024 })

test('a comic is pages, a collection is comics, and a file that is neither is no zip', async () => {
  expect(await surveyZip(cbz)).toEqual({ images: 2, archives: 0 })
  const pack = await makeZip(src, [{ name: 'Venom 001.cbz', path: cbz }, { name: 'Venom 002.cbr', data: 'rar' }])
  expect(await surveyZip(pack)).toEqual({ images: 0, archives: 2 })
  const text = join(src, 'notes.txt'); writeFileSync(text, 'hello')
  expect(await surveyZip(text)).toBeNull()
})

// A Mac zips an AppleDouble shadow beside every file, named exactly like the comic.
test('the __MACOSX shadows are not counted as comics', async () => {
  const pack = await makeZip(src, [
    { name: 'Venom/Venom 001.cbz', path: cbz },
    { name: '__MACOSX/Venom/._Venom 001.cbz', data: 'shadow' },
  ])
  expect(await surveyZip(pack)).toEqual({ images: 0, archives: 1 })
  expect(await unpackComics(pack, dest, plenty())).toEqual(['Venom 001.cbz'])
})

test('comics come out side by side, and the rest of the pack is left behind', async () => {
  const pack = await makeZip(src, [
    { name: 'Venom v4/Venom 001.cbz', path: cbz },
    { name: 'Venom v4/Annuals/Venom Annual 001.cbz', path: cbz },
    { name: 'Venom v4/cover.jpg', data: 'jpg' },
    { name: 'Venom v4/readme.txt', data: 'txt' },
  ])
  const names = await unpackComics(pack, dest, plenty())
  expect(names.sort()).toEqual(['Venom 001.cbz', 'Venom Annual 001.cbz'])
  expect(readdirSync(dest).sort()).toEqual(['Venom 001.cbz', 'Venom Annual 001.cbz'])
  expect(await listPages(join(dest, 'Venom 001.cbz'))).toHaveLength(2)
})

// The same file in two folders of the pack: both survive, the way a library collision does.
test('two comics with one name are both kept', async () => {
  const pack = await makeZip(src, [
    { name: 'a/Venom 001.cbz', path: cbz },
    { name: 'b/Venom 001.cbz', path: cbz },
  ])
  expect((await unpackComics(pack, dest, plenty())).sort()).toEqual(['Venom 001 (2).cbz', 'Venom 001.cbz'])
})

test('a zip inside the zip is opened in turn, and one of pages is a comic itself', async () => {
  const inner = await makeZip(src, [{ name: 'Venom 002.cbz', path: cbz }], 'part 2.zip')
  // What a zip holds is read off its entry names, so a page named like one is enough.
  const pagesZip = await makeZip(src, [{ name: '01.png', data: 'png' }], 'Venom 003.zip')
  const pack = await makeZip(src, [
    { name: 'Venom 001.cbz', path: cbz },
    { name: 'part 2.zip', path: inner },
    { name: 'Venom 003.zip', path: pagesZip },
  ])
  const names = await unpackComics(pack, dest, plenty())
  expect(names.sort()).toEqual(['Venom 001.cbz', 'Venom 002.cbz', 'Venom 003.cbz'])
  // Nothing of the nested zips is left lying about.
  expect(readdirSync(dest).sort()).toEqual(['Venom 001.cbz', 'Venom 002.cbz', 'Venom 003.cbz'])
})

// All or nothing: half a pack left behind would be unpacked again beside itself.
test('a pack bigger than the limit is refused and leaves nothing behind', async () => {
  const pack = await makeZip(src, [
    { name: 'Venom 001.cbz', path: cbz },
    { name: 'Venom 002.cbz', data: Buffer.alloc(64 * 1024) },
  ])
  await expect(unpackComics(pack, dest, { bytesLeft: 32 * 1024 })).rejects.toThrow(/size limit/)
  expect(readdirSync(dest)).toEqual([])
})
