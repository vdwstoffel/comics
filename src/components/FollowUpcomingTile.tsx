import CoverTile from './CoverTile'

interface FollowUpcomingTileProps {
  /** The run, as the shelf names it everywhere else. */
  name: string
  /** The Wednesday, already written out by the shared formatter. */
  date: string
  coverUrl: string
  /** The publisher's page for the solicitation, which is where the cover came from. */
  siteUrl: string
}

/**
 * A followed run whose next issue is solicited but not out: the cover Marvel has
 * published for it, dimmed, with the date over the middle of it.
 *
 * The art is safe to show here for the same reason it is safe on the releases tab and
 * nowhere else - this is a comic nobody has read, so a cover gives nothing away. The
 * dimming is the whole point of the tile: a shelf where a comic you can open and one you
 * cannot are drawn alike is a shelf you have to read the captions of. Brightness rather
 * than a dashed blank because the blank said only that something was missing, and the
 * cover says which comic is coming.
 *
 * It opens the publisher's page rather than the volume in the library: the thing this
 * tile is about does not exist here yet, and the run's own page is one row of its own
 * Coming soon list away.
 */
export default function FollowUpcomingTile({ name, date, coverUrl, siteUrl }: FollowUpcomingTileProps) {
  return (
    <div className="follow-upcoming">
      <CoverTile
        href={siteUrl}
        img={coverUrl}
        title={name}
        overlay={<span className="follow-upcoming__date">{date}</span>}
      />
    </div>
  )
}
