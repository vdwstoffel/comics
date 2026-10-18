import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { CvVolumeMatch } from '../api'
import { findVolumeHref } from '../lib/findVolumeHref'

/** Publisher and issue count identify a volume between two of the same name. Either may
 *  be missing, so the separator is joined rather than written into the markup. */
function factsOf(volume: CvVolumeMatch): string {
  return [
    volume.publisher,
    volume.issueCount == null
      ? undefined
      : `${volume.issueCount.toLocaleString()} ${volume.issueCount === 1 ? 'issue' : 'issues'}`,
  ].filter(Boolean).join(' · ')
}

/** Newest first. A volume Comic Vine gives no start year sorts last: there is nowhere
 *  honest to put it in a run of years. */
function newestFirst(a: CvVolumeMatch, b: CvVolumeMatch): number {
  if (a.startYear == null) return b.startYear == null ? 0 : 1
  if (b.startYear == null) return -1
  return b.startYear - a.startYear
}

/**
 * What Comic Vine knows about this series that the library does not.
 *
 * A series page can only show what has been collected, which leaves the rest of a
 * long-running title invisible - a shelf holding The Amazing Spider-Man (2025) says
 * nothing about the six volumes before it. These are those volumes.
 *
 * A list rather than the covers the page uses above it, because six volumes of one
 * title carry six near-identical covers and differ by the one thing a cover does not
 * show. The years are the column you read down, so they lead the row and the list runs
 * in their order rather than in the order Comic Vine ranked them.
 *
 * The candidates are offered rather than resolved: a library's name for a series and a
 * Comic Vine volume cannot be matched reliably, so nothing is dropped for looking like
 * a poor fit. The only ones dropped are the ones already on the page above.
 *
 * A row goes two ways: the name leads out to Comic Vine, and Find goes to the index
 * search for that volume. Nothing here writes to the library either way.
 */
export default function OtherVolumes({ series, ownedVolumeIds, publisher }: {
  series: string
  /** Comic Vine ids of the editions already shelved, which are not news. */
  ownedVolumeIds: number[]
  /**
   * Who publishes this series, as the library knows it. Comic Vine lists every
   * licensed reprint line under the same name - "Batman" answers with Panini Verlag,
   * ECC Ediciones, Editorial Novaro and six more before it gets to DC - and none of
   * those is a volume anyone here could go and find. Null when the library has never
   * been told, and then nothing is filtered: showing everything beats showing nothing.
   */
  publisher?: string | null
}) {
  const { data } = useQuery({
    queryKey: ['cv-volumes', series],
    queryFn: () => api.getComicVineVolumes(series),
  })

  const owned = new Set(ownedVolumeIds)
  // filter() hands back a new array, so the sort cannot reach the cached response.
  //
  // A volume Comic Vine credits to nobody is dropped along with the foreign lines: it
  // cannot be shown to be the publisher you asked for, and the list is long enough
  // without rows that might not be.
  const volumes = (data?.volumes ?? [])
    .filter((v) => !owned.has(v.id))
    .filter((v) => !publisher || v.publisher === publisher)
    .sort(newestFirst)

  // No key configured, Comic Vine unreachable with nothing held, nothing found, or
  // nothing found that is not already shelved. The series page is not the place to
  // report any of those - it simply has nothing to add.
  if (!volumes.length) return null

  return (
    <section className="other-volumes">
      <h2 className="shelf-heading">Other volumes on Comic Vine</h2>
      {data?.stale && (
        <p className="other-volumes__stale">Comic Vine is not answering — showing what we last read.</p>
      )}
      <ul className="other-volumes__list">
        {volumes.map((v) => {
          const facts = factsOf(v)
          // Comic Vine's name for this volume rather than the library's for the series:
          // the Marvel UK run is "Amazing Spider-Man" where the shelf says "The Amazing
          // Spider-Man", and the index was posted under the name the volume carries.
          const name = v.name ?? series
          const label = v.startYear ? `${name} (${v.startYear})` : name
          return (
            <li className="other-volumes__row" key={v.id}>
              <span className="other-volumes__year" data-testid="other-volume-year">{v.startYear ?? ''}</span>
              <span className="other-volumes__text">
                <a className="other-volumes__name" href={v.siteUrl} target="_blank" rel="noreferrer">{name}</a>
                {facts && <span className="other-volumes__facts">{facts}</span>}
              </span>
              {/* Named for the volume, because a list of nine of these is otherwise nine
                  links that all read "Find". */}
              <Link
                className="other-volumes__find"
                to={findVolumeHref(name, v.startYear)}
                aria-label={`Find ${label}`}
              >
                Find ↗
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
