import { useParams, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * Where a comic's run lives: its volume shelf when it has one, its edition otherwise.
 *
 * Shared with the reader, which closes onto the same place - a comic that opens from one
 * shelf and closes onto another is the kind of thing that reads as a bug.
 */
export function runHref(shelfVolumeId: number | null, editionId: number, bookId: string | number): string {
  const base = shelfVolumeId == null ? `/edition/${editionId}` : `/volume/${shelfVolumeId}`
  return `${base}?issue=book-${bookId}`
}

/**
 * What is left of the comic's own page.
 *
 * Everything that page said is now said under the cover in the run, and everything it did
 * is done there too - so the page is gone and this stands where it stood. It is not kept
 * for the sake of old bookmarks alone: Downloads, Upload, the releases tab, the arc pages
 * and the annuals all name a comic by its id and nothing else, and two of them could not
 * say which edition holds it without being given more to say it with. One lookup here
 * answers that for all of them.
 *
 * Replaced rather than pushed, so pressing back from the run leaves for wherever you came
 * from instead of landing on this and being sent forward again.
 */
export default function BookRedirect() {
  // On the way through to the run, which names itself the moment it arrives.
  useDocumentTitle()
  const { id } = useParams()
  const { data, isError } = useQuery({
    queryKey: ['book', id],
    queryFn: () => api.getBook(id!),
    retry: false,
  })

  // A comic that is not there any more - removed in another tab, or a link that outlived
  // it. The library is the one page that is always somewhere to be.
  if (isError) return <Navigate to="/" replace />
  if (!data) return <p>Loading…</p>
  // The shelf the comic lives on, which for a collected run is the volume rather than
  // whichever paperback line it shipped in - landing on "By Zeb Wells (2023)" would put
  // you back on one of the three shelves that gathering exists to stop showing.
  return <Navigate to={runHref(data.shelfVolumeId ?? null, data.book.editionId, id!)} replace />
}
