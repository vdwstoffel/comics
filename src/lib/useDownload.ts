import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { DownloadStatus } from '../api'

const POLL_MS = 500

/** What a newly stored comic could show up in. */
const LIBRARY_KEYS = [['editions'], ['series'], ['edition'], ['edition-issues']]

export interface DownloadView {
  status: DownloadStatus | undefined
  /** A finished run worth showing, or null when there is nothing to report. */
  result: DownloadStatus | null
  dismiss: () => void
}

/**
 * The one view of the server's download, shared by every page.
 *
 * Nothing here is gated on a page having started the run. A download outlives the page
 * that asked for it — it is a job on the server, not a thing the upload form is doing —
 * so the server's own `running` flag decides whether to poll. That is what lets you
 * navigate away mid-download and still be told when it lands.
 *
 * The two pieces of client state live in the query cache rather than in a component,
 * for the same reason: a component that unmounts on every navigation cannot remember
 * which run it has already dealt with.
 */
export function useDownload(): DownloadView {
  const qc = useQueryClient()

  const { data: status } = useQuery({
    queryKey: ['download'],
    queryFn: api.getDownload,
    refetchInterval: (q) => (q.state.data?.running ? POLL_MS : false),
  })

  const { data: dismissedAt } = useQuery<string | null>({
    queryKey: ['download-dismissed'],
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  // A run is over only once it is both stopped and stamped; an idle server has neither.
  const finishedAt = status && !status.running ? status.finishedAt ?? null : null

  // Refresh the library once per run, wherever the reader happens to be standing.
  // Keyed on the stamp so remounting a page does not re-run it for a run already dealt
  // with, and a later run is still handled on its own account.
  useEffect(() => {
    if (!finishedAt || qc.getQueryData(['download-handled']) === finishedAt) return
    qc.setQueryData(['download-handled'], finishedAt)
    for (const key of LIBRARY_KEYS) qc.invalidateQueries({ queryKey: key })
  }, [finishedAt, qc])

  return {
    status,
    result: finishedAt && dismissedAt !== finishedAt ? status ?? null : null,
    dismiss: () => { if (finishedAt) qc.setQueryData(['download-dismissed'], finishedAt) },
  }
}
