/**
 * Read a Comic Vine issue id out of whatever the user pasted.
 *
 * Comic Vine's issue search is down, so a comic is bound to its record by hand, and the
 * person doing it copies whatever the browser shows: a full link, a link with tracking
 * on the end, the bare "4000-1197227" token from the URL, or just the number. All four
 * must land on the same id.
 *
 * Comic Vine prefixes every resource in its URLs with a four-digit type code, so the
 * prefix is what says whether a pasted link is an issue at all. A volume link is the
 * likeliest wrong paste, since the volume page is the one people land on first, so it
 * gets its own message rather than the generic refusal.
 */

export type CvIssueIdResult = { ok: true; id: number } | { ok: false; error: string }

const HOST = 'comicvine.gamespot.com'

const NOT_AN_ID = 'That does not look like a Comic Vine issue id or link.'

// The resource codes Comic Vine uses in its URLs. Only the ones that come up in practice
// are named; any other code still gets refused, just with a message that says which code.
// This mirrors TYPE_PREFIX in server/lib/comicvine.ts, the source of truth. It is copied
// rather than imported because src/ never reaches into server/, so if you change one,
// check the other.
const RESOURCE_NAMES: Record<string, string> = {
  '4005': 'character',
  '4045': 'story arc',
  '4050': 'volume',
}

// The "NNNN-NNNN" token Comic Vine puts in an issue URL. The word boundary keeps a longer
// run of digits from being read as a resource code plus id.
const TOKEN_RE = /\b(\d{4})-(\d+)\b/

const BARE_ID_RE = /^\d+$/

export function parseCvIssueId(input: string): CvIssueIdResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: NOT_AN_ID }

  // The query and fragment never carry the id; dropping them first keeps a "#" or "?"
  // from being mistaken for part of the path.
  const path = trimmed.split(/[?#]/)[0]

  // A link must point at Comic Vine. Without this, a token copied from some other site's
  // URL would bind a comic to the wrong record. A dot in the first segment is what makes
  // it a host, so a bare "4000-1197227/" is still read as the token it is.
  const host = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0].toLowerCase()
  if ((path.includes('://') || host.includes('.')) && host !== HOST) {
    return { ok: false, error: NOT_AN_ID }
  }

  // Comic Vine puts the resource token in the final path segment, and a slug earlier in
  // the path can carry a run of digits that looks like one ("spider-man-2099-1").
  const segments = path.split('/').filter(Boolean)
  const token = TOKEN_RE.exec(segments[segments.length - 1] ?? '')
  if (token) {
    const [, prefix, digits] = token
    if (prefix === '4000') {
      const id = Number(digits)
      return id > 0 && Number.isSafeInteger(id) ? { ok: true, id } : { ok: false, error: NOT_AN_ID }
    }
    if (prefix === '4050') {
      return { ok: false, error: 'That is a volume link. Paste the link to a single issue.' }
    }
    const name = RESOURCE_NAMES[prefix]
    return {
      ok: false,
      error: name
        ? `That is a ${name} link. Paste the link to a single issue.`
        : `That is a Comic Vine ${prefix} link, not an issue. Paste the link to a single issue.`,
    }
  }

  if (BARE_ID_RE.test(path)) {
    const id = Number(path)
    if (id > 0 && Number.isSafeInteger(id)) return { ok: true, id }
  }

  return { ok: false, error: NOT_AN_ID }
}
