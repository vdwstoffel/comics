import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import type { ReviewCollection } from '../../api'
import { useDownload } from '../../lib/useDownload'
import QueueList from '../../components/QueueList'
import BlockedHandoff from '../../components/BlockedHandoff'
import StorageSummary from '../../components/StorageSummary'
import { storingLabel } from '../../components/DownloadBar'
import ConfirmDeleteDialog from '../../components/ConfirmDeleteDialog'
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
  const { active, queue, history, blocked, review } = useDownload()
  const [discarding, setDiscarding] = useState<ReviewCollection | null>(null)

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
  const discard = useMutation({
    mutationFn: (id: number) => api.discardCollection(id),
    onSuccess: () => { setDiscarding(null); qc.invalidateQueries({ queryKey: ['download'] }) },
  })
  // A finished download that became a collection links to it while it is still there.
  const reviewable = new Set(review.filter((c) => c.waiting === 0).map((c) => c.id))

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

      {/* Beside Needs you and for the same reason: nothing here moves until you act. A
          collection whose parts are still coming is listed too, so a run you queued is
          visible as one thing rather than as four rows in the queue. */}
      {review.length > 0 && (
        <section className="settings__subsection" aria-label="Ready to review">
          <h3 className="settings__subhead">Ready to review</h3>
          <p className="settings__hint">
            Comics that arrived together, waiting for you to check which volume they belong
            to before anything is filed.
          </p>
          <ul className="queue-list">
            {review.map((c) => {
              const landed = c.parts - c.waiting - c.failed - c.blocked
              return (
                <li key={c.id} className="queue-list__row">
                  <span className="queue-list__label">{c.label}</span>
                  <span className="queue-list__state">
                    {c.waiting > 0
                      ? `${landed} of ${c.parts} parts in`
                      : `${c.fileCount} comic${c.fileCount === 1 ? '' : 's'}`}
                  </span>
                  {c.failed > 0 && (
                    <span className="queue-list__error">
                      {c.failed} part{c.failed === 1 ? '' : 's'} failed — retry under Recent
                    </span>
                  )}
                  {c.blocked > 0 && (
                    <span className="queue-list__error">
                      {c.blocked} part{c.blocked === 1 ? '' : 's'} {c.blocked === 1 ? 'needs' : 'need'} you
                    </span>
                  )}
                  {c.waiting === 0 && c.fileCount > 0 && (
                    <Link className="btn btn-ghost" to={`/upload/bulk?collection=${c.id}`}>Review</Link>
                  )}
                  <button
                    type="button" className="btn btn-ghost"
                    aria-label={`Discard ${c.label}`}
                    onClick={() => { discard.reset(); setDiscarding(c) }}
                  >Discard</button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {discarding && (
        <ConfirmDeleteDialog
          what={`"${discarding.label}"`}
          detail={discarding.waiting > 0
            ? `The ${discarding.waiting} part${discarding.waiting === 1 ? '' : 's'} still to come will be cancelled.`
            : 'Nothing in your library is touched.'}
          fileCount={discarding.fileCount}
          deleting={discard.isPending}
          error={discard.isError ? 'Could not discard that one.' : null}
          onConfirm={() => discard.mutate(discarding.id)}
          onClose={() => setDiscarding(null)}
        />
      )}

      <section className="settings__subsection" aria-label="Now downloading">
        <h3 className="settings__subhead">Now downloading</h3>
        {active.length === 0 ? <p className="settings__hint">Nothing downloading.</p> : active.map((d) => (
          <p key={d.id} className="download-bar__name">
            {d.label || d.fileName}{' — '}
            {d.storing ? storingLabel(d.fileName)
              : d.total > 0 ? `${Math.round((d.received / d.total) * 100)}%` : mb(d.received)}
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
                  {entry.collectionId != null && reviewable.has(entry.collectionId) && (
                    <Link to={`/upload/bulk?collection=${entry.collectionId}`}>Review</Link>
                  )}
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
