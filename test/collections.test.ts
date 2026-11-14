import { test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { openDb } from '../server/db.js'
import uploadRoutes from '../server/routes/upload.js'
import collectionRoutes, { isPostPage } from '../server/routes/collections.js'
import downloadRoutes from '../server/routes/downloads.js'
import { createDownloadRunner } from '../server/services/downloader.js'
import { reconcileCollections } from '../server/services/collections.js'
import { createCollection, getCollection } from '../server/models/collections.js'
import { makeCbz } from './helpers/makeCbz.js'
import { makeZip } from './helpers/makeZip.js'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../server/config.js'

const POST = 'https://getcomics.org/marvel/daredevil-vol-6-1-23-annual-2019-2020/'
const PART_1 = 'https://getcomics.org/dls/part-one'
const PART_2 = 'https://getcomics.org/dls/part-two'

/** The older layout, as a run-with-annuals post still writes it: one list item per part. */
const POST_HTML = `<h1 class="post-title">Daredevil Vol. 6 #1 &#8211; 32 + Annual (2019-2021)</h1>
<section class="post-contents"><p><strong>Size :</strong> 1.4 GB</p><ul>
<li>Daredevil #1 &#8211; 12 (2019) (462 MB) :<br /><strong><a href="${PART_1}"><span>Main Server</span></a> | <a href="https://mega.example/x">MEGA</a></strong></li>
<li>Daredevil #13 &#8211; 23 + Annual (2020) (482 MB) :<br /><strong><a href="${PART_2}"><span>Main Server</span></a></strong></li>
</ul></section>`

let dir: string, src: string, app: FastifyInstance, cbz: string
/** What each url downloads to. A test sets the bytes and the name the response carries. */
let served: Record<string, { body: Uint8Array; name: string }>

function respond(body: Uint8Array | string, url: string, headers: Record<string, string> = {}) {
  const res = new Response(body as BodyInit, { headers })
  Object.defineProperty(res, 'url', { value: url })
  return res
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'col-'))
  src = join(dir, 'src'); mkdirSync(src)
  const config = {
    comicsDir: join(dir, 'comics'), thumbsDir: join(dir, 'thumbs'), tmpDir: join(dir, 'tmp'),
    stagingDir: join(dir, 'collections'), maxUploadBytes: 5 * 1024 * 1024,
  } as Config
  for (const d of [config.comicsDir, config.thumbsDir, config.tmpDir, config.stagingDir]) mkdirSync(d, { recursive: true })
  cbz = await makeCbz(src, ['p1.png', 'p2.png'], 'comic.cbz')
  served = {}

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    const hit = served[url]
    if (!hit) return respond('missing', url, { 'content-type': 'text/plain' })
    return respond(hit.body, `https://files.example/${encodeURIComponent(hit.name)}`)
  }) as typeof fetch

  app = Fastify()
  app.decorate('db', openDb(':memory:'))
  app.decorate('config', config)
  app.decorate('downloader', createDownloadRunner({ db: app.db, config }, { fetchImpl, concurrency: 1 }))
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } })
  await app.register(uploadRoutes)
  await app.register(downloadRoutes)
  await app.register(collectionRoutes, { fetchPage: async () => POST_HTML, fetchImpl })
})
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })

async function packOf(names: string[], outName = 'pack.zip'): Promise<string> {
  return makeZip(src, names.map((name) => ({ name, path: cbz })), outName)
}

function uploadForm(path: string, name: string, fields: Record<string, string> = {}): FormData {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  form.set('file', new Blob([readFileSync(path)]), name)
  return form
}

test('uploading a zip of several comics holds them for review instead of storing any', async () => {
  const pack = await packOf(['Venom 001.cbz', 'Venom 002.cbz', 'Venom Annual 001.cbz'])
  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: uploadForm(pack, 'Venom v4 (2018).zip') })
  expect(res.statusCode).toBe(200)
  const { collection } = res.json()
  expect(collection).toMatchObject({ label: 'Venom v4 (2018)', fileCount: 3 })
  expect(readdirSync(app.config.comicsDir)).toEqual([])

  const got = await app.inject({ url: `/api/collections/${collection.id}` })
  expect(got.json().files).toEqual(['Venom 001.cbz', 'Venom 002.cbz', 'Venom Annual 001.cbz'])
})

// A single issue so often arrives in a wrapper; it should not need a review table.
test('a zip of one comic is unwrapped and stored as if it had come alone', async () => {
  const pack = await packOf(['Venom 001.cbz'])
  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: uploadForm(pack, 'Venom 001.zip', { edition: 'Venom' }) })
  expect(res.statusCode).toBe(200)
  expect(res.json().book.pageCount).toBe(2)
  expect(existsSync(join(app.config.comicsDir, 'Venom', 'Venom 001.cbz'))).toBe(true)
  expect(readdirSync(app.config.stagingDir)).toEqual([])
})

test('a zip of pages is a comic, and is stored as a .cbz', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: uploadForm(cbz, 'Venom 001.zip', { edition: 'Venom' }) })
  expect(res.statusCode).toBe(200)
  expect(existsSync(join(app.config.comicsDir, 'Venom', 'Venom 001.cbz'))).toBe(true)
})

test('a zip with no comic in it is refused', async () => {
  const empty = await makeZip(src, [{ name: 'part.zip', path: await makeZip(src, [{ name: 'a.txt', data: 'x' }], 'part.zip') }], 'outer.zip')
  const res = await app.inject({ method: 'POST', url: '/api/upload', payload: uploadForm(empty, 'outer.zip') })
  expect(res.statusCode).toBe(400)
})

test('the bulk page holds even one comic for review', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/collections', payload: uploadForm(cbz, 'Venom 001.cbz') })
  expect(res.statusCode).toBe(200)
  const { collection } = res.json()
  expect((await app.inject({ url: `/api/collections/${collection.id}` })).json().files).toEqual(['Venom 001.cbz'])
})

test('a comic filed out of a collection lands in its edition and leaves the collection', async () => {
  const pack = await packOf(['Venom 001.cbz', 'Venom 002.cbz'])
  const { collection } = (await app.inject({ method: 'POST', url: '/api/collections', payload: uploadForm(pack, 'Venom.zip') })).json()

  const first = await app.inject({
    method: 'POST', url: `/api/collections/${collection.id}/file`,
    payload: { file: 'Venom 001.cbz', edition: 'Venom (2018)' },
  })
  expect(first.statusCode).toBe(200)
  expect(first.json()).toMatchObject({ remaining: 1 })
  expect(first.json().book.pageCount).toBe(2)
  expect(readdirSync(join(app.config.comicsDir, 'Venom', 'Venom (2018)'))).toEqual(['Venom 001.cbz'])
  expect((await app.inject({ url: `/api/collections/${collection.id}` })).json().files).toEqual(['Venom 002.cbz'])

  // The last one out takes the collection with it: there is nothing left to review.
  const last = await app.inject({
    method: 'POST', url: `/api/collections/${collection.id}/file`,
    payload: { file: 'Venom 002.cbz', edition: 'Venom (2018)' },
  })
  expect(last.json()).toMatchObject({ remaining: 0 })
  expect((await app.inject({ url: `/api/collections/${collection.id}` })).statusCode).toBe(404)
  expect(readdirSync(app.config.stagingDir)).toEqual([])
})

// The client names a file in the collection, never a path.
test('a name the collection does not list is not there, whatever it climbs to', async () => {
  const pack = await packOf(['Venom 001.cbz', 'Venom 002.cbz'])
  const { collection } = (await app.inject({ method: 'POST', url: '/api/collections', payload: uploadForm(pack, 'Venom.zip') })).json()
  const res = await app.inject({
    method: 'POST', url: `/api/collections/${collection.id}/file`, payload: { file: '../../comic.cbz' },
  })
  expect(res.statusCode).toBe(404)
})

// storeComic deletes what it is given on failure; a staged comic must not go with it.
test('a comic that fails to store stays in the collection to try again', async () => {
  const broken = join(src, 'Venom 003.cbz')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(broken, 'not a zip at all')
  const pack = await makeZip(src, [{ name: 'Venom 001.cbz', path: cbz }, { name: 'Venom 003.cbz', path: broken }])
  const { collection } = (await app.inject({ method: 'POST', url: '/api/collections', payload: uploadForm(pack, 'Venom.zip') })).json()

  const res = await app.inject({ method: 'POST', url: `/api/collections/${collection.id}/file`, payload: { file: 'Venom 003.cbz' } })
  expect(res.statusCode).toBe(400)
  expect((await app.inject({ url: `/api/collections/${collection.id}` })).json().files).toEqual(['Venom 001.cbz', 'Venom 003.cbz'])
})

test('discarding a collection removes its comics from the disk', async () => {
  const pack = await packOf(['Venom 001.cbz', 'Venom 002.cbz'])
  const { collection } = (await app.inject({ method: 'POST', url: '/api/collections', payload: uploadForm(pack, 'Venom.zip') })).json()
  const res = await app.inject({ method: 'DELETE', url: `/api/collections/${collection.id}` })
  expect(res.statusCode).toBe(200)
  expect(readdirSync(app.config.stagingDir)).toEqual([])
  expect((await app.inject({ url: '/api/downloads' })).json().review).toEqual([])
})

test('a downloaded zip of comics waits under review, and the queue row says which collection', async () => {
  const pack = await packOf(['Venom 001.cbz', 'Venom 002.cbz'])
  served['https://getcomics.org/dls/pack'] = { body: readFileSync(pack), name: 'Venom v4 (2018).zip' }

  app.downloader.enqueue({ url: 'https://getcomics.org/dls/pack' })
  await app.downloader.idle()

  const view = (await app.inject({ url: '/api/downloads' })).json()
  expect(view.history[0]).toMatchObject({ state: 'done', fileName: 'Venom v4 (2018).zip' })
  expect(view.review).toHaveLength(1)
  expect(view.review[0]).toMatchObject({ label: 'Venom v4 (2018)', fileCount: 2, waiting: 0 })
  expect(view.history[0].collectionId).toBe(view.review[0].id)
  expect(readdirSync(app.config.comicsDir)).toEqual([])
})

test('a downloaded zip of one comic is stored, filed where the queue said', async () => {
  const pack = await packOf(['Venom 001.cbz'])
  served['https://getcomics.org/dls/one'] = { body: readFileSync(pack), name: 'Venom 001 (2018).zip' }

  app.downloader.enqueue({ url: 'https://getcomics.org/dls/one', edition: 'Venom' })
  await app.downloader.idle()

  const [entry] = app.downloader.status().history
  expect(entry).toMatchObject({ state: 'done' })
  expect(entry!.bookId).toBeGreaterThan(0)
  expect(readdirSync(join(app.config.comicsDir, 'Venom'))).toEqual(['Venom 001.cbz'])
})

test('a post is read for every part it offers, each under its own heading', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/collections/link', payload: { url: POST } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({
    postUrl: POST,
    title: 'Daredevil Vol. 6 #1 – 32 + Annual (2019-2021)',
    size: '1.4 GB',
    parts: [
      { heading: 'Daredevil #1 – 12 (2019)', size: '462 MB', url: PART_1 },
      { heading: 'Daredevil #13 – 23 + Annual (2020)', size: '482 MB', url: PART_2 },
    ],
  })
})

test('every part of a post lands in one collection, ready once the last is in', async () => {
  served[PART_1] = { body: readFileSync(await packOf(['Daredevil 001.cbz', 'Daredevil 002.cbz'], 'p1.zip')), name: 'Daredevil 001-012.zip' }
  served[PART_2] = { body: readFileSync(await packOf(['Daredevil 013.cbz', 'Daredevil Annual 001.cbz'], 'p2.zip')), name: 'Daredevil 013-023.zip' }

  const res = await app.inject({
    method: 'POST', url: '/api/collections/download',
    payload: {
      label: 'Daredevil Vol. 6', postUrl: POST,
      parts: [{ heading: 'Daredevil #1 – 12', url: PART_1 }, { heading: 'Daredevil #13 – 23 + Annual', url: PART_2 }],
    },
  })
  expect(res.statusCode).toBe(202)
  const { collection } = res.json()
  expect(collection).toMatchObject({ label: 'Daredevil Vol. 6', parts: 2 })
  // Queued, not yet in: counted as still coming.
  expect(getCollection(app.db, collection.id)!.waiting).toBeGreaterThan(0)

  await app.downloader.idle()
  const view = (await app.inject({ url: '/api/downloads' })).json()
  expect(view.review).toHaveLength(1)
  expect(view.review[0]).toMatchObject({ id: collection.id, fileCount: 4, parts: 2, waiting: 0 })
  expect((await app.inject({ url: `/api/collections/${collection.id}` })).json().files)
    .toEqual(['Daredevil 001.cbz', 'Daredevil 002.cbz', 'Daredevil 013.cbz', 'Daredevil Annual 001.cbz'])
  expect(view.history.map((e: { label: string }) => e.label).sort()).toEqual(['Daredevil #1 – 12', 'Daredevil #13 – 23 + Annual'])
})

// A part a bot check stopped is handed back by hand; it belongs with the others.
test('a part handed back by hand joins its collection', async () => {
  const collection = createCollection(app.db, { label: 'Daredevil', dir: 'dd', fileCount: 0, parts: 2 })
  mkdirSync(join(app.config.stagingDir, 'dd'))
  const pack = await packOf(['Daredevil 013.cbz', 'Daredevil 014.cbz'])
  const res = await app.inject({
    method: 'POST', url: '/api/collections',
    payload: uploadForm(pack, 'Daredevil 013-023.zip', { collectionId: String(collection.id) }),
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().collection).toMatchObject({ id: collection.id, fileCount: 2 })
})

test('a link that is not a post is offered as one download, named as it will be', async () => {
  served['https://files.example/direct'] = { body: new Uint8Array(10), name: 'Venom 001 (2018).cbz' }
  const res = await app.inject({ method: 'POST', url: '/api/collections/link', payload: { url: 'https://files.example/direct' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ title: 'Venom 001 (2018)', parts: [{ heading: 'Venom 001 (2018)', url: 'https://files.example/direct' }] })
})

test('only a getcomics post is read for parts; its /dls/ links are files', () => {
  expect(isPostPage(POST)).toBe(true)
  expect(isPostPage('https://getcomics.org/dls/abc')).toBe(false)
  expect(isPostPage('https://getcomics.org/')).toBe(false)
  expect(isPostPage('https://example.com/marvel/daredevil/')).toBe(false)
  expect(isPostPage('not a url')).toBe(false)
})

test('startup clears what a dead process left, but not a collection still filling', async () => {
  mkdirSync(join(app.config.stagingDir, 'orphan'))
  const filling = createCollection(app.db, { label: 'Filling', dir: 'filling', fileCount: 0, parts: 1 })
  mkdirSync(join(app.config.stagingDir, 'filling'))
  app.db.prepare(`INSERT INTO download_queue (position, state, url, collection_id, queued_at) VALUES (0, 'queued', 'x', ?, 'now')`)
    .run(filling.id)
  const emptied = createCollection(app.db, { label: 'Emptied', dir: 'emptied', fileCount: 3 })
  mkdirSync(join(app.config.stagingDir, 'emptied'))

  await reconcileCollections({ db: app.db, config: app.config })
  expect(readdirSync(app.config.stagingDir).sort()).toEqual(['filling'])
  expect(getCollection(app.db, filling.id)).toBeDefined()
  expect(getCollection(app.db, emptied.id)).toBeUndefined()
})

// The unpack bound scales with the zip, so a long run is not capped at some fixed size.
test('a pack larger than the upload limit still unpacks', async () => {
  app.config.maxUploadBytes = 1024
  const pack = await packOf(['Venom 001.cbz', 'Venom 002.cbz'])
  served['https://getcomics.org/dls/big'] = { body: readFileSync(pack), name: 'Venom v4.zip' }
  app.downloader.enqueue({ url: 'https://getcomics.org/dls/big' })
  await app.downloader.idle()
  expect((await app.inject({ url: '/api/downloads' })).json().review[0]).toMatchObject({ fileCount: 2 })
})
