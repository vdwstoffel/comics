import { Link } from 'react-router-dom'
import { useDownload } from '../lib/useDownload'

/** Bytes as megabytes, for a progress line a person can read. */
function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * What the server is downloading, on every page that has a header.
 *
 * It summarises rather than lists: with a queue there can be more than one thing waiting,
 * and the bar is a glance, not a screen. /downloads is where the detail lives.
 *
 * A failure keeps it on screen. The bar holds the app's ONLY link to /downloads, so
 * disappearing the moment the queue empties hid it exactly when it was needed: a download
 * that failed twice lands in history with nothing running, and the user was never told it
 * failed - Retry and Clear reachable only by typing the url. The newest history row being
 * a failure is what stands in for "not acknowledged yet"; retrying it or clearing history
 * is the acknowledgement, and both change what `history[0]` is.
 */

/**
 * A cancel is recorded as a failure - there is no separate cancelled state, and there does
 * not need to be. But it is the one failure nobody has to be told about: the user stopped
 * it themselves, and raising a persistent "Download failed" over their own deliberate act
 * is both wrong and unclearable without a trip to /downloads. The runner writes this exact
 * word (see `fail(db, id, 'cancelled')` in services/downloader.ts).
 */
const CANCELLED = 'cancelled'

export default function DownloadBar() {
  const { active, queue, history } = useDownload()
  const waiting = queue.filter((e) => e.state === 'queued').length
  // Naming a single file is only honest when there is exactly one running. With more than
  // one active, `current` stays unset and the label reports a count instead - otherwise
  // finishing the named one would silently swap the name (and the percentage) under an
  // unchanged label, for a file the reader never asked about.
  const current = active.length === 1 ? active[0] : null
  const [newest] = history

  const busy = active.length > 0 || waiting > 0
  const failure = !busy && newest?.state === 'failed' && newest.error !== CANCELLED ? newest : null

  if (!busy && !failure) return null

  // Content-Length is a claim the server may not make; without it there is no percentage
  // to show, only how much has arrived. Only meaningful for a single named download - with
  // several running at once there is no one file's progress for a percentage to describe.
  const progress = !current ? null
    : current.total > 0
      ? `${Math.round((current.received / current.total) * 100)}% — ${mb(current.received)} of ${mb(current.total)}`
      : mb(current.received)

  return (
    <div className={`download-bar${failure ? ' download-bar--failed' : ''}`} role="status">
      <span className="download-bar__label">
        {failure
          ? 'Download failed'
          : active.length > 1
            ? `Downloading ${active.length}`
            : current ? 'Downloading…' : 'Queued'}
      </span>
      {(current || failure) && (
        <span className="download-bar__name">
          {failure ? failure.label ?? failure.url : current!.label || current!.fileName}
        </span>
      )}
      {progress && <span className="download-bar__progress">{progress}</span>}
      {failure?.error && <span className="download-bar__progress">{failure.error}</span>}
      {waiting > 0 && <span className="download-bar__progress">{waiting} queued</span>}
      <Link to="/downloads" className="download-bar__link">Queue</Link>
    </div>
  )
}
