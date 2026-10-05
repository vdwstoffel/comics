import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import { storeComic } from '../server/services/storeComic.js'
import { moveBookToEdition } from '../server/services/library.js'
import { upsertEdition, getEditionByName } from '../server/models/editions.js'
import { updateEdition } from '../server/models/editions.js'
import { cacheVolumeIssues } from '../server/models/volumeIssues.js'
import { setProgress } from '../server/models/progress.js'
import { addFollow } from '../server/models/follows.js'
import { nextWantedIssue } from '../server/services/following.js'
import { insertBook, getBook, updateBook } from '../server/models/books.js'
import { makeCbz } from './helpers/makeCbz.js'
import type { Ctx } from '../server/types.js'
import type { Config } from '../server/config.js'

let dir: string, ctx: Ctx, srcCbz: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'store-'))
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'), tmpDir: join(dir, 'tmp'),
    maxUploadBytes: 5 * 1024 * 1024,
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir]) mkdirSync(d, { recursive: true })
  ctx = { db: openDb(':memory:'), config }
  const src = mkdtempSync(join(tmpdir(), 'src-'))
  srcCbz = await makeCbz(src, ['p1.png', 'p2.png'], 'x.cbz')
})
afterEach(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }) })

function staged(n: number): string {
  const p = join(ctx.config.tmpDir, `staged-${n}.cbz`)
  copyFileSync(srcCbz, p)
  return p
}

// Both downloads resolve to the same final name. Serially this is fine - the second sees
// the first on disk and takes "(2)". Concurrently, without a lock, both are handed the
// same free name, the second rename destroys the first file, and one book row is lost.
//
// PARTIES=2 was tried first and measured to pass 21/21 runs with the mutex removed - i.e. it
// guards nothing, because the first of two calls gets a small but consistent head start and
// clears dedupeDestPath+rename before the second one can catch up to collide with it. These
// numbers are NOT arbitrary and must not be "simplified" back down:
//   - 20 concurrent parties under the same name was measured to reproduce the collision
//     (a thrown `UNIQUE constraint failed: book.file_path`, or a lost file) in about 3 of
//     every 5 runs against the unfixed code.
//   - Repeating that 20-party round 5 times in one test drives the compound catch rate to
//     practically 1 (roughly 1 - 0.4^5, i.e. over 99%), while the fixed code passes every
//     round every time (verified below).
// Removing the mutex from storeComic MUST make this test fail. A concurrency test that
// passes either way is testing nothing.
test('many comics storing at once under the same name all survive', async () => {
  const PARTIES = 20
  const ROUNDS = 5

  for (let round = 0; round < ROUNDS; round++) {
    const results = await Promise.all(
      Array.from({ length: PARTIES }, (_, n) =>
        storeComic(ctx, {
          tmpPath: staged(round * PARTIES + n),
          originalName: `Venom ${round}.cbz`,
          editionName: 'Venom',
        })),
    )
    expect(results.every((r) => r.ok)).toBe(true)
  }

  // editionFolderPath collapses <series>/<edition> to just <edition> when the derived
  // series name equals the edition name itself (see server/lib/paths.ts) - "Venom" derives
  // to series "Venom" too, so the folder is `comics/Venom`, not `comics/Venom/Venom`. Every
  // round targets the same edition, so all files land in this one folder.
  const files = readdirSync(join(ctx.config.comicsDir, 'Venom'))
  expect(files).toHaveLength(PARTIES * ROUNDS)
  expect(new Set(files).size).toBe(PARTIES * ROUNDS)

  const books = ctx.db.prepare('SELECT file_path FROM book').all() as Array<{ file_path: string }>
  expect(books).toHaveLength(PARTIES * ROUNDS)
  expect(new Set(books.map((r) => r.file_path)).size).toBe(PARTIES * ROUNDS)
})

// The same claim-then-rename, reached from two different services into one directory: a
// download filing `Venom 250.cbz` while the library moves another book of that name into
// the same edition. storeComic locked this; library.moveBookToEdition did not - and a
// second lock private to library.ts would not have helped either, because the two calls
// have to take the SAME lock or they interleave with each other exactly as before.
//
// The party counts are the ones the test above argues for, and for the same reason: a
// couple of callers lets the first finish before the second has caught up. Rounds are what
// drive the compound catch rate up. Removing the shared lock MUST make this fail.
test('a download and a library move claiming the same name both survive', async () => {
  const PARTIES = 10
  const ROUNDS = 5
  const EDITION = 'Venom (2025)'
  let staging = 0

  for (let round = 0; round < ROUNDS; round++) {
    // Each mover owns a loose folder holding a file of the contested name.
    const movers: number[] = []
    for (let i = 0; i < PARTIES; i++) {
      const folder = `Loose ${round}-${i}`
      const loose = join(ctx.config.comicsDir, folder)
      mkdirSync(loose, { recursive: true })
      await makeCbz(loose, ['p1.png'], 'Venom 250.cbz')
      const source = upsertEdition(ctx.db, { name: folder, folder })
      const book = insertBook(ctx.db, {
        editionId: source.id, filePath: `${folder}/Venom 250.cbz`, pageCount: 1, fileSize: 100,
      })!
      movers.push(book.id)
    }

    const results = await Promise.all([
      ...movers.map((id) => moveBookToEdition(ctx, id, EDITION)),
      ...Array.from({ length: PARTIES }, () => storeComic(ctx, {
        tmpPath: staged(staging++), originalName: 'Venom 250.cbz', editionName: EDITION,
      })),
    ])
    expect(results).toHaveLength(PARTIES * 2)
  }

  const total = PARTIES * ROUNDS * 2
  const folder = getEditionByName(ctx.db, EDITION)!.folder
  const files = readdirSync(join(ctx.config.comicsDir, folder))
  expect(files).toHaveLength(total)
  expect(new Set(files).size).toBe(total)

  // Every book still points at a file of its own, and at one that is really there.
  const books = ctx.db.prepare('SELECT file_path FROM book').all() as Array<{ file_path: string }>
  expect(books).toHaveLength(total)
  expect(new Set(books.map((r) => r.file_path)).size).toBe(total)
  for (const b of books) expect(existsSync(join(ctx.config.comicsDir, b.file_path))).toBe(true)
})

// The issue id came from the download queue, not Comic Vine. A metadata read that fails
// (no key here) must still leave the book owned: otherwise a follow sees nothing, queues
// the same issue every sweep, and the library fills with "name (2).cbz".
test('a failed metadata read still records which issue the comic is', async () => {
  const edition = 'Iron Man'
  const res = await storeComic(ctx, { tmpPath: staged(900), originalName: 'iron_man_002.cbz', editionName: edition, issueId: 4242 })
  expect(res).toMatchObject({ ok: true, metadataApplied: false })
  if (!res.ok || !res.book) throw new Error('expected a book')
  expect(res.book.comicvineId).toBe(4242)
  expect(getBook(ctx.db, res.book.id)?.comicvineId).toBe(4242)

  // And the follow now sees it as owned rather than wanting it again.
  const ed = getEditionByName(ctx.db, edition)!
  updateEdition(ctx.db, ed.id, { comicvineId: 500, cvName: 'Iron Man' })
  cacheVolumeIssues(ctx.db, 500, [
    { id: 4241, number: '1', coverDate: '2020-01-01' },
    { id: 4242, number: '2', coverDate: '2020-02-01' },
  ])
  const first = insertBook(ctx.db, { editionId: ed.id, filePath: 'Iron Man/1.cbz', pageCount: 2, fileSize: 1 })!
  updateBook(ctx.db, first.id, { comicvineId: 4241 })
  setProgress(ctx.db, first.id, { lastPage: 1, completed: true })
  const follow = addFollow(ctx.db, 'volume', ed.id, 'Iron Man')
  expect(nextWantedIssue(ctx.db, follow).state).toBe('supplied')
})
