import { useParams, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

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
  return <Navigate to={`/edition/${data.book.editionId}?issue=book-${id}`} replace />
}
