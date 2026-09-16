import type { UpdaterSnapshot } from '@shared/ipc'
import type { AuthStatus, Platform } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import {
  friends,
  worlds,
  worldImages,
  getPlatformSnapshot,
  getWorldSnapshot,
  linkedSnapshot
} from './fixtures'

export type FixtureBridge = NonNullable<Window['vrx']>
const noop = (): void => undefined
const unsubscribe = (): (() => void) => noop

export function fixtureAuth(platform: Platform): AuthStatus {
  return {
    platform,
    state: 'authenticated',
    accountId: linkedSnapshot.accountIds[platform] ?? `fixture-owner-${platform}`,
    displayName: 'Guide visitor'
  }
}

/** All callbacks close over synthetic memory. No transport or real bridge is accepted. */
export function createFixtureBridge(variant: string): FixtureBridge {
  const notes = new Map<string, string>()
  const updater: UpdaterSnapshot = {
    state:
      variant === 'downloading'
        ? 'downloading'
        : variant === 'downloaded'
          ? 'downloaded'
          : variant === 'idle'
            ? 'idle'
            : 'update-available',
    currentVersion: __APP_VERSION__,
    availableVersion: '0.99.0-example',
    progressPercent: variant === 'downloading' ? 46 : 0,
    failure: null
  }
  const links = structuredClone(linkedSnapshot)
  const denied = { ok: false, reason: 'launch-failed' } as const
  return {
    setExploreActive: () => Promise.resolve(),
    getExplore: ({ platform }) => Promise.resolve(getPlatformSnapshot(platform)),
    getExploreWorld: ({ platform, worldRef }) => {
      const world = worlds[platform].find((entry) => entry.worldRef === worldRef)
      return Promise.resolve(world ? getWorldSnapshot(world) : null)
    },
    cancelExploreWorld: () => Promise.resolve(),
    getExploreImage: ({ worldRef }) => {
      const dataUrl = worldImages[worldRef]
      return Promise.resolve(dataUrl ? { ok: true, dataUrl } : null)
    },
    joinExploreRoom: () => Promise.resolve(denied),
    onExploreChanged: unsubscribe,
    getLinkedProfiles: () => Promise.resolve({ ok: true, value: structuredClone(links) }),
    changeLinkedProfile: ({ change }) => {
      if (change.kind !== 'update') return Promise.resolve({ ok: false, reason: 'unavailable' })
      const person = links.profiles.find((item) => item.id === change.personId)
      if (!person || person.revision !== change.expectedRevision)
        return Promise.resolve({ ok: false, reason: 'stale' })
      Object.assign(person, change.patch)
      person.revision += 1
      links.storeRevision += 1
      return Promise.resolve({ ok: true, value: structuredClone(links) })
    },
    onLinkedProfilesChanged: unsubscribe,
    getFriends: ({ platform }) => Promise.resolve(friends[platform]),
    getAvatar: (url) => {
      const dataUrl = worldImages[url] ?? (url.startsWith('data:image/') ? url : undefined)
      return Promise.resolve(dataUrl ? { ok: true, dataUrl } : null)
    },
    getAccounts: () =>
      Promise.resolve(
        (['vrchat', 'chilloutvr'] as const).map((platform) => ({
          platform,
          platformAccountId: fixtureAuth(platform).accountId ?? '',
          displayName: 'Guide visitor',
          isActive: true
        }))
      ),
    getAuthStatus: ({ platform }) => Promise.resolve(fixtureAuth(platform)),
    login: () =>
      Promise.resolve({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      }),
    verify2fa: () =>
      Promise.resolve({
        ok: false,
        needs2fa: false,
        error: 'credential_persistence_failed',
        sessionCleared: true
      }),
    logout: () => Promise.resolve(),
    joinInstance: () => Promise.resolve(denied),
    selfInvite: () => Promise.resolve(denied),
    getAppStatus: () =>
      Promise.resolve({
        ws: { vrchat: 'live', chilloutvr: 'live' },
        lastReconcileAt: { vrchat: null, chilloutvr: null }
      }),
    openUrl: () => Promise.resolve(),
    getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
    saveSettings: ({ patch }) => Promise.resolve({ ...DEFAULT_SETTINGS, ...patch }),
    getUpdaterState: () => Promise.resolve(updater),
    checkForUpdates: () => Promise.resolve(),
    downloadUpdate: () => Promise.resolve(),
    installUpdate: () => Promise.resolve(),
    getFriendNote: ({ platform, friendId }) =>
      Promise.resolve({
        note:
          notes.get(`${platform}:${friendId}`) ??
          'Met at the observatory. Likes quiet worlds and long conversations.',
        revision: { platformAccountId: fixtureAuth(platform).accountId ?? '', epoch: 1 }
      }),
    setFriendNote: ({ platform, friendId, note }) => {
      notes.set(`${platform}:${friendId}`, note)
      return Promise.resolve({ ok: true })
    },
    notifyRendererHydrated: noop,
    onFriendEvent: unsubscribe,
    onIdentityBoundary: unsubscribe,
    onNavigateToDashboard: unsubscribe,
    onUpdaterStateChanged: unsubscribe
  }
}

export function installFixtureBridge(target: Window, variant: string): void {
  if (target.vrx !== undefined) throw new Error('Design fixtures refuse an existing app bridge')
  Object.defineProperty(target, 'vrx', {
    value: Object.freeze(createFixtureBridge(variant)),
    writable: false,
    configurable: false
  })
}
