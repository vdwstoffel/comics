import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { uploadComic } from '../lib/uploadComic'
import type { QueueEntry } from '../api'

export interface BlockedHandoffProps {
  entry: QueueEntry
}

/** What a newly stored comic could show up in. The same set useDownload invalidates. */
const LIBRARY_KEYS = [['editions'], ['series'], ['edition'], ['edition-issues']]

/**
 * One download the site refused to serve to a program, and the two things left to do
 * about it: open the post in a browser, and hand back what the browser got.
 *
 * The point of this control is everything it does NOT ask you for. The row still knows
 * which Comic Vine issue it was queued for and which run it was going into, so the file
 * goes through the same `storeComic` path the download would have taken: metadata read
 * from the issue id rather than guessed from the file name, filed into the run, named to
 * match. Without it the same recovery means the Upload page, finding the run by hand,
 * finding the issue by hand, and hoping the file name is close enough to match on - which
 * is the work this exists to delete.
 *
 * The upload is what dismisses the row. Asking someone to confirm they had just done the
 * thing the page watched them do is a button that only ever has one answer; Dismiss stays
 * for the other ending, where the comic is not coming.
 */
export default function BlockedHandoff({ entry }: BlockedHandoffProps) {
  const qc = useQueryClient()
  const [percent, setPercent] = useState<number | null>(null)

  const name = entry.label ?? entry.url
  // The post is the page a browser can open; the row's own url is the /dls/ token that
  // just refused us. Rows queued before post_url existed have only the latter, and a
  // token is still better than no way back to the site at all.
  const openAt = entry.postUrl ?? entry.url

  function settle() {
    qc.invalidateQueries({ queryKey: ['download'] })
    for (const key of LIBRARY_KEYS) qc.invalidateQueries({ queryKey: key })
  }

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const result = await uploadComic({
        file,
        edition: entry.edition,
        issueId: entry.cvIssueId,
        onProgress: setPercent,
      })
      // Only once the comic is actually stored. Dismissing first would lose the one row
      // that remembers which issue this file is for, and a failed upload would leave
      // nothing to try again from.
      await api.dismissBlocked(entry.id)
      return result
    },
    onSuccess: () => { setPercent(null); settle() },
    onError: () => setPercent(null),
  })

  const dismiss = useMutation({
    mutationFn: () => api.dismissBlocked(entry.id),
    onSuccess: settle,
  })

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Picking the same file twice is a real thing to do after a failure, and the input
    // fires nothing on an unchanged value.
    e.target.value = ''
    if (file) upload.mutate(file)
  }

  const busy = upload.isPending
  const text = busy ? `Adding… ${percent ?? 0}%` : '↑ Add the file'

  return (
    <li className="queue-list__row queue-list__row--blocked">
      <span className="queue-list__label">{name}</span>
      <span className="queue-list__error">The site asked for a browser.</span>

      <a className="btn btn-ghost" href={openAt} target="_blank" rel="noreferrer">
        Open post
      </a>

      <label className="btn btn-ghost">
        {text}
        <input
          type="file"
          accept=".cbz,.cbr"
          className="volume-issue__file"
          aria-label={busy ? `Adding ${name}` : `Add the file for ${name}`}
          disabled={busy}
          onChange={choose}
        />
      </label>

      <button
        type="button" className="btn btn-ghost"
        aria-label={`Dismiss ${name}`}
        disabled={busy || dismiss.isPending}
        onClick={() => dismiss.mutate()}
      >Dismiss</button>

      {upload.isError && <span className="queue-list__error">Could not add that one.</span>}
      {upload.data?.metadataApplied === false && (
        <span className="queue-list__error">Added, but the metadata could not be applied.</span>
      )}
    </li>
  )
}
