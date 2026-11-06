import type { UseQueryResult } from '@tanstack/react-query'
import type { AuthStatus } from '@shared/types'

/**
 * Whether a platform's sign-in check failed, also while one that failed with
 * nothing loaded runs again: TanStack Query reports that run as pending, not
 * as an error, until it answers. App keeps the shell, and the account notice
 * keeps its Retry, through that run. Its own module, so tests that mock the
 * auth query hooks still get the real rule.
 */
export function isAuthCheckFailing({
  isError,
  status,
  errorUpdatedAt
}: Pick<UseQueryResult<AuthStatus, Error>, 'isError' | 'status' | 'errorUpdatedAt'>): boolean {
  return isError || (status === 'pending' && errorUpdatedAt > 0)
}
