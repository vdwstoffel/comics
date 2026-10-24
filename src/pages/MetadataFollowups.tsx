import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { FollowupList } from '../components/FollowupList'
import { useBackLink } from '../lib/backOrigin'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * The comics still missing metadata, on a page of their own. It lived inside Settings
 * until a real library produced sixteen rows and pushed every other setting out of sight.
 */
export default function MetadataFollowups() {
  useDocumentTitle('Metadata follow-ups')
  // Settings is the only link in, but a fixed href would ignore history; the hook steps
  // back so Settings is restored where you left it, and falls back to /settings when the
  // page is opened cold.
  const back = useBackLink('/settings', 'Settings')
  // Only to choose between the list and the empty state; the list reads the same key.
  const { data: followupData } = useQuery({
    queryKey: ['metadata-followups'], queryFn: api.metadataFollowups,
  })
  const empty = (followupData?.followups ?? []).length === 0

  return (
    <>
      <Link to={back.to} onClick={back.onClick} className="back-link">← {back.label}</Link>
      <h1 className="page-title">Metadata follow-ups</h1>
      {/* Reachable by url with nothing listed, so the empty state has to say something
          rather than leave a heading over blank space. */}
      {empty && <p>{followupData === undefined ? 'Loading…' : 'Nothing to follow up.'}</p>}
      <FollowupList />
    </>
  )
}
