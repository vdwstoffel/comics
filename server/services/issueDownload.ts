import { findMatchForIssue } from './issueMatching.js'
import { comicIndexById } from '../models/comicIndex.js'
import { parseDownloadLink } from '../lib/comicPostPage.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { DownloadStatus } from './downloader.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'
import type { App } from '../types.js'

export type IssueDownloadResult =
  | { ok: true; status: DownloadStatus }
  | { ok: false; code: 404 | 409 | 502; reason: 'no-match' | 'busy' | 'unreadable' | 'no-link'; error: string }

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
  { volumeName, editionName, issue, fetchPage = fetchSourcePage }: {
    volumeName: string | null
    editionName: string
    issue: CvVolumeIssue
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

  const { started, status } = app.downloader.start({ url, edition: editionName, issueId: issue.id })
  if (!started) return { ok: false, code: 409, reason: 'busy', error: 'a download is already running' }
  return { ok: true, status }
}
