import { Link } from 'react-router-dom'
import { useDownload } from '../lib/useDownload'

/** Bytes as megabytes, for a progress line a person can read. */
function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * What a download that has every byte is doing now. Unpacking a run of seven hundred
 * comics takes minutes, and a bar parked at 100% for that long reads as stuck.
 */
export function storingLabel(fileName: string | null): string {
  return /\.zip$/i.test(fileName ?? '') ? 'Unpacking…' : 'Filing…'
}

/**
 * What the server is downloading, on every page that has a header.
 *
 * It summarises rather than lists: with a queue there can be more than one thing waiting,
 * and the bar is a glance, not a screen. Settings > Downloads is where the detail lives.
 *
 * A failure keeps it on screen. Disappearing the moment the queue empties hid it exactly
 * when it was needed: a download that failed twice lands in history with nothing running,
 * and the user was never told it failed - Retry and Clear reachable only by going looking.
 * The newest history row being a failure is what stands in for "not acknowledged yet";
 * retrying it or clearing history is the acknowledgement, and both change `history[0]`.
 */

/**
 * A cancel is recorded as a failure - there is no separate cancelled state, and there does
 * not need to be. But it is the one failure nobody has to be told about: the user stopped
 * it themselves, and raising a persistent "Download failed" over their own deliberate act
 * is both wrong and unclearable without a trip to the queue. The runner writes this exact
 * word (see `fail(db, id, 'cancelled')` in services/downloader.ts).
 */
const CANCELLED = 'cancelled'

export default function DownloadBar() {
  const { active, queue, history, blocked, review } = useDownload()
  const waiting = queue.filter((e) => e.state === 'queued').length
  // Naming a single file is only honest when there is exactly one running. With more than
  // one active, `current` stays unset and the label reports a count instead - otherwise
  // finishing the named one would silently swap the name (and the percentage) under an
  // unchanged label, for a file the reader never asked about.
  const current = active.length === 1 ? active[0] : null
  const [newest] = history

  const busy = active.length > 0 || waiting > 0
  const failure = !busy && newest?.state === 'failed' && newest.error !== CANCELLED ? newest : null

  // Held on screen for the same reason a failure is, and more insistently: a blocked row
  // is the one state that will NEVER resolve on its own. Nothing clears it but a person,
  // so the bar has to keep saying so until one acts - and it outranks a failure, because
  // it is the one with something to do about it.
  // A collection asks for a person too, if less urgently than a bot check: it is a run
  // that has landed and is waiting for its matches to be checked. One still filling is
  // not ready, and saying so would send you to a table with half a run in it.
  const ready = review.filter((c) => c.waiting === 0 && c.fileCount > 0)

  if (!busy && !failure && blocked.length === 0 && ready.length === 0) return null
  // The bar names one thing. When it is a collection to review, a failure's name and
  // reason under that heading would read as the collection's.
  const readyWins = !busy && blocked.length === 0 && ready.length > 0
  const shownFailure = readyWins ? null : failure

  // Content-Length is a claim the server may not make; without it there is no percentage
  // to show, only how much has arrived. Only meaningful for a single named download - with
  // several running at once there is no one file's progress for a percentage to describe.
  const progress = !current ? null
    : current.storing ? storingLabel(current.fileName)
    : current.total > 0
      ? `${Math.round((current.received / current.total) * 100)}% — ${mb(current.received)} of ${mb(current.total)}`
      : mb(current.received)

  return (
    <div className={`download-bar${shownFailure ? ' download-bar--failed' : ''}`} role="status">
      <span className="download-bar__label">
        {!busy && blocked.length > 0
          ? blocked.length === 1 ? 'Needs you' : `Needs you — ${blocked.length}`
          : readyWins
          ? ready.length === 1 ? 'Ready to review' : `Ready to review — ${ready.length}`
          : failure
          ? 'Download failed'
          : active.length > 1
            ? `Downloading ${active.length}`
            : current ? 'Downloading…' : 'Queued'}
      </span>
      {(current || shownFailure) && (
        <span className="download-bar__name">
          {shownFailure ? shownFailure.label ?? shownFailure.url : current!.label || current!.fileName}
        </span>
      )}
      {readyWins && ready.length === 1 && (
        <span className="download-bar__name">{ready[0]!.label}</span>
      )}
      {progress && <span className="download-bar__progress">{progress}</span>}
      {shownFailure?.error && <span className="download-bar__progress">{shownFailure.error}</span>}
      {waiting > 0 && <span className="download-bar__progress">{waiting} queued</span>}
      {busy && blocked.length > 0 && (
        <span className="download-bar__progress">{blocked.length} needs you</span>
      )}
      {(busy || blocked.length > 0) && ready.length > 0 && (
        <span className="download-bar__progress">{ready.length} to review</span>
      )}
      <Link to="/settings/downloads" className="download-bar__link">Queue</Link>
    </div>
  )
}
