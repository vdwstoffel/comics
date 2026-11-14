import { test, expect } from 'vitest'
import { parseDownloadLink, parsePostDownloads } from '../server/lib/comicPostPage.js'

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

// --- Every main-server download a post offers, for a run split across zips.

test('the older list gives one part per item, headed and sized as the post writes it', () => {
  const html = `<h1 class="post-title">Iron Man Vol. 6 #1 &#8211; 25 + Annual</h1>
    <section class="post-contents"><p><strong>Size :</strong> 955 MB</p><ul>
    <li>Iron Man #1 &#8211; 13 (2020-2021) (452 MB) :<br /><strong><a href="/dls/one"><span>Main Server</span></a> | <a href="https://ufile.example/x">UFile</a></strong></li>
    <li>Iron Man #14 &#8211; 25 + Annuals (2022) (503 MB)<strong> :</strong><br /><strong><a href="/dls/two"><span>Main Server</span></a></strong></li>
    </ul></section>`
  expect(parsePostDownloads(html, POST_URL)).toEqual({
    title: 'Iron Man Vol. 6 #1 – 25 + Annual',
    size: '955 MB',
    parts: [
      { heading: 'Iron Man #1 – 13 (2020-2021)', size: '452 MB', url: 'https://getcomics.org/dls/one' },
      { heading: 'Iron Man #14 – 25 + Annuals (2022)', size: '503 MB', url: 'https://getcomics.org/dls/two' },
    ],
  })
})

// The markup nests the button's div in a p, which the parser closes early - so the
// paragraph naming the download is a sibling to walk back to, past the mirror buttons.
test('a newer button is headed by the paragraph above it', () => {
  const html = `<h1 class="post-title">LIFE #1 &#8211; 6 (2024-2025)</h1><section class="post-contents">
    <p style="text-align: center;"><strong>LIFE #1 &#8211; 6 (Empire)</strong><br /><strong>Language :</strong> English | <strong>Size :</strong> 175 MB</p>
    <p style="text-align: center;">${button(MAIN, 'DOWNLOAD NOW', 'aio-red')}
    <p style="text-align: center;">${button('https://1024terabox.com/s/x', 'TERABOX', 'aio-blue')}</section>`
  expect(parsePostDownloads(html, POST_URL).parts).toEqual([{ heading: 'LIFE #1 – 6 (Empire)', size: '175 MB', url: MAIN }])
})

test('a post with only mirrors offers no parts', () => {
  const html = button('https://1024terabox.com/s/x', 'TERABOX', 'aio-blue')
  expect(parsePostDownloads(html, POST_URL).parts).toEqual([])
})
