/**
 * A reading list as it is written down: a story in the order a guide reads it, across as
 * many series as it takes, with the tie-ins marked so it can be read short or long.
 *
 * Lists live in code rather than in the database - they are rare, and each one is
 * researched rather than typed in - so this shape is the whole of what a list can say,
 * and the typechecker is what rejects a malformed one. Every value in an entry is Comic
 * Vine's, copied by scripts/reading-list-entries.ts; none is typed by hand.
 */

export interface ReadingListIssue {
  /** Comic Vine's id for the issue: what ownership, read state and Follow all key on. */
  cv: number
  /** Comic Vine's name for the issue's volume - what a match against the index keys on. */
  volume: string
  /** Comic Vine's id for that volume - what decides which edition a download lands in. */
  volumeId: number
  number: string
  coverDate?: string
  /** The story title, where Comic Vine records one. */
  title?: string
  /** Comic Vine's page for the issue - where the tile of one you do not have leads. */
  siteUrl?: string
  /** A tie-in: read in Full, left out of Core. */
  extra?: boolean
}

/** A stretch of a phase the guide names on its own - Secret Wars' Last Days, Warzones. */
export interface ReadingListSection {
  name: string
  note?: string
  issues: ReadingListIssue[]
}

interface PhaseHeading {
  name: string
  /** What a reader should know going in - "the story jumps forward eight months". */
  note?: string
}

/**
 * A phase holds its issues directly, or - where the guide splits it further - in sections.
 * The sections are Full's business: Core reads the phase as one run, because a finale
 * whose core is one issue per section would otherwise fall apart into a bar per issue.
 */
export type ReadingListPhase =
  | PhaseHeading & { issues: ReadingListIssue[]; sections?: never }
  | PhaseHeading & { sections: ReadingListSection[]; issues?: never }

export interface ReadingList {
  /** Fixed forever: a follow and the saved length are stored under it. Never reused. */
  id: number
  /** The url: /lists/<slug>. */
  slug: string
  name: string
  publisher?: string
  years?: string
  description?: string
  /** Comic Vine's cover for the list's first issue, for the shelf tile. */
  cover?: string
  phases: ReadingListPhase[]
}

/** Core is the story; Full is the story with its tie-ins. */
export type ListLength = 'core' | 'full'
