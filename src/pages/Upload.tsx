import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiBook, CvSearchResult } from '../api'
import EditionCombobox from '../components/EditionCombobox'
import ComicVineMatchDialog from '../components/ComicVineMatchDialog'
import { cvQueryFromFileName } from '../lib/cvQuery'

export default function Upload() {
  const [edition, setEdition] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // The issue chosen before the file is sent. Held here so the upload can carry it, which
  // is what lets the edition be decided by Comic Vine instead of typed by hand.
  const [match, setMatch] = useState<CvSearchResult | null>(null)
  const [matching, setMatching] = useState(false)
  const [uploaded, setUploaded] = useState<ApiBook | null>(null)

  const qc = useQueryClient()
  const { data: editionsData } = useQuery({
    queryKey: ['editions', null],
    queryFn: () => api.getEditions(),
  })

  function invalidateLibrary() {
    qc.invalidateQueries({ queryKey: ['editions'] })
    qc.invalidateQueries({ queryKey: ['series'] })
    qc.invalidateQueries({ queryKey: ['edition'] })
    qc.invalidateQueries({ queryKey: ['edition-issues'] })
  }

  // A picked issue tells us its volume, and the volume is the edition. The issue's own
  // year is its cover date, so the start year has to come from the volume itself —
  // Venom #256 is a 2026 issue of the 2025 volume.
  const pick = useMutation({
    mutationFn: (r: CvSearchResult) => api.issueVolume(r.id),
    onSuccess: (data) => {
      const name = data.volume?.editionName
      if (name) setEdition(name)
    },
    // No volume means no suggested edition; you type one. The match still stands.
    onError: () => {},
  })

  // The fallback for a comic uploaded without a match: the file already exists, so the
  // issue is applied to it directly rather than travelling with the upload.
  const applyAfter = useMutation({
    mutationFn: (issueId: number) => api.applyIssue(uploaded!.id, issueId),
    onSuccess: () => { setMatching(false); setMsg('Metadata added'); invalidateLibrary() },
    onError: () => { setMatching(false); setMsg('Uploaded, but the metadata could not be applied.') },
  })

  function choose(r: CvSearchResult) {
    setMatch(r)
    setMatching(false)
    pick.mutate(r)
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) return
    setUploaded(null)
    setMsg(null)
    const form = new FormData()
    if (edition) form.set('edition', edition)
    if (match) form.set('issueId', String(match.id))
    form.set('file', file, file.name)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setPct(Math.round((ev.loaded / ev.total) * 100)) }
    xhr.onload = () => {
      setPct(null)
      if (xhr.status !== 200) { setMsg(`Error: ${xhr.status}`); return }
      let body: { book?: ApiBook; metadataApplied?: boolean } = {}
      // A body we cannot read still means the file landed; it only costs the shortcut.
      try { body = JSON.parse(xhr.responseText) } catch { /* keep the empty body */ }
      setMsg(body.metadataApplied === false
        ? 'Uploaded, but the metadata could not be applied.'
        : 'Uploaded!')
      setUploaded(body.book ?? null)
      setMatch(null)
      invalidateLibrary()
    }
    xhr.onerror = () => { setPct(null); setMsg('Upload failed') }
    xhr.send(form)
  }

  const editions = editionsData?.editions ?? []
  // The edition NAME carries the year — "Venom (2025)" — which makes a poor search. Its
  // series is the part Comic Vine matches on.
  const chosenEdition = editions.find((e) => e.name === edition)
  const querySeries = chosenEdition?.seriesName?.trim() || null

  const matchLabel = match
    ? [match.name, match.issueNumber && `#${match.issueNumber}`, match.year && `(${match.year})`]
      .filter(Boolean).join(' ')
    : null

  return (
    <div className="upload-wrap">
      <div className="upload-card">
        <h1>Upload a comic</h1>
        <form onSubmit={submit}>
          <div className="field">
            <label className="file-label">
              Comic file (.cbz or .cbr)
              <input
                className="file-input"
                type="file"
                accept=".cbz,.cbr"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  // A new file makes any held match the wrong one.
                  setMatch(null)
                }}
              />
            </label>
          </div>

          {file && (
            <div className="upload-match">
              {match
                ? <span className="upload-match__picked">✓ {matchLabel}</span>
                : (
                  <button type="button" className="btn btn-ghost" onClick={() => setMatching(true)}>
                    Fetch metadata
                  </button>
                )}
              {match && (
                <button type="button" className="btn btn-ghost" onClick={() => setMatching(true)}>
                  Change
                </button>
              )}
            </div>
          )}

          <div className="field">
            <EditionCombobox
              value={edition}
              onChange={setEdition}
              options={editions}
              placeholder="Edition name"
            />
          </div>

          <button className="btn" type="submit" disabled={!file || pct !== null}>Upload</button>
        </form>

        {pct !== null && <p className="upload-progress">Uploading… {pct}%</p>}
        {msg && <p className="upload-msg">{msg}</p>}

        {uploaded && (
          <div className="upload-done">
            {!uploaded.comicvineId && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={applyAfter.isPending}
                onClick={() => setMatching(true)}
              >
                {applyAfter.isPending ? 'Adding…' : 'Fetch metadata'}
              </button>
            )}
            <Link to={`/book/${uploaded.id}`} className="upload-done__link">View comic</Link>
          </div>
        )}
      </div>

      {matching && (file || uploaded) && (
        <ComicVineMatchDialog
          defaultQuery={cvQueryFromFileName(file?.name ?? '', querySeries)}
          onPick={uploaded ? (r) => applyAfter.mutate(r.id) : choose}
          onClose={() => setMatching(false)}
        />
      )}
    </div>
  )
}
