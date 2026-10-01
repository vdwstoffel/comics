import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ApiBook } from '../api'

const FIELDS = ['title', 'number', 'writer', 'penciller', 'date', 'summary'] as const

interface MetadataEditorProps {
  book: ApiBook
  onSave: (form: Record<string, string>) => void
  onCancel: () => void
  /** Extra fields rendered above the metadata fields (e.g. the edition move row). */
  children?: ReactNode
}

export default function MetadataEditor({ book, onSave, onCancel, children }: MetadataEditorProps) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f, (book as unknown as Record<string, string | null>)[f] ?? ''])),
  )
  return (
    <div>
      {children}
      {FIELDS.map((f) => (
        <div key={f} className="field">
          {/* Tied to its field. A label that only sits near an input is a label a screen
              reader cannot give to anyone, and a field nothing can name is a field nothing
              can fill in but a mouse. */}
          <label htmlFor={`metadata-${f}`}>{f}</label>
          {f === 'summary'
            ? <textarea id={`metadata-${f}`} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} rows={4} />
            : <input id={`metadata-${f}`} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />}
        </div>
      ))}
      <div className="btn-row metadata-section__actions">
        <button className="btn" onClick={() => onSave(form)}>Save metadata</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
