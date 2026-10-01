import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ApiBookArc, ApiCredit, ApiTag } from '../api'
import CharacterDialog from './CharacterDialog'

/** Past this many, the cast is longer than everything else on the page put together. */
const CHARACTER_SHOW_THRESHOLD = 40

interface IssueDetailProps {
  /** The comic these belong to - what a character profile is looked up against. */
  bookId?: number
  credits?: ApiCredit[]
  tags?: ApiTag[]
  summary?: string | null
  writer?: string | null
  penciller?: string | null
  date?: string | null
  editionId?: number
  editionName?: string
  /** Where the issue falls in each arc it belongs to, when Comic Vine has said. */
  arcs?: ApiBookArc[]
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="issue-detail__section">
      <h3 className="issue-detail__heading">{title}</h3>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="creator-row">
      <span className="creator-row__role">{label}</span>
      <span className="creator-row__names">{value}</span>
    </div>
  )
}

/**
 * Everything known about the centred issue: who made it, who is in it, where it falls in
 * a story, and what happens in it.
 *
 * The same things the issue's own page shows, in the same order and the same words, and
 * acting the same way: a character is a button that opens its profile and an arc is a link
 * to the arc, because a tag you cannot follow is a list of names you can do nothing with.
 * The issue page keeps what this deliberately does not have - editing the metadata,
 * fetching it again, removing the comic - since those act on the comic rather than
 * describe it, and the identity line above links through to them.
 *
 * The half of the info block that is reference rather than action, which is why it sits
 * below the Missing and Coming soon sections on a phone held upright.
 */
export default function IssueDetail({
  bookId, credits = [], tags = [], summary, writer, penciller, date,
  editionId, editionName, arcs = [],
}: IssueDetailProps) {
  // Folded by default, so the stylesheet is free to clamp it where there is no room. On
  // any screen with the height for it the clamp never applies and this does nothing.
  const [unfolded, setUnfolded] = useState(false)
  const [showAllCharacters, setShowAllCharacters] = useState(false)
  const [character, setCharacter] = useState<string | null>(null)

  const byRole = credits.reduce<Record<string, string[]>>((acc, c) => {
    const key = c.role.charAt(0).toUpperCase() + c.role.slice(1)
    ;(acc[key] = acc[key] || []).push(c.name)
    return acc
  }, {})
  const roles = Object.entries(byRole)

  const valuesOf = (kind: string) => tags.filter((t) => t.kind === kind).map((t) => t.value)
  const characters = valuesOf('character')
  const teams = valuesOf('team')
  const storyArcs = valuesOf('story_arc')

  const visibleCharacters = showAllCharacters
    ? characters
    : characters.slice(0, CHARACTER_SHOW_THRESHOLD)
  const hasMoreCharacters = characters.length > CHARACTER_SHOW_THRESHOLD

  const details: { label: string; value: ReactNode }[] = []
  if (editionId != null && editionName) {
    details.push({ label: 'Edition', value: <Link to={`/edition/${editionId}`}>{editionName}</Link> })
  }
  if (writer) details.push({ label: 'Writer', value: writer })
  if (penciller) details.push({ label: 'Penciller', value: penciller })
  if (date) details.push({ label: 'Date', value: date })

  // An issue Comic Vine has never been asked about carries none of this, and a column of
  // headings with nothing under them says less than no column at all.
  const empty = roles.length === 0 && tags.length === 0 && arcs.length === 0
    && details.length === 0 && !summary
  if (empty) return null

  return (
    <div className="issue-detail">
      {summary && (
        <Section title="Summary">
          <p className={`issue-detail__summary${unfolded ? '' : ' issue-detail__summary--clamped'}`}>
            {summary}
          </p>
          <button
            type="button"
            className="btn btn-ghost issue-detail__more"
            onClick={() => setUnfolded((on) => !on)}
          >
            {unfolded ? 'Less' : 'More'}
          </button>
        </Section>
      )}

      {details.length > 0 && (
        <Section title="Details">
          {details.map((d) => <Row key={d.label} label={d.label} value={d.value} />)}
        </Section>
      )}

      {roles.length > 0 && (
        <Section title="Creators">
          {roles.map(([role, names]) => <Row key={role} label={role} value={names.join(', ')} />)}
        </Section>
      )}

      {/* Where this issue falls in the story, which the arc tags alone cannot say. */}
      {arcs.length > 0 && (
        <Section title={arcs.length > 1 ? 'Story arcs' : 'Story arc'}>
          {arcs.map((arc) => (
            <Link key={arc.name} to={`/arcs/${encodeURIComponent(arc.name)}`} className="arc-position">
              <span className="arc-position__name">{arc.name}</span>
              {arc.position != null && arc.total != null && (
                <span className="arc-position__part">Part {arc.position} of {arc.total}</span>
              )}
            </Link>
          ))}
        </Section>
      )}

      {characters.length > 0 && (
        <Section title="Characters">
          <div className="chip-row">
            {visibleCharacters.map((c) => (
              <button key={c} type="button" className="chip chip--action"
                onClick={() => setCharacter(c)}>
                {c}
              </button>
            ))}
          </div>
          {hasMoreCharacters && (
            <button
              type="button"
              className="btn-ghost issue-detail__show-toggle"
              onClick={() => setShowAllCharacters((v) => !v)}
            >
              {showAllCharacters ? 'Show less' : `Show all (${characters.length})`}
            </button>
          )}
        </Section>
      )}

      {teams.length > 0 && (
        <Section title="Teams">
          {/* No page to send you to, so a label rather than a control. */}
          <div className="chip-row">{teams.map((t) => <span key={t} className="chip">{t}</span>)}</div>
        </Section>
      )}

      {/* The arc tags the file carries, which are not always the arcs Comic Vine lists
          this issue in - a tie-in is tagged without the arc listing it back. */}
      {storyArcs.length > 0 && (
        <Section title="Story Arcs">
          <div className="chip-row">
            {storyArcs.map((a) => (
              <Link key={a} to={`/arcs/${encodeURIComponent(a)}`} className="chip chip--action">{a}</Link>
            ))}
          </div>
        </Section>
      )}

      {character && bookId != null && (
        <CharacterDialog bookId={bookId} name={character} onClose={() => setCharacter(null)} />
      )}
    </div>
  )
}
