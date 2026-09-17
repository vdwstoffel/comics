import { Link } from 'react-router-dom'
import type { VolumeGroup } from '../lib/volumeGroups'

interface VolumeGroupTileProps {
  group: VolumeGroup
  onOpen: () => void
}

/**
 * One volume's worth of unread comics, as a single tile.
 *
 * Twenty unread issues of one run used to be twenty tiles, which buried every other run
 * on the shelf. The cover opens the volume's issues because looking inside is the common
 * move; the name beside it stays a way through to the volume itself, carrying the filter
 * you are already looking at so the page you land on shows the same comics.
 *
 * A volume holding a single unread comic is still a tile. A second rendering rule for
 * that case would cost more than the one redundant step it saves.
 *
 * Which volume is open lives on the shelf rather than here, so only one can be.
 */
export default function VolumeGroupTile({ group, onOpen }: VolumeGroupTileProps) {
  return (
    <div className="volume-tile">
      <button
        type="button"
        className="volume-tile__cover"
        aria-label={`Issues of ${group.editionName}`}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <img src={`/api/editions/${group.editionId}/thumbnail`} alt={group.editionName} />
      </button>
      <Link className="volume-tile__name" to={`/edition/${group.editionId}?status=unread`}>
        {group.editionName}
      </Link>
      <div className="volume-tile__count">{group.books.length} unread</div>
    </div>
  )
}
