import { basename } from 'node:path'

/** The library holds comic archives; anything else is not a comic and must not be named as one. */
const COMIC_EXT = /\.(cbz|cbr)$/i

/** `filename*=UTF-8''name%20here` — the encoded form, which wins when both are present. */
const EXTENDED = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i
/** `filename="name here"` or `filename=name` */
const PLAIN = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i

function fromDisposition(header: string): string | null {
  const extended = EXTENDED.exec(header)
  if (extended) {
    try { return decodeURIComponent(extended[1].trim()) } catch { return extended[1].trim() }
  }
  const plain = PLAIN.exec(header)
  const raw = plain?.[1] ?? plain?.[2]
  return raw?.trim() || null
}

function fromUrl(url: string): string | null {
  try {
    // Only the path: a token in the query string is not what the file is called.
    const { pathname } = new URL(url)
    return decodeURIComponent(pathname.split('/').pop() ?? '') || null
  } catch {
    return null
  }
}

/**
 * What to call a comic being downloaded, or null when nothing says.
 *
 * The link you paste is often an opaque token — getcomics hands out
 * `/dls/VihnoomBUb2Wfcz/…` — and the real name only appears on the URL it redirects to,
 * so callers must pass the FINAL url, after redirects, not the one the user typed.
 *
 * Content-Disposition wins when present, being the server saying outright what the file
 * is called. The result is reduced to a bare basename: this name becomes a path on disk,
 * and nothing in it may climb out of the directory it is written to.
 */
export function downloadFileName(finalUrl: string, contentDisposition?: string | null): string | null {
  const candidate = (contentDisposition ? fromDisposition(contentDisposition) : null) ?? fromUrl(finalUrl)
  if (!candidate) return null

  const name = basename(candidate.replace(/\\/g, '/')).trim()
  if (!name || name === '.' || name === '..') return null
  return COMIC_EXT.test(name) ? name : null
}
