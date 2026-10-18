import { useState } from 'react'
import type { ApiCollectsProposal } from '../api'

interface CollectsBannerProps {
  /** What this edition reprints: confirmed, or offered for confirming. */
  proposal: ApiCollectsProposal | null
  confirmed: boolean
  saving: boolean
  onConfirm: (proposal: ApiCollectsProposal) => void
  /** No - either "this collects nothing" or taking a wrong confirmation back. */
  onDecline: () => void
  /** Ask Comic Vine again, after a decline or a miss. */
  onRecheck?: () => void
  /** Set the link from a volume id the user supplies. */
  onSetByHand?: (volumeId: number) => void
}

/** A Comic Vine volume, however it was pasted: a full url, a `4050-N`, or a bare id. */
export function volumeIdFrom(text: string): number | null {
  const found = /(?:4050-)?(\d{2,})\s*\/?\s*$/.exec(text.trim())
  return found ? Number(found[1]) : null
}

/**
 * What this edition reprints, and the one place it is decided.
 *
 * Comic Vine gives every collected-edition line a volume of its own, so three paperback
 * lines of one run look like three unrelated runs. The fix is a second link - what this
 * reprints, beside what it is - and this is where that link is confirmed.
 *
 * It is confirmed rather than applied because the failure is invisible. A wrong
 * `comicvine_id` shows up at once as a wrong cover or a wrong issue list; a wrong
 * collects link quietly folds two unrelated runs onto one shelf and looks, at a glance,
 * exactly like the feature working. So the volume is named, linked for checking, and
 * nothing is written until someone has looked.
 *
 * Once confirmed it says "Shelved under", not "Collects", because the field turned out
 * to do two jobs. Most of the time it is what it was built for - this omnibus reprints
 * that run. But it is also the only way to correct an edition matched to the wrong
 * volume: "Batman (2012)" that is really the 2011 run does not COLLECT the 2011 run, it
 * IS it. Nothing in the data tells those two apart, and nothing needs to - both belong
 * on that volume's shelf, which is what the wording now says and what the app does.
 *
 * When there is nothing to propose it shrinks to one quiet control. Detection reads
 * prose a Comic Vine editor typed and will miss; a miss, or a mistaken No, must not cost
 * the feature on that edition for good. But most editions collect nothing at all, and a
 * standing form on every one of them would be noise on a hundred pages to serve three.
 */
export default function CollectsBanner({
  proposal, confirmed, saving, onConfirm, onDecline, onRecheck, onSetByHand,
}: CollectsBannerProps) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')

  if (!proposal) {
    if (!onSetByHand && !onRecheck) return null
    if (!open) {
      return (
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          Part of another volume?
        </button>
      )
    }
    return (
      <div className="edition__cv-suggestion">
        <input
          className="collects-by-hand__input"
          value={typed}
          placeholder="Comic Vine volume link or id"
          aria-label="Comic Vine volume link or id"
          onChange={(e) => setTyped(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={() => {
            const volumeId = volumeIdFrom(typed)
            // Nothing that names a volume is not an answer; leave the field as typed so
            // it can be corrected rather than silently cleared.
            if (volumeId != null) onSetByHand?.(volumeId)
          }}
        >
          Set
        </button>
        {onRecheck && (
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={onRecheck}>
            Ask Comic Vine
          </button>
        )}
      </div>
    )
  }

  const name = proposal.name ?? `Volume ${proposal.volumeId}`
  const label = proposal.startYear ? `${name} (${proposal.startYear})` : name
  // Built rather than taken from siteUrl when Comic Vine gave us no link: the volume id
  // is enough for their resolver, and a proposal you cannot check is not checkable.
  const href = proposal.siteUrl ?? `https://comicvine.gamespot.com/volume/4050-${proposal.volumeId}/`

  return (
    <div className="edition__cv-suggestion">
      <span>
        {confirmed ? 'Shelved under ' : 'This looks like a collection of '}
        <a href={href} target="_blank" rel="noreferrer">{label}</a>
      </span>
      {confirmed ? (
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={onDecline}>
          Not this volume
        </button>
      ) : (
        <>
          <button type="button" className="btn" disabled={saving} onClick={() => onConfirm(proposal)}>
            Yes
          </button>
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={onDecline}>
            No
          </button>
        </>
      )}
    </div>
  )
}
