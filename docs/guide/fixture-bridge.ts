import { matchesActivityFilter, matchesActivityListQuery } from '@shared/activity'
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
    getWorldRating: () => Promise.resolve({ ok: true, value: null }),
    setWorldRating: ({ value }) => Promise.resolve({ ok: true, value }),
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
      // `pictures-loading` holds every picture on its way, so the waiting look
      // (Groups, Search tiles) can be inspected.
      if (variant === 'pictures-loading') return new Promise<never>(() => {})
      const dataUrl = worldImages[url] ?? (url.startsWith('data:image/') ? url : undefined)
      return Promise.resolve(dataUrl ? { ok: true, dataUrl } : null)
    },
    // Fixture pictures are data URLs; nothing is kept the way main keeps downloads.
    getKeptAvatar: () => Promise.resolve(null),
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
    // The guide starts nothing: VRChat answers "starting", ChilloutVR "already
    // open"; the `launch-failed` Dashboard variant answers a failed start.
    launchGame: ({ platform }) =>
      Promise.resolve(
        variant === 'launch-failed'
          ? { ok: false, reason: 'launch-failed' }
          : { ok: true, state: platform === 'vrchat' ? 'started' : 'already-open' }
      ),
    getAppStatus: () =>
      Promise.resolve({
        ws: { vrchat: 'live', chilloutvr: 'live' },
        lastReconcileAt: { vrchat: null, chilloutvr: null }
      }),
    // Sample numbers for Settings → Performance. The guide does not measure
    // the machine it is open on.
    getPerformance: () =>
      Promise.resolve({
        version: '1.5.0',
        channel: 'stable',
        platform: 'linux',
        arch: 'x64',
        osRelease: '6.12.0',
        packaged: false,
        totalWorkingSetKiB: 1536,
        processes: [
          { pid: 100, kind: 'browser', name: null, workingSetKiB: 1024, cpuPercent: 1.2 },
          { pid: 101, kind: 'renderer', name: null, workingSetKiB: 512, cpuPercent: null }
        ],
        mainHeapUsedBytes: 32 * 1024 * 1024,
        windowReadyMs: 800,
        firstRenderMs: 900,
        cpuIntervalMs: 2000,
        sockets: { vrchat: 'live', chilloutvr: 'down' }
      }),
    getActivity: () => Promise.resolve(variant === 'empty' ? [] : activityEntries(Date.now())),
    // A friend's History: that friend's sample entries, and a few older ones
    // so the dialog shows more than one day. The Activity page gets no older
    // page: the sample list is shorter than what main keeps in memory.
    getActivityPage: ({ scope, friends, query, filter }) => {
      if (variant === 'empty') return Promise.resolve({ entries: [], hasMore: false })
      if (friends === undefined) {
        if (query === undefined) return Promise.resolve({ entries: [], hasMore: false })
        const now = Date.now()
        const sample = activityEntries(now)
        const names = new Map<string, string[]>()
        for (const entry of sample) {
          const key = `${entry.platform}:${entry.platformUserId}`
          const stored = names.get(key) ?? []
          stored.push(entry.displayName)
          if (entry.previousName !== undefined) stored.push(entry.previousName)
          names.set(key, stored)
        }
        return Promise.resolve({
          entries: sample.filter(
            (entry) =>
              scope.some(
                (cursor) =>
                  cursor.platform === entry.platform &&
                  (cursor.beforeId === null || entry.id < cursor.beforeId)
              ) &&
              matchesActivityFilter(entry.kind, filter) &&
              matchesActivityListQuery(
                entry,
                query,
                names.get(`${entry.platform}:${entry.platformUserId}`) ?? []
              )
          ),
          hasMore: false
        })
      }
      const now = Date.now()
      const wanted = new Set(friends.map((friend) => `${friend.platform}:${friend.friendId}`))
      const sample = activityEntries(now).filter((entry) =>
        wanted.has(`${entry.platform}:${entry.platformUserId}`)
      )
      // Older than every sample row, so ids and times agree.
      const day = 3 * 86_400_000
      const older = friends
        .filter((friend) => scope.some((cursor) => cursor.platform === friend.platform))
        .flatMap((friend, index) =>
          [
            { kind: 'offline' as const, worldName: null, ago: day + index * 60_000 },
            { kind: 'world' as const, worldName: 'Glass Garden Arcade', ago: day + 3_600_000 },
            { kind: 'online' as const, worldName: 'Aurora Transit Lounge', ago: 9 * day },
            {
              kind: 'renamed' as const,
              worldName: null,
              ago: (40 / 3) * day,
              previousName: 'Mossy'
            },
            { kind: 'offline' as const, worldName: null, ago: 400 * day }
          ].map((row, position) => ({
            id: -(index * 10 + position + 1),
            kind: row.kind,
            platform: friend.platform,
            platformUserId: friend.friendId,
            displayName: '',
            worldName: row.worldName,
            ...('previousName' in row ? { previousName: row.previousName } : {}),
            at: now - row.ago
          }))
        )
      return Promise.resolve({
        entries: [...sample, ...older].sort((a, b) => b.at - a.at),
        hasMore: false
      })
    },
    // Friends since and earlier names: the first account is a friendship
    // VRX saw begin, a second one was already there when history started.
    getFriendHistory: ({ friends }) => {
      const now = Date.now()
      return Promise.resolve(
        variant === 'empty'
          ? []
          : friends.map((friend, index) => ({
              platform: friend.platform,
              friendId: friend.friendId,
              since: now - (index === 0 ? 212 : 400) * 86_400_000,
              sinceKnown: index === 0,
              previousNames:
                index === 0
                  ? [
                      { name: 'Mossy', until: now - 40 * 86_400_000 },
                      { name: 'Moss in the Machine', until: now - 150 * 86_400_000 }
                    ]
                  : [],
              met: {
                times: index === 0 ? 37 : 4,
                togetherMs: (index === 0 ? 52 : 3) * 3_600_000 + 25 * 60_000,
                lastAt: now - (index === 0 ? 2 : 20) * 86_400_000,
                lastWorldName:
                  index === 0 ? 'Aurora Transit Lounge' : 'Glass Garden Arcade (#816332)'
              }
            }))
      )
    },
    // The instance log: a room the visitor is in now and a few earlier ones,
    // the same on both platforms.
    getInstanceVisits: ({ scope, query }) => {
      if (variant === 'empty') return Promise.resolve({ visits: [], hasMore: false })
      const now = Date.now()
      const hour = 3_600_000
      const rows = [
        {
          platform: 'vrchat' as const,
          worldName: 'Aurora Transit Lounge',
          ago: 0.6,
          stay: null,
          people: 14
        },
        {
          platform: 'chilloutvr' as const,
          worldName: 'Midnight Museum of Small Wonders',
          ago: 5,
          stay: 1.4,
          people: 6
        },
        {
          platform: 'vrchat' as const,
          worldName: 'Glass Garden Arcade',
          ago: 26,
          stay: 2.1,
          people: 31
        },
        { platform: 'chilloutvr' as const, worldName: null, ago: 29, stay: 0.2, people: 0 },
        {
          platform: 'vrchat' as const,
          worldName: 'A World With a Very Long Name That Has to Truncate Somewhere',
          ago: 75,
          stay: 0.01,
          people: 1
        }
      ]
      return Promise.resolve({
        visits: rows
          .map((row, index) => ({
            id: rows.length - index,
            platform: row.platform,
            worldName: row.worldName,
            enteredAt: now - row.ago * hour,
            leftAt: row.stay === null ? null : now - row.ago * hour + row.stay * hour,
            current: row.stay === null,
            people: row.people
          }))
          .filter(
            (visit) =>
              scope.some(
                (cursor) => cursor.platform === visit.platform && cursor.before === null
              ) &&
              matchesActivityListQuery(
                {
                  displayName: '',
                  worldName: visit.worldName,
                  platform: visit.platform,
                  at: visit.enteredAt
                },
                query,
                visit.platform === 'vrchat'
                  ? ['Iris Circuitbreaker', 'Vale After the Last Train', 'Kai']
                  : ['Pixel Orchard', 'Fern', 'Marlow, Archive Keeper']
              )
          ),
        hasMore: false
      })
    },
    getInstanceVisitPeople: ({ platform }) => {
      const now = Date.now()
      return Promise.resolve(
        (platform === 'vrchat'
          ? ['Iris Circuitbreaker', 'Vale After the Last Train', 'Kai', 'Someone Passing Through']
          : ['Pixel Orchard', 'Fern', 'Marlow, Archive Keeper']
        ).map((displayName, index) => ({
          platformUserId: `guide-visit-${platform}-${index}`,
          displayName,
          joinedAt: now - (36 - index * 7) * 60_000,
          leftAt: index % 2 === 1 ? now - (20 - index * 3) * 60_000 : null
        }))
      )
    },
    clearInstanceLog: () => Promise.resolve(),
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
    joinInvite: () => Promise.resolve(denied),
    getLoginItem: () => Promise.resolve('off'),
    exportData: () =>
      Promise.resolve({
        ok: true,
        friends: 212,
        notes: 14,
        favorites: 31,
        gameFavoritesMissing: false
      }),
    importVrcxHistory: () =>
      Promise.resolve({
        ok: true,
        friendsSince: 38,
        names: 6,
        visits: 412,
        olderSkipped: true,
        otherAccountSkipped: false
      }),
    backupHistory: () => Promise.resolve({ ok: true }),
    restoreHistory: () => Promise.resolve({ ok: true }),
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
    answerFriendRequest: ({ platform, id }) => {
      const before = inbox.items.length
      inbox = {
        items: inbox.items.filter((item) => !(item.platform === platform && item.id === id))
      }
      if (inbox.items.length === before) {
        return Promise.resolve({ ok: false, reason: 'unknown-request' as const })
      }
      inboxChanged()
      return Promise.resolve({ ok: true })
    },
    sendFriendRequest: () => Promise.resolve({ ok: true }),
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
    onDoNotDisturbChanged: unsubscribe,
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
