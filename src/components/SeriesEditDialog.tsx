import { useEffect, useState } from 'react'

interface SeriesEditDialogProps {
  name: string
  groupName: string | null
  saving?: boolean
  error?: string | null
  onSave: (next: { name: string; groupName: string }) => void
  onClose: () => void
}

export default function SeriesEditDialog({
  name, groupName, saving = false, error = null, onSave, onClose,
}: SeriesEditDialogProps) {
  const [nameInput, setNameInput] = useState(name)
  const [groupInput, setGroupInput] = useState(groupName ?? '')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmedName = nameInput.trim()
  const canSave = trimmedName.length > 0 && !saving

  const save = () => {
    if (!canSave) return
    onSave({ name: trimmedName, groupName: groupInput.trim() })
  }

  const onFieldKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') save() }

  return (
    <div
      className="modal-backdrop"
      data-testid="series-edit-backdrop"
      onClick={onClose}
    >
      {/* Clicks inside the panel must not reach the backdrop's close handler. */}
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Edit series</h3>

        <div className="modal-field">
          <label htmlFor="series-name">Series name</label>
          <input
            id="series-name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={onFieldKeyDown}
            autoFocus
          />
          <p className="modal-hint">Renaming moves the files on disk to match.</p>
        </div>

        <div className="modal-field">
          <label htmlFor="series-group">Group</label>
          <input
            id="series-group"
            value={groupInput}
            placeholder="No group"
            onChange={(e) => setGroupInput(e.target.value)}
            onKeyDown={onFieldKeyDown}
          />
          <p className="modal-hint">Series sharing a group appear as one tile in the library.</p>
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
