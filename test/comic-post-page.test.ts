import { test, expect } from 'vitest'
import { parseDownloadLink } from '../server/lib/comicPostPage.js'

const POST_URL = 'https://getcomics.org/marvel/knull-5-2026/'

// The button block as the post page really writes it: several mirrors in a row, each an
// anchor in its own aio-button-center wrapper, labelled by both title and text.
const button = (href: string, label: string, cls: string) =>
  `<div class="aio-button-center"><div class="aio-pulse">` +
  `<a rel="nofollow" href="${href}" class="${cls}" title="${label}">` +
  `<i class="glyphicons glyphicons-ok"></i>${label}</a></div></div>`

const MAIN = 'https://getcomics.org/dls/tC3kM3XUCQrAyhWkBASEc+xuxbXEDFjQ==:X1Em/N7zYbPZ7w=='
const PIXELDRAIN = 'https://getcomics.org/dls/Gee+ptFEbBeZF8kZ+KY7K9R:sGdXI0ehyNt32A=='

const POST = `<article><h2>Free Marvel Comics Download</h2>
  ${button(MAIN, 'DOWNLOAD NOW', 'aio-red')}
  ${button('https://1024terabox.com/s/1g5F-iQDlwGZbT', 'TERABOX', 'aio-blue')}
  ${button('https://rootz.so/d/XV7Jo', 'ROOTZ', 'aio-green')}
  ${button(PIXELDRAIN, 'PIXELDRAIN', 'aio-orange')}
  ${button('https://datanodes.to/x1peo94fqorw/Knull_005.cbz', 'DATANODES', 'aio-gray')}
</article>`

test('parseDownloadLink returns the main DOWNLOAD NOW link', () => {
  expect(parseDownloadLink(POST, POST_URL)).toBe(MAIN)
})

test('parseDownloadLink ignores the third-party mirrors', () => {
  const link = parseDownloadLink(POST, POST_URL)
  expect(link).not.toContain('terabox')
  expect(link).not.toContain('rootz')
  expect(link).not.toContain('datanodes')
  expect(link).not.toBe(PIXELDRAIN)
})

test('parseDownloadLink matches the label whatever its case and spacing', () => {
  const html = button('https://getcomics.org/dls/abc', ' Download  Now ', 'aio-red')
  expect(parseDownloadLink(html, POST_URL)).toBe('https://getcomics.org/dls/abc')
})

test('parseDownloadLink falls back to the link text when there is no title attribute', () => {
  const html = '<div class="aio-button-center"><a href="/dls/xyz">DOWNLOAD NOW</a></div>'
  expect(parseDownloadLink(html, POST_URL)).toBe('https://getcomics.org/dls/xyz')
})

test('parseDownloadLink resolves a relative href against the post url', () => {
  const html = button('/dls/rel-token', 'DOWNLOAD NOW', 'aio-red')
  expect(parseDownloadLink(html, POST_URL)).toBe('https://getcomics.org/dls/rel-token')
})

test('parseDownloadLink returns null when the post offers only third-party mirrors', () => {
  const html = button('https://rootz.so/d/XV7Jo', 'ROOTZ', 'aio-green')
  expect(parseDownloadLink(html, POST_URL)).toBeNull()
})

test('parseDownloadLink returns null for a post with no button block', () => {
  expect(parseDownloadLink('<article><p>Coming soon</p></article>', POST_URL)).toBeNull()
})

test('parseDownloadLink ignores a DOWNLOAD NOW link outside the button block', () => {
  const html = '<p><a href="https://getcomics.org/how-to-download/">DOWNLOAD NOW</a></p>'
  expect(parseDownloadLink(html, POST_URL)).toBeNull()
})

test('parseDownloadLink takes the first DOWNLOAD NOW when a post repeats it', () => {
  const html = button(MAIN, 'DOWNLOAD NOW', 'aio-red') +
    button('https://getcomics.org/dls/second', 'DOWNLOAD NOW', 'aio-red')
  expect(parseDownloadLink(html, POST_URL)).toBe(MAIN)
})
