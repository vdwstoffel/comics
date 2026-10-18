/**
 * Reading what a collected edition reprints out of Comic Vine's prose.
 *
 * There is no field for it. What there is, in two places and neither of them reliable,
 * is a sentence somebody typed. These parsers are therefore a source of suggestions and
 * never of truth: what they find is offered, confirmed by hand, and stored - after
 * which nothing re-reads the prose, so a Comic Vine editor rewriting a paragraph can
 * never rearrange a shelf.
 */

/** Comic Vine's own machine-readable reference. 4050 is a volume; 4000 is an issue. */
const VOLUME_REF = /data-ref-id="4050-(\d+)"/g

/**
 * The words that mean "this reprints that", as opposed to "this is next to that".
 *
 * The distinction is the whole parser. Both real descriptions also link the other half
 * of the same trade line - "Continued on in", "Continued from" - and on "by Wells and
 * Romita Jr." the sibling and the answer are referenced exactly once each, so counting
 * references picks the wrong one half the time.
 */
const COLLECTING_VERB = /\bcollect(s|ing|ed)?\b/i

/**
 * The volume a collection says it collects, or null.
 *
 * The first volume reference that appears after a collecting verb. Takes the RAW
 * description: `stripHtml` removes the attributes this reads, so the `summary` already
 * on CvVolume is useless here.
 */
export function volumeRefFromDescription(html: string): number | null {
  if (!html) return null
  const verb = COLLECTING_VERB.exec(html)
  if (!verb) return null

  VOLUME_REF.lastIndex = verb.index
  const found = VOLUME_REF.exec(html)
  VOLUME_REF.lastIndex = 0
  return found ? Number(found[1]) : null
}

/**
 * Marvel's own line at the foot of a trade's solicitation: `COLLECTING: Amazing
 * Spider-Man (2022) 61-70`.
 *
 * This is what rescues a collection whose volume description is empty - which The 8
 * Deaths of Spider-Man's is. It carries no link, so the name and year still have to be
 * matched against Comic Vine's volume search to become an id.
 *
 * The issue range is deliberately dropped. It would be enough to say which issues of a
 * run you are missing, and that is worth having, but it is not what this is for and it
 * must never reach anything that decides the order of a shelf.
 */
export function collectingLineFromIssue(html: string): { name: string; startYear: number | null } | null {
  if (!html) return null
  const line = /COLLECTING:\s*([^<]+)/i.exec(html)
  if (!line) return null

  const rest = line[1].trim()
  const year = /\((\d{4})\)/.exec(rest)
  // Everything before the year, or before the issue numbers when there is no year.
  const name = (year ? rest.slice(0, year.index) : rest.replace(/[\s#]*\d[\d\s,#–—-]*$/, '')).trim()
  return name ? { name, startYear: year ? Number(year[1]) : null } : null
}
