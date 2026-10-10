import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useDownload } from '../lib/useDownload'
import { findIssueHref } from '../lib/findIssueHref'
import IssueAction from './IssueAction'
import IssueUploadAction from './IssueUploadAction'

interface MissingIssueActionProps {
  editionId: string
  /** Comic Vine's id for the issue - what the download endpoint is addressed by. */
  issueId: number
  /** `#12`, which is what the control is named for. */
  label: string
  /** The one scraped row that is this issue, when there is exactly one. */
  match?: { indexId: number; title: string } | null
  coverDate?: string
  /** What Find searches for, which is the series rather than this one issue. */
  seriesName: string
  /**
   * What the run is called, which is where an uploaded comic is filed. Only a run knows
   * this - which is why the upload offer lives here rather than in IssueAction itself.
   */
  editionName: string
  /**
   * Whether to offer the upload beside Get. Off by default: the run's sidebar lists every
   * gap at once, and a file picker on each row is a column of controls for comics you are
   * not looking at. Uploading is something you do while looking at the one comic.
   */
  offerUpload?: boolean
}

/**
 * The offer to fill one gap, wired to the server.
 *
 * Its own component because the mutation has to be per issue: two gaps can be mid-press
 * at once, and a failure belongs to the press that failed rather than to the page. The
 * volume page draws this in two places - beside the centred issue and in the sidebar's
 * list - and both are the same offer about the same issue.
 *
 * Two offers now: fetch the one release the index found, or hand over a file you already
 * have. The second is the useful one exactly where the first is not available, which is a
 * gap with no certain match.
 */
export default function MissingIssueAction({
  editionId, issueId, label, match, coverDate, seriesName, editionName, offerUpload,
}: MissingIssueActionProps) {
  const qc = useQueryClient()
  const { liveByIssue } = useDownload()

  const get = useMutation({
    mutationFn: () => api.downloadMissingIssue(editionId, issueId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['download'] }),
  })

  return (
    <IssueAction
      label={label}
      hasMatch={match != null}
      matchTitle={match?.title}
      findTo={findIssueHref(seriesName, coverDate)}
      onGet={() => get.mutate()}
      pending={get.isPending}
      failed={get.isError}
      queued={liveByIssue.has(issueId)}
      upload={offerUpload
        ? <IssueUploadAction editionName={editionName} issueId={issueId} label={label} />
        : undefined}
    />
  )
}
