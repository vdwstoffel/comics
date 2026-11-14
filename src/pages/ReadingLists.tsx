import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { ApiReadingListSummary } from '../api'
import LibraryRail from '../components/LibraryRail'
import { useBackOrigin } from '../lib/backOrigin'
import { useDocumentTitle } from '../lib/useDocumentTitle'

const issues = (n: number) => `${n} issue${n === 1 ? '' : 's'}`

/** How big a commitment it is: Core, and Full beside it when there are tie-ins to add. */
function sizeOf({ size }: ApiReadingListSummary): string {
  return size.full > size.core ? `${issues(size.core)} · ${size.full} with tie-ins` : issues(size.core)
}

/** Where you are, and what is missing - which is only worth saying when something is. */
function progressOf({ read, total, owned }: ApiReadingListSummary): string {
  const where = read === 0 ? 'Not started' : read === total ? 'Finished' : `${read} of ${total} read`
  return [where, owned < total && `${total - owned} missing`].filter(Boolean).join(' · ')
}

/** The story you are in the middle of first, then the ones to start, then the ones done. */
const rank = ({ read, total }: ApiReadingListSummary) => (read === 0 ? 1 : read < total ? 0 : 2)

/**
 * Every reading list, one row each: what it is, how big it is, and where you are in it, so a
 * list can be chosen - or picked back up - without opening it. No cover - the first issue's
 * cover says little about a story across thirty series.
 */
export default function ReadingLists() {
  useDocumentTitle('Reading Lists')
  const { data, isLoading, error } = useQuery({ queryKey: ['reading-lists'], queryFn: api.getReadingLists })
  const back = useBackOrigin()
  const lists = [...(data?.lists ?? [])].sort((a, b) => rank(a) - rank(b))

  return (
    <>
      <LibraryRail />
      <main className="library-content">
        <h1 className="page-title">Reading Lists</h1>
        {isLoading && <p>Loading…</p>}
        {error && <p>Failed to load reading lists.</p>}
        {data && lists.length === 0 && <p className="arc-empty">No reading lists yet.</p>}
        <ul className="list-shelf">
          {lists.map((list) => (
            <li key={list.id} className="list-shelf__item">
              <h2 className="list-shelf__name">
                <Link className="list-shelf__link" to={`/lists/${encodeURIComponent(list.slug)}`} state={back}>
                  {list.name}
                </Link>
              </h2>
              <p className="list-shelf__meta">{[list.publisher, list.years, sizeOf(list)].filter(Boolean).join(' · ')}</p>
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
