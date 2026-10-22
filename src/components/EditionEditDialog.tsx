import { useEffect, useState } from 'react'

interface EditionEditDialogProps {
  name: string
  seriesName: string | null
  /**
   * A limited series rather than a run of its series. Arrives already decided - an
   * edition that had to lose a subtitle to find its franchise is one - and this is
   * where that guess gets overruled.
   */
  limited?: boolean
  saving?: boolean
  error?: string | null
  onSave: (next: { name: string; seriesName: string; limited: boolean }) => void
  onClose: () => void
}

export default function EditionEditDialog({
  name, seriesName, limited = false, saving = false, error = null, onSave, onClose,
}: EditionEditDialogProps) {
  const [nameInput, setNameInput] = useState(name)
  const [seriesInput, setSeriesInput] = useState(seriesName ?? '')
  const [limitedInput, setLimitedInput] = useState(limited)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmedName = nameInput.trim()
  const canSave = trimmedName.length > 0 && !saving

  const save = () => {
    if (!canSave) return
    onSave({ name: trimmedName, seriesName: seriesInput.trim(), limited: limitedInput })
  }

  const onFieldKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') save() }

  return (
    <div
      className="modal-backdrop"
      data-testid="edition-edit-backdrop"
      onClick={onClose}
    >
      {/* Clicks inside the panel must not reach the backdrop's close handler. */}
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Edit edition</h3>

        <div className="modal-field">
          <label htmlFor="edition-name">Edition name</label>
          <input
            id="edition-name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={onFieldKeyDown}
            autoFocus
          />
        </div>

        <div className="modal-field">
          <label htmlFor="edition-series">Series</label>
          <input
            id="edition-series"
            value={seriesInput}
            placeholder="No series"
            onChange={(e) => setSeriesInput(e.target.value)}
            onKeyDown={onFieldKeyDown}
          />
        </div>

        {/* Under Series because that is what it qualifies: which shelf of the series
            this volume belongs on, the runs or the rest. */}
        <div className="modal-field modal-field--check">
          <label htmlFor="edition-limited">
            <input
              id="edition-limited"
              type="checkbox"
              checked={limitedInput}
              onChange={(e) => setLimitedInput(e.target.checked)}
            />
            Limited series
          </label>
        </div>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn" onClick={save} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
