import { QueryClient } from '@tanstack/react-query'
import { FriendEventReplayOverflowError } from './friendEventReplay'

function isRateLimitedError(error: unknown): boolean {
  return error instanceof Error && error.message === 'rate_limited'
}

/**
 * Local refusals are deterministic inside their window (an IPC rate limit, a
 * platform cooldown or pause, an overflowing live journal), so they are never
 * retried; any other failure is retried up to `maxRetries` times.
 */
export function retryUpTo(maxRetries: number) {
  return (failureCount: number, error: unknown): boolean =>
    isRateLimitedError(error) || error instanceof FriendEventReplayOverflowError
      ? false
      : failureCount < maxRetries
}

/**
 * Shared TanStack Query client (VRX-22).
 *
 * Defaults follow VRX's API etiquette (AGENTS.md): the WebSocket is the live
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
      // retrying them only consumes more channel budget. An overflowing live
      // journal also needs an explicit retry, not another roster in the burst.
      // Other failures keep
      // the existing three-retry policy and TanStack's exponential backoff.
      retry: retryUpTo(3)
    }
  }
})

/** Retries after a failed friends read (see below). */
export const FRIENDS_READ_RETRIES = 1

// The friends list is the heaviest read VRX makes (every VRChat page), so a
// failed one is tried once more, not three times. Three failures in a row would
// also pause the whole platform for a minute after a single Refresh press.
// The key prefix matches `friendsQueryKey` for both platforms.
queryClient.setQueryDefaults(['friends'], { retry: retryUpTo(FRIENDS_READ_RETRIES) })
