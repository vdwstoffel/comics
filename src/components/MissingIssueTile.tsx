import { Link } from 'react-router-dom'
import CoverTile from './CoverTile'

interface MissingIssueTileProps {
  label: string
  siteUrl?: string
  /** Exactly one scraped row can be this issue. Anything less certain offers Find. */
  hasMatch: boolean
  /** The scraped title, shown on hover so you can see what would be fetched. */
  matchTitle?: string
  /** Where Find goes: the search, with the series and year filled in. */
  findTo: string
  /**
   * Cover art, when the page has any to show. An edition page passes none - a cover is a
   * spoiler for a comic you have not read - but the Latest tab passes one, because every
   * issue there is unread and a shop window with no art is not a shop window.
   */
  coverUrl?: string
  onGet: () => void
  pending: boolean
  failed: boolean
  /** Already in the download queue — pressing Get again would just 409 on the server. */
  queued?: boolean
}

/**
 * An issue you do not have, and the way to fill it. Shared by the edition page and the
 * Latest tab so the two offer the same thing in the same words.
 */
export default function MissingIssueTile({
  label, siteUrl, hasMatch, matchTitle, findTo, coverUrl, onGet, pending, failed, queued,
}: MissingIssueTileProps) {
  return (
    <div className="volume-issue">
      <CoverTile href={siteUrl} img={coverUrl} title={label} subtitle="Missing" />
      {queued ? (
        <button type="button" className="btn btn-ghost volume-issue__get" disabled>
          Queued
        </button>
      ) : hasMatch ? (
        <button
          type="button"
          className="btn btn-ghost volume-issue__get"
          disabled={pending}
          onClick={onGet}
          title={matchTitle}
        >
          {pending ? 'Getting…' : `↓ Get ${label}`}
        </button>
      ) : (
        <Link className="volume-issue__find" to={findTo}>{`Find ${label} ↗`}</Link>
      )}
      {failed && <span className="volume-issue__error">Could not get that one.</span>}
    </div>
  )
}
