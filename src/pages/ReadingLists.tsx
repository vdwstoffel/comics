import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { ApiReadingListSummary } from '../api'
import LibraryRail from '../components/LibraryRail'
import { useBackOrigin } from '../lib/backOrigin'
import { usePublisher } from '../lib/usePublisher'
import { useDocumentTitle } from '../lib/useDocumentTitle'

const issues = (n: number) => `${n} issue${n === 1 ? '' : 's'}`

/** How big a commitment it is: Core, and Full beside it when there are tie-ins to add. */
function sizeOf({ size }: ApiReadingListSummary): string {
  return size.full > size.core ? `${issues(size.core)} · ${size.full} with tie-ins` : issues(size.core)
}

/** Where you are. What you have of it is the list page's to say - the shelf is for choosing. */
function progressOf({ read, total }: ApiReadingListSummary): string {
  return read === 0 ? 'Not started' : read === total ? 'Finished' : `${read} of ${total} read`
}

const publisherOf = (list: ApiReadingListSummary) => list.publisher ?? 'Other'

/** The tabs in the order Releases gives them - Marvel, then DC - and anyone else after. */
const TAB_ORDER = ['Marvel', 'DC Comics']

function publishersOf(lists: ApiReadingListSummary[]): string[] {
  const rank = (name: string) => (TAB_ORDER.includes(name) ? TAB_ORDER.indexOf(name) : TAB_ORDER.length)
  return [...new Set(lists.map(publisherOf))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** The year a story starts, from "2012–2016"; a list without one goes last. */
const startYear = ({ years }: ApiReadingListSummary) => Number(/\d{4}/.exec(years ?? '')?.[0] ?? 9999)

/**
 * A publisher's shelf: the stories you are in the middle of first, then the rest in the order
 * they came out - with the ones you have finished last, as the least likely to be picked next.
 */
function shelve(lists: ApiReadingListSummary[]): ApiReadingListSummary[] {
  const stage = ({ read, total }: ApiReadingListSummary) => (read === 0 ? 1 : read < total ? 0 : 2)
  return [...lists].sort((a, b) => stage(a) - stage(b) || startYear(a) - startYear(b))
}

/**
 * Every reading list, one row each and a tab per publisher: what it is, how big it is, and
 * where you are in it, so a list can be chosen - or picked back up - without opening it. No
 * cover - the first issue's cover says little about a story across thirty series.
 */
export default function ReadingLists() {
  useDocumentTitle('Reading Lists')
  const { data, isLoading, error } = useQuery({ queryKey: ['reading-lists'], queryFn: api.getReadingLists })
  const back = useBackOrigin()
  const lists = data?.lists ?? []
  const names = publishersOf(lists)
  const { current, select } = usePublisher(names)
  const shelf = shelve(lists.filter((list) => publisherOf(list) === current))

  return (
    <>
      <LibraryRail />
      <main className="library-content">
        <h1 className="page-title">Reading Lists</h1>
        {isLoading && <p>Loading…</p>}
        {error && <p>Failed to load reading lists.</p>}
        {data && lists.length === 0 && <p className="arc-empty">No reading lists yet.</p>}
        {/* One publisher needs no choosing between. */}
        {names.length > 1 && (
          <div className="tabs" role="tablist" aria-label="Publisher">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={name === current}
                className={name === current ? 'tab tab--on' : 'tab'}
                onClick={() => select(name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <ul className="list-shelf">
          {shelf.map((list) => (
            <li key={list.id} className="list-shelf__item">
              <h2 className="list-shelf__name">
                <Link className="list-shelf__link" to={`/lists/${encodeURIComponent(list.slug)}`} state={back}>
                  {list.name}
                </Link>
              </h2>
              <p className="list-shelf__meta">{[list.years, sizeOf(list)].filter(Boolean).join(' · ')}</p>
              {list.description && <p className="list-shelf__deck">{list.description}</p>}
              <div className="list-shelf__progress">
                <span>{progressOf(list)}</span>
                {list.next && (
                  <Link className="btn list-shelf__continue" to={`/read/${list.next.bookId}`}>
                    Continue · {list.next.label}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
