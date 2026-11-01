import type { UpdaterSnapshot } from '@shared/ipc'
import type { AuthStatus, Platform } from '@shared/types'
import type { AvatarItem } from '@shared/avatarLibrary'
import type { OwnProfile } from '@shared/ownProfile'
import type { GameFavoriteGroup, GameFavorites } from '@shared/gameFavorites'
import { DEFAULT_SETTINGS } from '@shared/settings'
import {
  activityEntries,
  avatarLibraries,
  communityGroups,
  profileFor,
  searchPeople,
  backgroundPicture,
  friends,
  worlds,
  worldImages,
  getPlatformSnapshot,
  getWorldSnapshot,
  inboxSample,
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
  // The first sample friend per platform and two worlds start starred.
  const favoriteFriends: Record<Platform, Set<string>> = {
    vrchat: new Set(friends.vrchat.slice(0, 1).map((friend) => friend.platformUserId)),
    chilloutvr: new Set(friends.chilloutvr.slice(0, 1).map((friend) => friend.platformUserId))
  }
  const favoriteWorlds: Record<Platform, string[]> = {
    vrchat: worlds.vrchat.slice(0, 2).map((world) => world.worldId),
    chilloutvr: worlds.chilloutvr.slice(0, 1).map((world) => world.worldId)
  }
  const favoriteRevision = (platform: Platform): { platformAccountId: string; epoch: number } => ({
    platformAccountId: fixtureAuth(platform).accountId ?? '',
    epoch: 1
  })
  // The account's own favorite groups: VRChat's fixed groups with caps, and
  // two ChilloutVR categories. The second sample friend and world sit in one.
  const gameGroup = (key: string, name: string, capacity: number | null): GameFavoriteGroup => ({
    key,
    name,
    capacity,
    count: 0
  })
  const gameFavorites: Record<Platform, GameFavorites> = {
    vrchat: {
      oneGroupPerItem: true,
      groups: {
        friend: [
          gameGroup('friend:group_0', 'Close friends', 150),
          gameGroup('friend:group_1', 'Group 2', 150),
          gameGroup('friend:group_2', 'Group 3', 150)
        ],
        world: [
          gameGroup('world:worlds1', 'Hangouts', 100),
          gameGroup('world:worlds2', 'Worlds 2', 100),
          gameGroup('world:worlds3', 'Worlds 3', 100),
          gameGroup('world:worlds4', 'Worlds 4', 100)
        ]
      },
      friends: Object.fromEntries(
        friends.vrchat.slice(1, 2).map((friend) => [friend.platformUserId, ['friend:group_0']])
      ),
      worlds: Object.fromEntries(
        worlds.vrchat.slice(2, 3).map((world) => [world.worldId, ['world:worlds1']])
      ),
      worldList: structuredClone(worlds.vrchat.slice(2, 3))
    },
    chilloutvr: {
      oneGroupPerItem: false,
      groups: {
        friend: [gameGroup('friends_besties', 'Besties', null)],
        world: [
          gameGroup('worlds_chill', 'Chill spots', null),
          gameGroup('worlds_games', 'Game nights', null)
        ]
      },
      friends: Object.fromEntries(
        friends.chilloutvr.slice(1, 2).map((friend) => [friend.platformUserId, ['friends_besties']])
      ),
      worlds: Object.fromEntries(
        worlds.chilloutvr.slice(1, 2).map((world) => [world.worldId, ['worlds_chill']])
      ),
      worldList: structuredClone(worlds.chilloutvr.slice(1, 2))
    }
  }
  const countGameGroups = (favorites: GameFavorites): void => {
    for (const kind of ['friend', 'world'] as const) {
      const items = kind === 'friend' ? favorites.friends : favorites.worlds
      for (const group of favorites.groups[kind]) {
        group.count = Object.values(items).filter((keys) => keys.includes(group.key)).length
      }
    }
  }
  countGameGroups(gameFavorites.vrchat)
  countGameGroups(gameFavorites.chilloutvr)
  const denied = { ok: false, reason: 'launch-failed' } as const
  // The visitor's own profile; a Save changes only this memory.
  const ownProfiles: Record<Platform, OwnProfile> = {
    vrchat: {
      platform: 'vrchat',
      bio: 'Exploring worlds with friends most evenings. Say hi!',
      pronouns: 'they/them',
      status: 'online',
      statusText: 'Around for a bit'
    },
    chilloutvr: {
      platform: 'chilloutvr',
      bio: 'Exploring worlds with friends most evenings. Say hi!',
      pronouns: 'they/them',
      status: null,
      statusText: null
    }
  }
  // Choosing always "picks" the synthetic sample; no dialog or file is involved.
  let picture: string | null = null
  // Hiding rows changes synthetic memory only and tells the scene to re-read.
  let inbox = variant === 'empty' ? { items: [] } : inboxSample(Date.now())
  const inboxListeners = new Set<() => void>()
  const inboxChanged = (): void => {
    for (const listener of inboxListeners) listener()
  }
  // Worn avatars change only in this synthetic memory.
  const worn: Record<Platform, string | null> = {
    vrchat: avatarLibraries.vrchat[0]?.avatarId ?? null,
    chilloutvr: avatarLibraries.chilloutvr[0]?.avatarId ?? null
  }
  // Unfriend and block change only this synthetic memory; the friends list stays.
  const relationships = new Map<string, { isFriend: boolean; blocked: boolean }>()
  const relationshipFor = (
    platform: Platform,
    userId: string
  ): { isFriend: boolean; blocked: boolean } => {
    const key = `${platform}:${userId}`
    const known = relationships.get(key)
    if (known) return known
    const fresh = {
      isFriend: friends[platform].some((friend) => friend.platformUserId === userId),
      blocked: false
    }
    relationships.set(key, fresh)
    return fresh
  }
  const findAvatar = (platform: Platform, avatarId: string): AvatarItem | undefined =>
    avatarLibraries[platform].find((avatar) => avatar.avatarId === avatarId)
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
    setHomeWorld: ({ platform, worldRef }) => {
      const world = worlds[platform].find((entry) => entry.worldRef === worldRef)
      return Promise.resolve(
        world
          ? { ok: true, platform, worldId: world.worldId }
          : { ok: false, reason: 'unknown-world' }
      )
    },
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
    getAvatarLibrary: ({ platform }) =>
      Promise.resolve({
        ok: true,
        platform,
        avatars: structuredClone(avatarLibraries[platform]),
        complete: true,
        current: structuredClone(
          avatarLibraries[platform].find((avatar) => avatar.avatarId === worn[platform]) ?? null
        )
      }),
    getCurrentAvatar: ({ platform }) =>
      Promise.resolve({
        ok: true,
        platform,
        current: structuredClone(
          avatarLibraries[platform].find((avatar) => avatar.avatarId === worn[platform]) ?? null
        )
      }),
    getAvatarDetails: ({ platform, avatarId }) => {
      const avatar = findAvatar(platform, avatarId)
      return Promise.resolve(
        avatar
          ? { ok: true, avatar: structuredClone(avatar) }
          : { ok: false, reason: 'unknown-avatar' }
      )
    },
    switchAvatar: ({ platform, avatarId }) => {
      if (!findAvatar(platform, avatarId)) {
        return Promise.resolve({ ok: false, reason: 'unknown-avatar' })
      }
      worn[platform] = avatarId
      return Promise.resolve({ ok: true })
    },
    getProfile: ({ platform, userId }) => {
      const profile = profileFor(platform, userId)
      return Promise.resolve(
        profile ? { ok: true, profile } : { ok: false, reason: 'not-found' as const }
      )
    },
    getProfileWorlds: ({ platform }) =>
      Promise.resolve({
        ok: true,
        worlds: worlds[platform].slice(0, 3).map((world) => ({
          platform,
          worldId: world.worldId,
          name: world.name,
          imageUrl: world.worldRef
        })),
        complete: true
      }),
    getProfileGroups: ({ platform }) =>
      Promise.resolve({
        ok: true,
        groups: communityGroups[platform].map((group) => ({ ...group, role: null })),
        complete: true
      }),
    searchCommunity: ({ platform, query }) =>
      Promise.resolve({
        ok: true,
        platform,
        query,
        people: searchPeople(platform),
        worlds: structuredClone(worlds[platform].slice(0, 2))
      }),
    getWorldList: ({ platform, list }) =>
      Promise.resolve({
        ok: true,
        platform,
        list,
        worlds: structuredClone(list === 'new' ? worlds[platform] : [...worlds[platform]].reverse())
      }),
    getPlayersOnline: ({ platform }) =>
      Promise.resolve({
        ok: true,
        platform,
        count: platform === 'vrchat' ? 48213 : 1876,
        checkedAt: Date.now()
      }),
    getMyGroups: ({ platform }) =>
      Promise.resolve({
        ok: true,
        platform,
        groups: structuredClone(communityGroups[platform]),
        complete: true
      }),
    getOwnProfile: ({ platform }) =>
      Promise.resolve({ ok: true, profile: structuredClone(ownProfiles[platform]) }),
    saveOwnProfile: ({ platform, changes }) => {
      const current = ownProfiles[platform]
      ownProfiles[platform] = {
        ...current,
        ...(changes.bio !== undefined ? { bio: changes.bio } : {}),
        ...(changes.pronouns !== undefined ? { pronouns: changes.pronouns } : {}),
        ...(platform === 'vrchat' && changes.status !== undefined
          ? { status: changes.status }
          : {}),
        ...(platform === 'vrchat' && changes.statusText !== undefined
          ? { statusText: changes.statusText }
          : {})
      }
      return Promise.resolve({ ok: true, profile: structuredClone(ownProfiles[platform]) })
    },
    getRelationship: ({ platform, userId }) =>
      Promise.resolve({
        ok: true,
        relationship: { platform, userId, ...relationshipFor(platform, userId) }
      }),
    socialAction: ({ platform, userId, action }) => {
      const state = relationshipFor(platform, userId)
      if (action === 'unfriend') {
        if (!state.isFriend) return Promise.resolve({ ok: false, reason: 'not-friend' })
        state.isFriend = false
      } else {
        state.blocked = action === 'block'
      }
      return Promise.resolve({ ok: true, relationship: { platform, userId, ...state } })
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
    openBugReport: () => Promise.resolve(),
    testVrAlert: () => Promise.resolve({ ok: true as const }),
    getAppBackground: () => Promise.resolve(picture === null ? null : { dataUrl: picture }),
    chooseAppBackground: () => {
      picture = backgroundPicture
      return Promise.resolve({ ok: true, dataUrl: picture })
    },
    clearAppBackground: () => {
      picture = null
      return Promise.resolve()
    },
    getInbox: () => Promise.resolve(structuredClone(inbox)),
    dismissInboxItem: ({ platform, id }) => {
      inbox = {
        items: inbox.items.filter((item) => !(item.platform === platform && item.id === id))
      }
      inboxChanged()
      return Promise.resolve()
    },
    clearInbox: ({ platforms }) => {
      inbox = { items: inbox.items.filter((item) => !platforms.includes(item.platform)) }
      inboxChanged()
      return Promise.resolve()
    },
    onInboxChanged: (callback) => {
      inboxListeners.add(callback)
      return () => inboxListeners.delete(callback)
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
    // The copy on the user's account: saved unless a variant shows another state.
    syncFriendNote: ({ platform, friendId, mode }) => {
      const note =
        notes.get(`${platform}:${friendId}`) ??
        'Met at the observatory. Likes quiet worlds and long conversations.'
      if (variant === 'note-account-conflict' && mode !== 'keep-mine' && mode !== 'use-account') {
        return Promise.resolve({
          ok: true,
          state: 'conflict',
          note,
          accountNote: 'Plays drums in a band. Ask about the summer meetup.'
        })
      }
      if (variant === 'note-account-local' && mode === 'check') {
        return Promise.resolve({ ok: true, state: 'local-only', note })
      }
      if (variant === 'note-account-failed' && mode === 'check') {
        return Promise.resolve({ ok: false, reason: 'unavailable' })
      }
      return Promise.resolve({ ok: true, state: 'saved', note })
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
    getFavoriteFriends: ({ platform }) =>
      Promise.resolve({
        friendIds: [...favoriteFriends[platform]],
        revision: favoriteRevision(platform)
      }),
    setFavoriteFriend: ({ platform, friendIds, favorite }) => {
      for (const friendId of friendIds) {
        if (favorite) favoriteFriends[platform].add(friendId)
        else favoriteFriends[platform].delete(friendId)
      }
      return Promise.resolve({ ok: true })
    },
    getFavoriteWorlds: ({ platform }) =>
      Promise.resolve({
        worlds: structuredClone(
          favoriteWorlds[platform].flatMap((worldId) =>
            worlds[platform].filter((world) => world.worldId === worldId)
          )
        ),
        revision: favoriteRevision(platform)
      }),
    setFavoriteWorld: (req) => {
      const ids = favoriteWorlds[req.platform]
      if (req.favorite) {
        const world = worlds[req.platform].find((item) => item.worldRef === req.worldRef)
        if (world && !ids.includes(world.worldId)) ids.unshift(world.worldId)
      } else {
        favoriteWorlds[req.platform] = ids.filter((worldId) => worldId !== req.worldId)
      }
      return Promise.resolve({ ok: true })
    },
    getGameFavorites: ({ platform }) =>
      Promise.resolve({
        state: 'ready',
        favorites: structuredClone(gameFavorites[platform]),
        revision: favoriteRevision(platform)
      }),
    setGameFavorite: (req) => {
      const favorites = gameFavorites[req.platform]
      const world =
        req.kind === 'world'
          ? worlds[req.platform].find((item) => item.worldRef === req.worldRef)
          : undefined
      const id = req.kind === 'friend' ? req.friendId : world?.worldId
      if (id === undefined) return Promise.resolve({ ok: false, reason: 'stale' })
      const items = req.kind === 'friend' ? favorites.friends : favorites.worlds
      const current = items[id] ?? []
      const next = req.on
        ? [...current.filter((key) => key !== req.groupKey), req.groupKey]
        : current.filter((key) => key !== req.groupKey)
      if (next.length > 0) items[id] = next
      else delete items[id]
      if (req.kind === 'world' && world) {
        favorites.worldList = favorites.worldList.filter((item) => item.worldId !== id)
        if (next.length > 0) favorites.worldList.unshift(structuredClone(world))
      }
      countGameGroups(favorites)
      return Promise.resolve({ ok: true, groups: next })
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
