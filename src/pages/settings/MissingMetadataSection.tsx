import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { FollowupList } from '../../components/FollowupList'

/**
 * The comics still missing metadata, as one of the Settings panes.
 *
 * It was a page of its own for a while, because sixteen rows stacked under the other
 * settings pushed them off the screen. The sidebar solves that on its own - nothing sits
 * below these rows now - so the list is back among the settings, and unpaged: there is
 * no longer anything underneath for a long list to bury.
 */
export default function MissingMetadataSection() {
  // Only to choose between the list and the empty state; the list reads the same key.
  const { data: followupData } = useQuery({
    queryKey: ['metadata-followups'], queryFn: api.metadataFollowups,
  })
  const empty = (followupData?.followups ?? []).length === 0

  return (
    <section>
      <h2 className="page-title">Missing metadata</h2>
      {/* Reachable by url with nothing listed - Bulk upload links straight here - so the
          empty state has to say something rather than leave a heading over blank space. */}
      {empty && <p>{followupData === undefined ? 'Loading…' : 'Nothing to follow up.'}</p>}
      <FollowupList />
    </section>
  )
}
