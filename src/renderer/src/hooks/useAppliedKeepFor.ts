/**
 * The "Kept" choice main has applied.
 *
 * Picking a choice changes the setting on this side at once. Main applies it,
 * and deletes the saved history that no longer fits, when that save reaches
 * it. Main does this before it answers, also when the write fails. This reads
 * the snapshot main has answered (`acknowledgedSettings`), never `saveError`:
 * that flag stays set across later edits, so it is not this snapshot's answer.
 *
 * A list that holds saved rows uses this value in its reset, so it drops what
 * it holds and reads again once main has done so, never before: a read made
 * earlier could bring back rows about to be deleted.
 */
import type { Settings } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'

export function useAppliedKeepFor(): Settings['activityKeepFor'] {
  return useSettingsStore((state) => state.acknowledgedSettings.activityKeepFor)
}
