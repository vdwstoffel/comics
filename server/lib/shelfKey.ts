import type { Edition } from '../types.js'

/**
 * The shelf an edition belongs on.
 *
 * Comic Vine gives every collected-edition line a volume of its own, so one run of trades
 * arrives as several editions whose `comicvine_id`s are all correct and all different.
 * What they agree on is what they reprint, and that is what a shelf is of: the volume,
 * not the packaging. An ordinary run of issues reprints nothing and is simply of itself.
 *
 * So the key is `collectsVolumeId ?? comicvineId` - which is also why a trade of a run you
 * already own as issues lands on that run's shelf without a special case, and why an
 * edition pointed at its own volume by a mis-confirm yields one key rather than two.
 *
 * A string rather than a number because an edition Comic Vine knows nothing about still
 * needs a shelf of its own, and `edition:7` cannot collide with any volume id.
 */
export function shelfKeyOf(
  e: Pick<Edition, 'id' | 'comicvineId' | 'collectsVolumeId'>,
): string {
  const volumeId = e.collectsVolumeId ?? e.comicvineId
  return volumeId == null ? `edition:${e.id}` : `volume:${volumeId}`
}

/** The volume a key names, or null for an `edition:` key, which names no volume. */
export function volumeIdOfKey(key: string): number | null {
  const found = /^volume:(\d+)$/.exec(key)
  return found ? Number(found[1]) : null
}
