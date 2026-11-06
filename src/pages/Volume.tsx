import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiBook, ApiEdition, ApiShelf } from '../api'
import { statusFrom, withStatus } from '../lib/readStatus'
import { useBackLink, useBackOrigin } from '../lib/backOrigin'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { volumeEntries } from '../lib/volumeEntries'
import CoverTile from '../components/CoverTile'
import EditionRun from '../components/EditionRun'

/**
 * The edition that holds the volume's own issues, when the shelf holds any.
 *
 * It owns the run; the rest of the shelf's editions are collections of it. Telling the
 * two apart is what keeps a shelf from naming itself among the things it was collected
 * into, and what gives the run something to read its issue list from.
 */
function ownerOf(shelf: ApiShelf): ApiEdition | undefined {
  return shelf.holdsIssues ? shelf.editions.find((e) => e.comicvineId === shelf.volumeId) : undefined
}

/**
 * One volume, and every comic of it you own.
 *
 * Comic Vine gives each collected-edition line a volume of its own, so thirteen trades
 * of one run arrive as three editions with three different ids - all of them correct,
 * none of them the run. This page is the run: it gathers whatever keys to the volume and
 * draws it the way every other volume in the library is drawn.
 *
 * Drawn the same way is the point, and it was worth getting wrong once to see why. A
 * shelf that merely listed its comics, while every other volume got a carousel, an issue
 * detail and a covers toggle, was the one second-class run in the library - and the
 * reason for it, that Follow and Get all and Remove each need a single edition to act
 * on, turns out to apply to those three controls and to nothing else in the view.
 *
 * What it draws still follows from what it holds. A shelf of collections has no gaps:
 * the 2022 Amazing Spider-Man has about seventy issues and the library holds none of
 * them as issues, so there is nothing to Get and nothing to re-read from Comic Vine. A
 * shelf that does hold the volume's own issues is a run with gaps, and gets them.
 */
export default function Volume() {
  const { volumeId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const status = statusFrom(searchParams)
  const back = useBackOrigin()
  // Reached from the library, a series, or the home shelf's tile - the way out names
  // whichever it was, rather than always claiming you came from the library.
  const backLink = useBackLink('/', 'Library')

  const { data, isLoading, error } = useQuery({
    queryKey: ['volume', volumeId, status],
    queryFn: () => api.getVolumeShelf(volumeId!, status ?? undefined),
    retry: false,
  })

  useDocumentTitle(data?.shelf.name)

  // The wall of covers: asked for and then left, so it lives in this volume's url and
  // nowhere else, exactly as it does on an edition page.
  const showingCovers = searchParams.get('view') === 'grid'
  const showCovers = (on: boolean) => {
    const params = new URLSearchParams(searchParams)
    if (on) params.set('view', 'grid')
    else params.delete('view')
    setSearchParams(params, { replace: true })
  }

  if (isLoading) return <p>Loading…</p>
  // A bookmark outlives the editions that made it: the volume is gone, or its last
  // collection was removed. Saying so beats drawing a shelf holding nothing.
  if (error || !data) return <p>That volume was not found.</p>

  const { shelf, books } = data
  // The owning edition is the run itself, not something the run was collected into:
  // "collected in The Amazing Spider-Man (2025)" would be the shelf pointing at itself.
  const owner = ownerOf(shelf)
  const collections = shelf.editions.filter((e) => e.id !== owner?.id)

  return (
    <div>
      <Link to={backLink.to} onClick={backLink.onClick} className="back-link">← {backLink.label}</Link>
      <div className="edition-header">
        <div className="edition-header__title-row">
          <h1 className="page-title">{shelf.name}</h1>
          <button
            type="button"
            className="btn btn-ghost edition-header__covers"
            aria-pressed={showingCovers}
            onClick={() => showCovers(!showingCovers)}
          >
            {showingCovers ? 'Hide covers' : 'Show covers'}
          </button>
        </div>
        <p className="edition-header__count">
          {/* A shelf holding the volume's own issues counts issues; one gathered out of
              paperback lines counts trades, which is what its comics are. */}
          {shelf.bookCount} {shelf.holdsIssues ? 'issue' : 'trade'}{shelf.bookCount === 1 ? '' : 's'}
          {/* Where this run was gathered from, said once, in the sentence already
              describing the shelf - the way an edition page says what its run includes.
              The links go into the app rather than out to Comic Vine, because that is
              the job they do: Follow, Edit and Remove live on an edition page, and these
              editions lost their own tile on the series page when the shelf replaced it. */}
          {collections.length > 0 && (
            <>
              {' · collected in '}
              {collections.map((edition, i) => (
                <span key={edition.id}>
                  {i > 0 && (i === collections.length - 1 ? ' and ' : ', ')}
                  <Link to={withStatus(`/edition/${edition.id}`, status)} state={back}>{edition.name}</Link>
                </span>
              ))}
            </>
          )}
        </p>
      </div>

      {showingCovers
        ? (
          <div className="tile-grid">
            {books.map((book) => (
              <CoverTile
                key={book.id}
                /* Back into the run, standing on this comic - the same move the edition
                   page's covers make, and the reason the run keeps its place in the url. */
                to={`/volume/${volumeId}?issue=book-${book.id}`}
                state={back}
                img={`/api/books/${book.id}/thumbnail`}
                title={book.title || `#${book.number ?? '?'}`}
                subtitle={book.number ? `#${book.number}` : undefined}
                readState={book.readState}
                percent={book.percent}
              />
            ))}
          </div>
        )
        : <ShelfRun shelf={shelf} books={books} />}
    </div>
  )
}

/**
 * The run, drawn from whatever the shelf holds.
 *
 * A shelf holding the volume's own issues reads its run from the edition that owns them,
 * and the collections ride along as entries outside that run - which is what `extras` is
 * for, and what stops a trade being mistaken for an issue it is not.
 */
function ShelfRun({ shelf, books }: { shelf: ApiShelf; books: ApiBook[] }) {
  const owner = ownerOf(shelf)

  // Only a shelf with an owning edition has a Comic Vine run to read. A shelf of
  // collections has nothing to ask about, and does not ask.
  const { data: run } = useQuery({
    queryKey: ['edition-issues', owner ? String(owner.id) : 'none'],
    queryFn: () => api.getEditionIssues(String(owner!.id)),
    enabled: owner != null,
  })

  const collected = owner ? books.filter((b) => b.editionId !== owner.id) : books
  const entries = volumeEntries({
    issues: run?.issues ?? [],
    // With an owner, the collections sit outside its run. Without one there is no run
    // at all, and volumeEntries falls through to the books themselves.
    extras: owner ? collected.map((b) => ({ bookId: b.id, number: b.number, title: b.title })) : [],
    books,
    editions: shelf.editions.map((e) => ({ id: e.id, name: e.name })),
  })

  if (!entries.length) return <p>Nothing on this shelf yet.</p>

  // A gap belongs to the edition that owns the run, because a download of one has to
  // land in a folder. With no owner there are no gaps and nothing reads this.
  const fillInto = owner ?? shelf.editions[0]

  return (
    <EditionRun
      editionId={String(fillInto.id)}
      editionName={fillInto.name}
      entries={entries}
      seriesName={fillInto.seriesName?.trim() || fillInto.cvName || shelf.name}
      /* Marvel's calendar is keyed to a running series; a shelf of trades is not one. */
      soon={[]}
      /* Nothing in bulk and nothing to re-read: a collection has no run of its own on
         Comic Vine, and a mixed shelf's gaps are filled from the edition page that owns
         them - which is also where Follow and Remove edition still live. */
      gettable={0}
      onGetAll={() => {}}
      getAllPending={false}
      cvUrl={shelf.siteUrl}
    />
  )
}
