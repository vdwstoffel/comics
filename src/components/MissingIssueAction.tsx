import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useDownload } from '../lib/useDownload'
import { findIssueHref } from '../lib/findIssueHref'
import IssueAction from './IssueAction'

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
}

/**
 * The offer to fill one gap, wired to the server.
 *
 * Its own component because the mutation has to be per issue: two gaps can be mid-press
 * at once, and a failure belongs to the press that failed rather than to the page. The
 * volume page draws this in two places - beside the centred issue and in the sidebar's
 * list - and both are the same offer about the same issue.
 */
export default function MissingIssueAction({
  editionId, issueId, label, match, coverDate, seriesName,
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
    />
  )
}
