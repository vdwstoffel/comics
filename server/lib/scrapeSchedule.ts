/**
 * When the release index is checked without anyone pressing the button.
 *
 * New comics come out on Wednesday, so a daily scrape would mostly find nothing. Wednesday
 * at six in the evening is when the button was being pressed anyway; Thursday at six looks
 * again for the posts that land after it - a week of manual runs showed a handful still
 * arriving the day after.
 *
 * Read in the server's LOCAL time, unlike releaseDay, which is about Comic Vine's plain
 * dates. Six in the evening is a wall-clock time: counted in fixed days from a UTC
 * instant it would drift an hour each time the clocks change. The container's zone comes
 * from TZ in docker-compose.yml.
 */

const DAYS = [3, 4] // Wednesday, Thursday - Date#getDay: Sunday is 0
const HOUR = 18

/** The check on the day `offset` days from `now`'s, if that day has one. */
function slotOn(now: Date, offset: number): Date | null {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, HOUR)
  return DAYS.includes(day.getDay()) ? day : null
}

/** The first check strictly after `now`. */
export function nextSlot(now: Date): Date {
  for (let offset = 0; ; offset++) {
    const slot = slotOn(now, offset)
    if (slot && slot > now) return slot
  }
}

/** The last check at or before `now`. */
export function previousSlot(now: Date): Date {
  for (let offset = 0; ; offset--) {
    const slot = slotOn(now, offset)
    if (slot && slot <= now) return slot
  }
}

/**
 * Whether the last check went by with no scrape after it. Any scrape counts, not only an
 * automatic one: pressing Check for new at seven did the job the six o'clock check was for.
 */
export function slotMissed(now: Date, lastStartedAt: string | null): boolean {
  return lastStartedAt === null || new Date(lastStartedAt) < previousSlot(now)
}
