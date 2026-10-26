import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiVolumeIssues, CvVolumeMatch } from '../api'
import { uploadComic } from '../lib/uploadComic'
import { buildRows, claimForVolume, assignIssue } from '../lib/bulkMatch'
import type { BulkIssue, BulkRow, BulkVolume } from '../lib/bulkMatch'
import { countBatch, summarise, willUpload } from '../lib/bulkProgress'
import type { RowProgress } from '../lib/bulkProgress'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import BulkVolumeGroup from '../components/BulkVolumeGroup'

/**
 * Comic Vine allows about 200 requests an hour and nothing in this app counts them. A
 * batch costs roughly one per comic, so past this the later files start landing without
 * metadata. Warned rather than blocked: they still land, and the follow-up list is where
 * they are repaired.
 */
const BUDGET_WARN_AT = 150

/** A volume the user has chosen, with everything the group needs to draw and file it. */
interface ChosenVolume {
  volume: BulkVolume
  editionName: string
  unavailable: boolean
}

/**
 * Adding a whole folder of comics in one pass.
 *
 * The shape of it: pick the files, search Comic Vine for the volume once, and the issue
 * number in each name is paired with an issue of that volume. Nothing is uploaded until
 * the table is on screen and the button is pressed - the matcher will be wrong sometimes,
 * and a table is a far cheaper place to catch that than a library you have to repair.
 *
 * Searches are additive and claim only files no earlier search took, because a folder of
 * a run is rarely one volume: Comic Vine gives every year's annual a volume of its own.
 */
export default function BulkUpload() {
  useDocumentTitle('Bulk add')
  const qc = useQueryClient()

  // The picked files, by row key. Rows are rebuilt as volumes claim them, so the files
  // cannot live on the rows themselves.
  const filesRef = useRef(new Map<string, File>())
  const [rows, setRows] = useState<BulkRow[]>([])
  const [chosen, setChosen] = useState<ChosenVolume[]>([])

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CvVolumeMatch[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [progress, setProgress] = useState<Record<string, RowProgress>>({})
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)

  // The bytes come from this tab, so leaving mid-batch abandons whatever is left. Unlike
  // the download queue there is no server-side run to come back to.
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    const next = buildRows(picked.map((f) => f.name))
    const map = new Map<string, File>()
    next.forEach((row, i) => map.set(row.key, picked[i]!))
    filesRef.current = map
    setRows(next)
    setChosen([])
    setProgress({})
    setFinished(false)
  }

  const search = useMutation({
    mutationFn: (series: string) => api.getComicVineVolumes(series),
    onSuccess: (d) => { setResults(d.volumes); setSearchError(null) },
    onError: () => { setResults(null); setSearchError('Comic Vine could not be searched.') },
  })

  // Choosing a volume reads its issue list, then lets it claim whatever is still unplaced.
  const take = useMutation({
    mutationFn: (volumeId: number) => api.getVolumeIssues(volumeId),
    onSuccess: (d: ApiVolumeIssues) => {
      const volume: BulkVolume = {
        volumeId: d.volumeId,
        name: d.volume?.name ?? '',
        startYear: d.volume?.startYear ?? null,
        editionId: d.edition?.id ?? null,
        issues: d.issues,
      }
      setChosen((cs) => cs.some((c) => c.volume.volumeId === volume.volumeId)
        ? cs
        : [...cs, { volume, editionName: d.editionName, unavailable: d.unavailable === true }])
      setRows((rs) => claimForVolume(rs, volume))
      setResults(null)
    },
    onError: () => setSearchError('That volume\'s issue list could not be read.'),
  })

  function pickIssue(key: string, issue: BulkIssue) {
    const row = rows.find((r) => r.key === key)
    const entry = chosen.find((c) => c.volume.volumeId === row?.volumeId)
    if (entry) setRows((rs) => assignIssue(rs, key, issue, entry.volume))
  }

  function toggleReplace(key: string) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, replace: !r.replace } : r)))
  }

  /**
   * Send the batch, one comic at a time.
   *
   * Sequential on purpose: each upload drives a .cbr conversion, a page scan and a Comic
   * Vine read on the server, and three at once makes the throttle worse rather than
   * better. A row that fails marks itself and the run carries on - one bad archive in the
   * middle of a folder must not cost the other forty.
   */
  async function run() {
    setRunning(true)
    setFinished(false)
    const sending = rows.filter(willUpload)
    setProgress(Object.fromEntries(sending.map((r) => [r.key, { status: 'pending' as const }])))

    for (const row of sending) {
      const file = filesRef.current.get(row.key)
      // Re-picking mid-run is locked out below, so this should be unreachable - but a row
      // left silently 'pending' would vanish from the summary entirely, which is the one
      // outcome a batch report must never have.
      if (!file) {
        setProgress((p) => ({ ...p, [row.key]: { status: 'failed', error: 'the picked file was lost' } }))
        continue
      }
      const entry = chosen.find((c) => c.volume.volumeId === row.volumeId)
      setProgress((p) => ({ ...p, [row.key]: { status: 'uploading', percent: 0 } }))
      try {
        const res = await uploadComic({
          file,
          edition: entry?.editionName,
          issueId: row.issue?.id,
          volumeName: entry?.volume.name,
          issueNumber: row.issue?.number ?? undefined,
          replaceBookId: row.replace ? row.issue?.bookId : undefined,
          onProgress: (percent) => setProgress((p) => ({ ...p, [row.key]: { status: 'uploading', percent } })),
        })
        // metadataApplied false is NOT a success: the comic landed, but bare. Reporting it
        // as added is how a batch that ran out of Comic Vine budget looks complete.
        setProgress((p) => ({
          ...p,
          [row.key]: {
            status: res.metadataApplied === false ? 'bare' : 'done',
            replaced: res.replaced != null,
            replaceFailed: res.replaceFailed === true,
          },
        }))
      } catch (err) {
        setProgress((p) => ({
          ...p,
          [row.key]: { status: 'failed', error: (err as Error).message || 'upload failed' },
        }))
      }
    }

    // Once, at the end rather than per file: every shelf that counted these as missing is
    // wrong until it is asked again. The same set the single-comic paths invalidate.
    for (const key of ['editions', 'series', 'edition', 'edition-issues']) {
      qc.invalidateQueries({ queryKey: [key] })
    }
    setRunning(false)
    setFinished(true)
  }

  const counts = countBatch(rows)
  const done = summarise(progress)
  const leftovers = rows.filter((r) => r.volumeId === null && r.state !== 'ignored')
  const ignored = rows.filter((r) => r.state === 'ignored')

  return (
    <div className="bulk-wrap">
      <h1>Bulk add</h1>
      <p className="bulk-intro">
        Add a whole volume at once. Pick the folder, choose the volume, check the matches,
        then upload. Nothing is sent until you press the button, and the tab has to stay
        open while it runs.
      </p>

      <div className="field">
        <label className="file-label">
          Choose a folder or files
          <input
            className="file-input"
            type="file"
            multiple
            // @ts-expect-error - a directory picker, which React does not type
            webkitdirectory=""
            directory=""
            disabled={running}
            onChange={choose}
          />
        </label>
      </div>

      {rows.length > 0 && (
        <p className="bulk-counts">
          {rows.length - counts.ignored} comic{rows.length - counts.ignored === 1 ? '' : 's'} picked
          {counts.ignored > 0 && <> · {counts.ignored} ignored</>}
        </p>
      )}

      {rows.length - counts.ignored > BUDGET_WARN_AT && (
        <p className="bulk-warn">
          That is a lot in one go. Comic Vine allows about 200 requests an hour and this
          costs roughly one per comic, so the later files may land without metadata. They
          will still land, and you can fetch the rest from Settings afterwards.
        </p>
      )}

      {rows.length > 0 && (
        <div className="bulk-search">
          <label className="bulk-search__label">
            Search Comic Vine for the volume
            <input
              type="search"
              value={query}
              placeholder="Avengers"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={!query.trim() || search.isPending || running}
            onClick={() => search.mutate(query.trim())}
          >
            {search.isPending ? 'Searching…' : 'Search'}
          </button>
        </div>
      )}

      {searchError && <p className="bulk-error">{searchError}</p>}

      {results && (
        <ul className="bulk-results">
          {results.map((v) => (
            <li key={v.id}>
              <button type="button" className="btn btn-ghost" disabled={running} onClick={() => take.mutate(v.id)}>
                {v.name}{v.startYear ? ` (${v.startYear})` : ''}
                {v.publisher ? ` · ${v.publisher}` : ''}
                {v.issueCount != null ? ` · ${v.issueCount} issues` : ''}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="bulk-row__note">Comic Vine found no volume by that name.</li>}
        </ul>
      )}

      {chosen.map((c) => (
        <BulkVolumeGroup
          key={c.volume.volumeId}
          volume={c.volume}
          editionName={c.editionName}
          allRows={rows}
          rows={rows.filter((r) => r.volumeId === c.volume.volumeId)}
          unavailable={c.unavailable}
          progress={progress}
          onPick={pickIssue}
          onToggleReplace={toggleReplace}
        />
      ))}

      {leftovers.length > 0 && (
        <section className="bulk-group bulk-group--leftovers" aria-label="Not placed yet">
          <header className="bulk-group__head">
            <strong>{leftovers.length} file{leftovers.length === 1 ? '' : 's'} not placed yet</strong>
            <span className="bulk-group__meta">
              Search another volume above — annuals are a volume of their own. Anything
              left will upload unmatched and wait on the Settings list.
            </span>
          </header>
          <ul className="bulk-group__rows">
            {leftovers.map((row) => (
              <li key={row.key} className="bulk-row bulk-row--unplaced">
                <span className="bulk-row__file">{row.fileName}</span>
                <span className="bulk-row__arrow">→</span>
                <span className="bulk-row__note">no volume</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ignored.length > 0 && (
        <p className="bulk-row__note">
          Not comics, so left alone: {ignored.map((r) => r.fileName).join(', ')}
        </p>
      )}

      {rows.length > 0 && (
        <div className="bulk-actions">
          <button type="button" className="btn" disabled={counts.toUpload === 0 || running} onClick={run}>
            {running ? 'Uploading…' : `Upload ${counts.toUpload} comic${counts.toUpload === 1 ? '' : 's'}`}
          </button>
          {/* What the button is about to do, which is not the same as what was picked -
              the ignored count belongs to the picked line above and saying it twice is
              noise. */}
          <span className="bulk-actions__note">
            {counts.replacing > 0 && <>{counts.replacing} will replace and delete · </>}
            {counts.skipped > 0 && <>{counts.skipped} skipped · </>}
            {counts.needsIssue > 0 && <>{counts.needsIssue} still need an issue</>}
          </span>
        </div>
      )}

      {finished && (
        <p className="bulk-summary">
          Done. {done.added} added
          {done.bare > 0 && <>, {done.bare} landed without metadata</>}
          {done.replaced > 0 && <>, {done.replaced} replaced and deleted</>}
          {done.failed > 0 && <>, {done.failed} failed</>}
          {counts.skipped > 0 && <>, {counts.skipped} skipped</>}.
          {done.replaceFailed > 0 && (
            <> {done.replaceFailed} landed but the old copy could not be removed, so you
            have two of those.</>
          )}
          {done.bare > 0 && (
            <> The bare ones are on the <Link to="/settings/metadata">metadata list</Link>.</>
          )}
        </p>
      )}
    </div>
  )
}
