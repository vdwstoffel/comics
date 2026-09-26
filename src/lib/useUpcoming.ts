import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

/**
 * What Marvel has announced for the coming weeks.
 *
 * One hook for both readers - the Upcoming tab and a volume's Coming soon list - so they
 * share a single query key and a single fetch. Reading the calendar twice under two keys
 * would ask the server for the same ten weeks again the moment you opened a volume.
 *
 * `retry: false` because the failure worth reporting is Marvel being unreadable, and
 * trying three more times only delays saying so. The five-minute `staleTime` matches the
 * server's own twelve-hour cache closely enough that a window refocus is not a round trip
 * to be told the same thing; it is set here rather than on the QueryClient, which would
 * quietly change how every other query in the app refetches.
 */
export function useUpcoming() {
  return useQuery({
    queryKey: ['releases-upcoming'],
    queryFn: api.getUpcoming,
    retry: false,
    staleTime: 5 * 60_000,
  })
}
