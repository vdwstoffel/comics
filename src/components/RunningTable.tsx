import { Link } from 'react-router-dom'
import type { ApiRunningSeries, RunKind } from '../api'

interface Publisher {
  name: string
  sourceUrl: string
  series: ApiRunningSeries[]
}

/**
 * Where a title takes you: the search page, seeded with the series name and its year.
 *
 * The Find links on the weekly tab back the year off by one, because a Comic Vine cover
 * date runs ahead of the day the comic reached the shop. A Wikipedia Pub. Year is the
 * actual year of publication, so it seeds exactly — the difference between the two tabs
 * is deliberate.
 */
function searchTo(series: ApiRunningSeries): string {
  const params = new URLSearchParams({ q: series.title })
  if (series.pubYear != null) params.set('yearFrom', String(series.pubYear))
  return `/search?${params}`
}

/** An em dash reads as "nothing here" without pretending to be a value. */
function orDash(value: string | number | null): string {
  return value == null ? '—' : String(value)
}

/** Open-ended runs first: they are the bulk of a publisher's list and the likelier read. */
const GROUPS: Array<{ kind: RunKind; caption: string }> = [
  { kind: 'ongoing', caption: 'Ongoing series' },
  { kind: 'limited', caption: 'Limited series' },
]

/**
 * One group of a publisher's series.
 *
 * The caption is the table's accessible name, so the heading and the table it names are
 * one thing rather than two that happen to sit next to each other — which is also what
 * lets "is this row in the right table?" be asked directly.
 */
function Group({ caption, series }: { caption: string; series: ApiRunningSeries[] }) {
  return (
    <table className="run-table">
      <caption className="run-table__caption">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col">Issues</th>
          <th scope="col">Year</th>
          <th scope="col">Ends</th>
        </tr>
      </thead>
      <tbody>
        {series.map((row, i) => (
          <tr key={`${row.title}-${row.pubYear ?? '?'}-${i}`}>
            <td><Link to={searchTo(row)}>{row.title}</Link></td>
            <td>{orDash(row.issues)}</td>
            <td>{orDash(row.pubYear)}</td>
            {/* Filled on few rows, and the one fact that decides whether a run is worth
                starting: it already has a last issue. */}
            <td>{orDash(row.endsOn)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * One publisher's currently-published series, split into open-ended runs and limited
 * ones. The split replaces a Kind column: the caption says it once instead of every row
 * repeating it.
 *
 * The title is the link rather than the whole row: a row-wide click target swallows text
 * selection and makes the tap area ambiguous on the tablet this app is used on, and a
 * linked title matches the Find affordance the weekly tab already uses.
 */
export default function RunningTable({ publisher }: { publisher: Publisher }) {
  return (
    <section>
      {GROUPS.map(({ kind, caption }) => {
        const series = publisher.series.filter((s) => s.kind === kind)
        // A caption over an empty table would announce a group that is not there.
        if (series.length === 0) return null
        return <Group key={kind} caption={caption} series={series} />
      })}
      {/* Once for the pair: both tables were read from the same page. */}
      <p className="arc-detail__meta">
        Source:{' '}
        <a href={publisher.sourceUrl} target="_blank" rel="noreferrer">
          Wikipedia — {publisher.name} publications
        </a>
      </p>
    </section>
  )
}
