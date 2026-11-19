/**
 * The "Kept" choice main has applied.
 *
 * Picking a choice changes the setting on this side at once; main applies it
 * (and deletes the saved history that no longer fits) when the save reaches
 * it. A list that holds saved rows uses this value in its reset key, so it
 * drops what it holds and reads again once main has done so, never before:
 * a read made earlier could bring back rows about to be deleted.
 *
 * Main applies a save before it answers, also when the write to disk fails,
 * so the choice counts as applied once its save has answered either way.
 */
import { useState } from 'react'
import type { Settings } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'

export function useAppliedKeepFor(): Settings['activityKeepFor'] {
  const keepFor = useSettingsStore((state) => state.settings.activityKeepFor)
  const answered = useSettingsStore((state) => !state.dirty || state.saveError)
  const [applied, setApplied] = useState(keepFor)
  if (answered && applied !== keepFor) setApplied(keepFor)
  return answered ? keepFor : applied
}
