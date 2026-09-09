import { Link } from 'react-router-dom'
import { useDownload } from '../lib/useDownload'

/** Bytes as megabytes, for a progress line a person can read. */
function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * What the server is downloading, on every page that has a header.
 *
 * It lives beside the header rather than on the upload form because the download does:
 * it is a job on the server that outlives whichever page started it. The reader has no
 * header and so gets no bar, which is the intent — that page is meant to be nothing but
 * the comic.
 */
export default function DownloadBar() {
  const { status, result, dismiss } = useDownload()

  if (status?.running) {
    // Content-Length is a claim the server may not make; without it there is no
    // percentage to show, only how much has arrived.
    const progress = status.total > 0
      ? `${Math.round((status.received / status.total) * 100)}% — ${mb(status.received)} of ${mb(status.total)}`
      : mb(status.received)
    return (
      <div className="download-bar" role="status">
        <span className="download-bar__label">Downloading…</span>
        {status.fileName && <span className="download-bar__name">{status.fileName}</span>}
        <span className="download-bar__progress">{progress}</span>
      </div>
    )
  }

  if (!result) return null

  return (
    <div className={`download-bar${result.error ? ' download-bar--failed' : ''}`} role="status">
      {result.error
        ? <span className="download-bar__label">Download failed: {result.error}</span>
        : (
          <>
            <span className="download-bar__label">✓ Downloaded</span>
            {result.fileName && <span className="download-bar__name">{result.fileName}</span>}
          </>
        )}
      {result.bookId && (
        <Link to={`/book/${result.bookId}`} className="download-bar__link">View comic</Link>
      )}
      <button
        type="button"
        className="download-bar__dismiss"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  )
}
