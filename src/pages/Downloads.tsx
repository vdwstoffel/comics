import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useDownload } from '../lib/useDownload'
import QueueList from '../components/QueueList'

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export default function Downloads() {
  const qc = useQueryClient()
  const { active, queue, history } = useDownload()
  // Every mutation ends by re-reading the one query the whole app shares.
  const refresh = { onSuccess: () => qc.invalidateQueries({ queryKey: ['download'] }) }

  const move = useMutation({ mutationFn: (v: { id: number; index: number }) => api.moveDownload(v.id, v.index), ...refresh })
  const cancel = useMutation({ mutationFn: (id: number) => api.cancelDownload(id), ...refresh })
  const retry = useMutation({ mutationFn: (id: number) => api.retryDownload(id), ...refresh })
  const clear = useMutation({ mutationFn: () => api.clearDownloadHistory(), ...refresh })

  return (
    <>
      <h1 className="page-title">Downloads</h1>

      <section aria-label="Now downloading">
        <h2 className="page-title">Now downloading</h2>
        {active.length === 0 ? <p>Nothing downloading.</p> : active.map((d) => (
          <p key={d.id} className="download-bar__name">
            {d.label || d.fileName}{' — '}
            {d.total > 0 ? `${Math.round((d.received / d.total) * 100)}%` : mb(d.received)}
          </p>
        ))}
      </section>

      <section>
        <h2 className="page-title">Queue</h2>
        <QueueList
          entries={queue}
          onMove={(id, index) => move.mutate({ id, index })}
          onCancel={(id) => cancel.mutate(id)}
        />
      </section>

      <section>
        <h2 className="page-title">Recent</h2>
        {history.length === 0 ? <p>Nothing yet.</p> : (
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
    </>
  )
}
