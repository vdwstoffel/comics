import { Link } from 'react-router-dom'

interface IssueActionProps {
  /** The comic this acts on, which is what the control is named for. */
  label: string
  /** Exactly one scraped row can be this issue. Anything less certain offers Find. */
  hasMatch: boolean
  /** The scraped title, shown on hover so you can see what would be fetched. */
  matchTitle?: string
  /** Where Find goes: the search, with the series and year filled in. */
  findTo: string
  onGet: () => void
  pending: boolean
  failed: boolean
  /** Already in the download queue — pressing Get again would just 409 on the server. */
  queued?: boolean
}

/**
 * The one way to fill a gap in a run, wherever the gap is shown.
 *
 * The grid tile, the carousel and the sidebar list all offer this, and they have to offer
 * it identically: the rule about when you may press Get is a real rule - it never guesses,
 * so it appears only when exactly one scraped release can be this issue - and three copies
 * of it would be three chances to word it differently.
 *
 * The control is labelled with the verb alone, because the comic is named beside it and a
 * name like "Spider-Man: Long Way Home #3" wrapped the label over three lines in a grid of
 * one-cover columns. The name is kept as the control's accessible name, because a page of
 * missing issues is otherwise a page of buttons that all read "Get". That name has to
 * follow the button into its working state: an accessible name overrides the text inside
 * the control, so a fixed one would announce an offer while the screen shows a fetch
 * already running.
 */
export default function IssueAction({
  label, hasMatch, matchTitle, findTo, onGet, pending, failed, queued,
}: IssueActionProps) {
  return (
    <>
      {queued ? (
        <button type="button" className="btn btn-ghost volume-issue__get" disabled>
          Queued
        </button>
      ) : hasMatch ? (
        <button
          type="button"
          className="btn btn-ghost volume-issue__get"
          disabled={pending}
          onClick={onGet}
          title={matchTitle}
          aria-label={pending ? `Getting ${label}` : `Get ${label}`}
        >
          {pending ? 'Getting…' : '↓ Get'}
        </button>
      ) : (
        <Link className="volume-issue__find" to={findTo} aria-label={`Find ${label}`}>Find ↗</Link>
      )}
      {failed && <span className="volume-issue__error">Could not get that one.</span>}
    </>
  )
}
