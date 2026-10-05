import { useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

interface FollowButtonProps {
  /** How to start following, which is how each kind is addressed by the api. */
  target: { kind: 'volume'; editionId: number } | { kind: 'arc'; name: string }
  /**
   * The id the follow is stored under - the edition id for a volume, Comic Vine's arc id
   * for an arc - or null when the page does not know it yet. Null means the button can
   * offer to follow but cannot claim the thing is already followed.
   */
  refId: number | null
  /** Why following is impossible here, when it is. Disables the button and explains it. */
  unavailable?: string
}

/**
 * Follow or unfollow, from the page you already open to read the thing.
 *
 * It reads the follow list rather than taking its state as a prop: the Following shelf
 * and this button are then one source of truth, and unfollowing in one place updates the
 * other without either knowing about it.
 */
export default function FollowButton({ target, refId, unavailable }: FollowButtonProps) {
  const queryClient = useQueryClient()
  const describedBy = useId()
  const { data, isSuccess } = useQuery({ queryKey: ['follows'], queryFn: api.getFollows })

  const followed = refId != null
    && (data?.follows ?? []).some((f) => f.kind === target.kind && f.refId === refId)

  // Returned, and run on failure too: the mutation is not finished until the list it
  // changed has been re-read, or the button re-enables showing the state it just replaced.
  // A failed unfollow (the row was already gone) still needs the list refreshed.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['follows'] })

  const start = useMutation({
    mutationFn: () => (target.kind === 'volume'
      ? api.followVolume(target.editionId)
      : api.followArc(target.name)),
    onSettled: refresh,
  })
  const stop = useMutation({
    mutationFn: () => api.unfollow(target.kind, refId!),
    onSettled: refresh,
  })

  const busy = start.isPending || stop.isPending

  return (
    <>
      <button
        type="button"
        className={`follow-button${followed ? ' follow-button--on' : ''}`}
        disabled={!!unavailable || busy || !isSuccess}
        aria-describedby={unavailable ? describedBy : undefined}
        onClick={() => (followed ? stop.mutate() : start.mutate())}
      >
        {/* Until the list has loaded the state is unknown, so claim neither. */}
        {!isSuccess && !unavailable ? '…' : followed ? 'Following' : 'Follow'}
      </button>
      {unavailable && <span id={describedBy} className="follow-button__why">{unavailable}</span>}
    </>
  )
}
