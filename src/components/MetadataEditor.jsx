import { useState } from 'react'

const FIELDS = ['title', 'number', 'writer', 'penciller', 'date', 'summary']

export default function MetadataEditor({ book, onSave }) {
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map((f) => [f, book[f] ?? ''])))
  return (
    <div>
      {FIELDS.map((f) => (
        <div key={f} style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>{f}</label>
          {f === 'summary'
            ? <textarea value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} rows={4} style={{ width: '100%' }} />
            : <input value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} style={{ width: '100%' }} />}
        </div>
      ))}
      <button onClick={() => onSave(form)}>Save metadata</button>
    </div>
  )
}
