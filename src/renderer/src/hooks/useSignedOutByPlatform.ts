import { useEffect } from 'react'
import type { Platform } from '@shared/types'
import { useAuthStatus } from '../queries/auth'
import { useUiStore } from '../stores/ui'

/**
 * The platform ended the session VRX held (main's `endedByPlatform`), at
 * launch or while running, and the user has not hidden the notice about it.
 * A sign-out the user chose never counts. Signing in again, or signing out,
 * clears it in main; the hidden mark then resets, so a later surprise
 * sign-out shows again.
 */
export function useSignedOutByPlatform(platform: Platform): boolean {
  const auth = useAuthStatus(platform).data
  const hidden = useUiStore((s) => s.signOutNoticeHidden[platform])
  const setHidden = useUiStore((s) => s.setSignOutNoticeHidden)
  const ended = auth?.state === 'unauthenticated' && auth.endedByPlatform === true
  useEffect(() => {
    if (!ended && hidden) setHidden(platform, false)
  }, [ended, hidden, platform, setHidden])
  return ended && !hidden
}
