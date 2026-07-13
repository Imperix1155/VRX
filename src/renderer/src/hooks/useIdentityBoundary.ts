import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { friendsQueryKey } from '../queries/friends'

/** Removes account-owned friends data whenever main crosses an identity boundary. */
export function useIdentityBoundary(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx?.onIdentityBoundary) return

    return window.vrx.onIdentityBoundary(({ platform }) => {
      const queryKey = friendsQueryKey(platform)
      void queryClient.cancelQueries({ queryKey })
      queryClient.removeQueries({ queryKey })
    })
  }, [queryClient])
}
