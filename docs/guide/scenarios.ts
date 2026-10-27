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
  { value: 'note-save-error', label: 'Note save failure' },
  { value: 'picked-alerts', label: 'Picked-friend alerts' }
]

/** Settings and drawer variant that limits alerts to picked friends. */
export function alertScopeFor(variant: string): 'everyone' | 'picked' {
  return variant === 'picked-alerts' ? 'picked' : 'everyone'
}

/** Friends roster states (issue 368): one platform fails while the other stays usable. */
export const friendsScenarios = [
  { value: 'ready', label: 'All loaded' },
  { value: 'cvr-missing', label: 'ChilloutVR failed' },
  { value: 'vrc-stale', label: 'VRChat stale' }
]

export function friendsFailureFor(
  variant: string
): { platform: 'vrchat' | 'chilloutvr'; kind: 'missing' | 'stale' } | null {
  if (variant === 'cvr-missing') return { platform: 'chilloutvr', kind: 'missing' }
  if (variant === 'vrc-stale') return { platform: 'vrchat', kind: 'stale' }
  return null
}

export function sourceModesFor(variant: string): readonly [PlatformMode, PlatformMode] {
  return sourceScenarios.find((scenario) => scenario.value === variant)?.modes ?? ['ready', 'ready']
}

export const desktopScenes: readonly string[] = [
  'dashboard',
  'hot',
  'friends',
  'inbox',
  'linked',
  'avatars',
  'settings',
  'updater',
  'drawer',
  'join'
]
