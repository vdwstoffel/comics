import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ApiCollectsProposal, ApiRunPart } from '../api'
import { volumeHref, volumeIdFrom, volumeLabel } from './CollectsBanner'
import { partSpan } from './RunPartsBanner'

interface EditionLinksProps {
  /** The volume this edition is confirmed to reprint, if any. */
  collects: ApiCollectsProposal | null
  onSetCollects: (volumeId: number) => Promise<unknown>
  onClearCollects: () => void
  /** Ask Comic Vine again what this reprints. Its answer is asked on the page. */
  onRecheckCollects: () => void
  /** The run's other volumes. Null when the edition has no volume of its own, so there
   *  is no run for another volume to be part of. */
  parts: ApiRunPart[] | null
  onAddPart: (volumeId: number) => Promise<unknown>
  onRemovePart: (volumeId: number) => void
  saving: boolean
  /** Why the last change was refused, in the server's words. */
  error?: string | null
}

/**
 * A field taking a Comic Vine volume link or id, and the one button that acts on it.
 *
 * The field keeps what was typed until the answer is in, so a refusal leaves it there to
 * be corrected; nothing that names a volume is not sent at all.
 */
function VolumeField({ id, label, action, saving, onSubmit, children }: {
  id: string
  label: string
  action: string
  saving: boolean
  onSubmit: (volumeId: number) => Promise<unknown>
  /** Anything else that belongs on the row, after the button. */
  children?: ReactNode
}) {
  const [typed, setTyped] = useState('')
  const submit = () => {
    const volumeId = volumeIdFrom(typed)
    if (volumeId == null) return
    onSubmit(volumeId).then(() => setTyped(''), () => {})
  }
  return (
    <div className="cv-id-row__controls">
      <input
        id={id}
        value={typed}
        placeholder="Comic Vine volume link or id"
        aria-label={label}
        onChange={(e) => setTyped(e.target.value)}
        // Enter here means this field's button, never the dialog's Save.
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
      />
      <button type="button" className="btn" disabled={saving} onClick={submit}>{action}</button>
      {children}
    </div>
  )
}

/**
 * How this edition is tied to Comic Vine volumes other than its own: what it reprints,
 * and which other volumes hold issues of its run.
 *
 * In the edit dialog rather than on the page. Both are set once and then left, and most
 * editions have neither, so a standing control for each on every page was rows of noise
 * above the comics. The page keeps what needs you - a suggestion to answer - and says in
 * a few words on its count line what has been answered. Each change here acts at once,
 * on its own button: none of it waits for Save, which is about the fields above.
 */
export default function EditionLinks({
  collects, onSetCollects, onClearCollects, onRecheckCollects,
  parts, onAddPart, onRemovePart, saving, error,
}: EditionLinksProps) {
  return (
    <section className="edition-links" aria-label="Comic Vine">
      <h4 className="edition-links__heading">Comic Vine</h4>

      <div className="cv-id-row">
        <label htmlFor="edition-collects">Part of another volume</label>
        {collects ? (
          <div className="edition-links__row">
            <span>
              Shelved under{' '}
              <a href={volumeHref(collects)} target="_blank" rel="noreferrer">{volumeLabel(collects)}</a>
            </span>
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClearCollects}>
              Not this volume
            </button>
          </div>
        ) : (
          <VolumeField
            id="edition-collects"
            label="Volume this edition is part of"
            action="Set"
            saving={saving}
            onSubmit={onSetCollects}
          >
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onRecheckCollects}>
              Ask Comic Vine
            </button>
          </VolumeField>
        )}
      </div>

      {parts && (
        <div className="cv-id-row">
          <label htmlFor="edition-parts">Some issues under another title</label>
          {parts.map((part) => (
            <div key={part.volumeId} className="edition-links__row">
              <span>
                <a href={volumeHref(part)} target="_blank" rel="noreferrer">{volumeLabel(part)}</a>
                {partSpan(part)}
              </span>
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => onRemovePart(part.volumeId)}>
                Not part of this run
              </button>
            </div>
          ))}
          <VolumeField
            id="edition-parts"
            label="Volume holding more of this run"
            action="Add"
            saving={saving}
            onSubmit={onAddPart}
          />
        </div>
      )}

      {error && <p className="cv-error" role="alert">{error}</p>}
    </section>
  )
}
