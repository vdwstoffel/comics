import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiBook, CvSearchResult } from '../api'
import EditionCombobox from '../components/EditionCombobox'
import ComicVineMatchDialog from '../components/ComicVineMatchDialog'
import { cvQueryFromFileName } from '../lib/cvQuery'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export default function Upload() {
  useDocumentTitle('Upload')
  // Arriving from a search result carries the link its post page pointed at, so the page
  // opens ready to download rather than waiting for a paste.
  const [urlParams] = useSearchParams()
  const seededUrl = urlParams.get('url')?.trim() ?? ''

  const [edition, setEdition] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // The issue chosen before the file is sent. Held here so the upload can carry it, which
  // is what lets the edition be decided by Comic Vine instead of typed by hand.
  const [match, setMatch] = useState<CvSearchResult | null>(null)
  // Whether that issue was typed by hand rather than picked from search. The server only
  // records a reminder to re-check it when told so.
  const [manual, setManual] = useState(false)
  const [matching, setMatching] = useState(false)
  const [uploaded, setUploaded] = useState<ApiBook | null>(null)
  // Whether metadata was successfully applied to the uploaded book. An id is recorded
  // even when the metadata read fails, so the id no longer tells you whether there is
  // anything to retry.
  const [metadataApplied, setMetadataApplied] = useState<boolean | null>(null)
  // A link to fetch server-side instead of sending a file. The two are alternatives.
  const [url, setUrl] = useState(seededUrl)
  // The name the link resolves to. A download link is often an opaque token, so the file
  // name only appears on the url it redirects to — and that name is what the Comic Vine
  // search is built from.
  const [resolvedName, setResolvedName] = useState<string | null>(null)

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
    mutationFn: ({ issueId, manual }: { issueId: number; manual?: boolean }) =>
      api.applyIssue(uploaded!.id, issueId, manual),
    // A hand-typed id during a Comic Vine outage answers 200 with metadataApplied false:
    // the link is saved and nothing else is. Reporting that as "Metadata added" is the
    // reading the user cannot check, and it would hide the retry button below as well.
    onSuccess: (res) => {
      setMatching(false)
      const applied = res.metadataApplied !== false
      setMetadataApplied(applied)
      setMsg(applied
        ? 'Metadata added'
        : 'The link is saved, but Comic Vine could not be read, so no metadata arrived. The comic is on the Settings list to re-check.')
      invalidateLibrary()
    },
    // The server's own words - a mistyped id is a 404 carrying "Comic Vine has no issue
    // with that id.", which the generic outage wording would turn into the opposite
    // reading. The dialog is left OPEN (and shown the same message) so the id can be
    // corrected in place rather than retyped from the start.
    onError: (err: Error) => setMsg(err.message || 'Uploaded, but the metadata could not be applied.'),
  })

  // Opening the dialog clears the last apply's failure with it: the dialog unmounts on
  // close but the mutation does not, so a reopen would otherwise greet you with the error
  // from the id you already gave up on.
  function openMatch() {
    applyAfter.reset()
    setMatching(true)
  }

  // Resolving reveals the file name; the dialog then opens on it as it would for a file.
  const resolve = useMutation({
    mutationFn: () => api.resolveDownload(url.trim()),
    onSuccess: (d) => { setResolvedName(d.fileName); openMatch() },
    // No name means no prefilled search, not no search: the dialog still opens.
    onError: () => { setResolvedName(null); openMatch() },
  })

  const startDownload = useMutation({
    mutationFn: () => api.queueDownload({
      url: url.trim(),
      edition: edition || undefined,
      issueId: match?.id,
      // Same rule as the upload path below: only a typed id files a reminder. Omitted
      // rather than false so a search-chosen download sends exactly what it always did.
      manual: match && manual ? true : undefined,
      // What the queue will call this row. A pasted link is usually an opaque token, so
      // the name resolving it revealed is the only readable thing we have; without it the
      // server falls back to the url itself.
      label: resolvedName ?? undefined,
    }),
    // Handing the run over: the download bar reports it from here, on whatever page you
    // are on. Refreshing the status is what lets the bar show it now rather than
    // whenever it next happens to look.
    onSuccess: () => {
      setMsg(null)
      setUploaded(null)
      setMatch(null)
      qc.invalidateQueries({ queryKey: ['download'] })
    },
    // A 409 no longer means the downloader is busy - you can queue as many as you like.
    // It means this exact issue is already waiting, which is worth saying plainly.
    onError: (err: Error) => setMsg((err as Error & { status?: number }).status === 409
      ? 'That is already in the queue.'
      : 'Could not start the download.'),
  })

  function choose(r: CvSearchResult, opts?: { manual?: boolean }) {
    setMatch(r)
    setManual(opts?.manual === true)
    setMatching(false)
    pick.mutate(r)
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // A link is fetched by the server; a file is sent to it. One or the other.
    if (!file && url.trim()) { startDownload.mutate(); return }
    if (!file) return
    setUploaded(null)
    setMetadataApplied(null)
    setMsg(null)
    const form = new FormData()
    if (edition) form.set('edition', edition)
    if (match) form.set('issueId', String(match.id))
    // The server reads this only when it is exactly 'true'.
    if (match && manual) form.set('manual', 'true')
    form.set('file', file, file.name)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setPct(Math.round((ev.loaded / ev.total) * 100)) }
    xhr.onload = () => {
      setPct(null)
      if (xhr.status !== 200) { setMsg(`Error: ${xhr.status}`); return }
      let body: { book?: ApiBook; metadataApplied?: boolean; issueNotFound?: boolean } = {}
      // A body we cannot read still means the file landed; it only costs the shortcut.
      try { body = JSON.parse(xhr.responseText) } catch { /* keep the empty body */ }
      // A typed id that does not exist still stores the comic (a 200), so this has to be
      // said outright or a typo looks like success and the comic stays unmatched.
      setMsg(body.issueNotFound
        ? 'Uploaded, but that Comic Vine id was not found on Comic Vine, so the comic is unmatched.'
        : body.metadataApplied === false
          ? 'Uploaded, but the metadata could not be applied.'
          : 'Uploaded!')
      setUploaded(body.book ?? null)
      setMetadataApplied(body.metadataApplied ?? true)
      setMatch(null)
      setManual(false)
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

  const sourceName = file?.name ?? resolvedName ?? ''
  const hasUrl = url.trim().length > 0

  const matchLabel = match
    ? [match.name, match.issueNumber && `#${match.issueNumber}`, match.year && `(${match.year})`]
      .filter(Boolean).join(' ')
    : null

  return (
    <div className="upload-wrap">
      <div className="upload-card">
        <h1>Upload a comic</h1>
        {/* A whole folder is a different job: one volume search for the lot, and a table
            to check before anything moves. */}
        <p className="upload-bulk-link">
          Got a whole volume? <Link to="/upload/bulk">Add them in bulk</Link>.
        </p>
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
                  setManual(false)
                  setUploaded(null)
                  setMetadataApplied(null)
                }}
              />
            </label>
          </div>

          <div className="field">
            <label className="file-label">
              …or paste a link to download
              <input
                type="url"
                className="upload-url"
                placeholder="Paste a link (https://…)"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setResolvedName(null); setMatch(null); setManual(false); setUploaded(null); setMetadataApplied(null) }}
              />
            </label>
          </div>

          {(file || hasUrl) && (
            <div className="upload-match">
              {match
                ? <span className="upload-match__picked">✓ {matchLabel}</span>
                : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={resolve.isPending}
                    onClick={() => (hasUrl && !file ? resolve.mutate() : openMatch())}
                  >
                    {resolve.isPending ? 'Reading link…' : 'Fetch metadata'}
                  </button>
                )}
              {match && (
                <button type="button" className="btn btn-ghost" onClick={openMatch}>
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

          <button
            className="btn"
            type="submit"
            disabled={(!file && !hasUrl) || pct !== null || startDownload.isPending}
          >
            {!file && hasUrl ? 'Download' : 'Upload'}
          </button>
        </form>

        {pct !== null && <p className="upload-progress">Uploading… {pct}%</p>}
        {msg && <p className="upload-msg">{msg}</p>}

        {uploaded && (
          <div className="upload-done">
            {metadataApplied === false && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={applyAfter.isPending}
                onClick={openMatch}
              >
                {applyAfter.isPending ? 'Adding…' : 'Fetch metadata'}
              </button>
            )}
            <Link to={`/book/${uploaded.id}`} className="upload-done__link">View comic</Link>
          </div>
        )}
      </div>

      {matching && (file || uploaded || hasUrl) && (
        <ComicVineMatchDialog
          defaultQuery={cvQueryFromFileName(sourceName, querySeries)}
          // Only the post-upload apply can fail from in here; a pick made before the
          // upload is just held in state. The dialog owns no errors of its own.
          error={applyAfter.isError ? applyAfter.error?.message : null}
          onPick={uploaded ? (r, opts) => applyAfter.mutate({ issueId: r.id, manual: opts?.manual }) : choose}
          onClose={() => setMatching(false)}
        />
      )}
    </div>
  )
}
