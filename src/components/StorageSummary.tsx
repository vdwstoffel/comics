import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { formatBytes } from '../lib/bytes'

/** The four kinds, in the order they matter: the library, then what indexing it costs. */
const KINDS = [
  ['Comics', 'comics'],
  ['Covers', 'covers'],
  ['Database', 'database'],
  ['Temp files', 'temp'],
] as const

/**
 * What the server is holding and what room is left, above the queue that fills it.
 *
 * It sits here rather than on a pane of its own because this is where it is acted on: the
 * answer to "is there room for this run" belongs beside the thing that queues the run.
 *
 * The bar is drawn against the whole disk, including what is on it that has nothing to do
 * with comics. On this server the library is 42 GB of the 370 GB in use, and a bar that
 * left the other 328 GB out would promise space that something else has already taken.
 */
export default function StorageSummary() {
  const { data } = useQuery({ queryKey: ['storage'], queryFn: api.getStorage })

  // Nothing at all until it is measured, and nothing if the server cannot say. A walk of
  // the comics folder is not instant, and a placeholder that pushed the queue down the
  // page every time the pane opened would cost more than the half-second it covered.
  if (!data) return null

  const library = data.comics + data.covers + data.database + data.temp
  // What is on the disk that is not ours. Floored at zero: `total` and `free` come from
  // the filesystem and the four sizes from a walk that takes a moment, so a download
  // landing between the two can make the parts add up to slightly more than the whole.
  const other = Math.max(0, data.total - data.free - library)
  const share = (bytes: number) => `${data.total > 0 ? (bytes / data.total) * 100 : 0}%`

  return (
    <section className="settings__subsection" aria-label="Storage">
      <h3 className="settings__subhead">Storage</h3>
      <p className="storage__headline">
        The library takes <strong>{formatBytes(library)}</strong>
        {' — '}
        {formatBytes(data.free)} free of {formatBytes(data.total)}.
      </p>

      <div
        className="storage__bar"
        role="img"
        aria-label={
          `${formatBytes(library)} library, ${formatBytes(other)} other files, ` +
          `${formatBytes(data.free)} free`
        }
      >
        <span className="storage__segment storage__segment--library" style={{ width: share(library) }} />
        <span className="storage__segment storage__segment--other" style={{ width: share(other) }} />
      </div>

      <dl className="storage__kinds">
        {KINDS.map(([label, key]) => (
          <div key={key} className="storage__kind">
            <dt>{label}</dt>
            <dd>{formatBytes(data[key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
