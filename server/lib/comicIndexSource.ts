import { load } from 'cheerio'
import { stripHtml } from './html.js'
import type { ComicIndexEntry } from '../types.js'

export const BASE_URL = 'https://getcomics.org/sitemap/'
export const USER_AGENT = 'comic-app/0.1 (self-hosted personal comic library)'
const PAGE_PARAM = 'lcp_page0'
const FRAGMENT = 'lcp_instance_0'

/** Set ?lcp_page0=<n> on the listing url, replacing any existing value. */
export function pageUrl(page: number, base: string = BASE_URL): string {
  const url = new URL(base)
  url.searchParams.set(PAGE_PARAM, String(page))
  url.hash = FRAGMENT
  return url.toString()
}

/**
 * Flatten one listing page into entries. Each tab pane carries its category in a
 * data-title attribute holding markup ("<strong>Marvel Comics</strong>"), so the label
 * is unwrapped before use. Items with no link, no text, or in a pane with no label are
 * skipped rather than stored half-formed.
 */
export function parsePage(html: string, baseUrl: string): ComicIndexEntry[] {
  const $ = load(html)
  const entries: ComicIndexEntry[] = []

  $('div.su-tabs-pane[data-title]').each((_, pane) => {
    const category = stripHtml($(pane).attr('data-title'))
    if (!category) return

    $(pane).find('li a[href]').each((_, anchor) => {
      const title = $(anchor).text().trim()
      const href = $(anchor).attr('href')
      if (!title || !href) return
      entries.push({ title, url: new URL(href, baseUrl).toString(), category })
    })
  })

  return entries
}

/**
 * GET one page from the source as text, saying who we are. Both the listing scraper and
 * the post-page reader come through here, so there is one place that decides how this
 * app identifies itself and what counts as a failed fetch.
 */
export async function fetchSourcePage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())
  return res.text()
}
