import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiVolumeIssues, CvVolumeMatch, PostDownloads, PostPart } from '../api'
import { uploadComic, stageCollection, fileStagedComic } from '../lib/uploadComic'
import { buildRows, claimForVolume, assignIssue, availableIssues } from '../lib/bulkMatch'
import type { BulkIssue, BulkRow, BulkVolume } from '../lib/bulkMatch'
import { countBatch, summarise, willUpload } from '../lib/bulkProgress'
import type { RowProgress } from '../lib/bulkProgress'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import BulkVolumeGroup from '../components/BulkVolumeGroup'
import BulkLeftoverPicker from '../components/BulkLeftoverPicker'
import UploadTabs from '../components/UploadTabs'
import PostPartsDialog from '../components/PostPartsDialog'

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
 *
 * The comics come from one of two places. Picked from your disk, they are uploaded one by
 * one. Or they are already on the server, in a collection - a zip unpacked, or every part
 * of a post downloaded - named by `?collection=`, and each is filed where it sits. The
 * table between is the same either way, so a run reviewed from a download is matched by
 * exactly the rules a folder is.
 */
export default function BulkUpload() {
  const [params] = useSearchParams()
  const collectionParam = Number(params.get('collection'))
  const collectionId = Number.isInteger(collectionParam) && collectionParam > 0 ? collectionParam : null
  // Keyed on the collection, so moving between one and another - or back to picking a
  // folder - starts from an empty table rather than the last one's rows and results.
  return <BulkAdd key={collectionId ?? 'disk'} collectionId={collectionId} />
}

function BulkAdd({ collectionId }: { collectionId: number | null }) {
  useDocumentTitle('Bulk add')
  const qc = useQueryClient()
  const navigate = useNavigate()

  // The comics by row key: a File picked from disk, or the name of one in the collection.
  // Rows are rebuilt as volumes claim them, so the files cannot live on the rows themselves.
  const filesRef = useRef(new Map<string, File | string>())
  const [rows, setRows] = useState<BulkRow[]>([])
  const [chosen, setChosen] = useState<ChosenVolume[]>([])

  const collection = useQuery({
    queryKey: ['collection', collectionId],
    queryFn: () => api.getCollection(collectionId!),
    enabled: collectionId != null,
    // Read once per visit: refetching under a table being matched would rebuild its rows.
    // Dropped on leaving, so the next visit lists what is left rather than what was there.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
  const review = collection.data

  // A collection's comics become the rows the moment it loads, exactly as picked files do.
  useEffect(() => {
    if (!review) return
    const next = buildRows(review.files)
    const map = new Map<string, File | string>()
    next.forEach((row, i) => map.set(row.key, review.files[i]!))
    filesRef.current = map
    setRows(next)
    setChosen([])
    setProgress({})
    setFinished(false)
  }, [review])

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CvVolumeMatch[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [progress, setProgress] = useState<Record<string, RowProgress>>({})
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)

  // Each comic is sent from this tab, so leaving mid-batch abandons whatever is left. A
  // collection keeps what was not filed, but the run itself does not carry on without you.
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    const next = buildRows(picked.map((f) => f.name))
    const map = new Map<string, File | string>()
    next.forEach((row, i) => map.set(row.key, picked[i]!))
    filesRef.current = map
    setRows(next)
    setChosen([])
    setProgress({})
    setFinished(false)
  }

  // A zip from your disk is unpacked on the server and comes back as a collection, which
  // this page then reviews like any other. Sending it whole is the point: the comics in it
  // never have to be unzipped on your side first.
  const [zipPercent, setZipPercent] = useState<number | null>(null)
  const sendZip = useMutation({
    mutationFn: (file: File) => stageCollection({ file, onProgress: setZipPercent }),
    onSuccess: ({ collection: c }) => {
      setZipPercent(null)
      qc.invalidateQueries({ queryKey: ['download'] })
      navigate(`/upload/bulk?collection=${c.id}`)
    },
    onError: () => setZipPercent(null),
  })

  function chooseZip(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) sendZip.mutate(file)
  }

  // A link is read before anything is queued: a post may split the run into parts, and
  // those are yours to choose from. One part needs no choosing and goes straight in.
  const [link, setLink] = useState('')
  const [post, setPost] = useState<PostDownloads | null>(null)
  const [queuedNote, setQueuedNote] = useState<string | null>(null)
  const queueParts = useMutation({
    mutationFn: ({ from, parts }: { from: PostDownloads; parts: PostPart[] }) => api.downloadParts({
      label: from.title ?? undefined, postUrl: from.postUrl, parts,
    }),
    onSuccess: (d) => {
      setPost(null)
      setLink('')
      setQueuedNote(`Downloading ${d.collection.parts} part${d.collection.parts === 1 ? '' : 's'} of ${d.collection.label}.`)
      qc.invalidateQueries({ queryKey: ['download'] })
    },
  })
  const readLink = useMutation({
    mutationFn: (url: string) => api.readLink(url),
    onSuccess: (d) => {
      if (d.parts.length > 1) setPost(d)
      else queueParts.mutate({ from: d, parts: d.parts })
    },
  })

  function submitLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setQueuedNote(null)
    queueParts.reset()
    if (link.trim()) readLink.mutate(link.trim())
  }

  // Throwing the rest away, once what was wanted has been filed or none of it was.
  const discard = useMutation({
    mutationFn: () => api.discardCollection(collectionId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['download'] })
      navigate('/upload/bulk')
    },
  })

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

  // A leftover has no volume yet, so the pick names one. Assigning it moves the row into
  // that volume's group, where it reads like any other match.
  function placeLeftover(key: string, volume: BulkVolume, issue: BulkIssue) {
    setRows((rs) => assignIssue(rs, key, issue, volume))
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
      const fields = {
        edition: entry?.editionName,
        issueId: row.issue?.id,
        volumeName: entry?.volume.name,
        issueNumber: row.issue?.number ?? undefined,
        replaceBookId: row.replace ? row.issue?.bookId : undefined,
      }
      // A comic already on the server has no bytes to count, so it reports no percent.
      setProgress((p) => ({ ...p, [row.key]: typeof file === 'string' ? { status: 'uploading' } : { status: 'uploading', percent: 0 } }))
      try {
        const res = typeof file === 'string'
          ? await fileStagedComic(collectionId!, { ...fields, file })
          : await uploadComic({
            ...fields,
            file,
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
    // What is left of a collection - skipped, failed - is still waiting in the queue's
    // review list, and the count there is now wrong.
    if (collectionId != null) qc.invalidateQueries({ queryKey: ['download'] })
    setRunning(false)
    setFinished(true)
  }

  const counts = countBatch(rows)
  const done = summarise(progress)
  const leftovers = rows.filter((r) => r.volumeId === null && r.state !== 'ignored')
  const ignored = rows.filter((r) => r.state === 'ignored')
  const freeByVolume = chosen.map((c) => ({ volume: c.volume, issues: availableIssues(rows, c.volume) }))
  const staged = collectionId != null
  // Comics a finished run left in the collection: skipped as already yours, or failed.
  const leftInCollection = staged && finished ? rows.filter((r) => r.state !== 'ignored').length - done.added - done.bare : 0
  const verb = staged ? 'File' : 'Upload'

  return (
    <div className="bulk-wrap">
      <h1>Bulk add</h1>
      <UploadTabs />

      {staged ? (
        <div className="bulk-collection">
          {collection.isError ? (
            <p className="bulk-intro">
              That collection is gone — filed, or thrown away. <Link to="/upload/bulk">Add another volume</Link>.
            </p>
          ) : (
            <>
              <p className="bulk-intro">
                {review ? <>Reviewing <strong>{review.label}</strong>. </> : 'Opening the collection… '}
                Choose the volume, check the matches, then file them. Nothing moves until
                you press the button.
              </p>
              {review && (review.waiting > 0 || review.blocked > 0) && (
                <p className="bulk-warn">
                  {review.waiting > 0 && <>{review.waiting} of {review.parts} parts {review.waiting === 1 ? 'is' : 'are'} still
                  downloading, so this is only what has landed so far. </>}
                  {review.blocked > 0 && <>{review.blocked} part{review.blocked === 1 ? '' : 's'} stopped at a
                  bot check and {review.blocked === 1 ? 'is' : 'are'} waiting in <Link to="/settings/downloads">Needs you</Link>.</>}
                </p>
              )}
              <div className="bulk-collection__actions">
                <button
                  type="button" className="btn btn-ghost"
                  disabled={running || discard.isPending || !review}
                  onClick={() => discard.mutate()}
                >{discard.isPending ? 'Discarding…' : 'Discard what is left'}</button>
                <Link to="/upload/bulk" className="btn btn-ghost">Add another volume</Link>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="bulk-intro">
            Add a whole volume at once: a folder, a zip, or a link to download. Choose the
            volume, check the matches, then add them. Nothing is filed until you press the
            button.
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

          <div className="field">
            <label className="file-label">
              …or a zip of the volume
              <input
                className="file-input"
                type="file"
                accept=".zip,.cbz,.cbr"
                disabled={running || sendZip.isPending}
                onChange={chooseZip}
              />
            </label>
            {zipPercent !== null && <p className="bulk-row__note">Sending the zip… {zipPercent}%</p>}
            {sendZip.isPending && zipPercent === 100 && <p className="bulk-row__note">Unpacking…</p>}
            {sendZip.isError && <p className="bulk-error">{(sendZip.error as Error).message}</p>}
          </div>

          <form className="field bulk-link" onSubmit={submitLink}>
            <label className="file-label">
              …or paste a link to download it
              <input
                type="url"
                className="upload-url"
                placeholder="A getcomics post, or a direct link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
            <button type="submit" className="btn" disabled={!link.trim() || readLink.isPending || queueParts.isPending}>
              {readLink.isPending ? 'Reading link…' : 'Download'}
            </button>
          </form>
          {readLink.isError && <p className="bulk-error">{(readLink.error as Error).message}</p>}
          {queueParts.isError && !post && <p className="bulk-error">Could not queue that download.</p>}
          {queuedNote && (
            <p className="bulk-note">
              {queuedNote} It will be under <Link to="/settings/downloads">Ready to review</Link> once
              it has landed, and you can leave this page meanwhile.
            </p>
          )}
        </>
      )}

      {post && (
        <PostPartsDialog
          post={post}
          pending={queueParts.isPending}
          error={queueParts.isError ? 'Could not queue those parts.' : null}
          onDownload={(parts) => queueParts.mutate({ from: post, parts })}
          onClose={() => setPost(null)}
        />
      )}

      {rows.length > 0 && (
        <p className="bulk-counts">
          {rows.length - counts.ignored} comic{rows.length - counts.ignored === 1 ? '' : 's'} {staged ? 'in the collection' : 'picked'}
          {counts.ignored > 0 && <> · {counts.ignored} ignored</>}
        </p>
      )}

      {rows.length - counts.ignored > BUDGET_WARN_AT && (
        <p className="bulk-warn">
          That is a lot in one go. Comic Vine allows about 200 requests an hour and this
          costs roughly one per comic, so the later files may land without metadata. They
          will still land, and fill in on their own afterwards at about 180 an hour - the{' '}
          <Link to="/settings/metadata">Missing metadata</Link> list shows how far it has got.
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
              Search another volume above — annuals are a volume of their own — or pick
              the issue by hand. Anything left will upload unmatched and wait on the
              Settings list.
            </span>
          </header>
          <ul className="bulk-group__rows">
            {leftovers.map((row) => (
              <li key={row.key} className="bulk-row bulk-row--unplaced">
                <span className="bulk-row__file">{row.fileName}</span>
                <span className="bulk-row__arrow">→</span>
                <span className="bulk-row__state">
                  {chosen.length > 0
                    ? (
                      <BulkLeftoverPicker
                        fileName={row.fileName}
                        groups={freeByVolume}
                        onPick={(volume, issue) => placeLeftover(row.key, volume, issue)}
                      />
                    )
                    : <span className="bulk-row__note">no volume</span>}
                </span>
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
            {running ? (staged ? 'Filing…' : 'Uploading…') : `${verb} ${counts.toUpload} comic${counts.toUpload === 1 ? '' : 's'}`}
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
          {leftInCollection > 0 && (
            <> {leftInCollection} {leftInCollection === 1 ? 'is' : 'are'} still in the collection — discard
            {leftInCollection === 1 ? ' it' : ' them'} above once you are sure.</>
          )}
        </p>
      )}
    </div>
  )
}
