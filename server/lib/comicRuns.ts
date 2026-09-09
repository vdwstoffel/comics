/** A jump larger than this is two numbering streams interleaved, not one run with holes. */
const MAX_GAP = 25
/** Years of silence that end a run rather than interrupt it. */
const SILENCE_YEARS = 3
/**
 * Issues divided by the span of numbers they cover. A real run is near 1; a scattering
 * of issues no honest range describes is near 0.
 */
const MIN_DENSITY = 0.6

/** Reserved: every real run's key is built from digits, so nothing can collide with it. */
export const REST_KEY = '__rest__'
const REST_LABEL = 'Other issues'

export interface RunRow {
  title: string
  number: string | null
  year: number | null
}

export interface IssueRun {
  key: string
  label: string
  yearFrom: number
  yearTo: number
  first: number
  last: number
  total: number
}

const numberOf = (n: string | null): number => (n ? parseInt(n, 10) : NaN)
const placeable = (r: RunRow) => r.year !== null && !Number.isNaN(numberOf(r.number))

function label(yearFrom: number, yearTo: number, first: number, last: number): string {
  const years = yearFrom === yearTo ? `${yearFrom}` : `${yearFrom}-${yearTo}`
  const issues = first === last ? `#${first}` : `#${first}-${last}`
  return `${years} · ${issues}`
}

/**
 * Break a series' issues into its runs — the stretch between one relaunch and the next.
 *
 * Issues are walked in numbering order and each one extends whichever open run it
 * continues — the nearest in time whose numbering ends just below it.
 *
 * Reading them in year order instead cannot work, and that is the whole difficulty here.
 * Marvel and DC publish an issue under both a fresh number and a legacy one, so two
 * numberings run side by side for years. Ordered by year, the turn of each year deals
 * out both streams at once and severs whichever run was mid-flow: Batman's #1-4 in 2025
 * and #5-12 in 2026 came apart, and so did its #141-155 and #156-162. Chaining keeps
 * each stream on its own thread, so the pair stay two runs instead of four.
 *
 * A run will not take an issue numbered below where it has reached, more than a couple
 * of dozen above it, or after a few years of silence. Ascending strictly is also what
 * makes "#1-140" an honest label rather than a minimum and a maximum with anything at
 * all in between.
 *
 * What cannot be placed in a trustworthy run — an issue with no year, or a scattering
 * too sparse for any range to describe — is set aside into a final "Other issues" entry
 * rather than discarded. Every issue handed in comes back out in exactly one entry;
 * a heading that hides rows is worse than an untidy one.
 */
export function detectRuns(rows: RunRow[]): { run: IssueRun; rows: RunRow[] }[] {
  const leftover: RunRow[] = rows.filter((r) => !placeable(r))

  const seen = new Set<string>()
  const issues = rows
    .filter(placeable)
    // Numbering order, not year order: a run is a thread of numbers, and the year only
    // says whether an issue could plausibly continue one.
    .sort((a, b) => numberOf(a.number) - numberOf(b.number) || a.year! - b.year!)
    // The same issue posted twice would otherwise read as the numbering going backwards.
    .filter((r) => {
      const id = `${r.year}|${numberOf(r.number)}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })

  const open: { last: RunRow; rows: RunRow[] }[] = []
  for (const row of issues) {
    const n = numberOf(row.number)
    const y = row.year!
    let best: (typeof open)[number] | undefined
    let bestGap = 0
    let bestNumber = 0
    for (const stream of open) {
      const lastNumber = numberOf(stream.last.number)
      const lastYear = stream.last.year!
      if (n <= lastNumber || n - lastNumber > MAX_GAP) continue
      if (y < lastYear || y - lastYear >= SILENCE_YEARS) continue
      // Nearest in time wins; between equals, the run whose numbering ends closest
      // below. That is what sends #5 to the run on #4 rather than one on #4 nine
      // years ago, when a series has been relaunched from #1 more than once.
      const gap = y - lastYear
      if (!best || gap < bestGap || (gap === bestGap && lastNumber > bestNumber)) {
        best = stream
        bestGap = gap
        bestNumber = lastNumber
      }
    }
    if (best) {
      best.rows.push(row)
      best.last = row
    } else {
      open.push({ last: row, rows: [row] })
    }
  }
  const stretches = open.map((stream) => stream.rows)

  const runs: { run: IssueRun; rows: RunRow[] }[] = []
  for (const stretch of stretches) {
    const numbers = stretch.map((r) => numberOf(r.number))
    const first = Math.min(...numbers)
    const last = Math.max(...numbers)
    if (stretch.length / (last - first + 1) < MIN_DENSITY) {
      leftover.push(...stretch)
      continue
    }
    const years = stretch.map((r) => r.year!)
    const yearFrom = Math.min(...years)
    const yearTo = Math.max(...years)
    runs.push({
      run: {
        key: `${yearFrom}_${yearTo}_${first}`,
        label: label(yearFrom, yearTo, first, last),
        yearFrom, yearTo, first, last,
        total: stretch.length,
      },
      rows: stretch,
    })
  }

  // Newest first: the current run is the one you are usually after.
  runs.sort((a, b) => b.run.yearTo - a.run.yearTo || b.run.first - a.run.first)

  if (leftover.length) {
    const years = leftover.map((r) => r.year).filter((y): y is number => y !== null)
    runs.push({
      run: {
        key: REST_KEY,
        label: REST_LABEL,
        yearFrom: years.length ? Math.min(...years) : 0,
        yearTo: years.length ? Math.max(...years) : 0,
        first: 0, last: 0,
        total: leftover.length,
      },
      rows: leftover,
    })
  }
  return runs
}

/** The run summaries alone, for a group heading that only needs to name them. */
export function splitRuns(rows: RunRow[]): IssueRun[] {
  return detectRuns(rows).map((r) => r.run)
}

/** The rows of one run, addressed by its key. Empty when the key names no run. */
export function runRows(rows: RunRow[], key: string): RunRow[] {
  return detectRuns(rows).find((r) => r.run.key === key)?.rows ?? []
}
