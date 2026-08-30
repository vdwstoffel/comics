import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { scanLibrary, walkComics } from '../server/services/indexer.js'
import { makeCbz } from './helpers/makeCbz.js'
import { embedComicInfo } from '../server/lib/embed.js'
import { buildComicInfo } from '../server/lib/comicinfo.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'idx-'))
  ctx = { db: openDb(':memory:'), config: { comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs') } as Config }
  mkdirSync(ctx.config.comicsDir, { recursive: true })
  mkdirSync(ctx.config.thumbsDir, { recursive: true })
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

test('scanLibrary ingests cbz files under series folders and writes thumbnails', async () => {
  const batmanDir = join(ctx.config.comicsDir, 'Batman')
  mkdirSync(batmanDir, { recursive: true })
  await makeCbz(batmanDir, ['p1.png', 'p2.png', 'p3.png'], '001.cbz')

  const res = await scanLibrary(ctx)
  expect(res.added).toBe(1)

  const series = ctx.db.prepare('SELECT * FROM edition').all() as Array<{ name: string }>
  expect(series[0].name).toBe('Batman')
  const book = ctx.db.prepare('SELECT * FROM book').get() as { page_count: number; id: number }
  expect(book.page_count).toBe(3)
  expect(existsSync(join(ctx.config.thumbsDir, `${book.id}.webp`))).toBe(true)
})

test('scanLibrary is idempotent (no duplicate ingest)', async () => {
  const d = join(ctx.config.comicsDir, 'Batman')
  mkdirSync(d, { recursive: true })
  await makeCbz(d, ['p1.png'], '001.cbz')
  await scanLibrary(ctx)
  const second = await scanLibrary(ctx)
  expect(second.added).toBe(0)
})

test('walkComics finds both .cbz and .cbr files', () => {
  const walkDir = mkdtempSync(join(tmpdir(), 'walk-'))
  try {
    const subDir = join(walkDir, 'Series')
    mkdirSync(subDir)
    writeFileSync(join(subDir, 'issue1.cbz'), 'dummy')
    writeFileSync(join(subDir, 'issue2.cbr'), 'dummy')
    writeFileSync(join(subDir, 'readme.txt'), 'ignore')

    const found = walkComics(walkDir)
    const names = found.map((f) => f.replace(subDir + '/', ''))
    expect(names).toContain('issue1.cbz')
    expect(names).toContain('issue2.cbr')
    expect(names).not.toContain('readme.txt')
  } finally {
    rmSync(walkDir, { recursive: true, force: true })
  }
})

test('a scan restores the credits and tags held in an embedded ComicInfo.xml', async () => {
  const d = join(ctx.config.comicsDir, 'Batman')
  mkdirSync(d, { recursive: true })
  const cbz = await makeCbz(d, ['p1.png'], '001.cbz')
  await embedComicInfo(cbz, buildComicInfo({
    title: 'Shed', series: 'Batman', number: '12',
    credits: [{ name: 'Scott Snyder', role: 'writer' }, { name: 'Greg Capullo', role: 'cover' }],
    characters: ['Batman', 'Commissioner Gordon'],
    teams: ['Court of Owls'],
    storyArcs: ['The Black Mirror'],
  }))

  await scanLibrary(ctx)
  const bookId = (ctx.db.prepare('SELECT id FROM book').get() as { id: number }).id

  const credits = ctx.db.prepare('SELECT name, role FROM book_credit WHERE book_id = ? ORDER BY id').all(bookId)
  expect(credits).toEqual([
    { name: 'Scott Snyder', role: 'writer' },
    { name: 'Greg Capullo', role: 'cover' },
  ])

  const tags = ctx.db.prepare('SELECT kind, value FROM book_tag WHERE book_id = ? ORDER BY id').all(bookId)
  expect(tags).toEqual([
    { kind: 'character', value: 'Batman' },
    { kind: 'character', value: 'Commissioner Gordon' },
    { kind: 'team', value: 'Court of Owls' },
    { kind: 'story_arc', value: 'The Black Mirror' },
  ])
})

test('a scan of a file without ComicInfo.xml leaves no credits or tags behind', async () => {
  const d = join(ctx.config.comicsDir, 'Batman')
  mkdirSync(d, { recursive: true })
  await makeCbz(d, ['p1.png'], '001.cbz')
  await scanLibrary(ctx)
  const bookId = (ctx.db.prepare('SELECT id FROM book').get() as { id: number }).id
  expect(ctx.db.prepare('SELECT * FROM book_credit WHERE book_id = ?').all(bookId)).toEqual([])
  expect(ctx.db.prepare('SELECT * FROM book_tag WHERE book_id = ?').all(bookId)).toEqual([])
})
