import { useState } from 'react'
import type { ApiBook } from '../api'

const FIELDS = ['title', 'number', 'writer', 'penciller', 'date', 'summary'] as const

interface MetadataEditorProps {
  book: ApiBook
  onSave: (form: Record<string, string>) => void
}

export default function MetadataEditor({ book, onSave }: MetadataEditorProps) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f, (book as unknown as Record<string, string | null>)[f] ?? ''])),
  )
  return (
    <div>
      {FIELDS.map((f) => (
        <div key={f} className="field">
          <label>{f}</label>
          {f === 'summary'
            ? <textarea value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} rows={4} />
            : <input value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />}
        </div>
      ))}
      <button className="btn" onClick={() => onSave(form)}>Save metadata</button>
    </div>
  )
}
