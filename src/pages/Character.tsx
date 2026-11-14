import { useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiCharacter, ProfileBlock } from '../api'
import { groupBySeries } from '../lib/volumeGroups'
import { profileSections } from '../lib/profileSections'
import { useBackLink } from '../lib/backOrigin'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import SeriesGroupTile from '../components/SeriesGroupTile'
import CharacterContents from '../components/CharacterContents'

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="character-page__fact">
      <dt className="character-page__fact-label">{label}</dt>
      <dd className="character-page__fact-value">{value}</dd>
    </div>
  )
}

/** One block of the profile. Nothing here is HTML from Comic Vine — it arrives as text. */
function Block({ block, id }: { block: ProfileBlock; id?: string }) {
  if (block.kind === 'list') {
    return <ul className="character-profile__list">{block.items.map((i) => <li key={i}>{i}</li>)}</ul>
  }
  if (block.kind === 'para') return <p className="character-profile__para">{block.text}</p>
  // The page's own h1 is the character, so the article's sections rank beneath it.
  const Tag = block.level === 2 ? 'h2' : block.level === 3 ? 'h3' : 'h4'
  return <Tag id={id} className={`character-profile__heading character-profile__heading--${block.level}`}>{block.text}</Tag>
}

/** Who they are, before anything else: the portrait, the names, the one-line description. */
function Header({ c, name }: { c: ApiCharacter | null; name: string }) {
  return (
    <div className="character-page__head">
      {c?.imageUrl
        ? <img className="character-page__portrait" src={c.imageUrl} alt={name} referrerPolicy="no-referrer" />
        : <span className="character-page__portrait character-page__portrait--empty" aria-hidden="true" />}
      <div className="character-page__ident">
        <h1 className="page-title character-page__name">{name}</h1>
        {c?.realName && <p className="character-page__real-name">{c.realName}</p>}
        {c?.publisher && <p className="character-page__publisher">{c.publisher}</p>}
        {c?.deck && <p className="character-page__deck">{c.deck}</p>}
      </div>
    </div>
  )
}

/**
 * A character, read like an encyclopedia entry, with the comics of yours they are in.
 *
 * Reached from a character on any comic, which is where you meet someone new and want to
 * know who they are - so the page leads with that, and reads top to bottom: who they are,
 * the facts, the full profile, and only then your comics. The comics come last because
 * they are what you do after reading, and a line near the top says how many there are, so
 * a long profile cannot hide that you own a hundred of them.
 *
 * The comics are grouped the way the library's own search groups them - a tile per series
 * that opens onto its volumes - so Iron Man's 121 comics are a dozen tiles rather than a
 * wall of covers, and look like every other shelf in the app.
 *
 * What Comic Vine says comes from the server's week-long cache. The comics come from the
 * library, matched by Comic Vine's character id, never by name: Comic Vine has four
 * Hobgoblins, and this page is about one of them.
 */
export default function Character() {
  const { id: raw } = useParams()
  const id = Number(raw)
  const location = useLocation()
  // Arrived from a chip on a comic Comic Vine never matched: the character was found by
  // name, which is a guess worth saying out loud.
  const guess = (location.state as { guess?: boolean } | null)?.guess === true
  const back = useBackLink('/', 'Library')
  const [openSeries, setOpenSeries] = useState<string | null>(null)
  const comicsRef = useRef<HTMLElement>(null)

  const page = useQuery({
    queryKey: ['character-page', id],
    queryFn: () => api.getCharacterPage(id),
    enabled: Number.isSafeInteger(id) && id > 0,
    retry: false,
  })
  const books = useQuery({
    queryKey: ['character-books', id],
    queryFn: () => api.characterBooks(id),
    enabled: Number.isSafeInteger(id) && id > 0,
  })

  const c = page.data?.character ?? null
  const name = c?.name ?? page.data?.name ?? 'Character'
  useDocumentTitle(page.data ? name : 'Character')

  const { sections, idFor } = profileSections(c?.profile ?? [])
  const owned = books.data?.books ?? []
  const groups = groupBySeries(owned)
  const facts: Array<{ label: string; value: string }> = []
  if (c?.firstAppearance) facts.push({ label: 'First appearance', value: c.firstAppearance })
  if (c?.appearanceCount != null) facts.push({ label: 'Appearances', value: c.appearanceCount.toLocaleString() })
  if (c && c.aliases.length > 0) facts.push({ label: 'Also known as', value: c.aliases.join(', ') })

  return (
    <div className="character-page">
      <Link to={back.to} onClick={back.onClick} className="back-link">← {back.label}</Link>

      {page.isLoading && <p className="cv-status">Looking them up…</p>}
      {page.isError && <p className="cv-error">{"Couldn't find that character on Comic Vine."}</p>}

      {page.data && (
        <div className={`character-page__body${sections.length > 1 ? ' character-page__body--contents' : ''}`}>
          <div className="character-page__intro">
            <Header c={c} name={name} />

            {guess && (
              <p className="character-page__caveat">
                {"Matched by name, not from the comic's credits — this is a best guess."}
              </p>
            )}
            {page.data.unavailable && (
              <p className="character-page__caveat">
                Nothing to read about them right now: {page.data.unavailable}. Your comics with them are below.
              </p>
            )}

            {facts.length > 0 && (
              <dl className="character-page__facts">
                {facts.map((f) => <Fact key={f.label} {...f} />)}
              </dl>
            )}

            {/* How many of yours, said up here: a long profile would otherwise hide it. A
                button rather than an anchor, so jumping down does not touch the url. */}
            {owned.length > 0 && (
              <button
                type="button"
                className="btn-ghost character-page__jump"
                onClick={() => comicsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                In {owned.length} of your comics ↓
              </button>
            )}
          </div>

          {/* Only where there is somewhere to jump: a profile of one section has nothing
              to list, and a character with no profile has no sections at all. */}
          {sections.length > 1 && (
            <CharacterContents sections={sections} comics={{ id: 'character-comics', count: owned.length }} />
          )}

          <div className="character-page__reading">
            {c && c.profile.length > 0 && (
              <article className="character-page__profile">
                {c.profile.map((block, i) => <Block key={i} block={block} id={idFor.get(i)} />)}
              </article>
            )}

            {c?.siteUrl && (
              <a className="character-page__link" href={c.siteUrl} target="_blank" rel="noreferrer">
                Their page on Comic Vine ↗
              </a>
            )}
          </div>
        </div>
      )}

      {(page.data || page.isError) && (
        <section className="character-page__comics" id="character-comics" ref={comicsRef} aria-label="In your library">
          <h2 className="character-page__comics-title">
            In your library
            {owned.length > 0 && <span className="character-page__comics-count">
              {' '}— {owned.length} comic{owned.length === 1 ? '' : 's'}
              {groups.length > 1 && ` in ${groups.length} series`}
            </span>}
          </h2>
          {books.isLoading && <p>Loading…</p>}
          {books.data && owned.length === 0 && <p className="settings__hint">None of your comics credit them yet.</p>}
          {owned.length > 0 && (
            <div className="tile-grid">
              {groups.map((group) => (
                <SeriesGroupTile
                  key={group.key}
                  group={group}
                  open={openSeries === group.key}
                  onToggle={() => setOpenSeries(openSeries === group.key ? null : group.key)}
                  onClose={() => setOpenSeries(null)}
                  unread={false}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
