import { useEffect, useState } from 'react'
import type { JoinHandoff, Platform } from '@shared/types'
import { useSettingsStore } from '../stores/settings'

/**
 * What a Join on `platform` would do now (main's `get-join-handoff`): start the
 * game, or reach the copy that is already open. Asked again for each `openId`
 * (one per dialog open) and when the open-game settings change. Null while
 * asking, without a bridge, or when the answer failed: callers then show the
 * launch copy, and main decides again when the Join happens.
 */
export function useJoinHandoff(
  platform: Platform | null,
  openId: number | null
): JoinHandoff | null {
  const joinOpenGame = useSettingsStore((s) => s.settings.joinOpenGame)
  const vrchatOpenGameJoin = useSettingsStore((s) => s.settings.vrchatOpenGameJoin)
  const [answer, setAnswer] = useState<{ key: string; handoff: JoinHandoff } | null>(null)
  const key = `${platform}:${openId}:${joinOpenGame}:${vrchatOpenGameJoin}`

  useEffect(() => {
    if (platform === null || !joinOpenGame) return
    const getJoinHandoff = typeof window === 'undefined' ? undefined : window.vrx?.getJoinHandoff
    if (!getJoinHandoff) return
    let live = true
    getJoinHandoff({ platform }).then(
      (handoff) => {
        if (live) setAnswer({ key, handoff })
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [key, platform, joinOpenGame])

  if (platform === null || !joinOpenGame) return null
  return answer?.key === key ? answer.handoff : null
}
