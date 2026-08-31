import { useEffect } from 'react'

interface ConfirmDeleteDialogProps {
  /** What is going, phrased to follow "Remove " — e.g. `series "Saga"`. */
  what: string
  /** Optional line spelling out the scale, e.g. "3 editions · 34 issues". */
  detail?: string
  /** The guard: how many files leave the disk. null while that is still being counted. */
  fileCount: number | null
  deleting?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}

export default function ConfirmDeleteDialog({
  what, detail, fileCount, deleting = false, error = null, onConfirm, onClose,
}: ConfirmDeleteDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" data-testid="confirm-delete-backdrop" onClick={onClose}>
      {/* Clicks inside the panel must not reach the backdrop's close handler. */}
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Remove {what}?</h3>

        {detail && <p className="modal-detail">{detail}</p>}
        <p className="modal-detail">
          {fileCount === null
            ? 'Counting the files…'
            : `${fileCount} file${fileCount === 1 ? '' : 's'} will be deleted from disk.`}
        </p>
        <p className="modal-warning">This cannot be undone.</p>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn" onClick={onConfirm} disabled={deleting || fileCount === null}>
            {deleting ? 'Removing…' : 'Remove'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
