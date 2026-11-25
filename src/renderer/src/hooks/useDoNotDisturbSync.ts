import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settings'

/**
 * When a game starts, main turns Do not disturb off and tells the window.
 * Apply that here so the sidebar and Settings match the mute that is in force.
 */
export function useDoNotDisturbSync(): void {
  useEffect(() => {
    const subscribe = typeof window === 'undefined' ? undefined : window.vrx?.onDoNotDisturbChanged
    if (!subscribe) return
    return subscribe((event) => {
      useSettingsStore.setState((state) => {
        if (
          state.settings.doNotDisturb === event.doNotDisturb &&
          state.settings.doNotDisturbUntil === event.doNotDisturbUntil
        ) {
          return state
        }
        return {
          settings: { ...state.settings, ...event },
          dirty: true
        }
      })
    })
  }, [])
}
