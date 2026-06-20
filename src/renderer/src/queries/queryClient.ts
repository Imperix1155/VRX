import { QueryClient } from '@tanstack/react-query'

/**
 * Shared TanStack Query client (VRX-22).
 *
 * Defaults follow VRX's API etiquette (CLAUDE.md): the WebSocket is the live
 * path, so REST is initial-load + slow reconcile, never a fast poll. We do NOT
 * refetch on window focus — that would hammer the unofficial API and risk a
 * rate-limit/flag. A failed background refetch keeps the last good data and
 * surfaces `error` separately (stale-while-revalidate; never blank-on-error).
 * Per-query cadence (staleTime/refetchInterval) lives with each query.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 3 // TanStack applies exponential backoff between retries
    }
  }
})
