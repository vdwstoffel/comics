import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiCharacter, ProfileBlock } from '../api'

interface CharacterDialogProps {
  bookId: string | number
  name: string
  onClose: () => void
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="character-card__fact">
      <span className="character-card__fact-label">{label}</span>
      <span className="character-card__fact-value">{value}</span>
    </div>
  )
}

/** Renders one parsed block. Nothing here is HTML from Comic Vine — it arrives as text. */
function Block({ block }: { block: ProfileBlock }) {
  if (block.kind === 'list') {
    return <ul className="character-profile__list">{block.items.map((i) => <li key={i}>{i}</li>)}</ul>
  }
  if (block.kind === 'para') return <p className="character-profile__para">{block.text}</p>
  // Shifted a rank down: the card's own name is the h3, so the article's sections sit
  // beneath it rather than outranking the character they belong to.
  const Tag = block.level === 2 ? 'h4' : block.level === 3 ? 'h5' : 'h6'
  return <Tag className={`character-profile__heading character-profile__heading--${block.level}`}>{block.text}</Tag>
}

function Profile({ blocks }: { blocks: ProfileBlock[] }) {
  const [open, setOpen] = useState(false)
  if (blocks.length === 0) return null
  return (
    <div className="character-profile">
      <button
        className="btn-ghost character-profile__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide the full profile' : 'Read the full profile'}
      </button>
      {open && (
        <div className="character-profile__body">
          {blocks.map((block, i) => <Block key={i} block={block} />)}
        </div>
      )}
    </div>
  )
}

function Card({ c, verified }: { c: ApiCharacter; verified: boolean }) {
  return (
    <>
      <div className="character-card__head">
        {c.imageUrl
          ? <img className="character-card__portrait" src={c.imageUrl} alt={c.name || 'Portrait'} loading="lazy" referrerPolicy="no-referrer" />
          : <span className="character-card__portrait character-card__portrait--empty" aria-hidden="true" />}
        <div className="character-card__ident">
          <h3 className="character-card__name">{c.name}</h3>
          {c.realName && <p className="character-card__real-name">{c.realName}</p>}
          {c.publisher && <p className="character-card__publisher">{c.publisher}</p>}
        </div>
      </div>

      {!verified && (
        <p className="character-card__caveat">
          {"Matched by name, not from this issue's credits — this is a best guess."}
        </p>
      )}

      {c.deck && <p className="character-card__deck">{c.deck}</p>}

      <div className="character-card__facts">
        {c.firstAppearance && <Fact label="First appearance" value={c.firstAppearance} />}
        {c.appearanceCount != null && <Fact label="Appearances" value={String(c.appearanceCount)} />}
        {c.aliases.length > 0 && <Fact label="Also known as" value={c.aliases.join(', ')} />}
      </div>

      <Profile blocks={c.profile ?? []} />

      {c.siteUrl && (
        <a className="character-card__link" href={c.siteUrl} target="_blank" rel="noreferrer">
          Read the full profile on Comic Vine ↗
        </a>
      )}
    </>
  )
}

/**
 * Who is this character? Fetched when you click, never on render — an issue can credit
 * thirty characters, and looking all of them up to show a panel nobody opened would burn
 * the hourly budget for nothing.
 */
export default function CharacterDialog({ bookId, name, onClose }: CharacterDialogProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['character', bookId, name],
    queryFn: () => api.getCharacter(bookId, name),
    // The same character does not change mid-session; clicking its chip twice is one request.
    staleTime: Infinity,
    retry: false,
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel character-card" onClick={(e) => e.stopPropagation()}>
        {isLoading && <p className="cv-status">Looking up {name}…</p>}
        {isError && <p className="cv-error">{"Couldn't find that character on Comic Vine."}</p>}
        {data && <Card c={data.character} verified={data.verified} />}
        <div className="cv-close-row">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
