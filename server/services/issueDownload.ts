import { findMatchForIssue } from './issueMatching.js'
import { comicIndexById } from '../models/comicIndex.js'
import { parseDownloadLink } from '../lib/comicPostPage.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { QueueEntry } from '../models/downloadQueue.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'
import type { App } from '../types.js'

export type IssueDownloadResult =
  | { ok: true; entry: QueueEntry }
  | { ok: false; code: 404 | 409 | 502; reason: 'no-match' | 'duplicate' | 'unreadable' | 'no-link'; error: string; entry?: QueueEntry }

/**
 * What the queue calls an issue: Comic Vine's volume name and the issue number,
 * `Wolverine #27`. Both halves are nullable, so the join can come out empty - and an empty
 * string is not null, so it would survive every `?? entry.url` fallback downstream and
 * render as a blank row with an aria-label reading "Cancel ". Nothing to say returns
 * nothing, and the caller falls back.
 */
export function issueLabel(volumeName?: string | null, number?: string | null): string | undefined {
  return [volumeName, number && `#${number}`].filter(Boolean).join(' ').trim() || undefined
}

/**
 * Everything between "this issue is missing" and "the downloader is running": re-derive
 * the match, read the scraped row, fetch the post, parse the link out of it, start.
 *
 * The match is re-derived here rather than taken from the client. The page that offered
 * the button computed one, but the index can be rescraped between the render and the
 * press, and a download the server did not decide on is a download nobody checked.
 *
 * `volumeName` is Comic Vine's name for the volume and is what the match keys on.
 * `editionName` is where the file lands - the same thing for the Latest tab, but an
 * edition's own hand-editable name when the press came from an edition page.
 */
export async function startIssueDownload(
  app: App,
  { volumeName, editionName, issue, label, fetchPage = fetchSourcePage }: {
    volumeName: string | null
    editionName: string
    issue: CvVolumeIssue
    /** What the queue shows for this row; the url stands in when there is no name. */
    label?: string
    /** Injected so tests never touch the network. */
    fetchPage?: (url: string) => Promise<string>
  },
): Promise<IssueDownloadResult> {
  const match = findMatchForIssue(app.db, volumeName, issue)
  if (!match) return { ok: false, code: 409, reason: 'no-match', error: 'no unique match for that issue' }

  const row = comicIndexById(app.db, match.indexId)
  if (!row) return { ok: false, code: 409, reason: 'no-match', error: 'no unique match for that issue' }

  let url: string | null = null
  try {
    url = parseDownloadLink(await fetchPage(row.url), row.url)
  } catch {
    return { ok: false, code: 502, reason: 'unreadable', error: 'could not read that post' }
  }
  if (!url) return { ok: false, code: 404, reason: 'no-link', error: 'no download link on that post' }

  const res = app.downloader.enqueue({ url, edition: editionName, issueId: issue.id, label: label || url })
  if (!res.queued) {
    return {
      ok: false, code: 409, reason: 'duplicate',
      error: 'that issue is already queued', entry: res.duplicate,
    }
  }
  return { ok: true, entry: res.entry }
}
