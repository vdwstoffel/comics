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
