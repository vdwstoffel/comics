import { useState } from 'react'
import { api } from '../api'
import type { CvSearchResult } from '../api'

interface ComicVineMatchDialogProps {
  defaultQuery?: string | null
  onPick: (r: CvSearchResult) => void
  onClose: () => void
}

export default function ComicVineMatchDialog({ defaultQuery, onPick, onClose }: ComicVineMatchDialogProps) {
  const [q, setQ] = useState(defaultQuery || '')
  const [results, setResults] = useState<CvSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function doSearch() {
    setLoading(true); setErr(null)
    try { setResults((await api.cvSearch(q, 'issue')).results) }
    catch { setErr('Search failed') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <h3>Fetch from Comic Vine</h3>
        <div className="cv-search-row">
          <input placeholder="Search Comic Vine" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={doSearch}>Search</button>
        </div>
        {loading && <p className="cv-status">Searching…</p>}
        {err && <p className="cv-error">{err}</p>}
        <ul className="cv-results">
          {results.map((r) => (
            <li key={r.id}>
              <button className="cv-candidate" onClick={() => onPick(r)}>
                {r.name} #{r.issueNumber} {r.year ? `(${r.year})` : ''}
              </button>
            </li>
          ))}
        </ul>
        <div className="cv-close-row">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
