import CoverTile from './CoverTile'
import IssueAction from './IssueAction'

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
 * An issue you do not have, as a tile in a grid. Shared by the edition page's grid view
 * and the Latest tab so the two offer the same thing in the same words.
 *
 * The offer itself lives in IssueAction, which the carousel and the volume page's sidebar
 * draw too; this is the tile around it.
 */
export default function MissingIssueTile({
  label, siteUrl, hasMatch, matchTitle, findTo, coverUrl, onGet, pending, failed, queued,
}: MissingIssueTileProps) {
  return (
    <div className="volume-issue">
      <CoverTile href={siteUrl} img={coverUrl} title={label} subtitle="Missing" />
      <IssueAction
        label={label}
        hasMatch={hasMatch}
        matchTitle={matchTitle}
        findTo={findTo}
        onGet={onGet}
        pending={pending}
        failed={failed}
        queued={queued}
      />
    </div>
  )
}
