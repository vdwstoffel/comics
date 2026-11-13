import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import CoverTile from '../components/CoverTile'
import LibraryRail from '../components/LibraryRail'
import { useBackOrigin } from '../lib/backOrigin'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * Every reading list, one tile each. The count is Core's whatever length a list is read
 * in: the shelf is where you pick a story, and the story is the core of it.
 */
export default function ReadingLists() {
  useDocumentTitle('Reading Lists')
  const { data, isLoading, error } = useQuery({ queryKey: ['reading-lists'], queryFn: api.getReadingLists })
  const back = useBackOrigin()
  const lists = data?.lists ?? []

  return (
    <>
      <LibraryRail />
      <main className="library-content">
        <h1 className="page-title">Reading Lists</h1>
        {isLoading && <p>Loading…</p>}
        {error && <p>Failed to load reading lists.</p>}
        {data && lists.length === 0 && <p className="arc-empty">No reading lists yet.</p>}
        <div className="tile-grid">
          {lists.map((list) => (
            <CoverTile
              key={list.id}
              to={`/lists/${encodeURIComponent(list.slug)}`}
              state={back}
              img={list.cover ?? undefined}
              title={list.name}
              subtitle={`${list.owned} of ${list.total}`}
            />
          ))}
        </div>
      </main>
    </>
  )
}
