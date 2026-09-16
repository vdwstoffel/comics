import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { DownloadsView, QueueEntry } from '../api'

const POLL_MS = 500

/** What a newly stored comic could show up in. */
const LIBRARY_KEYS = [['editions'], ['series'], ['edition'], ['edition-issues']]

export interface DownloadView {
  data: DownloadsView | undefined
  active: DownloadsView['active']
  queue: QueueEntry[]
  history: QueueEntry[]
  /** Live entries by Comic Vine issue id, so a tile can say Queued instead of Get. */
  liveByIssue: Map<number, QueueEntry>
}

/**
 * The one view of the server's downloads, shared by every page.
 *
 * Polling is driven by the server's own state, not by whether this page started anything:
 * a download outlives the page that asked for it. The single-`finishedAt` dismissal this
 * hook used to carry is gone - with a queue, several runs finish in a row, and the history
 * list is what represents that.
 */
export function useDownload(): DownloadView {
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['download'],
    queryFn: api.getDownloads,
    refetchInterval: (q) => {
      const d = q.state.data
      return d && (d.active.length > 0 || d.queue.length > 0) ? POLL_MS : false
    },
  })

  const active = data?.active ?? []
  const queue = data?.queue ?? []
  const history = data?.history ?? []

  // Refresh the library once per completed run, wherever the reader is standing. Keyed on
  // the newest finished id so a remount does not redo one already dealt with - but id
  // alone is not enough: `retry` reuses the same row id, only clearing `finishedAt` and
  // re-stamping it on the next completion, so a retried success needs `finishedAt` in the
  // key too or it would be mistaken for the failure already handled.
  const newest = history[0]
  const newestDone = newest ? `${newest.id}:${newest.finishedAt}` : null
  useEffect(() => {
    if (newestDone == null || qc.getQueryData(['download-handled']) === newestDone) return
    qc.setQueryData(['download-handled'], newestDone)
    for (const key of LIBRARY_KEYS) qc.invalidateQueries({ queryKey: key })
  }, [newestDone, qc])

  const liveByIssue = new Map<number, QueueEntry>()
  for (const entry of queue) if (entry.cvIssueId != null) liveByIssue.set(entry.cvIssueId, entry)

  return { data, active, queue, history, liveByIssue }
}
