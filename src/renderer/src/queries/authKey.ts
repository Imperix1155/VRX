import type { Platform } from '@shared/types'

/** The auth status query key, shared by useAuthStatus and cache observers. */
export function authStatusQueryKey(platform: Platform): readonly ['auth-status', Platform] {
  return ['auth-status', platform] as const
}
