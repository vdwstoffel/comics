import type { ApiCollectsProposal } from '../api'

interface CollectsBannerProps {
  /** What this edition looks like it reprints, offered for confirming. */
  proposal: ApiCollectsProposal | null
  /** Whether that is already the answer - in which case there is nothing to ask. */
  confirmed: boolean
  saving: boolean
  onConfirm: (proposal: ApiCollectsProposal) => void
  /** No: this collects nothing. */
  onDecline: () => void
}

/** A Comic Vine volume, however it was pasted: a full url, a `4050-N`, or a bare id. */
export function volumeIdFrom(text: string): number | null {
  const found = /(?:4050-)?(\d{2,})\s*\/?\s*$/.exec(text.trim())
  return found ? Number(found[1]) : null
}

/** "The Amazing Spider-Man (2022)", or the id when Comic Vine gave us no name. */
export function volumeLabel(volume: { volumeId: number; name: string | null; startYear: number | null }): string {
  const name = volume.name ?? `Volume ${volume.volumeId}`
  return volume.startYear ? `${name} (${volume.startYear})` : name
}

/**
 * Comic Vine's page for a volume. Built when Comic Vine gave us no link: the id is
 * enough for its resolver, and a suggestion you cannot check is not checkable.
 */
export function volumeHref(volume: { volumeId: number; siteUrl: string | null }): string {
  return volume.siteUrl ?? `https://comicvine.gamespot.com/volume/4050-${volume.volumeId}/`
}

/**
 * What this edition looks like it reprints, asked once on the page.
 *
 * Comic Vine gives every collected-edition line a volume of its own, so three paperback
 * lines of one run look like three unrelated runs. The fix is a second link - what this
 * reprints, beside what it is - and this is where Comic Vine's suggestion for it is
 * answered.
 *
 * It is confirmed rather than applied because the failure is invisible. A wrong
 * `comicvine_id` shows up at once as a wrong cover or a wrong issue list; a wrong
 * collects link quietly folds two unrelated runs onto one shelf and looks, at a glance,
 * exactly like the feature working. So the volume is named, linked for checking, and
 * nothing is written until someone has looked.
 *
 * Only the question lives on the page. The answer, once given, is a few words on the
 * count line, and setting one by hand or taking one back happens in the edit dialog:
 * most editions collect nothing, and a standing control on every one of them was three
 * rows of noise above the comics to serve the few that do.
 */
export default function CollectsBanner({ proposal, confirmed, saving, onConfirm, onDecline }: CollectsBannerProps) {
  if (!proposal || confirmed) return null

  return (
    <div className="edition__cv-suggestion">
      <span>
        This looks like a collection of{' '}
        <a href={volumeHref(proposal)} target="_blank" rel="noreferrer">{volumeLabel(proposal)}</a>
      </span>
      <button type="button" className="btn" disabled={saving} onClick={() => onConfirm(proposal)}>
        Yes
      </button>
      <button type="button" className="btn btn-ghost" disabled={saving} onClick={onDecline}>
        No
      </button>
    </div>
  )
}
