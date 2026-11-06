import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { useDownload } from '../../lib/useDownload'
import QueueList from '../../components/QueueList'
import BlockedHandoff from '../../components/BlockedHandoff'
import StorageSummary from '../../components/StorageSummary'
import { useAppliedSettings } from './useAppliedSettings'

/** Bytes as megabytes, for a progress line a person can read. */
function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * The download dial and the queue it governs, on one pane.
 *
 * They were a setting here and a page of their own at /downloads, which meant changing how
 * many run at once and seeing what that did to the queue were two different places. The
 * dial stays at the top: it is the setting, and the pane is reached from Settings.
 */
export default function DownloadsSection() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const applied = useAppliedSettings()
  const { active, queue, history, blocked } = useDownload()

  const setConcurrency = useMutation({
    mutationFn: (downloadConcurrency: number) => api.updateSettings({ downloadConcurrency }),
    ...applied,
  })

  // Every queue mutation ends by re-reading the one query the whole app shares.
  const refresh = { onSuccess: () => qc.invalidateQueries({ queryKey: ['download'] }) }
  const move = useMutation({ mutationFn: (v: { id: number; index: number }) => api.moveDownload(v.id, v.index), ...refresh })
  const cancel = useMutation({ mutationFn: (id: number) => api.cancelDownload(id), ...refresh })
  const retry = useMutation({ mutationFn: (id: number) => api.retryDownload(id), ...refresh })
  const clear = useMutation({ mutationFn: () => api.clearDownloadHistory(), ...refresh })

  return (
    <section>
      <h2 className="page-title">Downloads</h2>

      <label className="settings__concurrency">
        Download at once
        <select
          value={String(settings?.downloadConcurrency ?? 1)}
          onChange={(e) => setConcurrency.mutate(Number(e.target.value))}
          disabled={setConcurrency.isPending}
        >
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {/* A dial invites the reading that higher is better. It depends on where the
          bottleneck is: a saturated link gains nothing from more connections. */}
      <p className="settings__hint">More at once is not always faster — it depends on your connection.</p>

      {/* Under the dial, which is the setting the pane leads with, and above everything
          that moves. Room on the disk is what you want to know before queueing a run, not
          what you find out when a download fails partway through for want of it. */}
      <StorageSummary />

      {/* First of the live sections, and only when there is one: it is the only state
          that will never resolve on its own, so it goes above the things that will. */}
      {blocked.length > 0 && (
        <section className="settings__subsection" aria-label="Needs you">
          <h3 className="settings__subhead">Needs you</h3>
          <p className="settings__hint">
            These asked for a browser instead of handing over the file. Open the post, do
            the check yourself, then give the comic back here — it files into the right run
            with its metadata, exactly as the download would have.
          </p>
          <ul className="queue-list">
            {blocked.map((entry) => <BlockedHandoff key={entry.id} entry={entry} />)}
          </ul>
        </section>
      )}

      <section className="settings__subsection" aria-label="Now downloading">
        <h3 className="settings__subhead">Now downloading</h3>
        {active.length === 0 ? <p className="settings__hint">Nothing downloading.</p> : active.map((d) => (
          <p key={d.id} className="download-bar__name">
            {d.label || d.fileName}{' — '}
            {d.total > 0 ? `${Math.round((d.received / d.total) * 100)}%` : mb(d.received)}
          </p>
        ))}
      </section>

      <section className="settings__subsection">
        <h3 className="settings__subhead">Queue</h3>
        <QueueList
          entries={queue}
          onMove={(id, index) => move.mutate({ id, index })}
          onCancel={(id) => cancel.mutate(id)}
        />
      </section>

      <section className="settings__subsection">
        <h3 className="settings__subhead">Recent</h3>
        {history.length === 0 ? <p className="settings__hint">Nothing yet.</p> : (
          <>
            <ul className="queue-list">
              {history.map((entry) => (
                <li key={entry.id} className="queue-list__row">
                  <span className="queue-list__label">{entry.label ?? entry.url}</span>
                  {entry.error && <span className="queue-list__error">{entry.error}</span>}
                  {entry.bookId && <Link to={`/book/${entry.bookId}`}>View comic</Link>}
                  {entry.state === 'failed' && (
                    <button
                      type="button" className="btn btn-ghost"
                      aria-label={`Retry ${entry.label ?? entry.url}`}
                      onClick={() => retry.mutate(entry.id)}
                    >Retry</button>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-ghost" onClick={() => clear.mutate()}>Clear</button>
          </>
        )}
      </section>
    </section>
  )
}
