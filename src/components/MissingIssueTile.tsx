import type { ReactNode } from 'react'
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
  /** The offer to fill this gap from a file you already have. Passed straight through. */
  upload?: ReactNode
}

/**
 * An issue you do not have, as a tile in a grid. Shared by the edition page's grid view
 * and the Latest tab so the two offer the same thing in the same words.
 *
 * The offer itself lives in IssueAction, which the carousel and the volume page's sidebar
 * draw too; this is the tile around it.
 */
export default function MissingIssueTile({
  label, siteUrl, hasMatch, matchTitle, findTo, coverUrl, onGet, pending, failed, queued, upload,
}: MissingIssueTileProps) {
  const action = (
    <IssueAction
      label={label}
      hasMatch={hasMatch}
      matchTitle={matchTitle}
      findTo={findTo}
      onGet={onGet}
      pending={pending}
      failed={failed}
      queued={queued}
      upload={upload}
    />
  )

  // With no art the cover is a dashed blank, and the controls belong in it: it is the only
  // empty space on the tile and it is the very thing they are about. With art - the
  // releases tab passes some - they stay beneath, because blotting out the cover is the
  // opposite of what that page is for.
  return coverUrl
    ? (
      <div className="volume-issue">
        <CoverTile href={siteUrl} img={coverUrl} title={label} subtitle="Missing" />
        {action}
      </div>
    )
    : (
      <div className="volume-issue">
        <CoverTile href={siteUrl} title={label} subtitle="Missing" overlay={action} />
      </div>
    )
}
