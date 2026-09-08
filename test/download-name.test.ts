import { test, expect } from 'vitest'
import { downloadFileName } from '../server/lib/downloadName.js'

// The real shape: the pasted link is an opaque token, and the name only appears on the
// URL it redirects to.
const OPAQUE = 'https://getcomics.org/dls/VihnoomBUb2Wfcz/NL3vKE94d8fp9SpeGrSONTXkKs7/XXQ32oumCVZ'
const REDIRECTED = 'https://fs3.comicfiles.ru/2026.07.08/Fixed/Amazing%20Spider-Man%20031%20%282026%29%20%28Digital%29%20%28F%29%20%28Shan-Empire%29.cbz'

test('the name comes from the url the download actually lands on', () => {
  expect(downloadFileName(REDIRECTED)).toBe('Amazing Spider-Man 031 (2026) (Digital) (F) (Shan-Empire).cbz')
})

test('a link with nothing but an opaque token yields no name', () => {
  expect(downloadFileName(OPAQUE)).toBeNull()
})

test('a content-disposition filename is trusted over the url', () => {
  expect(downloadFileName(REDIRECTED, 'attachment; filename="Venom 258.cbz"')).toBe('Venom 258.cbz')
})

test('a quoted or unquoted content-disposition both work', () => {
  expect(downloadFileName(OPAQUE, 'attachment; filename=Venom_258.cbz')).toBe('Venom_258.cbz')
})

test('the rfc5987 form is understood and decoded', () => {
  expect(downloadFileName(OPAQUE, "attachment; filename*=UTF-8''Venom%20258.cbz")).toBe('Venom 258.cbz')
})

// Anything else is not a comic, and naming a file for it would be a lie.
test('a name that is not a comic archive is refused', () => {
  expect(downloadFileName('https://x.test/index.html')).toBeNull()
  expect(downloadFileName('https://x.test/file.zip')).toBeNull()
})

test('a .cbr is a comic too', () => {
  expect(downloadFileName('https://x.test/Venom%20258.cbr')).toBe('Venom 258.cbr')
})

test('a query string is not part of the name', () => {
  expect(downloadFileName('https://x.test/Venom%20258.cbz?token=abc&x=1')).toBe('Venom 258.cbz')
})

// A name is about to become a path on disk; nothing in it may escape the directory.
test('a name cannot carry a path out of the download', () => {
  expect(downloadFileName('https://x.test/a/b/../../etc/Venom.cbz')).toBe('Venom.cbz')
  expect(downloadFileName(OPAQUE, 'attachment; filename="../../etc/Venom.cbz"')).toBe('Venom.cbz')
})

test('junk in place of a url is no name rather than a crash', () => {
  expect(downloadFileName('not a url')).toBeNull()
  expect(downloadFileName('')).toBeNull()
})
