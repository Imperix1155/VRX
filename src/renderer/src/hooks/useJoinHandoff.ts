import { useEffect, useState } from 'react'
import type { JoinHandoff, Platform } from '@shared/types'
import { useSettingsStore } from '../stores/settings'

/**
 * What a Join on `platform` would do now (main's `get-join-handoff`): start the
 * game, or reach the copy that is already open. Asked again for each `openId`
 * (one per dialog open) and when the open-game settings change. `'pending'`
 * while main checks (its process check is bounded), so a dialog can hold the
 * launch line's place without showing a picker that may turn into the
 * open-game note. Null without a bridge, with the setting off, or when the
 * answer failed: callers then show the launch copy, and main decides again
 * when the Join happens.
 */
export function useJoinHandoff(
  platform: Platform | null,
  openId: number | null
): JoinHandoff | 'pending' | null {
  const joinOpenGame = useSettingsStore((s) => s.settings.joinOpenGame)
  const vrchatOpenGameJoin = useSettingsStore((s) => s.settings.vrchatOpenGameJoin)
  const [answer, setAnswer] = useState<{ key: string; handoff: JoinHandoff | null } | null>(null)
  const key = `${platform}:${openId}:${joinOpenGame}:${vrchatOpenGameJoin}`
  const asks =
    platform !== null &&
    joinOpenGame &&
    typeof window !== 'undefined' &&
    window.vrx?.getJoinHandoff !== undefined

  useEffect(() => {
    if (platform === null || !joinOpenGame) return
    const getJoinHandoff = typeof window === 'undefined' ? undefined : window.vrx?.getJoinHandoff
    if (!getJoinHandoff) return
    let live = true
    getJoinHandoff({ platform }).then(
      (handoff) => {
        if (live) setAnswer({ key, handoff })
      },
      () => {
        if (live) setAnswer({ key, handoff: null })
      }
    )
    return () => {
      live = false
    }
  }, [key, platform, joinOpenGame])

  if (!asks) return null
  return answer?.key === key ? answer.handoff : 'pending'
}
