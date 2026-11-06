import type { ApiRunPart } from '../api'
import { volumeHref, volumeLabel } from './CollectsBanner'

interface RunPartsBannerProps {
  /** What Comic Vine's note on the run suggests, until it is answered. */
  proposal: ApiRunPart | null
  saving: boolean
  onConfirm: (part: ApiRunPart) => void
  /** No: that volume is not part of this run. */
  onDecline: (volumeId: number) => void
}

/** " #7–13", " #7", or nothing when the stretch is not known yet. */
export function partSpan(part: ApiRunPart): string {
  if (!part.first) return ''
  return part.last && part.last !== part.first ? ` #${part.first}–${part.last}` : ` #${part.first}`
}

/**
 * Another Comic Vine volume that looks like part of this run, asked once on the page.
 *
 * Comic Vine names a volume after its indicia, so a run retitled for a stretch is split
 * in two: Thor (2025) jumps from #6 to #800, because #7-13 were printed as Mortal Thor
 * and filed as a volume of their own. Taking that volume in puts its issues back between
 * #6 and #800 - drawn, matched and followed as the run's own.
 *
 * Asked rather than applied, like the collects question beside it. The suggestion comes
 * from Comic Vine's own note on the run, checked against the issue numbers, and is right
 * often enough to offer and not so often that it should change a run unasked. Only the
 * question lives here: an answer is a few words on the count line, and adding a volume
 * by hand or taking one back happens in the edit dialog.
 */
export default function RunPartsBanner({ proposal, saving, onConfirm, onDecline }: RunPartsBannerProps) {
  if (!proposal) return null

  return (
    <div className="edition__cv-suggestion">
      <span>
        Continues as{' '}
        <a href={volumeHref(proposal)} target="_blank" rel="noreferrer">{volumeLabel(proposal)}</a>
        {partSpan(proposal)}?
      </span>
      <button type="button" className="btn" disabled={saving} onClick={() => onConfirm(proposal)}>
        Yes
      </button>
      <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => onDecline(proposal.volumeId)}>
        No
      </button>
    </div>
  )
}
