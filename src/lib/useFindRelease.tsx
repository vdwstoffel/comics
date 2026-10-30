import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import FindReleaseDialog from '../components/FindReleaseDialog'
import type { IssueSeed } from './findIssueSeed'

/**
 * Wire one gap's `Find` to the dialog that fills it.
 *
 * Four pages draw a gap - the edition grid, the run sidebar and carousel, the arc page
 * and This week - and all four need the same two things: a handler for the button and
 * the dialog itself, rendered somewhere. Shared so they cannot drift into opening it
 * three slightly different ways, the same reason `IssueAction` is shared.
 *
 * The invalidation lives here rather than in each caller's mutation because it is the
 * same in all four and it is what makes the gap's tile flip to `Queued`: the queue is
 * keyed by Comic Vine issue id, so refreshing it is what tells the tile the download it
 * just started is now in flight.
 */
export function useFindRelease({ gapLabel, seed, onDownload }: {
  gapLabel: string
  seed: IssueSeed
  onDownload: (indexId: number) => Promise<unknown>
}): { onFind: () => void; dialog: React.ReactNode } {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  return {
    onFind: () => setOpen(true),
    // Through a portal, because a gap is drawn deep inside a grid tile or the carousel
    // and the dialog's backdrop is position:fixed. A transform on ANY ancestor makes a
    // fixed box anchor to that ancestor instead of the viewport, and there are several
    // on the way up - `.cover-tile:hover` lifts by 5px, the carousel moves its cards.
    // The modal would land inside a comic cover. Rendering at the body sidesteps the
    // whole question, and overflow clipping with it.
    dialog: open
      ? createPortal(
        <FindReleaseDialog
          gapLabel={gapLabel}
          seed={seed}
          onDownload={async (indexId) => {
            const res = await onDownload(indexId)
            qc.invalidateQueries({ queryKey: ['download'] })
            return res
          }}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )
      : null,
  }
}
