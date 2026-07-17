import { useEffect, useRef, useState } from 'react'
import type { Friend } from '@shared/types'

/**
 * The ONE join-a-friend flow (VRX-166 row pill · VRX-69 drawer button):
 * `window.vrx.joinInstance` with an in-flight guard against double-fires and
 * the 2.5s failure blip (`joinFailed`) for typed denials — bridge exceptions
 * (guard throws, missing bridge in exotic states) are user-equivalent to a
 * denial: blip, never an unhandled rejection. The blip timer is cleaned up on
 * unmount. Callers own event concerns (the row stopPropagation's its click).
 */
export function useJoinInstance(): {
  isJoining: boolean
  joinFailed: boolean
  join: (friend: Friend) => Promise<void>
} {
  const [isJoining, setIsJoining] = useState(false)
  const [joinFailed, setJoinFailed] = useState(false)
  const inFlight = useRef(false)
  const failureTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (failureTimer.current != null) window.clearTimeout(failureTimer.current)
    },
    []
  )

  async function join(friend: Friend): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setIsJoining(true)
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
      if (!result.ok) showFailureBlip()
    } catch {
      showFailureBlip()
    } finally {
      inFlight.current = false
      setIsJoining(false)
    }
  }

  return { isJoining, joinFailed, join }
}
