import { useState } from 'react'
import type { ReactNode } from 'react'
import { writeOutShortDay } from '../lib/releaseWeek'
import type { UpcomingIssueForEdition } from '../lib/upcomingForEdition'

/** A gap in the run, as the list needs to name it. */
export interface MissingRow {
  id: number
  label: string
}

interface EditionSidebarProps {
  missing: MissingRow[]
  soon: UpcomingIssueForEdition[]
  /** How many gaps one press of Get all would actually take. */
  gettable: number
  onGetAll: () => void
  getAllPending: boolean
  /** The page wires each row's own download; this block only places it. */
  renderAction: (issueId: number) => ReactNode
  /** Read the run from Comic Vine again. Absent when there is no run to re-read. */
  onRefresh?: () => void
  refreshing?: boolean
  /** True when Comic Vine could not be reached and this run is what we already held. */
  stale?: boolean
  /** Comic Vine's own page for the volume. Null when the edition has no volume. */
  cvUrl?: string | null
}

/**
 * One foldable section of the sidebar.
 *
 * Folded is where it starts, because on a phone the sidebar sits under the issue and both
 * headings have to be reachable without scrolling past one of them. In a landscape window
 * the stylesheet unfolds both and hides the control, which is why the content is always
 * rendered and only ever hidden by CSS: a section that existed only when expanded would
 * be empty in the column it was designed for.
 */
function Section({ title, count, aside, quiet, children }: {
  title: string
  count: number
  /** Drawn beside the heading and outside the fold - a bulk action needs no unfolding. */
  aside?: ReactNode
  /** A section carrying nothing to act on, which should not look like one that does. */
  quiet?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className={`edition-side__section${open ? ' edition-side__section--open' : ''}${quiet ? ' edition-side__section--quiet' : ''}`}>
      <div className="edition-side__head">
        <button
          type="button"
          className="edition-side__toggle"
          aria-expanded={open}
          onClick={() => setOpen((on) => !on)}
        >
          <span className="edition-side__chevron" aria-hidden="true">▸</span>
          {title} ({count})
        </button>
        {aside}
      </div>
      <div className="edition-side__body">{children}</div>
    </section>
  )
}

/**
 * What the run still owes you: the issues you do not have and the ones not published yet.
 *
 * A column beside the comic in a landscape window, two folded rows beneath it in portrait.
 * Both sections disappear entirely when they are empty - a complete run carrying a
 * permanent "Missing (0)", or an ended volume promising "Coming soon: nothing", would each
 * say something untrue about the run.
 */
export default function EditionSidebar({
  missing, soon, gettable, onGetAll, getAllPending, renderAction,
  onRefresh, refreshing, stale, cvUrl,
}: EditionSidebarProps) {
  return (
    <aside className="edition-side">
      {/* Where the run came from, beside the run rather than over it. There is no date
          here: when Comic Vine was last read is bookkeeping nobody acts on, and it was
          spending a line of the page's header to say it. That the run could NOT be read
          is different - that is news, and it is said whatever the size of the screen. */}
      {(onRefresh || cvUrl) && (
        <div className="edition-side__source">
          {stale && <p className="edition-side__stale">Could not reach Comic Vine</p>}
          {onRefresh && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={refreshing}
              onClick={onRefresh}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          {cvUrl && (
            <a className="edition-side__cv" href={cvUrl} target="_blank" rel="noopener noreferrer">
              See this volume on Comic Vine ↗
            </a>
          )}
        </div>
      )}

      {missing.length > 0 && (
        <Section
          title="Missing"
          count={missing.length}
          aside={gettable > 0 && (
            <button
              type="button"
              className="btn btn-ghost edition-side__get-all"
              disabled={getAllPending}
              onClick={onGetAll}
            >
              {getAllPending ? 'Queueing…' : `↓ Get all ${gettable}`}
            </button>
          )}
        >
          <ul className="edition-side__list">
            {missing.map((row) => (
              <li key={row.id} className="edition-side__row">
                <span className="edition-side__label">{row.label}</span>
                <span className="edition-side__action">{renderAction(row.id)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Quieter than Missing by design: a gap is something you can do something about,
          and this is something you can only wait for. */}
      {soon.length > 0 && (
        <Section title="Coming soon" count={soon.length} quiet>
          <ul className="edition-side__list">
            {soon.map((issue) => (
              <li key={issue.sourceId} className="edition-side__row edition-side__row--soon">
                {/* The number alone, and a short date. Every row here is this volume, so
                    the volume's name on each one is the longest thing in the column and
                    the only thing in it the page has not already said. */}
                <span className="edition-side__label" title={issue.headline}>{issue.label}</span>
                <span className="edition-side__week">{writeOutShortDay(issue.week)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </aside>
  )
}
