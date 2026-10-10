import type { ReactNode } from 'react'
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
  /**
   * The offer to fill this gap from a file you already have, where there is somewhere to
   * file it. A slot rather than props of its own: only a run knows which edition a comic
   * belongs to, and the arc page and the releases tab draw this same control without one.
   */
  upload?: ReactNode
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
 *
 * Uploading rides along as a slot rather than a fourth rule, because unlike Get it is not
 * offered everywhere this is drawn: it needs an edition to file the comic into, and only a
 * run has one.
 */
export default function IssueAction({
  label, hasMatch, matchTitle, findTo, onGet, pending, failed, queued, upload,
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
      {/*
        Beside whichever of Get or Find is showing, because the two answer different
        questions - Get fetches the release the index found, Upload takes the comic you
        already have - and a gap with no match is where having the file yourself matters
        most. Not beside Queued: a download for this issue is already running, and a second
        copy landing next to it is not a fix for waiting.
      */}
      {!queued && upload}
      {failed && <span className="volume-issue__error">Could not get that one.</span>}
    </>
  )
}
