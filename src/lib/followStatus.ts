import type { ApiFollow } from '../api'
import { writeOutShortDay } from './releaseWeek'

/**
 * What the solicitation calendar has to say about a follow that has run out of issues.
 *
 * Three answers rather than an optional issue, because "nothing is solicited" and "we
 * have not asked yet" are different facts and only one of them may be stated out loud.
 * Marvel's calendar is a network read behind a twelve-hour cache: on a cold load every
 * follow is `pending` for a moment, and spending that moment asserting that there is
 * nothing more to tell would be a claim we have not earned.
 */
export type FollowSoon =
  | { state: 'pending' }
  | { state: 'none' }
  /** The Wednesday it is solicited for, `YYYY-MM-DD`. The issue's number is deliberately
   *  not carried: the calendar numbers a run its own way - legacy numbering, specials -
   *  and the date is the part that is both reliable and the thing being asked. */
  | { state: 'next'; week: string }

/**
 * What a follow has to say for itself, in one line.
 *
 * Every line is derived from the state the server computed rather than stored, and the
 * two kinds of waiting are deliberately different sentences: "nobody has posted it" is a
 * fact about the index, "not announced" is a fact about the publisher, and a reader can
 * do something about neither - but only one of them is going to change this week.
 *
 * A supplied follow says nothing: there is a comic on the shelf, which says it better.
 *
 * `soon` is consulted for `caught-up` alone. It is the only state where the calendar can
 * know something the issue list does not: every other state already has its next issue,
 * and naming a solicitation beside it would be two answers to one question.
 */
export function followStatus(follow: ApiFollow, soon: FollowSoon = { state: 'pending' }): string {
  switch (follow.state) {
    case 'wanted': {
      const which = follow.want?.number ? `#${follow.want.number}` : 'the next issue'
      if (follow.queued) return `Getting ${which}`
      return follow.want?.number
        ? `${which} is out — not posted yet`
        : 'The next issue is out — not posted yet'
    }
    case 'caught-up':
      if (soon.state === 'next') return `Next: ${writeOutShortDay(soon.week)}`
      // Only once the calendar has actually answered. While it is pending - loading, or
      // unreadable - the older sentence is the honest one: it claims nothing either way.
      if (soon.state === 'none') return 'Waiting on the next issue — no further details'
      return 'Waiting on the next issue to be announced'
    case 'dormant':
      return 'Nothing read yet — finish an issue to pull the next'
    case 'supplied':
      return ''
  }
}
