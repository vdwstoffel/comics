/**
 * The order an arc reads in.
 *
 * Kept out of the Comic Vine client so it can be tested with plain objects and numbers:
 * the client's job is fetching, and the running order is a decision about comics.
 */

/** Only what placing an issue in a run needs. Structural, so the client's richer type fits. */
export interface OrderableIssue {
  id: number
  number?: string
  volumeName?: string
  coverDate?: string
  storeDate?: string
}

/**
 * The series an arc is named for. Comic Vine names a crossover with its family in quotes -
 * `"Batman" Bad Seeds`, `"X-Men" DNX`, `"Hulk/Thor" Banner of War` - and that is the only
 * machine-readable signal it gives about which series is the spine and which are tie-ins.
 * A slash separates two co-headliners, so both terms count.
 */
export function arcFamily(arcName?: string): string[] {
  const quoted = /^"([^"]+)"/.exec(arcName ?? '')
  if (!quoted) return []
  return quoted[1].split('/').map((s) => s.trim().toLowerCase()).filter(Boolean)
}

/**
 * How close a series is to the arc's spine: 0 is the title itself, 1 a book the family
 * named (`Batman: Bad Seeds - Sunset`), 2 a tie-in from elsewhere.
 */
export function familyRank(volumeName: string | undefined, family: string[]): number {
  const name = (volumeName ?? '').toLowerCase()
  if (!name || family.length === 0) return 2
  if (family.includes(name)) return 0
  return family.some((f) => name.startsWith(f)) ? 1 : 2
}

/**
 * How to read one arc's dates. Cover dates run about two months ahead of on-sale dates, so
 * an arc where only some issues carry a store date goes on cover dates throughout - mixing
 * the two scales would shuffle the halves into each other. Decided once per arc, so the
 * sort and the merge below never disagree about what day an issue is.
 */
function dayOf<T extends OrderableIssue>(issues: T[]): (i: T) => string {
  const byStore = issues.length > 0 && issues.every((i) => i.storeDate)
  return (i) => (byStore ? i.storeDate : i.coverDate) || ''
}

/** The running order, as a new array. */
export function sortArcIssues<T extends OrderableIssue>(issues: T[], arcName?: string): T[] {
  const family = arcFamily(arcName)
  const day = dayOf(issues)
  return [...issues].sort((a, b) => {
    const ad = day(a)
    const bd = day(b)
    // An undated issue cannot be placed at all; it goes last rather than first.
    if (!ad !== !bd) return ad ? -1 : 1
    if (ad !== bd) return ad < bd ? -1 : 1
    const rank = familyRank(a.volumeName, family) - familyRank(b.volumeName, family)
    if (rank !== 0) return rank
    const vol = (a.volumeName || '').localeCompare(b.volumeName || '')
    if (vol !== 0) return vol
    const an = Number(a.number)
    const bn = Number(b.number)
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn
    return a.id - b.id
  })
}

/**
 * The run as you arranged it. `savedIds` is a whole-order snapshot taken when you last
 * reordered the arc by hand; `issues` is what Comic Vine says the arc holds now, in the
 * computed order.
 */
export function applySavedOrder<T extends OrderableIssue>(issues: T[], savedIds: number[]): T[] {
  const byId = new Map(issues.map((i) => [i.id, i]))
  // An id you arranged that the arc no longer lists is simply gone; it names nothing to place.
  const order = savedIds.flatMap((id) => {
    const found = byId.get(id)
    return found ? [found] : []
  })

  const placed = new Set(order.map((i) => i.id))
  const day = dayOf(issues)
  for (const issue of issues) {
    if (placed.has(issue.id)) continue
    // After the last issue that shipped on or before this one - so next week's issue
    // lands at the end, and a late-added tie-in lands in the week it belongs to rather
    // than at the bottom of a run you already arranged.
    // An undated issue cannot be placed against anything, so it goes last - the same
    // answer the sort gives it, rather than walking to the front past every real date.
    let at = order.length
    if (day(issue)) while (at > 0 && !(day(order[at - 1]) <= day(issue))) at--
    order.splice(at, 0, issue)
  }
  return order
}
