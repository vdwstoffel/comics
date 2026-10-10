// @vitest-environment jsdom
import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import { uploadComic } from '../src/lib/uploadComic'
import { FakeXhr, installFakeXhr } from './helpers/fakeXhr'

beforeEach(() => { installFakeXhr() })
afterEach(() => { vi.restoreAllMocks() })

const file = () => new File(['pretend comic'], 'venom-256-scene-tag.cbz')

// The whole point of uploading from a gap rather than from the Upload page: the edition
// and the issue are already known, so they travel with the file and the server files the
// comic into the run and reads its metadata from Comic Vine's id rather than the name.
test('the file travels with the edition and the issue it fills', async () => {
  const done = uploadComic({ file: file(), edition: 'Venom (2025)', issueId: 1234 })
  const sent = FakeXhr.last!

  expect(sent.method).toBe('POST')
  expect(sent.url).toBe('/api/upload')
  expect(sent.body!.get('edition')).toBe('Venom (2025)')
  expect(sent.body!.get('issueId')).toBe('1234')
  expect((sent.body!.get('file') as File).name).toBe('venom-256-scene-tag.cbz')

  sent.finish(200, JSON.stringify({ book: { id: 7 }, metadataApplied: true }))
  await expect(done).resolves.toEqual({ book: { id: 7 }, metadataApplied: true })
})

// A comic is tens of megabytes over a home connection. Without this the button sits
// silent for a minute, which reads as a button that did nothing.
test('it reports how far the file has got, in whole percent', async () => {
  const seen: number[] = []
  const done = uploadComic({ file: file(), onProgress: (p) => seen.push(p) })
  const sent = FakeXhr.last!

  sent.progress(0, 400)
  sent.progress(123, 400)
  sent.progress(400, 400)

  expect(seen).toEqual([0, 31, 100])
  sent.finish(200, '{}')
  await done
})

// A length the browser cannot work out would otherwise report NaN%.
test('a length the browser cannot measure reports nothing at all', async () => {
  const seen: number[] = []
  const done = uploadComic({ file: file(), onProgress: (p) => seen.push(p) })
  const sent = FakeXhr.last!

  sent.upload.onprogress!({ lengthComputable: false, loaded: 1, total: 0 } as ProgressEvent)

  expect(seen).toEqual([])
  sent.finish(200, '{}')
  await done
})

// 413 is the one the size limit answers with, and a caller that treated it as success
// would close the gap on the page while the comic was never stored.
test('a server that refuses the file rejects rather than resolving', async () => {
  const done = uploadComic({ file: file() })
  FakeXhr.last!.finish(413, '{"error":"file too large"}')
  await expect(done).rejects.toThrow(/413/)
})

test('a connection that drops rejects too', async () => {
  const done = uploadComic({ file: file() })
  FakeXhr.last!.onerror!()
  await expect(done).rejects.toThrow(/Upload failed/)
})

// The file is on disk by the time the body is written, so an unreadable answer costs the
// shortcut - what to say next - and never the comic.
test('an answer that will not parse still counts as stored', async () => {
  const done = uploadComic({ file: file() })
  FakeXhr.last!.finish(200, '<html>proxy said hello</html>')
  await expect(done).resolves.toEqual({})
})
