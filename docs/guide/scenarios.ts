import type { PlatformMode } from './fixtures'

interface SourceScenario {
  value: string
  label: string
  modes: readonly [PlatformMode, PlatformMode]
}

/** One registry drives both selectable controls and the scenes they render. */
export const sourceScenarios: readonly SourceScenario[] = [
  { value: 'ready', label: 'Ready', modes: ['ready', 'ready'] },
  { value: 'loading', label: 'VRC first load', modes: ['loading', 'ready'] },
  { value: 'loading-cvr', label: 'CVR first load', modes: ['ready', 'loading'] },
  { value: 'refreshing', label: 'Refreshing with cards', modes: ['refreshing', 'refreshing'] },
  { value: 'stale', label: 'Stale cards', modes: ['stale', 'ready'] },
  { value: 'error', label: 'Source error', modes: ['error', 'ready'] },
  { value: 'empty', label: 'Empty', modes: ['empty', 'empty'] },
  { value: 'unavailable', label: 'Unavailable', modes: ['ready', 'unavailable'] }
]

export const exploreScenarios = [
  ...sourceScenarios,
  { value: 'sheet-loading', label: 'Rooms loading' },
  { value: 'sheet-error', label: 'Rooms error' },
  { value: 'sheet-stale', label: 'Rooms stale' }
]

export const drawerScenarios = [
  { value: 'vrchat', label: 'VRChat' },
  { value: 'chilloutvr', label: 'ChilloutVR' },
  { value: 'note-load-error', label: 'Note load failure' },
  { value: 'note-save-error', label: 'Note save failure' }
]

export function sourceModesFor(variant: string): readonly [PlatformMode, PlatformMode] {
  return sourceScenarios.find((scenario) => scenario.value === variant)?.modes ?? ['ready', 'ready']
}

export const desktopScenes: readonly string[] = [
  'dashboard',
  'friends',
  'linked',
  'settings',
  'updater',
  'drawer',
  'join'
]
