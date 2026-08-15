import { useState } from 'react'
import { api } from '../api.js'

export default function ComicVineMatchDialog({ defaultQuery, onPick, onClose }) {
  const [q, setQ] = useState(defaultQuery || '')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  async function doSearch() {
    setLoading(true); setErr(null)
    try { setResults((await api.cvSearch(q, 'issue')).results) }
    catch { setErr('Search failed') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center' }}>
      <div style={{ background: '#fff', color: '#000', padding: 16, width: 480, maxHeight: '80vh', overflow: 'auto', borderRadius: 8 }}>
        <h3>Fetch from Comic Vine</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Search Comic Vine" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          <button onClick={doSearch}>Search</button>
        </div>
        {loading && <p>Searching…</p>}
        {err && <p style={{ color: 'red' }}>{err}</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {results.map((r) => (
            <li key={r.id}>
              <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: 8 }} onClick={() => onPick(r)}>
                {r.name} #{r.issueNumber} {r.year ? `(${r.year})` : ''}
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
