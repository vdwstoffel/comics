/**
 * Which of Marvel's solicited issues belong to the volume you are looking at.
 *
 * Kept apart from the page so the rule can be read and tested on its own: it is the
 * whole substance of the Coming soon section, and every interesting case in it is a
 * string comparison rather than anything you can see in a rendered list.
 */

/** Only the fields the rule reads. Narrower than ApiUpcomingIssue on purpose. */
export interface UpcomingIssueLike {
  sourceId: string
  headline: string
}

export interface UpcomingWeekLike {
  week: string
  issues: UpcomingIssueLike[]
}

/** The names an edition may be known by, all of them optional but `name`. */
export interface EditionNames {
  name: string
  seriesName?: string | null
  cvName?: string | null
  /** The year the run began, when Comic Vine has told us. */
  cvStartYear?: number | null
}

export interface UpcomingIssueForEdition {
  sourceId: string
  headline: string
  /**
   * The headline with the series taken off it: `#16`, usually.
   *
   * For a list on the page of one volume, where every row is that volume by construction
   * and the name is the longest thing in each one. Falls back to the whole headline when
   * the issue states no number - an annual or a one-shot - because an empty label names
   * nothing at all.
   */
  label: string
  /** The Wednesday it is solicited for, `YYYY-MM-DD`. */
  week: string
}

/**
 * A series name reduced to what two sources can be expected to agree on.
 *
 * Marvel's calendar writes some headlines in title case and others in capitals, so case
 * cannot be trusted. A trailing "(2025)" is the volume's year rather than part of its
 * name, and is compared separately. Punctuation goes because a colon, a slash and a dash
 * are all used to join the same two halves of a title.
 */
function normalizeSeries(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The trailing issue number, which is the one part of a headline that is not the series. */
const NUMBER = /#\s*[^\s#]+\s*$/

/** "Captain America (2025) #16" -> "Captain America". */
function seriesOf(headline: string): string {
  return headline.replace(/\s*#\s*[^\s#]+\s*$/, '')
}

/** "Captain America (2025) #16" -> "#16". The exact inverse of seriesOf, and the same
 *  rule, so a headline matched on its series is labelled by what the match left over. */
function labelOf(headline: string): string {
  return NUMBER.exec(headline)?.[0].trim() ?? headline
}

/**
 * The volume year Marvel states, or null when it states none.
 *
 * Plenty of headlines carry no year at all - annuals, one-shots and specials among them -
 * and that silence is not a disagreement.
 */
function statedYear(headline: string): number | null {
  const year = /\((\d{4})\)\s*$/.exec(seriesOf(headline))?.[1]
  return year ? Number(year) : null
}

export function upcomingForEdition(
  weeks: UpcomingWeekLike[],
  edition: EditionNames,
): UpcomingIssueForEdition[] {
  // Any of the three names may be the one Marvel uses: `seriesName` is ours and is what
  // usually matches, `cvName` is Comic Vine's, and `name` is whatever the edition ended
  // up called - which for a volume nobody has renamed is the only one there is.
  const wanted = new Set(
    [edition.seriesName, edition.cvName, edition.name]
      .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
      .map(normalizeSeries),
  )

  // Only when BOTH sides name a year is a disagreement meaningful. Marvel reuses a title
  // every few years, and "Captain America (2027) #1" on the page for the 2025 volume is
  // not a comic you are waiting for. Requiring a year outright would be worse: it would
  // drop every annual and special, which state none.
  const startYear = edition.cvStartYear
  const sameRun = (headline: string): boolean => {
    const year = statedYear(headline)
    return year === null || startYear == null || year === startYear
  }

  return weeks
    .slice()
    .sort((a, b) => a.week.localeCompare(b.week))
    .flatMap(({ week, issues }) => issues
      .filter((issue) => wanted.has(normalizeSeries(seriesOf(issue.headline))))
      .filter((issue) => sameRun(issue.headline))
      .map(({ sourceId, headline }) => ({ sourceId, headline, label: labelOf(headline), week })))
}
