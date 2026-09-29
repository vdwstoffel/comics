/**
 * Telling a run's annuals apart from the run itself.
 *
 * Comic Vine gives every year's annual its own volume, so a run you have followed for a
 * while brings one edition per year - "Amazing Spider-Man Annual (2026)", "(2027)", and
 * on - each of which is a single issue. Left alone they crowd the series page, saying
 * "Annual" as many times as there are years before saying anything else.
 *
 * This is a second copy of a rule the server also holds, in `deriveSeriesName`'s strip
 * list. Deliberately: nothing under src/ reaches into server/, and the two answer
 * different questions - the server decides what a volume's series is called, and this
 * decides which tile a volume is drawn on.
 */

/** Name ends in "Annual" or "Annuals", give or take the year that follows it. */
const ANNUAL = /\s+annuals?(\s*\(\d{4}\))?\s*$/i

/** Only the field the rule reads, so any edition-shaped thing can be split. */
interface NamedEdition {
  name: string
}

export function isAnnual(name: string): boolean {
  return ANNUAL.test(name)
}

/**
 * A series' editions, split into the run and the annuals of it.
 *
 * Both lists keep the order they arrived in, so the page draws them in whatever order the
 * server chose rather than an order invented here.
 */
export function splitAnnuals<T extends NamedEdition>(editions: T[]): { runs: T[]; annuals: T[] } {
  const runs: T[] = []
  const annuals: T[] = []
  for (const edition of editions) {
    if (isAnnual(edition.name)) annuals.push(edition)
    else runs.push(edition)
  }
  return { runs, annuals }
}

/**
 * The year an annual belongs to, from its own name.
 *
 * The year is what tells one annual from another: they are almost all issue #1, and a
 * page listing them by number would say "#1" as many times as there are years. Taken from
 * the volume's name rather than the comic's cover date, because it is the volume that the
 * year names - Comic Vine opens a new one for each.
 */
export function annualYear(name: string): string | null {
  return /\((\d{4})\)\s*$/.exec(name.trim())?.[1] ?? null
}
