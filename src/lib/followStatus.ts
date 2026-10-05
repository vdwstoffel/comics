import type { ApiFollow } from '../api'

/**
 * What a follow has to say for itself, in one line.
 *
 * Every line is derived from the state the server computed rather than stored, and the
 * two kinds of waiting are deliberately different sentences: "nobody has posted it" is a
 * fact about the index, "not announced" is a fact about the publisher, and a reader can
 * do something about neither - but only one of them is going to change this week.
 *
 * A supplied follow says nothing: there is a comic on the shelf, which says it better.
 */
export function followStatus(follow: ApiFollow): string {
  switch (follow.state) {
    case 'wanted': {
      const which = follow.want?.number ? `#${follow.want.number}` : 'the next issue'
      if (follow.queued) return `Getting ${which}`
      return follow.want?.number
        ? `${which} is out — not posted yet`
        : 'The next issue is out — not posted yet'
    }
    case 'caught-up':
      return 'Waiting on the next issue to be announced'
    case 'dormant':
      return 'Nothing read yet — finish an issue to pull the next'
    case 'supplied':
      return ''
  }
}
