import { useQueryClient } from '@tanstack/react-query'
import type { ApiSettings } from '../../api'

/**
 * The success half of every settings mutation, in one place because all three sections
 * want it and a section that forgot it would sit on a stale control.
 *
 * The echoed response becomes the new truth immediately, and the refetch only confirms
 * it. Invalidating alone left a control showing its old value for the length of a second
 * round trip.
 */
export function useAppliedSettings() {
  const qc = useQueryClient()
  return {
    onSuccess: (next: ApiSettings) => {
      qc.setQueryData(['settings'], next)
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  }
}
