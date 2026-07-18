import { useEffect, useRef, useState } from 'react'
import type { Friend } from '@shared/types'

/**
 * MODULE-scoped in-flight latch (VRX-69 review): every Join surface — each
 * row pill AND the drawer button — consults the same latch, so one active
 * join blocks ALL surfaces, not just the hook instance that fired it. The
 * blip display (`joinFailed`) stays per-caller.
 */
const anyJoinInFlight = { current: false }

/**
 * The ONE join-a-friend flow (VRX-166 row pill · VRX-69 drawer button):
 * `window.vrx.joinInstance` with the cross-surface in-flight guard above and
 * the 2.5s failure blip (`joinFailed`) for typed denials — bridge exceptions
 * (guard throws, missing bridge in exotic states) are user-equivalent to a
 * denial: blip, never an unhandled rejection. A NEW attempt clears any
 * previous blip immediately, and a success clears it too (review fix of a
 * lifecycle gap inherited from the original row code). The blip timer is
 * cleaned up on unmount. Callers own event concerns (the row
 * stopPropagation's its click).
 */
export function useJoinInstance(): {
  isJoining: boolean
  joinFailed: boolean
  join: (friend: Friend) => Promise<void>
} {
  const [isJoining, setIsJoining] = useState(false)
  const [joinFailed, setJoinFailed] = useState(false)
  const failureTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (failureTimer.current != null) window.clearTimeout(failureTimer.current)
    },
    []
  )

  function clearFailureBlip(): void {
    if (failureTimer.current != null) {
      window.clearTimeout(failureTimer.current)
      failureTimer.current = null
    }
    setJoinFailed(false)
  }

  async function join(friend: Friend): Promise<void> {
    if (anyJoinInFlight.current) return
    anyJoinInFlight.current = true
    setIsJoining(true)
    clearFailureBlip()
    const showFailureBlip = (): void => {
      setJoinFailed(true)
      if (failureTimer.current != null) window.clearTimeout(failureTimer.current)
      failureTimer.current = window.setTimeout(() => {
        setJoinFailed(false)
        failureTimer.current = null
      }, 2_500)
    }
    try {
      // VRChat ignores mode; a CVR VR-mode picker is a future setting.
      const result = await window.vrx.joinInstance({
        platform: friend.platform,
        friendId: friend.platformUserId,
        mode: 'desktop'
      })
      if (result.ok) clearFailureBlip()
      else showFailureBlip()
    } catch {
      showFailureBlip()
    } finally {
      anyJoinInFlight.current = false
      setIsJoining(false)
    }
  }

  return { isJoining, joinFailed, join }
}
