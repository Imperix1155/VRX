import { QueryClient } from '@tanstack/react-query'

function isRateLimitedError(error: unknown): boolean {
  return error instanceof Error && error.message === 'rate_limited'
}

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
      // Local IPC rate-limit denials are deterministic inside their window;
      // retrying them only consumes more channel budget. Other failures keep
      // the existing three-retry policy and TanStack's exponential backoff.
      retry: (failureCount, error) => (isRateLimitedError(error) ? false : failureCount < 3)
    }
  }
})
