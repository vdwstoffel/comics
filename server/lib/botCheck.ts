/**
 * Telling "the site wants a human" apart from "the download failed".
 *
 * Both arrive as a response with no comic in it, and until this existed they were the
 * same thing: a queue row marked failed, carrying whatever the response happened to say.
 * They are not the same thing. A failure is worth another attempt; a bot check is not,
 * because the next automated try meets the same page. And it is the only failure a person
 * can finish themselves - the check is asking for a browser, and they have one.
 */

export interface Answered {
  status: number
  contentType: string | null
}

/**
 * Whether this response is the file host asking for a browser rather than serving the
 * comic.
 *
 * Three shapes, all seen from the same source:
 *  - 403, the plain refusal of a request that did not look like a browser. This is what
 *    the queue was recording as a bare "403 Forbidden".
 *  - 503, which is the status a challenge has historically been served under.
 *  - 200 carrying `text/html`, the interstitial served in the file's place. The worst of
 *    the three, because HTTP calls it a success: without this check the page of markup
 *    streams into a file named like a comic, and the only thing that notices is the zip
 *    guard in storeComic, which reports it as "not a valid .cbz (no image pages)" - a
 *    corrupt comic, which it is not.
 *
 * A 200 of HTML need not strictly BE a challenge - it could be some other error page -
 * but the conclusion is the same either way: no comic came back, nothing is gained by
 * fetching it again, and a browser is the way through. That is what this function is
 * read for, so it is what it is named for.
 */
export function needsABrowser({ status, contentType }: Answered): boolean {
  if (status === 403 || status === 503) return true
  if (status !== 200) return false
  return /^text\/html\b/i.test((contentType ?? '').trim())
}
