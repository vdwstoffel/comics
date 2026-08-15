import { useState } from 'react'

const FIELDS = ['title', 'number', 'writer', 'penciller', 'date', 'summary']

export default function MetadataEditor({ book, onSave }) {
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map((f) => [f, book[f] ?? ''])))
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
