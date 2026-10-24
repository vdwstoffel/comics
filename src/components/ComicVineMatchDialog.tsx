import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { CvSearchResult } from '../api'
import { parseCvIssueId } from '../lib/cvIssueId'

interface ComicVineMatchDialogProps {
  defaultQuery?: string | null
  /** A failure from applying a pick, which the caller owns and the dialog only displays. */
  error?: string | null
  /** `manual` marks an id typed by hand, which the server records so it can be re-checked later. */
  onPick: (r: CvSearchResult, opts?: { manual?: boolean }) => void
  onClose: () => void
}

/** "#11 · 2022 · Marvel" - what separates two printings of the same issue. */
function caption(r: CvSearchResult): string {
  return [r.issueNumber ? `#${r.issueNumber}` : '', r.year, r.publisher].filter(Boolean).join(' · ')
}

export default function ComicVineMatchDialog({ defaultQuery, error, onPick, onClose }: ComicVineMatchDialogProps) {
  const [q, setQ] = useState(defaultQuery || '')
  const [results, setResults] = useState<CvSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [idInput, setIdInput] = useState('')
  // Kept apart from `err`: a failed search and a mistyped link are different problems and
  // must not overwrite one another.
  const [idErr, setIdErr] = useState<string | null>(null)

  async function doSearch(query = q) {
    if (!query.trim()) return
    setLoading(true); setErr(null)
    try { setResults((await api.cvSearch(query, 'issue')).results) }
    catch { setErr('Search failed') }
    finally { setLoading(false) }
  }

  function applyTyped() {
    const parsed = parseCvIssueId(idInput)
    if (!parsed.ok) { setIdErr(parsed.error); return }
    setIdErr(null)
    // Only the id is known. The name is synthesized because callers render it: the upload
    // page builds its "matched" label from it and would show a bare tick without one.
    onPick({ id: parsed.id, name: `Comic Vine #${parsed.id}` }, { manual: true })
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
        {/* Always rendered, never gated on a failed search: when Comic Vine's search is down
            it answers with an error rather than an empty list, and this is the way round it.
            It reaches the issue endpoint directly. */}
        <form className="cv-id-row" onSubmit={(e) => { e.preventDefault(); applyTyped() }}>
          <label htmlFor="cv-id-input">Comic Vine ID or link</label>
          <div className="cv-id-row__controls">
            <input
              id="cv-id-input"
              placeholder="Paste an issue link or id"
              value={idInput}
              onChange={(e) => { setIdInput(e.target.value); setIdErr(null) }}
            />
            <button type="submit" className="btn">Apply</button>
          </div>
          {idErr && <p className="cv-error" role="alert">{idErr}</p>}
        </form>
        {error && <p className="cv-error" role="alert">{error}</p>}
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
