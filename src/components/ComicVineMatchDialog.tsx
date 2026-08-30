import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { CvSearchResult } from '../api'

interface ComicVineMatchDialogProps {
  defaultQuery?: string | null
  onPick: (r: CvSearchResult) => void
  onClose: () => void
}

/** "#11 · 2022 · Marvel" - what separates two printings of the same issue. */
function caption(r: CvSearchResult): string {
  return [r.issueNumber ? `#${r.issueNumber}` : '', r.year, r.publisher].filter(Boolean).join(' · ')
}

export default function ComicVineMatchDialog({ defaultQuery, onPick, onClose }: ComicVineMatchDialogProps) {
  const [q, setQ] = useState(defaultQuery || '')
  const [results, setResults] = useState<CvSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function doSearch(query = q) {
    if (!query.trim()) return
    setLoading(true); setErr(null)
    try { setResults((await api.cvSearch(query, 'issue')).results) }
    catch { setErr('Search failed') }
    finally { setLoading(false) }
  }

  // A query derived from the book is worth running on the spot: the dialog opens on
  // candidates rather than on a filled box waiting for a click nobody asked for.
  const searched = useRef(false)
  useEffect(() => {
    if (searched.current) return
    searched.current = true
    void doSearch(defaultQuery || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modal-backdrop">
      <div className="modal-panel modal-panel--wide">
        <h3>Fetch from Comic Vine</h3>
        <div className="cv-search-row">
          <input
            placeholder="Search Comic Vine"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void doSearch() }}
          />
          <button className="btn" onClick={() => void doSearch()}>Search</button>
        </div>
        {loading && <p className="cv-status">Searching…</p>}
        {err && <p className="cv-error">{err}</p>}
        <ul className="cv-results">
          {results.map((r) => (
            <li key={r.id}>
              <button className="cv-tile" onClick={() => onPick(r)}>
                {r.cover
                  ? <img className="cv-tile__cover" src={r.cover} alt={r.name || 'Cover'} loading="lazy" referrerPolicy="no-referrer" />
                  : <span className="cv-tile__cover cv-tile__cover--empty" aria-hidden="true" />}
                <span className="cv-tile__name">{r.name}</span>
                <span className="cv-tile__caption">{caption(r)}</span>
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
