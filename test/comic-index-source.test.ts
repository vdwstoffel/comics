import { test, expect } from 'vitest'
import { pageUrl, parsePage, BASE_URL } from '../server/lib/comicIndexSource.js'

const PAGE = `
<div class="su-tabs">
  <div class="su-tabs-nav"><span data-title="nav noise">nav</span></div>
  <div class="su-tabs-pane su-u-clearfix su-tabs-pane-open" data-title="&lt;strong&gt;DC Comics&lt;/strong&gt;">
    <ul class="lcp_catlist">
      <li><a href="/dc-one/">DC One</a></li>
      <li><a href="https://getcomics.org/dc-two/">DC Two</a></li>
      <li>no link here</li>
      <li><a href="/blank/"></a></li>
    </ul>
  </div>
  <div class="su-tabs-pane" data-title="&lt;strong&gt;Marvel Comics&lt;/strong&gt;">
    <ul><li><a href="/marvel-one/">Marvel One</a></li></ul>
  </div>
</div>
`

test('pageUrl sets the page param and keeps the fragment', () => {
  expect(pageUrl(7)).toBe('https://getcomics.org/sitemap/?lcp_page0=7#lcp_instance_0')
})

test('pageUrl replaces an existing page param instead of appending a second', () => {
  const url = pageUrl(9, 'https://example.org/sitemap/?foo=bar&lcp_page0=1')
  expect(url).toContain('foo=bar')
  expect(url).toContain('lcp_page0=9')
  expect(url.match(/lcp_page0/g)).toHaveLength(1)
})

test('BASE_URL is the sitemap listing', () => {
  expect(pageUrl(1, BASE_URL)).toContain('lcp_page0=1')
})

test('parsePage returns one entry per linked list item, tagged with its pane category', () => {
  const entries = parsePage(PAGE, 'https://getcomics.org/sitemap/?lcp_page0=1')
  expect(entries).toEqual([
    { title: 'DC One', url: 'https://getcomics.org/dc-one/', category: 'DC Comics' },
    { title: 'DC Two', url: 'https://getcomics.org/dc-two/', category: 'DC Comics' },
    { title: 'Marvel One', url: 'https://getcomics.org/marvel-one/', category: 'Marvel Comics' },
  ])
})

test('parsePage unwraps the markup inside data-title', () => {
  const [entry] = parsePage(PAGE, BASE_URL)
  expect(entry.category).toBe('DC Comics')
  expect(entry.category).not.toContain('strong')
})

test('parsePage ignores a data-title outside a pane', () => {
  const categories = parsePage(PAGE, BASE_URL).map((e) => e.category)
  expect(categories).not.toContain('nav noise')
})

test('parsePage skips items with no link and links with no text', () => {
  const entries = parsePage(PAGE, BASE_URL)
  expect(entries).toHaveLength(3)
  expect(entries.every((e) => e.title.length > 0)).toBe(true)
})

test('parsePage resolves relative hrefs against the page url', () => {
  const [entry] = parsePage('<div class="su-tabs-pane" data-title="X"><li><a href="/rel/">T</a></li></div>',
    'https://getcomics.org/sitemap/?lcp_page0=4')
  expect(entry.url).toBe('https://getcomics.org/rel/')
})

test('parsePage returns nothing for a page with no panes', () => {
  expect(parsePage('<div>nothing here</div>', BASE_URL)).toEqual([])
})

test('parsePage skips a pane whose data-title is empty', () => {
  const entries = parsePage('<div class="su-tabs-pane" data-title=""><li><a href="/a/">T</a></li></div>', BASE_URL)
  expect(entries).toEqual([])
})
