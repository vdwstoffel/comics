import { useMutation, useQueryClient } from '@tanstack/react-query'
import { refreshLibrary } from './useDownload'

/** The server's refusal for a comic already in the library, told apart by `reason`. */
export function isOwnedRefusal(err: unknown): boolean {
  return (err as { reason?: string } | null)?.reason === 'owned'
}

/**
 * One gap's Get press. Four pages draw a gap - the edition grid, the run sidebar, the arc
 * page and This week - and shared for the reason `useFindRelease` is: so they cannot drift.
 *
 * A refusal because the comic is already here is not a failure. The page was drawn before
 * it arrived - a follow fetched it while the tile still offered Get - so the answer is to
 * redraw, which turns the Get into the comic, rather than "Could not get that one".
 */
export function useGetIssue(start: () => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      try {
        await start()
        return 'queued' as const
      } catch (err) {
        if (isOwnedRefusal(err)) return 'owned' as const
        throw err
      }
    },
    onSuccess: (result) => {
      if (result === 'owned') refreshLibrary(qc)
      else qc.invalidateQueries({ queryKey: ['download'] })
    },
  })
}
