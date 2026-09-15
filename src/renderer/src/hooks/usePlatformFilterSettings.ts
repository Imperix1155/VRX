import { useEffect } from 'react'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'

/**
 * Keeps the global filter in the existing view store while persisting its value
 * through Settings.  The bridge lives here so neither store imports the other.
 */
export function usePlatformFilterSettings(): void {
  const hydrated = useSettingsStore((state) => state.hydrated)
  const saved = useSettingsStore((state) => state.settings.platformFilter)

  useEffect(() => {
    if (!hydrated) return
    if (useFriendsStore.getState().platformFilter !== saved) {
      useFriendsStore.getState().setPlatformFilter(saved)
    }
  }, [hydrated, saved])

  useEffect(() => {
    if (!hydrated) return
    return useFriendsStore.subscribe((state, previous) => {
      if (state.platformFilter === previous.platformFilter) return
      if (useSettingsStore.getState().settings.platformFilter !== state.platformFilter) {
        useSettingsStore.getState().updateSettings({ platformFilter: state.platformFilter })
      }
    })
  }, [hydrated])
}
