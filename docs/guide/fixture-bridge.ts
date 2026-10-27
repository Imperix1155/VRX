import type { UpdaterSnapshot } from '@shared/ipc'
import type { AuthStatus, Platform } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import {
  activityEntries,
  backgroundPicture,
  friends,
  worlds,
  worldImages,
  getPlatformSnapshot,
  getWorldSnapshot,
  linkedSnapshot
} from './fixtures'
import { friendsFailureFor, joinHandoffFor } from './scenarios'

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
  const failedNoteLoads = new Set<string>()
  const failedNoteSaves = new Set<string>()
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
  // Two sample friends per platform start picked for alerts.
  const alertPicks: Record<Platform, Set<string>> = {
    vrchat: new Set(friends.vrchat.slice(0, 2).map((friend) => friend.platformUserId)),
    chilloutvr: new Set(friends.chilloutvr.slice(0, 2).map((friend) => friend.platformUserId))
  }
  const denied = { ok: false, reason: 'launch-failed' } as const
  // Choosing always "picks" the synthetic sample; no dialog or file is involved.
  let picture: string | null = null
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
    getFriends: ({ platform }) =>
      friendsFailureFor(variant)?.platform === platform
        ? Promise.reject(new Error('Synthetic roster refresh failed'))
        : Promise.resolve(friends[platform]),
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
    // The guide never reads this PC: the button shows its not-found copy.
    importSession: () =>
      Promise.resolve({ ok: false, needs2fa: false, error: 'session_import_not_found' }),
    logout: () => Promise.resolve(),
    joinInstance: () => Promise.resolve(denied),
    selfInvite: () => Promise.resolve(denied),
    getJoinHandoff: ({ platform }) => Promise.resolve(joinHandoffFor(variant, platform)),
    getAppStatus: () =>
      Promise.resolve({
        ws: { vrchat: 'live', chilloutvr: 'live' },
        lastReconcileAt: { vrchat: null, chilloutvr: null }
      }),
    getActivity: () => Promise.resolve(variant === 'empty' ? [] : activityEntries(Date.now())),
    clearActivity: () => Promise.resolve(),
    onActivityChanged: unsubscribe,
    openUrl: () => Promise.resolve(),
    openLogsFolder: () => Promise.resolve(),
    getAppBackground: () => Promise.resolve(picture === null ? null : { dataUrl: picture }),
    chooseAppBackground: () => {
      picture = backgroundPicture
      return Promise.resolve({ ok: true, dataUrl: picture })
    },
    clearAppBackground: () => {
      picture = null
      return Promise.resolve()
    },
    getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
    saveSettings: ({ patch }) => Promise.resolve({ ...DEFAULT_SETTINGS, ...patch }),
    getUpdaterState: () => Promise.resolve(updater),
    checkForUpdates: () => Promise.resolve(),
    downloadUpdate: () => Promise.resolve(),
    installUpdate: () => Promise.resolve(),
    getFriendNote: ({ platform, friendId }) => {
      const key = `${platform}:${friendId}`
      if (variant === 'note-load-error' && !failedNoteLoads.has(key)) {
        failedNoteLoads.add(key)
        return Promise.reject(new Error('Synthetic note load failed'))
      }
      return Promise.resolve({
        note:
          notes.get(key) ?? 'Met at the observatory. Likes quiet worlds and long conversations.',
        revision: { platformAccountId: fixtureAuth(platform).accountId ?? '', epoch: 1 }
      })
    },
    setFriendNote: ({ platform, friendId, note }) => {
      const key = `${platform}:${friendId}`
      if (variant === 'note-save-error' && !failedNoteSaves.has(key)) {
        failedNoteSaves.add(key)
        return Promise.reject(new Error('Synthetic note save failed'))
      }
      notes.set(key, note)
      return Promise.resolve({ ok: true })
    },
    getAlertPicks: ({ platform }) =>
      Promise.resolve({
        friendIds: [...alertPicks[platform]],
        revision: { platformAccountId: fixtureAuth(platform).accountId ?? '', epoch: 1 }
      }),
    setAlertPick: ({ platform, friendIds, picked }) => {
      for (const friendId of friendIds) {
        if (picked) alertPicks[platform].add(friendId)
        else alertPicks[platform].delete(friendId)
      }
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
