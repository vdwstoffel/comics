import { load } from 'cheerio'

/** The main-server button, as opposed to TERABOX, ROOTZ, DATANODES and the rest. */
const MAIN_LABEL = 'download now'

/**
 * The url behind a post page's "DOWNLOAD NOW" button, absolute, or null when the post
 * has no such button.
 *
 * A post lists several mirrors — TERABOX, ROOTZ, VIKINGFILE, DATANODES — but only the
 * getcomics ones answer with the file itself; the others are landing pages that a
 * streaming download cannot read. So only the main button is taken, and a post offering
 * nothing else is reported as having no link rather than handed a url that will fail.
 *
 * The search is confined to the button block: "DOWNLOAD NOW" also appears in the page
 * chrome, pointing at the how-to-download article.
 */
export function parseDownloadLink(html: string, postUrl: string): string | null {
  const $ = load(html)
  let found: string | null = null

  $('div.aio-button-center a[href]').each((_, anchor) => {
    if (found) return false
    const label = ($(anchor).attr('title') ?? $(anchor).text()).replace(/\s+/g, ' ').trim()
    if (label.toLowerCase() !== MAIN_LABEL) return
    const href = $(anchor).attr('href')
    if (href) found = new URL(href, postUrl).toString()
  })

  return found
}

/** One download a post offers: a whole run in one zip, or one part of a run split across several. */
export interface PostPart {
  /** What the post calls it - "Daredevil #13 – 23 + Annual (2020)". */
  heading: string
  /** As the post writes it, "482 MB". Absent when the post does not say. */
  size?: string
  url: string
}

export interface PostDownloads {
  title: string | null
  /** The whole post's size, from its "Size :" line. */
  size?: string
  parts: PostPart[]
}

/** The older list's link to the getcomics server, beside TERABOX, MEGA and the rest. */
const MAIN_SERVER = 'main server'
const TRAILING_SIZE = /\s*\(([\d.,]+\s*[KMGT]B)\)\s*$/i
const SIZE_LINE = /Size\s*:\s*([\d.,]+\s*[KMGT]B)/i

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** "Daredevil #1 – 12 (2019) (462 MB) :" into its heading and its size. */
function splitSize(text: string): { heading: string; size?: string } {
  const bare = clean(text).replace(/\s*:\s*$/, '')
  const m = TRAILING_SIZE.exec(bare)
  return m ? { heading: bare.slice(0, m.index).trim(), size: m[1] } : { heading: bare }
}

/**
 * Every main-server download a post offers, each under the heading the post gives it.
 *
 * A run with its annuals is rarely one zip. A post for one is a list of parts of about
 * 450 MB each - "Daredevil #1 – 12", "#13 – 23 + Annual", "#24 – 32" - and taking only
 * the first, as parseDownloadLink does for a single issue, would download a third of the
 * run and call it done.
 *
 * Two layouts, both still served:
 *  - the older list, one `<li>` per part: its text is the heading and size, and its
 *    "Main Server" link is the part's own;
 *  - the newer buttons, a "DOWNLOAD NOW" under a paragraph naming what it downloads.
 *    The markup nests a div in a p, which the parser closes early, so the paragraph is
 *    found by walking back past the mirror buttons rather than by asking for a parent.
 */
export function parsePostDownloads(html: string, postUrl: string): PostDownloads {
  const $ = load(html)
  const title = clean($('h1.post-title').first().text())
    || clean(($('meta[property="og:title"]').attr('content') ?? '').replace(/\s+[–-]\s+GetComics\s*$/i, ''))
    || null
  const sizeLine = SIZE_LINE.exec($('.post-contents').text() || $('article').text())
  const parts: PostPart[] = []
  const seen = new Set<string>()

  function add(href: string | undefined, heading: string, size?: string) {
    if (!href) return
    const url = new URL(href, postUrl).toString()
    if (seen.has(url)) return
    seen.add(url)
    parts.push({ heading: heading || title || 'Download', ...(size ? { size } : {}), url })
  }

  $('div.aio-button-center a[href]').each((_, anchor) => {
    const label = clean($(anchor).attr('title') ?? $(anchor).text())
    if (label.toLowerCase() !== MAIN_LABEL) return
    let prev = $(anchor).closest('div.aio-button-center').prev()
    while (prev.length && (prev.is('div.aio-button-center') || !clean(prev.text()))) prev = prev.prev()
    const named = prev.length ? clean(prev.find('strong').first().text()) : ''
    add($(anchor).attr('href'), named, prev.length ? SIZE_LINE.exec(prev.text())?.[1] : undefined)
  })

  $('a[href]').each((_, anchor) => {
    if (clean($(anchor).text()).toLowerCase() !== MAIN_SERVER) return
    const item = $(anchor).closest('li')
    // The heading is everything in the item before its links.
    const text = item.length ? clean(item.text()).split(/main server/i)[0] ?? '' : ''
    const { heading, size } = splitSize(text)
    add($(anchor).attr('href'), heading, size)
  })

  return { title, ...(sizeLine ? { size: sizeLine[1] } : {}), parts }
}
